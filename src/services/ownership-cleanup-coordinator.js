// services/ownership-cleanup-coordinator.js
/**
 * OwnershipCleanupCoordinator
 *
 * Subscribes to the room-ownership-service's `ownership:gained` and
 * `ownership:lost` events and dispatches to per-resource-type cleanup
 * handlers. Used to flush/discard local resource state when this node
 * loses ownership of a room, and to hydrate state when it gains
 * ownership.
 *
 * Wave 4b W1 task: this is a thin coordinator. Per-resource-type cleanup
 * handler logic is stubbed out here as no-op placeholders that log what
 * they would do — Wave 4c will replace these stubs with real
 * implementations against the chat / presence / reactions / cursors
 * services.
 *
 * Note: `crdt-editor` is intentionally NOT registered here. The CRDT
 * editor partition-merge story is separately planned (see the
 * distributed-core integration spec); this coordinator must not dispatch
 * to a `crdt-editor` resource type.
 */

const Logger = require('../utils/logger');

/**
 * @typedef {Object} CleanupHandler
 * @property {(roomId: string, payload: object) => Promise<void>} [onLost]
 * @property {(roomId: string, payload: object) => Promise<void>} [onGained]
 */

class OwnershipCleanupCoordinator {
    /**
     * @param {object} deps
     * @param {object} deps.ownershipService - room-ownership-service singleton (EventEmitter-like)
     * @param {object} deps.logger - logger with .info/.warn/.error
     */
    constructor({ ownershipService, logger } = {}) {
        if (!ownershipService) {
            throw new Error('OwnershipCleanupCoordinator: ownershipService is required');
        }
        this.ownershipService = ownershipService;
        this.logger = logger || new Logger('ownership-cleanup-coordinator');

        /** @type {Map<string, CleanupHandler>} */
        this._handlers = new Map();

        this._started = false;
        this._onLostListener = null;
        this._onGainedListener = null;
    }

    /**
     * Register cleanup handlers for a resource type.
     * @param {string} resourceType - 'chat' | 'presence' | 'reactions' | 'cursors'
     * @param {CleanupHandler} handlers
     */
    registerCleanupHandler(resourceType, handlers) {
        if (typeof resourceType !== 'string' || resourceType.length === 0) {
            throw new Error('registerCleanupHandler: resourceType must be a non-empty string');
        }
        if (resourceType === 'crdt-editor') {
            // Hard guard: spec says crdt-editor is intentionally excluded.
            throw new Error(
                'registerCleanupHandler: crdt-editor is intentionally excluded from coordinator dispatch'
            );
        }
        if (!handlers || typeof handlers !== 'object') {
            throw new Error('registerCleanupHandler: handlers must be an object');
        }
        this._handlers.set(resourceType, {
            onLost: typeof handlers.onLost === 'function' ? handlers.onLost : null,
            onGained: typeof handlers.onGained === 'function' ? handlers.onGained : null,
        });
    }

    /**
     * @returns {string[]} list of registered resource type names
     */
    getRegisteredTypes() {
        return Array.from(this._handlers.keys());
    }

    /**
     * Subscribe to ownership service events.
     * If the ownership service does not implement `.on()` (e.g. the feature
     * flag is off and the singleton is a no-op stub), this is a quiet
     * no-op — callers should be safe to invoke regardless of config.
     */
    start() {
        if (this._started) return;

        if (!this.ownershipService || typeof this.ownershipService.on !== 'function') {
            this.logger.info(
                'ownership-cleanup-coordinator: ownership service does not expose .on(); start() is a no-op (feature flag likely disabled)'
            );
            return;
        }

        this._onLostListener = (payload) => this._dispatch('onLost', payload);
        this._onGainedListener = (payload) => this._dispatch('onGained', payload);

        try {
            this.ownershipService.on('ownership:lost', this._onLostListener);
            this.ownershipService.on('ownership:gained', this._onGainedListener);
            this._started = true;
            this.logger.info('ownership-cleanup-coordinator: started', {
                registeredTypes: this.getRegisteredTypes(),
            });
        } catch (err) {
            this.logger.warn('ownership-cleanup-coordinator: failed to subscribe to ownership events', {
                error: err && err.message,
            });
            this._onLostListener = null;
            this._onGainedListener = null;
        }
    }

    /**
     * Unsubscribe from ownership service events.
     */
    stop() {
        if (!this._started) return;

        if (this.ownershipService && typeof this.ownershipService.off === 'function') {
            try {
                if (this._onLostListener) {
                    this.ownershipService.off('ownership:lost', this._onLostListener);
                }
                if (this._onGainedListener) {
                    this.ownershipService.off('ownership:gained', this._onGainedListener);
                }
            } catch (err) {
                this.logger.warn('ownership-cleanup-coordinator: failed to unsubscribe', {
                    error: err && err.message,
                });
            }
        } else if (this.ownershipService && typeof this.ownershipService.removeListener === 'function') {
            try {
                if (this._onLostListener) {
                    this.ownershipService.removeListener('ownership:lost', this._onLostListener);
                }
                if (this._onGainedListener) {
                    this.ownershipService.removeListener('ownership:gained', this._onGainedListener);
                }
            } catch (err) {
                this.logger.warn('ownership-cleanup-coordinator: failed to unsubscribe', {
                    error: err && err.message,
                });
            }
        }

        this._onLostListener = null;
        this._onGainedListener = null;
        this._started = false;
        this.logger.info('ownership-cleanup-coordinator: stopped');
    }

    /**
     * Dispatch an ownership event to all registered handlers in parallel.
     *
     * Dispatch model: every registered resource-type handler is invoked
     * for every event. Ownership events from the room-ownership-service
     * are room-scoped, not resource-type-scoped — when this node loses
     * ownership of `roomId`, ALL local resource types associated with that
     * room must be flushed (chat buffer, presence, reactions, cursors).
     * Conversely on `ownership:gained`, each resource type independently
     * decides whether/how to hydrate.
     *
     * Each handler call is wrapped via Promise.allSettled so one
     * resource-type's failure cannot block the others. Fire-and-forget.
     *
     * @param {'onLost' | 'onGained'} kind
     * @param {object} payload event payload from ownership-service; expected to include roomId
     */
    _dispatch(kind, payload) {
        const roomId = payload && (payload.roomId || payload.resourceId);
        if (!roomId) {
            this.logger.warn('ownership-cleanup-coordinator: event missing roomId', { kind, payload });
            return;
        }

        const tasks = [];
        for (const [resourceType, handlers] of this._handlers.entries()) {
            const fn = handlers && handlers[kind];
            if (typeof fn !== 'function') continue;
            tasks.push(
                (async () => {
                    try {
                        await fn(roomId, payload);
                    } catch (err) {
                        // Swallow + log: one handler must not block others.
                        this.logger.error(
                            `ownership-cleanup-coordinator: ${resourceType} ${kind} handler threw`,
                            { roomId, error: err && err.message, stack: err && err.stack }
                        );
                    }
                })()
            );
        }

        // Fire-and-forget; allSettled so we never reject upstream.
        Promise.allSettled(tasks).then((results) => {
            const failures = results.filter((r) => r.status === 'rejected');
            if (failures.length > 0) {
                // Should be unreachable because each task swallows its own
                // errors, but guard anyway.
                this.logger.warn('ownership-cleanup-coordinator: dispatch had unexpected rejections', {
                    kind,
                    roomId,
                    failures: failures.length,
                });
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _singleton = null;

/**
 * Lazily instantiate the coordinator against the room-ownership-service
 * singleton, register the stub handlers, and return it. Subsequent calls
 * return the same instance.
 *
 * @param {object} [opts]
 * @param {object} [opts.ownershipService] - override (mainly for tests)
 * @param {object} [opts.logger] - override logger
 * @returns {OwnershipCleanupCoordinator}
 */
function getOwnershipCleanupCoordinator(opts = {}) {
    if (_singleton) return _singleton;

    let ownershipService = opts.ownershipService;
    if (!ownershipService) {
        // Lazy require so this module loads even if room-ownership-service
        // hasn't been written yet (Wave 4b W1 is parallel to this task).
        // eslint-disable-next-line global-require
        const mod = require('./room-ownership-service');
        if (typeof mod.getRoomOwnershipService === 'function') {
            ownershipService = mod.getRoomOwnershipService();
        } else if (mod && typeof mod.on === 'function') {
            ownershipService = mod;
        } else {
            ownershipService = mod;
        }
    }

    const logger = opts.logger || new Logger('ownership-cleanup-coordinator');
    const coord = new OwnershipCleanupCoordinator({ ownershipService, logger });

    registerStubHandlers(coord, logger);
    _singleton = coord;
    return _singleton;
}

/**
 * Reset the singleton — testing only.
 * @private
 */
function _resetSingletonForTests() {
    _singleton = null;
}

/**
 * Pre-register Wave-4c stub handlers. Each handler is a no-op that logs
 * what it _would_ do; Wave 4c replaces these with real flush/hydrate
 * implementations.
 *
 * NOTE: `crdt-editor` is intentionally NOT registered. CRDT-editor
 * partition-merge is a separate story.
 *
 * @param {OwnershipCleanupCoordinator} coord
 * @param {object} log
 */
function registerStubHandlers(coord, log) {
    coord.registerCleanupHandler('chat', {
        onLost: async (roomId) => {
            log.info('would discard chat buffer for roomId', { roomId, resourceType: 'chat' });
        },
        onGained: async (roomId) => {
            log.info('would hydrate chat for roomId', { roomId, resourceType: 'chat' });
        },
    });

    coord.registerCleanupHandler('presence', {
        onLost: async (roomId) => {
            log.info('would flush presence for roomId', { roomId, resourceType: 'presence' });
        },
        onGained: async (roomId) => {
            log.info('would hydrate presence for roomId', { roomId, resourceType: 'presence' });
        },
    });

    coord.registerCleanupHandler('reactions', {
        onLost: async (roomId) => {
            log.info('would discard reactions for roomId', { roomId, resourceType: 'reactions' });
        },
        onGained: async (roomId) => {
            log.info('no-op (reactions don\'t hydrate) for roomId', {
                roomId,
                resourceType: 'reactions',
            });
        },
    });

    coord.registerCleanupHandler('cursors', {
        onLost: async (roomId) => {
            log.info('would discard cursors for roomId', { roomId, resourceType: 'cursors' });
        },
        onGained: async (roomId) => {
            log.info('no-op (cursors don\'t hydrate) for roomId', {
                roomId,
                resourceType: 'cursors',
            });
        },
    });
}

module.exports = {
    OwnershipCleanupCoordinator,
    getOwnershipCleanupCoordinator,
    _resetSingletonForTests,
};
