// cluster/cluster-bootstrap.js
/**
 * Gateway-side cluster bootstrap.
 *
 * Phase 3 (April 2026): migrated the **size === 1** (single-process / production)
 * path from `createCluster()` (multi-node test front-door, returns ClusterHandle)
 * to `Cluster.create()` (single-process facade, returns Cluster). The
 * `size > 1` path is test-only and continues to use `createCluster()` for
 * the 2-node integration test that depends on `clusterHandle.getNode(N)`.
 *
 * What the facade gives us "for free" vs. the previous wiring:
 *   - `cluster.scope('rooms')` (v0.5.7+) — namespaced lock / resource IDs
 *     for RoomOwnershipService to drop down to in a follow-up PR.
 *   - `cluster.snapshot()` (v0.4.0+) — postmortem aggregator.
 *   - `cluster.lock` — DistributedLock factory we no longer hand-wire.
 *   - Single `metrics:` config field — was per-primitive plumbing.
 *
 * What the facade does NOT do (and we still wire ourselves):
 *   - RebalanceManager — distributed-core v0.6.7's facade does not own a
 *     RebalanceManager. We construct one against `cluster.router` +
 *     `cluster.clusterManager` and start it with `seedOwnership: true` (M11).
 *   - PeerMessaging — non-Raft facade does not auto-construct PeerMessaging.
 *     We construct one against `cluster.clusterManager.transport` so
 *     message-router can do peer-addressed delivery (DC-PIPELINE-7).
 *   - Stop-first-then-delay-then-teardown shutdown order. The facade's
 *     `cluster.stop()` runs the right sequence internally, but it does the
 *     LEAVING-emit + the rest atomically. We need peers to observe LEAVING
 *     and reclaim our resources BEFORE we silence our own RebalanceManager,
 *     so we still drive the phases ourselves: clusterManager.stop() →
 *     delay → rebalanceManager.stop() → cluster.stop().
 *
 * The bootstrap return shape is preserved verbatim so existing callers
 * (RoomOwnershipService, message-router, server.js) need NO changes:
 *   { registry, rebalanceManager, router, clusterHandle, nodeId,
 *     peerMessaging, presenceRegistry, cluster (NEW), shutdown }
 *
 * Behind a feature flag (`WSG_ENABLE_OWNERSHIP_ROUTING`). When the flag is off
 * (default), `bootstrapGatewayCluster()` returns `null` so callers can
 * idempotently call it without conditionals.
 *
 * Construction order (size === 1, facade path):
 *   1. Resolve nodeId (optionally persisted via loadOrCreateNodeId).
 *   2. Cluster.create({ nodeId, topic, pubsub: 'memory', transport, registry: 'crdt' }).
 *   3. cluster.start() — facade brings up transport / pubsub / registry /
 *      clusterManager / router / lock / autoReclaim in the correct order.
 *   4. RebalanceManager(router, clusterManager, { metrics, ... }) — external.
 *   5. PeerMessaging(nodeId, clusterManager.transport, clusterManager) — external.
 *   6. Optional secondary CRDT registry for presence shadow-writes (L2).
 *   7. rebalanceManager.start({ seedOwnership: true }).
 *
 * Shutdown is *stop-first-then-teardown* (same user-visible behaviour as
 * the pre-Phase-3 implementation):
 *   1. cluster.clusterManager.stop() — emits LEAVING; peers reclaim our
 *      resources, our RebalanceManager observes and emits `ownership:lost`.
 *   2. brief delay (`WSG_TEARDOWN_DELAY_MS`, default 50ms).
 *   3. rebalanceManager.stop() / peerMessaging.stop() / presenceRegistry.stop().
 *   4. cluster.stop() — facade tears down router → lock → registry →
 *      pubsub → transport. clusterManager.stop() is idempotent on the
 *      second call inside cluster.stop().
 *
 * @group cluster
 */

const Logger = require('../utils/logger');

/**
 * Returns true iff the WSG_ENABLE_OWNERSHIP_ROUTING flag is set to a truthy
 * (case-insensitive) "true". Anything else — including unset, '0', 'false',
 * '' — disables the cluster bootstrap.
 */
function isOwnershipRoutingEnabled(opts = {}) {
    const raw = opts.enableOwnershipRouting != null
        ? String(opts.enableOwnershipRouting)
        : process.env.WSG_ENABLE_OWNERSHIP_ROUTING;
    if (raw == null) return false;
    return String(raw).trim().toLowerCase() === 'true';
}

function resolveIdentityFile(opts = {}) {
    if (opts.identityFile !== undefined) return opts.identityFile; // explicit override (incl. null)
    if (process.env.WSG_CLUSTER_IDENTITY_FILE) return process.env.WSG_CLUSTER_IDENTITY_FILE;
    // Tests: ephemeral identity (no file).
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return null;
    if (process.env.NODE_ENV === 'production') {
        return '/var/lib/wsg-gateway/node-identity';
    }
    return '/tmp/wsg-gateway-node-identity';
}

function resolveTombstoneTtl(opts = {}) {
    const v = opts.tombstoneTTLMs != null ? opts.tombstoneTTLMs : process.env.WSG_TOMBSTONE_TTL_MS;
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
    return 7 * 24 * 3600 * 1000; // one week
}

function resolveTeardownDelay(opts = {}) {
    const v = opts.teardownDelayMs != null ? opts.teardownDelayMs : process.env.WSG_TEARDOWN_DELAY_MS;
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
    return 50;
}

function resolveTransport(opts = {}) {
    return opts.transport || process.env.WSG_CLUSTER_TRANSPORT || 'in-memory';
}

function resolveSize(opts = {}) {
    const v = opts.size != null ? opts.size : process.env.WSG_CLUSTER_SIZE;
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

/**
 * Returns true iff the current process is a jest/test runner. Mirrors the
 * detection used by distributed-core's `IS_TEST_ENV` (v0.6.3) so the two
 * stay in lock-step.
 */
function isTestEnv() {
    return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

/**
 * Returns true iff the gateway should activate "fast test mode" — fast-timer
 * defaults from distributed-core v0.6.3 (sub-second gossip / heartbeat / dead
 * timeouts) and per-node logging suppression. Active by default whenever
 * `isTestEnv()` is true; operators can disable with `WSG_TEST_FAST_MODE=false`
 * (case-insensitive) to keep the prod-shaped 1s/5s timers and DC chatter for
 * debugging a flaky test. Production is unaffected because `isTestEnv()` is
 * false there.
 */
function isFastTestModeEnabled() {
    if (!isTestEnv()) return false;
    const raw = process.env.WSG_TEST_FAST_MODE;
    if (raw == null) return true;
    return String(raw).trim().toLowerCase() !== 'false';
}

/**
 * Distributed-core fast-timer overrides for `createCluster()` (size > 1
 * test path). These match `FixtureCluster`'s test defaults from DC v0.6.3
 * (commit 82f4782) so the gateway's bootstrap behaves identically to DC's
 * own fixtures under jest.
 *
 * Returned object is shaped for `createCluster({ nodeDefaults })` —
 * distributed-core's Node ctor reads gossipInterval / joinTimeout /
 * failureDetector / lifecycle directly, and `logging: false` propagates the
 * suppression flag to per-node FrameworkLogger / Transport components.
 */
function fastTimerNodeDefaults() {
    return {
        logging: false,
        gossipInterval: 50,
        joinTimeout: 500,
        failureDetector: {
            heartbeatInterval: 100,
            failureTimeout: 300,
            deadTimeout: 600,
            pingTimeout: 200,
        },
        lifecycle: {
            enableGracefulShutdown: true,
            maxShutdownWait: 50,
        },
    };
}

/**
 * Failure-detection overrides for `Cluster.create()` (size === 1 facade
 * path). The facade exposes `failureDetection: { heartbeatMs, deadTimeoutMs,
 * activeProbing }` — different field shape from `nodeDefaults` above, but
 * same intent: shrink jest's wait on `cluster.start()` / `stop()` so we
 * don't sit on the prod 1s / 6s timers during a unit test.
 *
 * Mirrors the social-api precedent in `social-api/src/pipeline/bootstrap.ts`.
 */
function fastFailureDetection() {
    return {
        heartbeatMs: 100,
        deadTimeoutMs: 600,
        activeProbing: true,
    };
}

/**
 * Lazily resolves the gateway's shared MetricsRegistry singleton from
 * src/observability/metrics.js. Threaded into the facade's `metrics:`
 * field (single-config metrics threading, v0.6.5+) so distributed-core's
 * ResourceRouter and DistributedLock land their counters on the same
 * /internal/metrics scrape surface as the gateway's own shadow Prometheus
 * metrics. Returns null on any failure — callers MUST tolerate a missing
 * registry (DC's primitives accept `metrics?: ...` and skip emission when
 * null).
 *
 * @param {object} opts — bootstrap options; honors `opts.metrics` as an
 *   explicit override (caller-supplied registry instance), and
 *   `opts.metrics === false` to opt out entirely (used by tests that don't
 *   want global side-effects).
 */
function resolveMetricsRegistry(opts = {}, logger = null) {
    if (opts.metrics === false) return null;
    if (opts.metrics) return opts.metrics;
    try {
        // Lazy require: keeps cluster-bootstrap loadable in environments where
        // the observability module isn't on the path (e.g. minimal smoke tests).
        // eslint-disable-next-line global-require
        const obs = require('../observability/metrics');
        if (obs && typeof obs.getRegistry === 'function') {
            return obs.getRegistry();
        }
        return null;
    } catch (err) {
        if (logger && logger.debug) {
            logger.debug('No MetricsRegistry available for cluster substrate', {
                error: err && err.message,
            });
        }
        return null;
    }
}

function delay(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bootstraps the gateway's distributed-core cluster substrate.
 *
 * Returns `null` when the feature flag is off — callers can wire this into
 * services unconditionally; null-checks live downstream.
 *
 * @param {object} [opts]
 * @param {string|boolean} [opts.enableOwnershipRouting] — override for env flag
 * @param {string} [opts.transport] — transport name (default 'in-memory')
 * @param {number} [opts.size] — cluster size (default 1)
 * @param {number} [opts.tombstoneTTLMs]
 * @param {string|null} [opts.identityFile] — null disables persistence
 * @param {number} [opts.teardownDelayMs]
 * @param {object} [opts.logger] — Logger-compatible instance
 * @returns {Promise<null | {
 *   registry, rebalanceManager, router, clusterHandle, nodeId, peerMessaging,
 *   presenceRegistry, cluster, shutdown
 * }>}
 */
async function bootstrapGatewayCluster(opts = {}) {
    const baseLogger = opts.logger || new Logger('cluster-bootstrap');

    // In jest, suppress info-level chatter from this bootstrap (cluster
    // shutdown phases, "bootstrap complete", etc.) — error/warn still flow
    // through so real failures surface. Operators can re-enable everything
    // by setting WSG_TEST_FAST_MODE=false (which also keeps prod-shaped
    // timers — same flag governs both for parity with DC's IS_TEST_ENV).
    const quietInfoInTest = isFastTestModeEnabled();
    const logger = quietInfoInTest
        ? {
            ...baseLogger,
            info: () => {},
            debug: () => {},
            warn: baseLogger.warn ? baseLogger.warn.bind(baseLogger) : () => {},
            error: baseLogger.error ? baseLogger.error.bind(baseLogger) : () => {},
        }
        : baseLogger;

    if (!isOwnershipRoutingEnabled(opts)) {
        logger.debug && logger.debug('Ownership routing disabled (WSG_ENABLE_OWNERSHIP_ROUTING != "true")');
        return null;
    }

    const transport = resolveTransport(opts);
    const size = resolveSize(opts);
    const tombstoneTTLMs = resolveTombstoneTtl(opts);
    const identityFile = resolveIdentityFile(opts);
    const teardownDelayMs = resolveTeardownDelay(opts);
    const fastTimers = isFastTestModeEnabled();

    // Shared MetricsRegistry (the gateway's /internal/metrics surface).
    // Threaded into the facade's `metrics:` config (v0.6.5+) for the
    // size === 1 path so ResourceRouter / DistributedLock counters land
    // automatically. The size > 1 path threads it into RebalanceManager
    // + ResourceRouter explicitly (legacy plumbing).
    const metrics = resolveMetricsRegistry(opts, logger);

    // Branch on `size`:
    //   - size === 1 (production)  → Cluster.create() facade.
    //   - size  >  1 (test-only)   → createCluster() multi-node front-door.
    // The 2-node integration test (`test/cluster/room-ownership.test.js`'s
    // 2-node describe block) depends on `clusterHandle.getNode(N)`, which
    // is a multi-node-only API. Single-process production deployments use
    // size === 1 exclusively — that's where the facade's ergonomics matter.
    if (size === 1) {
        return bootstrapViaFacade({
            opts, logger, transport, tombstoneTTLMs, identityFile,
            teardownDelayMs, fastTimers, metrics,
        });
    }
    return bootstrapViaCreateCluster({
        opts, logger, transport, size, tombstoneTTLMs, identityFile,
        teardownDelayMs, fastTimers, metrics,
    });
}

// ---------------------------------------------------------------------------
// size === 1: Cluster.create() facade path
// ---------------------------------------------------------------------------

async function bootstrapViaFacade({
    opts, logger, transport, tombstoneTTLMs, identityFile,
    teardownDelayMs, fastTimers, metrics,
}) {
    // Lazy-require so test environments without distributed-core compiled
    // can still load this module (e.g. for the smoke test with the flag off).
    const {
        Cluster,
        RebalanceManager,
        PeerMessaging,
        EntityRegistryFactory,
        loadOrCreateNodeId,
        HashPlacement,
    } = require('distributed-core');

    // -----------------------------------------------------------------
    // 1. Resolve nodeId (persistent or ephemeral). Cluster.create()
    //    requires `nodeId`, so resolution happens before construction.
    // -----------------------------------------------------------------
    let resolvedNodeId = opts.nodeId;
    if (!resolvedNodeId && identityFile) {
        try {
            resolvedNodeId = await loadOrCreateNodeId(identityFile);
        } catch (err) {
            logger.warn(`loadOrCreateNodeId failed for ${identityFile}; falling back to ephemeral id`, {
                error: err && err.message,
            });
            resolvedNodeId = undefined;
        }
    }
    // Ephemeral fallback: same convention loadOrCreateNodeId uses internally,
    // so the visible format is consistent across paths.
    const nodeId = resolvedNodeId || `wsg-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

    // -----------------------------------------------------------------
    // 2. Build the Cluster facade. Transport: env-var-driven; defaults
    //    in-memory for single-process. The `WSG_CLUSTER_TRANSPORT=tcp`
    //    (etc.) escape hatch survives the migration intact.
    // -----------------------------------------------------------------
    const transportConfig = transport === 'in-memory'
        ? { type: 'in-memory' }
        : { type: transport };

    const clusterConfig = {
        nodeId,
        topic: `wsg-rooms-${nodeId}`, // per-node topic so two bootstraps in the
                                       // same process don't cross-talk on the
                                       // in-memory pubsub fabric.
        pubsub: { type: 'memory' },    // single-process today; multi-node will
                                       // flip to 'redis' (Phase 4).
        transport: transportConfig,
        // The facade's `crdt` registry mode replaces the manual
        // EntityRegistryFactory.create({ type: 'crdt', ... }) we used to do
        // alongside the legacy front-door.
        registry: { type: 'crdt', crdtOptions: { tombstoneTTLMs } },
        // Single-config metrics threading (v0.6.5+). The facade forwards this
        // into ResourceRouter and DistributedLock automatically. Our
        // externally-constructed RebalanceManager threads it separately below.
        ...(metrics ? { metrics } : {}),
        // Fast-timer overrides for test mode (mirrors social-api precedent).
        ...(fastTimers ? { failureDetection: fastFailureDetection() } : {}),
        // No `logger` — facade defaults to NOOP_LOGGER, which is what we
        // want. Test-mode noise reduction is handled by the `logger` we
        // constructed in the parent function (which scopes to OUR own logs).
    };

    const cluster = await Cluster.create(clusterConfig);
    await cluster.start();

    // -----------------------------------------------------------------
    // 3. RebalanceManager — external; the v0.6.7 facade does not own one.
    //    Wire it against `cluster.router` + `cluster.clusterManager`.
    // -----------------------------------------------------------------
    const router = cluster.router;
    const registry = cluster.registry;
    const clusterManager = cluster.clusterManager;

    // NB: under v0.6.7 the facade always wires LocalPlacement on its router.
    // We wanted HashPlacement historically (room-id → node hash). For Phase 3
    // we accept the facade default to keep the migration mechanical; the
    // placement-strategy decision is logged here as a known difference and
    // a TODO for Phase 4 (when multi-node lands and placement actually
    // matters). With size === 1 there is exactly one node, so all placement
    // strategies pick it.
    void HashPlacement; // explicit unused — see TODO above

    const rebalanceManager = new RebalanceManager(router, clusterManager, {
        // 0 disables the periodic timer in tests so jest doesn't wait on it
        // during teardown; production gets the DC default (30s).
        ...(fastTimers ? { autoRebalanceIntervalMs: 0 } : {}),
        // RebalanceManager records `rebalance.triggered.count{reason}` and
        // `rebalance.duration_ms{reason}` when this is set.
        ...(metrics ? { metrics } : {}),
    });

    // DC-FR-3: attach our externally-owned RebalanceManager to the Cluster
    // facade so `cluster.scope('rooms').on('ownership:gained' | 'ownership:lost')`
    // can locate it (the scope subscriptions throw at wiring time if the
    // cluster's rebalanceManager is null). The facade itself never owns a
    // RebalanceManager — see the header comment on this file. attach is
    // idempotent across identical instances and cheap.
    if (typeof cluster.attachRebalanceManager === 'function') {
        try {
            cluster.attachRebalanceManager(rebalanceManager);
        } catch (err) {
            logger.warn && logger.warn(
                'cluster.attachRebalanceManager failed; scope ownership events will be unavailable',
                { error: err && err.message },
            );
        }
    }

    // -----------------------------------------------------------------
    // 4. PeerMessaging — external; the v0.6.7 facade only auto-constructs
    //    PeerMessaging for Raft-mode registries (we use CRDT). We use it
    //    on the gateway for peer-addressed channel delivery (DC-PIPELINE-7).
    //    Construct against `clusterManager.transport` — that's the same
    //    transport the facade wired internally, so PeerMessaging shares
    //    membership + transport with everything else.
    // -----------------------------------------------------------------
    let peerMessaging = null;
    try {
        peerMessaging = new PeerMessaging(nodeId, clusterManager.transport, clusterManager);
        peerMessaging.start();
    } catch (err) {
        // Defensive: if PeerMessaging construction or start fails we want
        // ownership routing to still work — the gateway's message-router
        // path falls back to Redis pub/sub when peerMessaging is null.
        logger.warn && logger.warn(
            'PeerMessaging construction/start failed; falling back to null (Redis pub/sub still works)',
            { error: err && err.message },
        );
        peerMessaging = null;
    }

    // -----------------------------------------------------------------
    // Optional secondary registry for presence shadow-writes (L2 work,
    // unchanged from pre-Phase-3). When `WSG_PRESENCE_REGISTRY_ENABLED=true`,
    // construct a separate CRDT registry pinned to the same nodeId but with
    // a much shorter tombstone TTL (presence churn is high). PresenceService
    // uses this as a shadow-write secondary path; reads still come from its
    // in-memory map. Default: null (the flag is off, byte-identical
    // pre-Phase-3 behaviour).
    // -----------------------------------------------------------------
    let presenceRegistry = null;
    const presenceRegistryEnabled = String(process.env.WSG_PRESENCE_REGISTRY_ENABLED || '').trim().toLowerCase() === 'true';
    if (presenceRegistryEnabled) {
        presenceRegistry = EntityRegistryFactory.create({
            type: 'crdt',
            nodeId,
            crdtOptions: { tombstoneTTLMs: 60_000 },
        });
        try {
            await presenceRegistry.start();
            logger.info && logger.info('Presence shadow-write registry started', { nodeId });
        } catch (err) {
            logger.warn && logger.warn('presenceRegistry.start() failed; disabling shadow-writes', {
                error: err && err.message,
            });
            presenceRegistry = null;
        }
    }

    // -----------------------------------------------------------------
    // 5. Start the RebalanceManager last, with seedOwnership.
    //
    //    M11 (DC v0.4.0): seedOwnership pre-populates the manager's
    //    ownerCache from the registry on start, so the first observed
    //    migration carries a non-null `previousOwnerId`. The default in
    //    `RebalanceManager.start()` is `seedOwnership: false` (verified
    //    against distributed-core/src/cluster/topology/RebalanceManager.ts
    //    `RebalanceManagerStartOptions` — "Default: false") so we MUST
    //    pass it explicitly here. Also: the facade's `cluster.start()`
    //    does not start a RebalanceManager (it doesn't own one), so we
    //    are not double-starting anything.
    // -----------------------------------------------------------------
    await rebalanceManager.start({ seedOwnership: true });

    logger.info && logger.info('Gateway cluster bootstrap complete (Cluster.create facade)', {
        nodeId,
        transport,
        size: 1,
        tombstoneTTLMs,
        identityFile: identityFile || '(ephemeral)',
        peerMessaging: peerMessaging ? 'enabled' : 'disabled',
    });

    let shuttingDown = false;
    /**
     * Stop-first-then-teardown shutdown order. Same user-visible behaviour
     * as the pre-Phase-3 implementation: peers observe LEAVING and reclaim
     * our resources BEFORE we silence our local RebalanceManager.
     *
     *   1. clusterManager.stop()   — emits LEAVING; peers see it. Our
     *                                 RebalanceManager observes the
     *                                 resulting `resource:migrated` events
     *                                 and emits `ownership:lost` for
     *                                 anything we still owned.
     *   2. small delay (configurable via WSG_TEARDOWN_DELAY_MS).
     *   3. rebalanceManager.stop() — local listeners drop.
     *   4. peerMessaging.stop()    — local listeners drop.
     *   5. presenceRegistry.stop() — if wired.
     *   6. cluster.stop()          — facade tears down router → lock →
     *                                 clusterManager (idempotent on the
     *                                 second call) → registry → pubsub →
     *                                 transport.
     */
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info && logger.info('Cluster shutdown: phase 1 — clusterManager.stop() (LEAVING gossip)', { nodeId });
        try {
            await clusterManager.stop();
        } catch (err) {
            logger.warn && logger.warn('clusterManager.stop() failed', { error: err && err.message });
        }

        await delay(teardownDelayMs);

        logger.info && logger.info('Cluster shutdown: phase 2 — tearing down local services', { nodeId });
        try { await rebalanceManager.stop(); } catch (err) {
            logger.warn && logger.warn('rebalanceManager.stop() failed', { error: err && err.message });
        }
        if (peerMessaging) {
            try { peerMessaging.stop(); } catch (err) {
                logger.warn && logger.warn('peerMessaging.stop() failed', { error: err && err.message });
            }
        }
        if (presenceRegistry) {
            try { await presenceRegistry.stop(); } catch (err) {
                logger.warn && logger.warn('presenceRegistry.stop() failed', { error: err && err.message });
            }
        }

        logger.info && logger.info('Cluster shutdown: phase 3 — cluster.stop() (facade teardown)', { nodeId });
        try { await cluster.stop(); } catch (err) {
            logger.warn && logger.warn('cluster.stop() failed', { error: err && err.message });
        }
    }

    return {
        registry,
        rebalanceManager,
        router,
        // Backwards-compat alias: pre-Phase-3 callers (and the
        // shutdown-ordering test) reach into `bootstrap.clusterHandle`. With
        // the facade migration `clusterHandle` IS the Cluster instance.
        // Tests that called `clusterHandle.getNode(N)` only run on size > 1
        // (the createCluster path); callers that need `.scope()` /
        // `.snapshot()` use the explicit `cluster` field below.
        clusterHandle: cluster,
        nodeId,
        peerMessaging,
        presenceRegistry,
        // NEW in Phase 3: expose the Cluster instance directly so a
        // follow-up RoomOwnershipService refactor (DC-FR-3) can grab
        // `cluster.scope('rooms')` for namespaced resource IDs.
        cluster,
        shutdown,
    };
}

// ---------------------------------------------------------------------------
// size > 1: createCluster() multi-node test path
// ---------------------------------------------------------------------------
//
// Preserved verbatim from the pre-Phase-3 implementation. Used exclusively by
// `test/cluster/room-ownership.test.js`'s 2-node describe block, which
// constructs a second observer service against `clusterHandle.getNode(1)` —
// a multi-node-only API not exposed by Cluster.create(). No production
// deployment runs with size > 1.

async function bootstrapViaCreateCluster({
    opts, logger, transport, size, tombstoneTTLMs, identityFile,
    teardownDelayMs, fastTimers, metrics,
}) {
    const {
        createCluster,
        EntityRegistryFactory,
        ResourceRouter,
        HashPlacement,
        RebalanceManager,
        loadOrCreateNodeId,
    } = require('distributed-core');

    let primaryNodeId = opts.nodeId;
    if (!primaryNodeId && identityFile) {
        try {
            primaryNodeId = await loadOrCreateNodeId(identityFile);
        } catch (err) {
            logger.warn(`loadOrCreateNodeId failed for ${identityFile}; falling back to ephemeral id`, {
                error: err && err.message,
            });
            primaryNodeId = undefined;
        }
    }

    const nodes = [];
    if (size >= 1) {
        nodes.push(primaryNodeId ? { id: primaryNodeId } : {});
        for (let i = 1; i < size; i++) nodes.push({});
    }

    const nodeDefaults = fastTimers ? fastTimerNodeDefaults() : undefined;

    const clusterHandle = await createCluster({
        size,
        transport,
        autoStart: true,
        nodes,
        ...(nodeDefaults ? { nodeDefaults } : {}),
    });

    const convergenceTimeoutMs = fastTimers ? 1000 : 5000;
    const converged = await clusterHandle.waitForConvergence(convergenceTimeoutMs);
    if (!converged) {
        logger.warn(`Cluster did not fully converge within ${convergenceTimeoutMs}ms; continuing best-effort`);
    }

    const primaryHandle = clusterHandle.getNode(0);
    const nodeId = primaryHandle.id;
    const cluster = primaryHandle.getCluster();
    const peerMessaging = primaryHandle.peer || null;

    const registry = EntityRegistryFactory.create({
        type: 'crdt',
        nodeId,
        crdtOptions: { tombstoneTTLMs },
    });

    const router = new ResourceRouter(nodeId, registry, cluster, {
        placement: new HashPlacement(),
        ...(metrics ? { metrics } : {}),
    });

    const rebalanceManager = new RebalanceManager(router, cluster, {
        ...(metrics ? { metrics } : {}),
    });

    let presenceRegistry = null;
    const presenceRegistryEnabled = String(process.env.WSG_PRESENCE_REGISTRY_ENABLED || '').trim().toLowerCase() === 'true';
    if (presenceRegistryEnabled) {
        presenceRegistry = EntityRegistryFactory.create({
            type: 'crdt',
            nodeId,
            crdtOptions: { tombstoneTTLMs: 60_000 },
        });
    }

    await registry.start();
    await router.start();
    if (presenceRegistry) {
        try {
            await presenceRegistry.start();
            logger.info && logger.info('Presence shadow-write registry started', { nodeId });
        } catch (err) {
            logger.warn && logger.warn('presenceRegistry.start() failed; disabling shadow-writes', {
                error: err && err.message,
            });
            presenceRegistry = null;
        }
    }
    await rebalanceManager.start({ seedOwnership: true });

    logger.info && logger.info('Gateway cluster bootstrap complete (createCluster size>1)', {
        nodeId,
        transport,
        size,
        tombstoneTTLMs,
        identityFile: identityFile || '(ephemeral)',
    });

    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info && logger.info('Cluster shutdown: phase 1 — stopping primary node (LEAVING gossip)', { nodeId });
        try {
            await primaryHandle.stop();
        } catch (err) {
            logger.warn && logger.warn('primary node.stop() failed', { error: err && err.message });
        }

        await delay(teardownDelayMs);

        logger.info && logger.info('Cluster shutdown: phase 2 — tearing down local services', { nodeId });
        try { await rebalanceManager.stop(); } catch (err) {
            logger.warn && logger.warn('rebalanceManager.stop() failed', { error: err && err.message });
        }
        try { await router.stop(); } catch (err) {
            logger.warn && logger.warn('router.stop() failed', { error: err && err.message });
        }
        try { await registry.stop(); } catch (err) {
            logger.warn && logger.warn('registry.stop() failed', { error: err && err.message });
        }
        if (presenceRegistry) {
            try { await presenceRegistry.stop(); } catch (err) {
                logger.warn && logger.warn('presenceRegistry.stop() failed', { error: err && err.message });
            }
        }

        logger.info && logger.info('Cluster shutdown: phase 3 — full cluster teardown', { nodeId });
        try { await clusterHandle.stop(); } catch (err) {
            logger.warn && logger.warn('clusterHandle.stop() failed', { error: err && err.message });
        }
    }

    return {
        registry,
        rebalanceManager,
        router,
        clusterHandle,
        nodeId,
        peerMessaging,
        presenceRegistry,
        // size > 1 path doesn't have a Cluster facade instance; expose null
        // so downstream code (RoomOwnershipService follow-up) can null-check
        // and fall back to legacy plumbing in test scenarios.
        cluster: null,
        shutdown,
    };
}

module.exports = {
    bootstrapGatewayCluster,
    // Exported for unit tests / introspection — not part of the public surface.
    _internal: {
        isOwnershipRoutingEnabled,
        resolveIdentityFile,
        resolveTombstoneTtl,
        resolveTeardownDelay,
        resolveTransport,
        resolveSize,
        isTestEnv,
        isFastTestModeEnabled,
        fastTimerNodeDefaults,
        fastFailureDetection,
    },
};
