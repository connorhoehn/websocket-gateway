// src/observability/postmortem.js
//
// Postmortem endpoint helper. Surfaces distributed-core's
// `Cluster.snapshot()` (v0.4.0+ — structured object with membership,
// ownership, locks, inflightRebalances, walPosition, metrics) over a tiny
// HTTP handler so /internal/postmortem becomes a one-shot incident-response
// view of cluster state.
//
// Wiring:
//   - The handler is registered alongside /internal/metrics in src/server.js
//     and shares the same auth gate (today: open — internal/admin scope is
//     enforced at the network layer).
//   - The cluster instance is resolved from the RoomOwnershipService
//     singleton (the same lazy-bootstrap path that gives us PeerMessaging
//     and the secondary presence registry). When ownership routing is off
//     (NullRoomOwnershipService), the singleton has no cluster — we report
//     `wired: false` rather than 500ing.
//
// Response shape:
//   - 200 + cluster.snapshot() body  → cluster wired and snapshot taken.
//   - 200 + { error, wired: false }  → cluster not wired (flag off, etc).
//   - 500 + { error, wired: true }   → snapshot() threw.
//
// All bodies are JSON; no new deps — JSON.stringify of the snapshot is
// sufficient (the snapshot type is JSON-friendly by design, see
// distributed-core/src/cluster/Cluster.ts:728 docstring).

/**
 * Resolve the Cluster instance the gateway is running on, if any.
 *
 * Routes through the RoomOwnershipService singleton (which lazy-bootstraps
 * the cluster on first call). When ownership routing is disabled, the
 * singleton is a NullRoomOwnershipService whose `cluster` property is
 * undefined — we treat that as "not wired" and return null.
 *
 * @param {object} [opts]
 * @param {object} [opts.logger]
 * @param {Function} [opts.getRoomOwnershipService] — DI seam for tests.
 *   Defaults to the singleton getter from src/services/room-ownership-service.
 * @returns {Promise<object|null>} the Cluster instance or null.
 */
async function resolveCluster(opts = {}) {
    const getter = opts.getRoomOwnershipService
        // eslint-disable-next-line global-require
        || require('../services/room-ownership-service').getRoomOwnershipService;
    let svc = null;
    try {
        svc = await getter({ logger: opts.logger });
    } catch (_err) {
        // bootstrap failure is already logged inside getRoomOwnershipService;
        // surface it as "not wired" to the caller.
        return null;
    }
    if (!svc) return null;
    // RoomOwnershipService stashes the Cluster facade on `cluster` (Phase 3+).
    // NullRoomOwnershipService does NOT have one. The presence/absence of
    // `cluster.snapshot` is the precise signal for "wired".
    const cluster = svc.cluster || null;
    if (!cluster || typeof cluster.snapshot !== 'function') return null;
    return cluster;
}

/**
 * HTTP handler for `GET /internal/postmortem`.
 *
 * Always responds with `Content-Type: application/json`. Status code:
 *   - 200 — snapshot taken or cluster intentionally not wired.
 *   - 500 — `cluster.snapshot()` threw (genuinely unexpected).
 *
 * The handler does NOT enforce authentication — the auth gate matches
 * /internal/metrics (open today; if /internal/metrics ever grows a header
 * or IP allowlist, /internal/postmortem must be moved behind the same
 * gate by the caller in src/server.js).
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {object} [opts]
 * @param {object} [opts.logger]
 * @param {Function} [opts.getRoomOwnershipService] — DI for tests
 * @param {Function} [opts.resolveCluster] — DI for tests (skips the singleton)
 */
async function handlePostmortem(req, res, opts = {}) {
    const logger = opts.logger || null;
    const writeJson = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };

    let cluster = null;
    try {
        cluster = opts.resolveCluster
            ? await opts.resolveCluster(opts)
            : await resolveCluster(opts);
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[postmortem] failed to resolve cluster', {
                error: err && err.message,
            });
        }
        cluster = null;
    }

    if (!cluster) {
        writeJson(200, { error: 'cluster not wired', wired: false });
        return;
    }

    let snapshot;
    try {
        snapshot = cluster.snapshot();
    } catch (err) {
        const message = (err && err.message) || String(err);
        if (logger && logger.error) {
            logger.error('[postmortem] cluster.snapshot() threw', { error: message });
        }
        writeJson(500, { error: message, wired: true });
        return;
    }

    writeJson(200, snapshot);
}

module.exports = {
    handlePostmortem,
    // Exported for unit tests / introspection — not part of the public surface.
    _internal: {
        resolveCluster,
    },
};
