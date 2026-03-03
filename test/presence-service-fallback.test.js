// test/presence-service-fallback.test.js
/**
 * Tests for PresenceService Redis fallback behavior
 * Ensures presence service continues operating with local cache when Redis is unavailable
 */

const PresenceService = require('../src/services/presence-service');

// Mock MessageRouter with redisAvailable control
class MockMessageRouter {
    constructor(redisAvailable = true) {
        this.redisAvailable = redisAvailable;
        this.sentMessages = [];
        this.channelMessages = [];
    }

    async sendToChannel(channel, message, excludeClientId) {
        this.channelMessages.push({ channel, message, excludeClientId });
    }

    async subscribeToChannel(clientId, channel) {}
    async unsubscribeFromChannel(clientId, channel) {}

    getClientData(clientId) {
        return {
            clientId,
            userContext: {
                userId: 'user-1',
                channels: ['general', 'public:test'],
            }
        };
    }

    sendToClient(clientId, message) {
        this.sentMessages.push({ clientId, message });
    }

    reset() {
        this.sentMessages = [];
        this.channelMessages = [];
    }

    setRedisAvailable(available) {
        this.redisAvailable = available;
    }
}

// Mock NodeManager
class MockNodeManager {
    get nodeId() { return 'node-1'; }
}

// Mock Logger
class MockLogger {
    constructor() {
        this.logs = { debug: [], info: [], warn: [], error: [] };
    }

    debug(msg, ...args) { this.logs.debug.push({ msg, args }); }
    info(msg, ...args) { this.logs.info.push({ msg, args }); }
    warn(msg, ...args) { this.logs.warn.push({ msg, args }); }
    error(msg, ...args) { this.logs.error.push({ msg, args }); }

    hasLog(level, searchTerm) {
        return this.logs[level].some(log =>
            JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
}

describe('PresenceService Redis Fallback', () => {
    let presenceService;
    let mockMessageRouter;
    let mockLogger;

    beforeEach(() => {
        mockMessageRouter = new MockMessageRouter(true);
        mockLogger = new MockLogger();
        presenceService = new PresenceService(mockMessageRouter, new MockNodeManager(), mockLogger);
    });

    afterEach(async () => {
        if (presenceService) {
            await presenceService.shutdown();
        }
    });

    describe('Redis available — normal operation', () => {
        test('presence updates broadcast to channel via sendToChannel when Redis available', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            const channelMsg = mockMessageRouter.channelMessages.find(m =>
                m.channel === 'presence:general'
            );
            expect(channelMsg).toBeDefined();
            expect(channelMsg.message.type).toBe('presence');
            expect(channelMsg.message.action).toBe('update');
        });

        test('presence data is stored locally regardless of Redis state', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'away',
                metadata: { device: 'mobile' },
                channels: []
            });

            expect(presenceService.clientPresence.has('client-1')).toBe(true);
            const data = presenceService.clientPresence.get('client-1');
            expect(data.status).toBe('away');
        });
    });

    describe('Redis unavailable — degraded mode', () => {
        beforeEach(() => {
            mockMessageRouter.setRedisAvailable(false);
        });

        test('sendToChannel is still called when Redis unavailable (MessageRouter handles fallback)', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            // Presence service delegates fallback to MessageRouter.sendToChannel
            const channelMsg = mockMessageRouter.channelMessages.find(m =>
                m.channel === 'presence:general'
            );
            expect(channelMsg).toBeDefined();
        });

        test('logs debug message when Redis unavailable and client has channels', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            expect(mockLogger.hasLog('debug', 'redis unavailable')).toBe(true);
        });

        test('does not log degraded mode when client has no channels', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: []
            });

            // No channels = no broadcast = no degraded mode log
            expect(mockLogger.hasLog('debug', 'redis unavailable')).toBe(false);
        });

        test('presence updates do not throw when Redis unavailable', async () => {
            await expect(async () => {
                await presenceService.handleSetPresence('client-1', {
                    status: 'busy',
                    metadata: {},
                    channels: ['general']
                });
            }).not.toThrow();
        });

        test('presence is stored locally even when Redis unavailable', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'away',
                metadata: {},
                channels: ['general']
            });

            expect(presenceService.clientPresence.has('client-1')).toBe(true);
            expect(presenceService.clientPresence.get('client-1').status).toBe('away');
        });

        test('multiple presence updates continue working during Redis outage', async () => {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            await presenceService.handleSetPresence('client-2', {
                status: 'busy',
                metadata: {},
                channels: ['general']
            });

            expect(presenceService.clientPresence.size).toBe(2);
            expect(presenceService.clientPresence.get('client-1').status).toBe('online');
            expect(presenceService.clientPresence.get('client-2').status).toBe('busy');
        });
    });

    describe('Redis recovery', () => {
        test('presence broadcasts resume via sendToChannel after Redis recovers', async () => {
            // Redis down: set presence
            mockMessageRouter.setRedisAvailable(false);
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            // Redis recovers
            mockMessageRouter.setRedisAvailable(true);
            mockMessageRouter.reset();

            // New presence update after recovery
            await presenceService.handleSetPresence('client-2', {
                status: 'online',
                metadata: {},
                channels: ['general']
            });

            const channelMsg = mockMessageRouter.channelMessages.find(m =>
                m.channel === 'presence:general'
            );
            expect(channelMsg).toBeDefined();
        });
    });
});
