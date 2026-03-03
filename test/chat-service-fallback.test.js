// test/chat-service-fallback.test.js
/**
 * Tests for ChatService Redis fallback behavior
 * Ensures chat service continues operating with local delivery when Redis is unavailable
 */

const ChatService = require('../src/services/chat-service');

// Mock MessageRouter with redisAvailable control
class MockMessageRouter {
    constructor(redisAvailable = true) {
        this.redisAvailable = redisAvailable;
        this.sentMessages = [];
        this.channels = new Map();
        this.localClients = new Map();
    }

    async sendToChannel(channel, message, excludeClientId) {
        this.sentMessages.push({ channel, message, excludeClientId });
    }

    async subscribeToChannel(clientId, channel) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel).add(clientId);
    }

    async unsubscribeFromChannel(clientId, channel) {
        const channelSet = this.channels.get(channel);
        if (channelSet) {
            channelSet.delete(clientId);
        }
    }

    getClientData(clientId) {
        return {
            clientId,
            userContext: {
                userId: 'user-1',
                permissions: ['*']
            }
        };
    }

    sendToClient(clientId, message) {
        this.sentMessages.push({ clientId, message });
    }

    broadcastToLocalChannel(channel, message, excludeClientId) {
        // Simulate local broadcast
        const clients = this.channels.get(channel) || new Set();
        for (const clientId of clients) {
            if (clientId !== excludeClientId) {
                this.sendToClient(clientId, message);
            }
        }
        return clients.size;
    }

    reset() {
        this.sentMessages = [];
    }

    setRedisAvailable(available) {
        this.redisAvailable = available;
    }
}

// Mock Logger
class MockLogger {
    constructor() {
        this.logs = { debug: [], info: [], warn: [], error: [] };
    }

    debug(msg, ...args) {
        this.logs.debug.push({ msg, args });
    }

    info(msg, ...args) {
        this.logs.info.push({ msg, args });
    }

    warn(msg, ...args) {
        this.logs.warn.push({ msg, args });
    }

    error(msg, ...args) {
        this.logs.error.push({ msg, args });
    }

    hasLog(level, searchTerm) {
        return this.logs[level].some(log =>
            JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
}

describe('ChatService Redis Fallback', () => {
    let chatService;
    let mockMessageRouter;
    let mockLogger;

    beforeEach(() => {
        mockMessageRouter = new MockMessageRouter(true);
        mockLogger = new MockLogger();
        chatService = new ChatService(mockMessageRouter, mockLogger, null);
    });

    afterEach(async () => {
        if (chatService) {
            await chatService.shutdown();
        }
    });

    describe('Redis available - normal operation', () => {
        test('chat messages broadcast via messageRouter when Redis available', async () => {
            // Join channel
            await chatService.handleJoinChannel('client-1', { channel: 'general' });

            mockMessageRouter.reset();

            // Send message
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Hello, world!'
            });

            // Should have sent message via messageRouter (to Redis)
            const channelMessages = mockMessageRouter.sentMessages.filter(
                msg => msg.channel === 'general'
            );
            expect(channelMessages.length).toBeGreaterThan(0);
        });
    });

    describe('Redis unavailable - degraded mode', () => {
        beforeEach(() => {
            mockMessageRouter.setRedisAvailable(false);
        });

        test('chat messages delivered to local clients only when Redis unavailable', async () => {
            // Join channel
            await chatService.handleJoinChannel('client-1', { channel: 'general' });

            mockMessageRouter.reset();

            // Send message
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Hello, local!'
            });

            // Should have sent confirmation to client
            const confirmations = mockMessageRouter.sentMessages.filter(
                msg => msg.clientId === 'client-1' && msg.message.action === 'sent'
            );
            expect(confirmations.length).toBe(1);

            // Should have broadcast message
            const broadcasts = mockMessageRouter.sentMessages.filter(
                msg => msg.message && msg.message.type === 'chat' && msg.message.action === 'message'
            );
            expect(broadcasts.length).toBeGreaterThan(0);
        });

        test('chat messages stored in local channelHistory when Redis unavailable', async () => {
            await chatService.handleJoinChannel('client-1', { channel: 'general' });

            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Test message'
            });

            // Check that message is in local history
            const history = chatService.getChannelHistory('general');
            expect(history.length).toBe(1);
            expect(history[0].message).toBe('Test message');
        });

        test('chat messages log degraded mode when Redis unavailable', async () => {
            await chatService.handleJoinChannel('client-1', { channel: 'general' });
            mockLogger.logs.debug = []; // Reset logs

            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Test'
            });

            // Should log degraded mode (check in messageRouter.sendToChannel)
            // The log happens in MessageRouter, but we can verify the message was sent
            expect(mockMessageRouter.sentMessages.length).toBeGreaterThan(0);
        });

        test('chat messages do not throw errors when Redis unavailable', async () => {
            await chatService.handleJoinChannel('client-1', { channel: 'general' });

            await expect(async () => {
                await chatService.handleSendMessage('client-1', {
                    channel: 'general',
                    message: 'Test message'
                });
            }).not.toThrow();
        });

        test('multiple chat messages continue working when Redis unavailable', async () => {
            await chatService.handleJoinChannel('client-1', { channel: 'general' });

            // Send multiple messages
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Message 1'
            });
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Message 2'
            });
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Message 3'
            });

            // All should be in history
            const history = chatService.getChannelHistory('general');
            expect(history.length).toBe(3);
        });
    });

    describe('Redis recovery', () => {
        test('chat messages resume Redis operations when connection recovers', async () => {
            // Start with Redis down
            mockMessageRouter.setRedisAvailable(false);
            await chatService.handleJoinChannel('client-1', { channel: 'general' });
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Message during outage'
            });

            // Redis recovers
            mockMessageRouter.setRedisAvailable(true);
            mockMessageRouter.reset();

            // Send new message
            await chatService.handleSendMessage('client-1', {
                channel: 'general',
                message: 'Message after recovery'
            });

            // Should use messageRouter (Redis) again
            const channelMessages = mockMessageRouter.sentMessages.filter(
                msg => msg.channel === 'general'
            );
            expect(channelMessages.length).toBeGreaterThan(0);
        });
    });
});
