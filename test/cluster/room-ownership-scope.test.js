// test/cluster/room-ownership-scope.test.js
/**
 * RoomOwnershipService — DC-FR-3 ClusterScope path unit tests.
 *
 * Sibling to `room-ownership.test.js`. The integration suite there runs
 * a real distributed-core cluster (slow, 30s timeout) and continues to
 * cover the legacy raw-deps path. These tests construct
 * RoomOwnershipService against a *mock* ClusterScope so we can assert,
 * synchronously and deterministically, that:
 *
 *   1. claim()/release() route through scope.claim() / scope.release()
 *      (NOT through the legacy router that was also passed in).
 *   2. ownership:gained / ownership:lost handlers fire with payloads that
 *      ClusterScope has already prefix-stripped — service-emitted events
 *      carry bare `roomId`s.
 *   3. getOwner() consults scope.getEntity() first, then falls back to the
 *      cache, then to scope.isLocal() — in that exact order.
 *   4. detach() unsubscribes from scope (zero zombie listeners): every
 *      handler attached via scope.on() is removed via the SAME function
 *      reference passed to scope.off().
 *
 * No environment flags or async cluster startup — this file is a pure
 * unit test that runs in milliseconds.
 */

const { EventEmitter } = require('events');
const { RoomOwnershipService } = require('../../src/services/room-ownership-service');

function silentLogger() {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
}

/**
 * Minimal ClusterScope mock. Mirrors v0.6.7's surface: claim/release/
 * getEntity/isLocal/on/off. Internally tracks every (event, handler) pair
 * passed to on() so the test can drive listeners and verify off() cleans
 * up symmetrically.
 *
 * The mock represents events as ALREADY prefix-stripped — the real
 * ClusterScope strips the prefix off `payload.resourceId` and
 * `record.entityId` before invoking the consumer's handler, so the
 * service should see bare roomIds without any unwrapping logic.
 */
function createMockScope({ nodeId = 'node-A' } = {}) {
    const emitter = new EventEmitter();
    const calls = {
        claim: [],
        release: [],
        getEntity: [],
        isLocal: [],
        on: [],
        off: [],
    };
    let entityToReturn = null;
    let isLocalReturn = false;

    return {
        // Real ClusterScope methods.
        async claim(roomId, options) {
            calls.claim.push({ roomId, options });
            return { resourceId: roomId };
        },
        async release(roomId) {
            calls.release.push({ roomId });
        },
        getEntity(roomId) {
            calls.getEntity.push({ roomId });
            return entityToReturn;
        },
        isLocal(roomId) {
            calls.isLocal.push({ roomId });
            return isLocalReturn;
        },
        on(event, handler) {
            calls.on.push({ event, handler });
            emitter.on(event, handler);
            return this;
        },
        off(event, handler) {
            calls.off.push({ event, handler });
            emitter.off(event, handler);
            return this;
        },

        // Test introspection helpers (NOT part of the ClusterScope surface).
        _calls: calls,
        _nodeId: nodeId,
        _setEntity(record) { entityToReturn = record; },
        _setIsLocal(v) { isLocalReturn = v; },
        _emit(event, payload) { emitter.emit(event, payload); },
        _listenerCount(event) { return emitter.listenerCount(event); },
    };
}

describe('RoomOwnershipService — DC-FR-3 scope path', () => {
    test('claim() routes through scope.claim, not raw router', async () => {
        const scope = createMockScope();
        const router = { claim: jest.fn(), release: jest.fn(), isLocal: jest.fn() };
        const service = new RoomOwnershipService({
            scope,
            // Pass raw deps too, to verify scope wins.
            router,
            registry: { on: jest.fn(), off: jest.fn(), getEntity: jest.fn() },
            rebalanceManager: { on: jest.fn(), off: jest.fn() },
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        expect(service.isEnabled()).toBe(true);

        await service.claim('room-1');

        expect(scope._calls.claim).toHaveLength(1);
        expect(scope._calls.claim[0].roomId).toBe('room-1');
        expect(scope._calls.claim[0].options).toEqual({
            metadata: { resourceType: 'room' },
        });
        expect(router.claim).not.toHaveBeenCalled();

        // claim() primes lastKnownOwnerMap and ownedRooms.
        expect(service.getStats().ownedRoomCount).toBe(1);
    });

    test('release() routes through scope.release, not raw router', async () => {
        const scope = createMockScope();
        const router = { claim: jest.fn(), release: jest.fn(), isLocal: jest.fn() };
        const service = new RoomOwnershipService({
            scope,
            router,
            registry: { on: jest.fn(), off: jest.fn(), getEntity: jest.fn() },
            rebalanceManager: { on: jest.fn(), off: jest.fn() },
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        await service.claim('room-1');
        await service.release('room-1');

        expect(scope._calls.release).toHaveLength(1);
        expect(scope._calls.release[0].roomId).toBe('room-1');
        expect(router.release).not.toHaveBeenCalled();
        expect(service.getStats().ownedRoomCount).toBe(0);
    });

    test('ownership:gained handler fires with prefix-stripped resourceId', () => {
        const scope = createMockScope();
        const service = new RoomOwnershipService({
            scope,
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        const seen = [];
        service.on('ownership:gained', (p) => seen.push(p));

        // ClusterScope rewrites the prefixed `rooms:room-7` back to bare
        // `room-7` before invoking our handler — the mock simulates the
        // already-stripped payload.
        scope._emit('ownership:gained', {
            resourceId: 'room-7',
            newOwnerId: 'node-A',
            previousOwnerId: null,
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
            roomId: 'room-7',
            ownerId: 'node-A',
            isLocal: true,
        });
        // Verify the cache + ownedRooms now contain the bare id.
        expect(service.getStats().knownRoomCount).toBe(1);
        expect(service.getStats().ownedRoomCount).toBe(1);
    });

    test('ownership:lost handler fires with prefix-stripped resourceId', () => {
        const scope = createMockScope();
        const service = new RoomOwnershipService({
            scope,
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        const seen = [];
        service.on('ownership:lost', (p) => seen.push(p));

        scope._emit('ownership:lost', {
            resourceId: 'room-9',
            newOwnerId: 'node-B',
            previousOwnerId: 'node-A',
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
            roomId: 'room-9',
            ownerId: 'node-B',
            previousOwnerId: 'node-A',
            isLocal: false,
        });
    });

    test('entity:* handlers update lastKnownOwnerMap with bare entityId', () => {
        const scope = createMockScope();
        const service = new RoomOwnershipService({
            scope,
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        // entity:created — record.entityId is already prefix-stripped by scope.
        scope._emit('entity:created', { entityId: 'room-X', ownerNodeId: 'node-B' });
        expect(service.lastKnownOwnerMap.get('room-X')).toBe('node-B');

        // entity:transferred — owner change.
        scope._emit('entity:transferred', { entityId: 'room-X', ownerNodeId: 'node-C' });
        expect(service.lastKnownOwnerMap.get('room-X')).toBe('node-C');

        // entity:deleted — drop from cache.
        scope._emit('entity:deleted', { entityId: 'room-X', ownerNodeId: 'node-C' });
        expect(service.lastKnownOwnerMap.has('room-X')).toBe(false);
    });

    test('getOwner() consults scope.getEntity, then cache, then scope.isLocal', () => {
        const scope = createMockScope();
        const service = new RoomOwnershipService({
            scope,
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        // 1. getEntity returns a record → that wins.
        scope._setEntity({ entityId: 'room-1', ownerNodeId: 'node-B' });
        const r1 = service.getOwner('room-1');
        expect(r1).toEqual({ ownerId: 'node-B', isLocal: false });
        expect(scope._calls.getEntity).toHaveLength(1);
        expect(scope._calls.getEntity[0].roomId).toBe('room-1');
        expect(scope._calls.isLocal).toHaveLength(0); // never reached

        // 2. getEntity returns null → fall through to cache.
        scope._setEntity(null);
        service.lastKnownOwnerMap.set('room-2', 'node-C');
        const r2 = service.getOwner('room-2');
        expect(r2).toEqual({ ownerId: 'node-C', isLocal: false });
        expect(scope._calls.isLocal).toHaveLength(0); // still not reached — cache hit

        // 3. getEntity null + cache miss → fall through to scope.isLocal.
        scope._setIsLocal(true);
        const r3 = service.getOwner('room-3');
        expect(r3).toEqual({ ownerId: 'node-A', isLocal: true });
        expect(scope._calls.isLocal).toHaveLength(1);
        expect(scope._calls.isLocal[0].roomId).toBe('room-3');

        // 4. all three return nothing → null.
        scope._setIsLocal(false);
        const r4 = service.getOwner('room-4');
        expect(r4).toBeNull();
    });

    test('detach() unsubscribes every scope listener (zero zombies)', () => {
        const scope = createMockScope();
        const service = new RoomOwnershipService({
            scope,
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        // Six on() calls expected: ownership:gained|lost +
        // entity:created|updated|transferred|deleted.
        expect(scope._calls.on).toHaveLength(6);
        expect(scope._listenerCount('ownership:gained')).toBe(1);
        expect(scope._listenerCount('ownership:lost')).toBe(1);
        expect(scope._listenerCount('entity:created')).toBe(1);
        expect(scope._listenerCount('entity:updated')).toBe(1);
        expect(scope._listenerCount('entity:transferred')).toBe(1);
        expect(scope._listenerCount('entity:deleted')).toBe(1);

        service.detach();

        // Six off() calls, each with the SAME handler reference passed to on().
        expect(scope._calls.off).toHaveLength(6);
        for (const offCall of scope._calls.off) {
            const matchingOn = scope._calls.on.find(
                (onCall) => onCall.event === offCall.event && onCall.handler === offCall.handler,
            );
            expect(matchingOn).toBeDefined();
        }

        // Zero zombies — every listener has been removed.
        expect(scope._listenerCount('ownership:gained')).toBe(0);
        expect(scope._listenerCount('ownership:lost')).toBe(0);
        expect(scope._listenerCount('entity:created')).toBe(0);
        expect(scope._listenerCount('entity:updated')).toBe(0);
        expect(scope._listenerCount('entity:transferred')).toBe(0);
        expect(scope._listenerCount('entity:deleted')).toBe(0);

        // Idempotent — second detach() is a no-op, no extra off() calls.
        service.detach();
        expect(scope._calls.off).toHaveLength(6);
    });

    test('detach() does NOT touch raw deps when scope path is active', () => {
        const scope = createMockScope();
        const rebalanceManager = { on: jest.fn(), off: jest.fn() };
        const registry = { on: jest.fn(), off: jest.fn(), getEntity: jest.fn() };

        const service = new RoomOwnershipService({
            scope,
            rebalanceManager,
            registry,
            router: { claim: jest.fn(), release: jest.fn(), isLocal: jest.fn() },
            nodeId: 'node-A',
            logger: silentLogger(),
        });

        // Scope-path attach: raw rebalanceManager / registry should NEVER
        // have been subscribed to.
        expect(rebalanceManager.on).not.toHaveBeenCalled();
        expect(registry.on).not.toHaveBeenCalled();

        service.detach();

        expect(rebalanceManager.off).not.toHaveBeenCalled();
        expect(registry.off).not.toHaveBeenCalled();
    });
});
