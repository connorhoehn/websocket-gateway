// test/redis-degradation.test.js
/**
 * Tests for Redis connection degradation handling
 * Ensures services gracefully degrade to local cache when Redis becomes unavailable
 */

const EventEmitter = require('events');
const MessageRouter = require('../src/core/message-router');

// Mock Redis client that extends EventEmitter
class MockRedisPublisher extends EventEmitter {
    constructor() {
        super();
        this.publishedMessages = [];
    }

    async publish(channel, message) {
        this.publishedMessages.push({ channel, message });
        return 1;
    }

    reset() {
        this.publishedMessages = [];
    }
}

class MockRedisSubscriber extends EventEmitter {
    constructor() {
        super();
        this.subscriptions = new Map();
    }

    async subscribe(channel, handler) {
        this.subscriptions.set(channel, handler);
    }

    async unsubscribe(channel) {
        this.subscriptions.delete(channel);
    }
}

// Mock NodeManager
class MockNodeManager {
    constructor() {
        this.nodeId = 'test-node-1';
        this.clients = new Map();
        this.channelSubscriptions = new Map();
    }

    registerClient(clientId, metadata) {
        this.clients.set(clientId, { metadata, channels: new Set() });
    }

    async unregisterClient(clientId) {
        this.clients.delete(clientId);
    }

    async subscribeClientToChannel(clientId, channel) {
        const client = this.clients.get(clientId);
        if (client) {
            client.channels.add(channel);
        }
        if (!this.channelSubscriptions.has(channel)) {
            this.channelSubscriptions.set(channel, new Set());
        }
        this.channelSubscriptions.get(channel).add(this.nodeId);
    }

    async unsubscribeClientFromChannel(clientId, channel) {
        const client = this.clients.get(clientId);
        if (client) {
            client.channels.delete(channel);
        }
    }

    async getNodesForChannel(channel) {
        const nodes = this.channelSubscriptions.get(channel);
        return nodes ? Array.from(nodes) : [];
    }

    async getClientNode(clientId) {
        return this.clients.has(clientId) ? this.nodeId : null;
    }

    // Mirror of NodeManager.getClientsForChannel. In prod this is an O(1)
    // lookup on a reverse index; the mock derives it from the per-client
    // channel sets since its data model is keyed by client.
    getClientsForChannel(channel) {
        const result = new Set();
        for (const [clientId, client] of this.clients) {
            if (client.channels.has(channel)) result.add(clientId);
        }
        return result;
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

    reset() {
        this.logs = { debug: [], info: [], warn: [], error: [] };
    }

    hasLog(level, searchTerm) {
        return this.logs[level].some(log =>
            JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
}

describe('MessageRouter Redis Degradation', () => {
    let messageRouter;
    let mockNodeManager;
    let mockRedisPublisher;
    let mockRedisSubscriber;
    let mockLogger;

    beforeEach(() => {
        mockNodeManager = new MockNodeManager();
        mockRedisPublisher = new MockRedisPublisher();
        mockRedisSubscriber = new MockRedisSubscriber();
        mockLogger = new MockLogger();

        messageRouter = new MessageRouter(
            mockNodeManager,
            mockRedisPublisher,
            mockRedisSubscriber,
            mockLogger
        );
    });

    afterEach(() => {
        if (messageRouter) {
            messageRouter.cleanup();
        }
    });

    describe('Redis health monitoring', () => {
        test('redisAvailable should be set to false on ECONNREFUSED error from redisPublisher', () => {
            // Initially should be true
            expect(messageRouter.redisAvailable).toBe(true);

            // Simulate Redis connection error
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            mockRedisPublisher.emit('error', error);

            // Should now be false
            expect(messageRouter.redisAvailable).toBe(false);
            expect(mockLogger.hasLog('warn', 'redis unavailable')).toBe(true);
        });

        test('redisAvailable should be set to true on ready event from redisPublisher', () => {
            // Start with Redis unavailable
            const error = new Error('Connection reset');
            error.code = 'ECONNRESET';
            mockRedisPublisher.emit('error', error);
            expect(messageRouter.redisAvailable).toBe(false);

            // Emit ready event
            mockRedisPublisher.emit('ready');

            // Should now be true
            expect(messageRouter.redisAvailable).toBe(true);
            expect(mockLogger.hasLog('info', 'redis connection restored')).toBe(true);
        });

        test('redisAvailable should be set to false on ECONNRESET error', () => {
            const error = new Error('Connection reset');
            error.code = 'ECONNRESET';
            mockRedisPublisher.emit('error', error);

            expect(messageRouter.redisAvailable).toBe(false);
        });

        test('redisAvailable should be set to false on ETIMEDOUT error', () => {
            const error = new Error('Connection timed out');
            error.code = 'ETIMEDOUT';
            mockRedisPublisher.emit('error', error);

            expect(messageRouter.redisAvailable).toBe(false);
        });

        test('redisAvailable should be set to false on EAI_AGAIN error', () => {
            const error = new Error('DNS lookup failed');
            error.code = 'EAI_AGAIN';
            mockRedisPublisher.emit('error', error);

            expect(messageRouter.redisAvailable).toBe(false);
        });

        test('redisAvailable should remain true on non-connection errors', () => {
            const error = new Error('Some other error');
            error.code = 'OTHER_ERROR';
            mockRedisPublisher.emit('error', error);

            // Should still be true as it's not a connection error
            expect(messageRouter.redisAvailable).toBe(true);
        });
    });

    describe('sendToChannel fallback behavior', () => {
        beforeEach(async () => {
            // Register a local client
            const mockWs = {
                readyState: 1, // WebSocket.OPEN
                send: jest.fn()
            };
            messageRouter.registerLocalClient('client-1', mockWs, {});
            await messageRouter.subscribeToChannel('client-1', 'test-channel');
        });

        test('sendToChannel should publish to Redis when redisAvailable is true', async () => {
            mockRedisPublisher.reset();

            const testMessage = { type: 'test', data: 'hello' };
            await messageRouter.sendToChannel('test-channel', testMessage);

            // Should have published to Redis
            expect(mockRedisPublisher.publishedMessages.length).toBe(1);
            expect(mockRedisPublisher.publishedMessages[0].channel).toBe('websocket:route:test-channel');
        });

        test('sendToChannel should fall back to local-only broadcast when redisAvailable is false', async () => {
            // Simulate Redis failure
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            mockRedisPublisher.emit('error', error);
            mockRedisPublisher.reset();

            const testMessage = { type: 'test', data: 'hello' };
            await messageRouter.sendToChannel('test-channel', testMessage);

            // Should NOT have published to Redis
            expect(mockRedisPublisher.publishedMessages.length).toBe(0);

            // Should log that it's using local cache
            expect(mockLogger.hasLog('debug', 'local')).toBe(true);
        });

        test('sendToChannel should resume Redis publishing when redisAvailable becomes true', async () => {
            // Start with Redis down
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            mockRedisPublisher.emit('error', error);
            mockRedisPublisher.reset();

            // Send message - should use local only
            const testMessage1 = { type: 'test', data: 'hello1' };
            await messageRouter.sendToChannel('test-channel', testMessage1);
            expect(mockRedisPublisher.publishedMessages.length).toBe(0);

            // Restore Redis
            mockRedisPublisher.emit('ready');
            mockRedisPublisher.reset();

            // Send message - should use Redis
            const testMessage2 = { type: 'test', data: 'hello2' };
            await messageRouter.sendToChannel('test-channel', testMessage2);
            expect(mockRedisPublisher.publishedMessages.length).toBe(1);
        });

        test('local clients should still receive messages when Redis is down', async () => {
            // Register and subscribe client
            const mockWs = {
                readyState: 1,
                send: jest.fn()
            };
            messageRouter.registerLocalClient('client-2', mockWs, {});
            await messageRouter.subscribeToChannel('client-2', 'test-channel');

            // Simulate Redis failure
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            mockRedisPublisher.emit('error', error);

            // Send message
            const testMessage = { type: 'test', data: 'hello' };
            await messageRouter.sendToChannel('test-channel', testMessage);

            // Local client should have received the message
            expect(mockWs.send).toHaveBeenCalled();
        });
    });

    describe('subscribeToRedisChannel behavior during outage', () => {
        test('subscribeToRedisChannel should not fail when Redis is unavailable', async () => {
            // Simulate Redis failure
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            mockRedisPublisher.emit('error', error);

            // Should not throw
            await expect(async () => {
                await messageRouter.subscribeToRedisChannel('test-channel');
            }).not.toThrow();
        });
    });
});
