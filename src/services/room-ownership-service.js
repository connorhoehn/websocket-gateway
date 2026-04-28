// services/room-ownership-service.js
/**
 * RoomOwnershipService — gateway-side wrapper around distributed-core's
 * RebalanceManager + ResourceRouter + CrdtEntityRegistry (Wave 4b W1).
 *
 * Public surface:
 *   - claim(roomId)           → resourceId or null when flag is off
 *   - release(roomId)         → Promise<void>
 *   - getOwner(roomId)        → { ownerId, isLocal } | null
 *   - on('ownership:gained')  → { roomId, ownerId, previousOwnerId, isLocal: true }
 *   - on('ownership:lost')    → { roomId, ownerId, isLocal: false }
 *   - getStats()              → { ownedRoomCount, knownRoomCount }
 *
 * Singleton: `getRoomOwnershipService({ logger? } = {})` lazily bootstraps
 * the gateway cluster on first call. If `bootstrapGatewayCluster()` returns
 * null (feature flag off), the singleton is a no-op shim — `claim()` and
 * `release()` succeed silently, `getOwner()` returns null, `getStats()`
 * returns zeros, and event subscribers are never invoked.
 *
 * `lastKnownOwnerMap` — local cache (post-DC-PIPELINE-6 / M11):
 *   distributed-core v0.4.0 added `RebalanceManager.start({ seedOwnership: true })`
 *   which pre-populates the manager's own ownerCache from the registry, so
 *   `previousOwnerId` is now correct without our intervention. The local map
 *   is retained for two independent reasons:
 *     1. Timing-window fallback in `getOwner()` when the registry's view
 *        hasn't caught up to a recent local claim/release.
 *     2. Backing the `knownRoomCount` stat without round-tripping the registry.
 *   Registry-event subscriptions keep the cache fresh for *remote* resources
 *   as the CRDT converges.
 *
 * Wave 4c will hook this service into message-router and presence-service.
 *
 * @group services
 */

const { EventEmitter } = require('events');
const Logger = require('../utils/logger');
const { bootstrapGatewayCluster } = require('../cluster/cluster-bootstrap');

const ROOM_RESOURCE_TYPE = 'room';

class RoomOwnershipService extends EventEmitter {
    /**
     * @param {object} deps
     * @param {object} [deps.rebalanceManager]
     * @param {object} [deps.registry]
     * @param {object} [deps.router]
     * @param {string} [deps.nodeId]
     * @param {object} [deps.logger]
     */
    constructor({ rebalanceManager, registry, router, nodeId, logger } = {}) {
        super();
        this.rebalanceManager = rebalanceManager || null;
        this.registry = registry || null;
        this.router = router || null;
        this.nodeId = nodeId || (router && router.nodeId) || null;
        this.logger = logger || new Logger('room-ownership-service');

        /** @type {Map<string, string>} resourceId → ownerNodeId */
        this.lastKnownOwnerMap = new Map();
        /** @type {Set<string>} resourceIds we've locally claimed and not released. */
        this.ownedRooms = new Set();

        this._listenersAttached = false;
        this._enabled = Boolean(this.rebalanceManager && this.router && this.registry);

        if (this._enabled) {
            this._attachListeners();
        }
    }

    isEnabled() {
        return this._enabled;
    }

    _attachListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        // RebalanceManager → public events (normalized payload).
        this._onGained = (payload) => {
            const { resourceId, newOwnerId, previousOwnerId } = payload || {};
            if (!resourceId) return;
            this.lastKnownOwnerMap.set(resourceId, newOwnerId);
            this.ownedRooms.add(resourceId);
            const out = {
                roomId: resourceId,
                ownerId: newOwnerId,
                previousOwnerId: previousOwnerId || null,
                isLocal: true,
            };
            this.logger.info && this.logger.info('ownership:gained', out);
            this.emit('ownership:gained', out);
        };

        this._onLost = (payload) => {
            const { resourceId, newOwnerId, previousOwnerId } = payload || {};
            if (!resourceId) return;
            // Prefer the new owner from the payload; fall back to last known.
            const ownerId = newOwnerId || this.lastKnownOwnerMap.get(resourceId) || null;
            if (ownerId) this.lastKnownOwnerMap.set(resourceId, ownerId);
            this.ownedRooms.delete(resourceId);
            const out = {
                roomId: resourceId,
                ownerId,
                previousOwnerId: previousOwnerId || this.nodeId || null,
                isLocal: false,
            };
            this.logger.info && this.logger.info('ownership:lost', out);
            this.emit('ownership:lost', out);
        };

        this.rebalanceManager.on('ownership:gained', this._onGained);
        this.rebalanceManager.on('ownership:lost', this._onLost);

        // Registry events keep lastKnownOwnerMap fresh for *remote* resources
        // (workaround for DC-PIPELINE-6: previousOwnerId null in router-only
        // setups). We don't emit public events from these — only the local
        // RebalanceManager events do that.
        const updateFromRecord = (record) => {
            if (!record || !record.entityId) return;
            this.lastKnownOwnerMap.set(record.entityId, record.ownerNodeId);
        };
        this._onEntityCreated = updateFromRecord;
        this._onEntityTransferred = updateFromRecord;
        this._onEntityUpdated = updateFromRecord;
        this._onEntityDeleted = (record) => {
            if (!record || !record.entityId) return;
            this.lastKnownOwnerMap.delete(record.entityId);
            this.ownedRooms.delete(record.entityId);
        };

        try {
            this.registry.on('entity:created', this._onEntityCreated);
            this.registry.on('entity:transferred', this._onEntityTransferred);
            this.registry.on('entity:updated', this._onEntityUpdated);
            this.registry.on('entity:deleted', this._onEntityDeleted);
        } catch (err) {
            this.logger.warn && this.logger.warn('Failed to subscribe to registry events', {
                error: err && err.message,
            });
        }
    }

    /**
     * Claim ownership of a room.
     * @param {string} roomId
     * @returns {Promise<string|null>} resourceId or null when disabled.
     */
    async claim(roomId) {
        if (!this._enabled) return null;
        if (!roomId) throw new Error('claim() requires a roomId');
        const handle = await this.router.claim(roomId, {
            metadata: { resourceType: ROOM_RESOURCE_TYPE },
        });
        // Locally we know we are the owner immediately — prime the cache so
        // getOwner() is correct before any event loop turn.
        this.lastKnownOwnerMap.set(roomId, this.nodeId);
        this.ownedRooms.add(roomId);
        // ResourceHandle can be the entity record or a wrapped object across
        // distributed-core versions; resourceId is the input.
        return (handle && (handle.resourceId || handle.entityId)) || roomId;
    }

    /**
     * Release ownership of a room. No-op when disabled or not owned.
     * @param {string} roomId
     */
    async release(roomId) {
        if (!this._enabled) return;
        if (!roomId) return;
        try {
            await this.router.release(roomId);
        } finally {
            this.ownedRooms.delete(roomId);
            // Do NOT clear lastKnownOwnerMap here — release just hands off;
            // the registry's deletion event (or the next claim) will update it.
        }
    }

    /**
     * Get the current owner of a room.
     * @param {string} roomId
     * @returns {{ ownerId: string, isLocal: boolean } | null}
     */
    getOwner(roomId) {
        if (!this._enabled || !roomId) return null;

        // 1. Trust the registry first — it's the source of truth.
        try {
            const entity = this.registry.getEntity && this.registry.getEntity(roomId);
            if (entity && entity.ownerNodeId) {
                this.lastKnownOwnerMap.set(roomId, entity.ownerNodeId);
                return {
                    ownerId: entity.ownerNodeId,
                    isLocal: entity.ownerNodeId === this.nodeId,
                };
            }
        } catch (_err) { /* fall through to cache */ }

        // 2. Fall back to lastKnownOwnerMap (handles router-only timing windows).
        const cached = this.lastKnownOwnerMap.get(roomId);
        if (cached) {
            return { ownerId: cached, isLocal: cached === this.nodeId };
        }

        // 3. Local ownership flag — the router may know it without a cached entry.
        try {
            if (this.router && this.router.isLocal && this.router.isLocal(roomId)) {
                return { ownerId: this.nodeId, isLocal: true };
            }
        } catch (_err) { /* noop */ }

        return null;
    }

    /**
     * Service stats. Cheap counters; safe to call on a hot path.
     */
    getStats() {
        if (!this._enabled) {
            return { ownedRoomCount: 0, knownRoomCount: 0 };
        }
        return {
            ownedRoomCount: this.ownedRooms.size,
            knownRoomCount: this.lastKnownOwnerMap.size,
        };
    }

    /**
     * Detach all listeners. Safe to call repeatedly. The bootstrap's
     * shutdown() handles the underlying cluster teardown — this method is
     * for tests / scenarios that want to drop the wrapper without tearing
     * down the cluster.
     */
    detach() {
        if (!this._enabled || !this._listenersAttached) return;
        try { this.rebalanceManager.off('ownership:gained', this._onGained); } catch (_e) { /* noop */ }
        try { this.rebalanceManager.off('ownership:lost', this._onLost); } catch (_e) { /* noop */ }
        try { this.registry.off && this.registry.off('entity:created', this._onEntityCreated); } catch (_e) { /* noop */ }
        try { this.registry.off && this.registry.off('entity:transferred', this._onEntityTransferred); } catch (_e) { /* noop */ }
        try { this.registry.off && this.registry.off('entity:updated', this._onEntityUpdated); } catch (_e) { /* noop */ }
        try { this.registry.off && this.registry.off('entity:deleted', this._onEntityDeleted); } catch (_e) { /* noop */ }
        this._listenersAttached = false;
    }
}

// ---------------------------------------------------------------------------
// Null/no-op singleton when the cluster is disabled (flag off). Same shape so
// callers can wire to it without conditional logic.
// ---------------------------------------------------------------------------
class NullRoomOwnershipService extends EventEmitter {
    constructor({ logger } = {}) {
        super();
        this.logger = logger || new Logger('room-ownership-service:null');
    }
    isEnabled() { return false; }
    async claim(_roomId) { return null; }
    async release(_roomId) { /* noop */ }
    getOwner(_roomId) { return null; }
    getStats() { return { ownedRoomCount: 0, knownRoomCount: 0 }; }
    detach() { /* noop */ }
}

// ---------------------------------------------------------------------------
// Lazy singleton.
// ---------------------------------------------------------------------------
let _singleton = null;
let _bootstrapPromise = null;

/**
 * Get (or lazily create) the process-wide RoomOwnershipService singleton.
 *
 * First call bootstraps the cluster (if the flag is on) and wires the
 * service. Subsequent calls return the same instance. Concurrent first
 * calls share the same bootstrap promise.
 *
 * @param {object} [opts]
 * @param {object} [opts.logger]
 * @param {object} [opts.bootstrapOptions] — passed through to bootstrapGatewayCluster
 * @returns {Promise<RoomOwnershipService|NullRoomOwnershipService>}
 */
async function getRoomOwnershipService(opts = {}) {
    if (_singleton) return _singleton;
    if (_bootstrapPromise) return _bootstrapPromise;

    _bootstrapPromise = (async () => {
        const logger = opts.logger || new Logger('room-ownership-service');
        let bootstrap = null;
        try {
            bootstrap = await bootstrapGatewayCluster({
                ...(opts.bootstrapOptions || {}),
                logger,
            });
        } catch (err) {
            logger.error && logger.error('bootstrapGatewayCluster failed; falling back to null service', {
                error: err && err.message,
            });
            bootstrap = null;
        }

        if (!bootstrap) {
            _singleton = new NullRoomOwnershipService({ logger });
            return _singleton;
        }

        _singleton = new RoomOwnershipService({
            rebalanceManager: bootstrap.rebalanceManager,
            registry: bootstrap.registry,
            router: bootstrap.router,
            nodeId: bootstrap.nodeId,
            logger,
        });
        // Attach the shutdown helper so callers can tear down via the service.
        _singleton.shutdown = bootstrap.shutdown;
        return _singleton;
    })();

    try {
        return await _bootstrapPromise;
    } finally {
        _bootstrapPromise = null;
    }
}

/**
 * Test-only reset. Drops the singleton without touching the underlying
 * cluster (callers in tests typically own that lifecycle separately).
 */
function _resetForTests() {
    if (_singleton && typeof _singleton.detach === 'function') {
        try { _singleton.detach(); } catch (_e) { /* noop */ }
    }
    _singleton = null;
    _bootstrapPromise = null;
}

module.exports = {
    RoomOwnershipService,
    NullRoomOwnershipService,
    getRoomOwnershipService,
    _resetForTests,
};
