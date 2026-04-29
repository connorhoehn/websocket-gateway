// test/services/presence-shadow-write.test.js
/**
 * Shadow-write tests for PresenceService.
 *
 * Validates the additive TTL-aware EntityRegistry secondary path:
 *   - When the optional `presenceRegistry` ctor option is provided,
 *     set / setClientOffline (update) / heartbeat / disconnect-cleanup
 *     each call proposeEntity / updateEntity / releaseEntity on the
 *     registry mock with `presence:<clientId>` and `{ ttlMs }`.
 *   - When the registry method throws, the in-memory presence path
 *     still succeeds (resilience requirement: never affect the live
 *     path).
 *   - When `presenceRegistry` is omitted (default), no shadow-writes
 *     occur — preserving byte-identical pre-flag behaviour.
 */

const PresenceService = require('../../src/services/presence-service');
const { PRESENCE_TIMEOUT_MS } = require('../../src/config/constants');

class MockMessageRouter {
    constructor() {
        this.redisAvailable = true;
        this.sentMessages = [];
        this.channelMessages = [];
    }
    async sendToChannel(channel, message, excludeClientId) {
        this.channelMessages.push({ channel, message, excludeClientId });
    }
    async subscribeToChannel() {}
    async unsubscribeFromChannel() {}
    sendToClient(clientId, message) {
        this.sentMessages.push({ clientId, message });
    }
}

class MockNodeManager {
    get nodeId() { return 'node-1'; }
}

class SilentLogger {
    constructor() {
        this.warns = [];
    }
    debug() {}
    info() {}
    warn(msg, ...args) { this.warns.push({ msg, args }); }
    error() {}
}

/**
 * Mock EntityRegistry. proposeEntity is upsert-shaped: on second call
 * for the same id we throw EntityAlreadyExistsError to mirror the real
 * CrdtEntityRegistry contract; PresenceService falls back to updateEntity.
 */
function makeMockRegistry() {
    const calls = { propose: [], update: [], release: [] };
    const seen = new Set();

    const registry = {
        async proposeEntity(entityId, data, options) {
            calls.propose.push({ entityId, data, options });
            if (seen.has(entityId)) {
                const err = new Error(`Entity ${entityId} already exists`);
                err.name = 'EntityAlreadyExistsError';
                throw err;
            }
            seen.add(entityId);
            return { entityId, ownerNodeId: 'node-1', metadata: data };
        },
        async updateEntity(entityId, data, options) {
            calls.update.push({ entityId, data, options });
            return { entityId, ownerNodeId: 'node-1', metadata: data };
        },
        async releaseEntity(entityId) {
            calls.release.push({ entityId });
            seen.delete(entityId);
        },
        _calls: calls,
    };
    return registry;
}

describe('PresenceService shadow-write secondary path', () => {
    let presenceService;
    let messageRouter;
    let logger;
    let registry;

    beforeEach(() => {
        messageRouter = new MockMessageRouter();
        logger = new SilentLogger();
        registry = makeMockRegistry();
        presenceService = new PresenceService(
            messageRouter,
            new MockNodeManager(),
            logger,
            null,
            { presenceRegistry: registry }
        );
    });

    afterEach(async () => {
        if (presenceService) await presenceService.shutdown();
    });

    test('handleSetPresence writes to registry with ttlMs = PRESENCE_TIMEOUT_MS', async () => {
        await presenceService.handleSetPresence('client-1', {
            status: 'online',
            metadata: { userId: 'user-1' },
            channels: ['general'],
        });

        expect(registry._calls.propose.length).toBe(1);
        const call = registry._calls.propose[0];
        expect(call.entityId).toBe('presence:client-1');
        expect(call.options).toEqual({ ttlMs: PRESENCE_TIMEOUT_MS });
        expect(call.data.roomId).toBe('general');
        expect(call.data.userId).toBe('user-1');
        expect(typeof call.data.lastHeartbeat).toBe('number');
    });

    test('handleHeartbeat refreshes registry entry (falls back to updateEntity on second write)', async () => {
        await presenceService.handleSetPresence('client-1', {
            status: 'online',
            metadata: {},
            channels: ['general'],
        });
        await presenceService.handleHeartbeat('client-1', {});

        // First call propose succeeds; second call throws AlreadyExists and
        // PresenceService falls back to updateEntity with the same TTL.
        expect(registry._calls.propose.length).toBe(2);
        expect(registry._calls.update.length).toBe(1);

        const update = registry._calls.update[0];
        expect(update.entityId).toBe('presence:client-1');
        expect(update.options).toEqual({ ttlMs: PRESENCE_TIMEOUT_MS });
    });

    test('setClientOffline (update path) shadow-writes with ttlMs', async () => {
        await presenceService.handleSetPresence('client-1', {
            status: 'online',
            metadata: {},
            channels: ['general'],
        });
        await presenceService.setClientOffline('client-1');

        // setClientOffline triggered a second proposeEntity (which throws
        // AlreadyExists) and falls back to updateEntity.
        expect(registry._calls.update.length).toBeGreaterThanOrEqual(1);
        const last = registry._calls.update[registry._calls.update.length - 1];
        expect(last.entityId).toBe('presence:client-1');
        expect(last.options).toEqual({ ttlMs: PRESENCE_TIMEOUT_MS });
    });

    test('onClientDisconnect schedules releaseEntity on cleanup', async () => {
        jest.useFakeTimers();
        try {
            await presenceService.handleSetPresence('client-1', {
                status: 'online',
                metadata: {},
                channels: ['general'],
            });

            await presenceService.onClientDisconnect('client-1');

            // The release happens inside the disconnect-delay setTimeout.
            // Advance timers, then flush microtasks (release is a Promise).
            jest.runAllTimers();
        } finally {
            jest.useRealTimers();
        }

        // Allow the queued microtask (Promise.resolve(...)) to run.
        await new Promise((r) => setImmediate(r));

        expect(registry._calls.release.length).toBe(1);
        expect(registry._calls.release[0].entityId).toBe('presence:client-1');
    });

    test('registry failure does not affect the live presence path (resilience)', async () => {
        const throwingRegistry = {
            async proposeEntity() { throw new Error('registry boom'); },
            async updateEntity() { throw new Error('registry boom'); },
            async releaseEntity() { throw new Error('registry boom'); },
        };

        // Replace the registry on the existing service (simulates the
        // attachment helper used by server.js after lazy bootstrap).
        presenceService.setPresenceRegistry(throwingRegistry);

        // The live path must still succeed.
        await expect(
            presenceService.handleSetPresence('client-2', {
                status: 'online',
                metadata: {},
                channels: ['general'],
            })
        ).resolves.not.toThrow();

        // In-memory map populated.
        expect(presenceService.clientPresence.has('client-2')).toBe(true);

        // Heartbeat also succeeds despite the registry throwing.
        await expect(presenceService.handleHeartbeat('client-2', {})).resolves.not.toThrow();

        // setClientOffline also succeeds.
        await expect(presenceService.setClientOffline('client-2')).resolves.not.toThrow();

        // Logger captured warnings (registry failures must be visible).
        expect(logger.warns.length).toBeGreaterThan(0);
    });
});

describe('PresenceService without shadow-write (default behaviour)', () => {
    test('omitting presenceRegistry results in zero shadow writes', async () => {
        const messageRouter = new MockMessageRouter();
        const logger = new SilentLogger();
        const svc = new PresenceService(messageRouter, new MockNodeManager(), logger);

        // No registry attached. set/heartbeat/disconnect must not error and
        // there is no registry to assert against — the meaningful assertion
        // is simply that the service field is null.
        expect(svc.presenceRegistry).toBeNull();

        await svc.handleSetPresence('client-1', {
            status: 'online',
            metadata: {},
            channels: ['general'],
        });
        await svc.handleHeartbeat('client-1', {});
        await svc.setClientOffline('client-1');
        await svc.onClientDisconnect('client-1');

        expect(svc.presenceRegistry).toBeNull();
        await svc.shutdown();
    });
});
