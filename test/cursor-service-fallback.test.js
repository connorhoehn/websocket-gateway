// test/cursor-service-fallback.test.js
/**
 * Tests for CursorService Redis fallback behavior
 * Ensures cursor service continues operating with local cache when Redis is unavailable
 */

const CursorService = require('../src/services/cursor-service');

// Mock MessageRouter with redisAvailable control
class MockMessageRouter {
    constructor(redisAvailable = true) {
        this.redisAvailable = redisAvailable;
        this.sentMessages = [];
        this.channels = new Map();
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

describe('CursorService Redis Fallback', () => {
    let cursorService;
    let mockMessageRouter;
    let mockLogger;

    beforeEach(() => {
        mockMessageRouter = new MockMessageRouter(true);
        mockLogger = new MockLogger();
        cursorService = new CursorService(mockMessageRouter, mockLogger, null);
    });

    afterEach(async () => {
        if (cursorService) {
            await cursorService.shutdown();
        }
    });

    describe('Redis available - normal operation', () => {
        test('cursor updates write to local Maps when Redis available', async () => {
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: { userColor: '#FF0000' }
            });

            // Should write to local cache
            expect(cursorService.clientCursors.has('client-1')).toBe(true);
            const cursorData = cursorService.clientCursors.get('client-1');
            expect(cursorData.position.x).toBe(100);
            expect(cursorData.position.y).toBe(200);

            // Should write to channel cursors
            expect(cursorService.channelCursors.has('doc-123')).toBe(true);
            const channelMap = cursorService.channelCursors.get('doc-123');
            expect(channelMap.has('client-1')).toBe(true);
        });
    });

    describe('Redis unavailable - degraded mode', () => {
        beforeEach(() => {
            mockMessageRouter.setRedisAvailable(false);
        });

        test('cursor updates write to local clientCursors Map when Redis unavailable', async () => {
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: { userColor: '#FF0000' }
            });

            // Should still write to local cache
            expect(cursorService.clientCursors.has('client-1')).toBe(true);
            const cursorData = cursorService.clientCursors.get('client-1');
            expect(cursorData.position.x).toBe(100);
            expect(cursorData.position.y).toBe(200);
            expect(cursorData.channel).toBe('doc-123');
        });

        test('cursor updates write to channelCursors Map when Redis unavailable', async () => {
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: {}
            });

            // Should write to channel cursors
            expect(cursorService.channelCursors.has('doc-123')).toBe(true);
            const channelMap = cursorService.channelCursors.get('doc-123');
            expect(channelMap.has('client-1')).toBe(true);
            expect(channelMap.get('client-1').position.x).toBe(100);
        });

        test('cursor updates still emit info-level log when Redis unavailable', async () => {
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: {}
            });

            // Service has been simplified to always store locally; it no longer
            // emits a specific "degraded mode" log, but it still logs the update.
            expect(mockLogger.hasLog('info', 'cursor updated')).toBe(true);
        });

        test('cursor updates do not throw errors when Redis unavailable', async () => {
            await expect(async () => {
                await cursorService.handleUpdateCursor('client-1', {
                    channel: 'doc-123',
                    position: { x: 100, y: 200 },
                    metadata: {}
                });
            }).not.toThrow();
        });

        test('multiple cursor updates continue working when Redis unavailable', async () => {
            // Update cursor 1
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: {}
            });

            // Update cursor 2
            await cursorService.handleUpdateCursor('client-2', {
                channel: 'doc-123',
                position: { x: 300, y: 400 },
                metadata: {}
            });

            // Both should be in local cache
            expect(cursorService.clientCursors.size).toBe(2);
            expect(cursorService.channelCursors.get('doc-123').size).toBe(2);
        });
    });

    describe('Redis recovery', () => {
        test('cursor updates resume normal operation when Redis recovers', async () => {
            // Start with Redis down
            mockMessageRouter.setRedisAvailable(false);
            await cursorService.handleUpdateCursor('client-1', {
                channel: 'doc-123',
                position: { x: 100, y: 200 },
                metadata: {}
            });

            // Redis recovers
            mockMessageRouter.setRedisAvailable(true);
            mockMessageRouter.reset();

            // New cursor update
            await cursorService.handleUpdateCursor('client-2', {
                channel: 'doc-123',
                position: { x: 300, y: 400 },
                metadata: {}
            });

            // Should broadcast to messageRouter (Redis)
            expect(mockMessageRouter.sentMessages.length).toBeGreaterThan(0);
        });
    });
});
