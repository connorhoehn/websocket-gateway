// cluster/cluster-bootstrap.js
/**
 * Gateway-side cluster bootstrap (Wave 4b W1).
 *
 * Wires distributed-core's CRDT entity registry + RebalanceManager + ResourceRouter
 * for the websocket-gateway process. This is the *cluster substrate* — it does
 * not (yet) hook into message-router or presence-service. Wave 4c does that.
 *
 * Behind a feature flag (`WSG_ENABLE_OWNERSHIP_ROUTING`). When the flag is off
 * (default), `bootstrapGatewayCluster()` returns `null` so callers can
 * idempotently call it without conditionals.
 *
 * Construction order (matches the verified pattern in
 * social-api/src/__tests__/cluster-verification/ownership-events.test.ts):
 *   1. Resolve nodeId (optionally persisted via loadOrCreateNodeId).
 *   2. createCluster({ size, transport, autoStart, nodes: [{ id }] }).
 *   3. waitForConvergence(5_000).
 *   4. Per-node: EntityRegistryFactory.create({ type: 'crdt', nodeId,
 *        crdtOptions: { tombstoneTTLMs } }).
 *   5. ResourceRouter wired against that registry with HashPlacement.
 *   6. RebalanceManager(router, cluster).
 *
 * Shutdown is *stop-first-then-teardown* (the inverse of distributed-core's
 * own example, which has it backwards for consumers needing `ownership:lost`):
 *   1. node.stop()  — emits LEAVING; peers react.
 *   2. brief delay (`WSG_TEARDOWN_DELAY_MS`, default 50ms).
 *   3. rebalanceManager.stop() / router.stop() / registry.stop().
 *   4. clusterHandle.stop() — full cluster teardown.
 *
 * @group cluster
 */

const path = require('path');
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
 * Lazily resolves the gateway's shared MetricsRegistry singleton from
 * src/observability/metrics.js. Threaded into distributed-core's ResourceRouter
 * and RebalanceManager so their internal counters
 * (resource.claim.count, resource.release.count, rebalance.triggered.count, ...)
 * land on the same /internal/metrics scrape surface as the gateway's own
 * shadow Prometheus metrics. Returns null on any failure — callers MUST
 * tolerate a missing registry (DC's primitives accept `metrics?: ...` and
 * skip emission when null).
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
 *   registry, rebalanceManager, router, clusterHandle, nodeId, peerMessaging, shutdown
 * }>}
 */
async function bootstrapGatewayCluster(opts = {}) {
    const logger = opts.logger || new Logger('cluster-bootstrap');

    if (!isOwnershipRoutingEnabled(opts)) {
        logger.debug && logger.debug('Ownership routing disabled (WSG_ENABLE_OWNERSHIP_ROUTING != "true")');
        return null;
    }

    // Lazy-require so test environments without distributed-core compiled
    // can still load this module (e.g. for the smoke test with the flag off
    // — though we already returned above in that case).
    const {
        createCluster,
        EntityRegistryFactory,
        ResourceRouter,
        HashPlacement,
        RebalanceManager,
        loadOrCreateNodeId,
    } = require('distributed-core');

    const transport = resolveTransport(opts);
    const size = resolveSize(opts);
    const tombstoneTTLMs = resolveTombstoneTtl(opts);
    const identityFile = resolveIdentityFile(opts);
    const teardownDelayMs = resolveTeardownDelay(opts);

    // Shared MetricsRegistry (the gateway's /internal/metrics surface). When
    // present, distributed-core's primitives (ResourceRouter / RebalanceManager)
    // record counters/histograms onto it: resource.claim.count{result},
    // resource.release.count, resource.transfer.count, resource.orphaned.count,
    // rebalance.triggered.count{reason}, rebalance.duration_ms{reason}, plus
    // the resource.claim.latency_ms histogram and resource.local.gauge.
    // Falls back to null in environments without the observability module
    // (DC primitives short-circuit on null — see ResourceRouter.metrics?? path).
    const metrics = resolveMetricsRegistry(opts, logger);

    // -----------------------------------------------------------------
    // 1. Resolve nodeId (persistent or ephemeral).
    // -----------------------------------------------------------------
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

    // -----------------------------------------------------------------
    // 2. Build the cluster. For size=1 we pass an explicit node config so
    //    we can pin our resolved id; for size>1 we still allow node[0]
    //    to be the gateway and the rest to be placeholders (mostly only
    //    useful in tests).
    // -----------------------------------------------------------------
    const nodes = [];
    if (size >= 1) {
        nodes.push(primaryNodeId ? { id: primaryNodeId } : {});
        for (let i = 1; i < size; i++) nodes.push({});
    }

    const clusterHandle = await createCluster({
        size,
        transport,
        autoStart: true,
        nodes,
    });

    const converged = await clusterHandle.waitForConvergence(5000);
    if (!converged) {
        logger.warn('Cluster did not fully converge within 5000ms; continuing best-effort');
    }

    // -----------------------------------------------------------------
    // 3. Wire the *primary* (index-0) node's registry/router/manager.
    //    Multi-node bootstraps are typically test-only; we only return
    //    one set of services because the gateway process owns one node.
    // -----------------------------------------------------------------
    const primaryHandle = clusterHandle.getNode(0);
    const nodeId = primaryHandle.id;
    const cluster = primaryHandle.getCluster();
    // distributed-core v0.4.3+: each NodeHandle exposes a PeerMessaging
    // dispatcher that's started automatically by Node.start(). We surface
    // it on the bootstrap return so message-router can use peer-addressed
    // delivery for cross-node room ownership routing (DC-PIPELINE-7).
    // Defensive: older builds may not expose `.peer` — fall back to null.
    const peerMessaging = primaryHandle.peer || null;

    // CRITICAL: option key is `crdtOptions`, NOT `options`. The factory
    // silently ignores unknown keys, so passing `options:` would leave us
    // on the default "tombstones forever" path.
    const registry = EntityRegistryFactory.create({
        type: 'crdt',
        nodeId,
        crdtOptions: { tombstoneTTLMs },
    });

    const router = new ResourceRouter(nodeId, registry, cluster, {
        placement: new HashPlacement(),
        // Optional. When non-null, ResourceRouter increments
        // `resource.claim.count{result}`, `resource.release.count`,
        // `resource.transfer.count`, `resource.orphaned.count`, observes
        // `resource.claim.latency_ms`, and sets `resource.local.gauge`.
        ...(metrics ? { metrics } : {}),
    });

    const rebalanceManager = new RebalanceManager(router, cluster, {
        // Optional. When non-null, RebalanceManager increments
        // `rebalance.triggered.count{reason}` and observes
        // `rebalance.duration_ms{reason}` for each dispatched rebalance trigger
        // (manual, member-joined, member-left, interval, topology-recommendation).
        ...(metrics ? { metrics } : {}),
        // Keep the periodic timer active — gateway runs are long-lived; the
        // membership-driven path covers most cases but periodic ticks let
        // skewed placements catch up. The default in distributed-core is
        // sane; we only override here if the operator asks.
    });

    await registry.start();
    await router.start();
    // M11 (distributed-core v0.4.0): seedOwnership pre-populates the manager's
    // ownerCache from the wired registry on start, so the first observed
    // migration carries a non-null `previousOwnerId`. Without this, router-only
    // setups would see `previousOwnerId === null` until the cache built lazily.
    await rebalanceManager.start({ seedOwnership: true });

    logger.info && logger.info('Gateway cluster bootstrap complete', {
        nodeId,
        transport,
        size,
        tombstoneTTLMs,
        identityFile: identityFile || '(ephemeral)',
    });

    let shuttingDown = false;
    /**
     * Stop-first-then-teardown shutdown order.
     *
     *   1. primary node.stop() — emits LEAVING; peers see it and reclaim
     *      our resources, which lets *our* RebalanceManager observe and
     *      emit `ownership:lost`. If we tore down the manager first, the
     *      manager's listeners would be gone before the LEAVING propagates
     *      and we'd silently miss the loss event.
     *   2. small delay (configurable via WSG_TEARDOWN_DELAY_MS).
     *   3. rebalanceManager.stop() → router.stop() → registry.stop().
     *   4. clusterHandle.stop() to clean up any other nodes (in tests).
     */
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info && logger.info('Cluster shutdown: phase 1 — stopping primary node (LEAVING gossip)', { nodeId });
        try {
            // Don't await graceful drain (~5s); we just need the LEAVING
            // broadcast to land. The handle's stop() resolves quickly enough
            // for the gossip layer's purposes; we still await to surface
            // catastrophic errors.
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
    },
};
