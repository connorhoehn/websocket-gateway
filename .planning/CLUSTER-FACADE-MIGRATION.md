# Phase-3 Spike — `Cluster.create()` facade migration

**Status:** planning
**Owner:** infra
**Last updated:** 2026-04-28

This is the scoping doc for migrating both bootstrap surfaces from the multi-node `createCluster()` front-door to the single-process `Cluster.create()` facade. It pairs with the broader `.planning/DC-INTEGRATION-ROADMAP.md` (Phase 3).

---

## Why migrate

The `createCluster()` front-door was built for multi-node test fixtures and convenience. The `Cluster.create()` facade is the *production* surface for single-process deployments. Today the gateway uses the former because it predates the facade. The cost of staying:

- `cluster.scope('domain')` (v0.5.7) is unreachable through `createCluster()` — its handle returns `ClusterManager` (legacy), not `Cluster`.
- `cluster.snapshot()` (v0.4.0) — postmortem aggregator. Unreachable.
- `DistributedLock` factory threading — we'd hand-wire it.
- `MetricsRegistry` is threaded *per-primitive* today (we plumb it into `ResourceRouter` and `RebalanceManager` separately). With the facade it's one config field.
- `PubSubManager` — the gateway currently uses Redis directly via `src/core/message-router.js`, separately from any DC pubsub. The facade gives us a single PubSubManager we could plumb through.

These are not blockers, but every v0.5.x/v0.6.x ergonomic feature lands on `Cluster`, not on `ClusterManager`. The gap widens with each release.

---

## Concrete diff — gateway

### BEFORE — `src/cluster/cluster-bootstrap.js` (~v0.4.0 era)

```js
const clusterHandle = await createCluster({
  size, transport, autoStart: true, nodes,
});
const primaryHandle = clusterHandle.getNode(0);
const nodeId = primaryHandle.id;
const cluster = primaryHandle.getCluster(); // returns ClusterManager
const peerMessaging = primaryHandle.peer || null;

const registry = EntityRegistryFactory.create({
  type: 'crdt', nodeId, crdtOptions: { tombstoneTTLMs },
});
const router = new ResourceRouter(nodeId, registry, cluster, {
  placement: new HashPlacement(), metrics,
});
const rebalanceManager = new RebalanceManager(router, cluster, { metrics });
await registry.start();
await router.start();
await rebalanceManager.start({ seedOwnership: true });
```

### AFTER — `Cluster.create({...})`

```js
const cluster = await Cluster.create({
  nodeId,
  topic: 'wsg-rooms',
  pubsub: { type: 'memory' },             // or 'redis' for multi-node
  transport: { type: 'in-memory' },        // single-node
  registry: { type: 'crdt', crdtOptions: { tombstoneTTLMs } },
  autoReclaim: { jitterMs: 500 },
  metrics,                                  // single-config metrics threading
  logger,
});
const nodeId = cluster.nodeId;
const registry = cluster.registry;          // CrdtEntityRegistry
const router = cluster.router;              // ResourceRouter
const rebalanceManager = cluster.rebalanceManager;
const peerMessaging = cluster.peer;         // PeerMessaging
const lock = cluster.lock;                  // DistributedLock — bonus

await cluster.start();
```

**What we lose:** the explicit "size: 1" + nodes-array shape. We keep the default in-memory single-node behavior; multi-node is now a `transport: { type: 'tcp', seedNodes: [...] }` change instead of a `size`/`nodes` change.

**What we gain immediately:** `cluster.scope('rooms')`, `cluster.snapshot()`, `cluster.lock`, single-config metrics.

---

## Concrete diff — social-api

### BEFORE — `social-api/src/pipeline/bootstrap.ts`

```ts
const resourceRegistry = new ResourceRegistry({
  nodeId, entityRegistryType: 'wal',
  entityRegistryConfig: { walConfig: { filePath: walPath } },
});
const topologyManager = new ResourceTopologyManager(...);
const moduleRegistry = new ApplicationRegistry(topologyManager);
// ... 6-field ApplicationModuleContext hand-construction ...
const module = new PipelineModule(config);
await moduleRegistry.register(module);
```

### AFTER — `Cluster.create({...})` + ApplicationRegistry

```ts
const cluster = await Cluster.create({
  nodeId,
  topic: 'pipeline-runs',
  pubsub: { type: 'memory' },
  registry: { type: 'wal', walPath: registryWalPath },
});
await cluster.start();

// Pipeline module hangs off the cluster's resource layer.
const moduleRegistry = cluster.applicationRegistry;
const module = new PipelineModule(config);
await moduleRegistry.register(module);  // v0.5.7 auto-context
```

The `WAL` registry type (`type: 'wal'`) is supported by the facade today; Raft (`type: 'raft'`) becomes a config flag flip when we go multi-node (Phase 4.2).

---

## Risk inventory

| Risk | Severity | Notes |
|---|---|---|
| **Shutdown sequence** — we have a careful stop-first-then-teardown order in `cluster-bootstrap.js`. Cluster's `stop()` may not match it. | medium | Verify with an integration test. If mismatched, file as DC ask or wrap with a custom shutdown. |
| **`seedOwnership: true` (M11)** — Cluster.start() may not expose this. | medium | Read `Cluster.start()` impl in DC. If the option is gated, file FR. Today `RebalanceManager.start({ seedOwnership: true })` is what we call; the facade calls `start()` without options. |
| **Redis pubsub coexistence** — the gateway uses Redis directly via `src/core/message-router.js`; Cluster.create() with `pubsub: { type: 'redis', ... }` would create a *second* Redis client unless we share the connection. | medium | For now, keep `pubsub: { type: 'memory' }` on the facade — the gateway's app-layer Redis stays separate. Re-evaluate when multi-node lands. |
| **PeerMessaging surface** — we grab `primaryHandle.peer` today; need to confirm `cluster.peer` exists on the facade. | low | If absent, file as a small DC ask (likely a 1-line export). |
| **DC-FR-2 (createCluster expose Cluster)** is filed but not blocking the *facade* migration — the facade is what we're migrating *to*. FR-2 is about making `createCluster` ergonomic for tests. We can migrate without it. | n/a | This is for clarity. |
| **Test impact** — `test/cluster/room-ownership.test.js` constructs the bootstrap directly; will need a refactor to the facade shape. | low | ~30 lines of test wiring updates. |

---

## DC asks needed for cleanest migration

- **Required:** `cluster.peer` accessor — confirm it's exposed (it is, per `Cluster.ts` line ~310).
- **Required:** `RebalanceManager.start({ seedOwnership: true })` reachable through the facade — verify `Cluster.start()` propagates the flag, or expose `cluster.rebalanceManager` so we can call it ourselves (the latter is already true).
- **Nice-to-have:** **DC-FR-7** (`Cluster.createSingleNode()` shortcut) — would shave ~10 lines per bootstrap.
- **Not needed for this phase:** DC-FR-2, DC-FR-3 (those address *other* gaps).

**Conclusion:** the facade is migration-ready today. No DC blockers.

---

## Migration sequencing

1. **social-api first** (lower risk):
   - No auth/session coupling
   - No app-layer Redis
   - Pipeline tests are isolated
   - Gives us a working facade case study
2. **Gateway second** (higher risk):
   - Auth, sessions, and `message-router.js` all touch the bootstrap return shape
   - Redis client coexistence needs a decision
   - Larger test surface

A 1-week pause between (1) and (2) lets us shake out facade quirks before touching the gateway.

---

## Effort estimate

| Sub-task | Effort | Notes |
|---|---|---|
| social-api/bootstrap.ts rewrite | 0.5 day | Mostly mechanical |
| social-api test refactor | 0.5 day | bootstrap.test.ts + integration tests |
| gateway cluster-bootstrap.js rewrite | 1 day | More wiring (auth/sessions) |
| gateway test refactor | 1 day | room-ownership.test.js + cluster integration |
| message-router peer wiring update | 0.5 day | confirm `cluster.peer` plumbs through |
| Integration smoke + WAL recovery | 1 day | Run the existing scripts/wal-recovery-smoke.sh on the new shape |
| Documentation update | 0.5 day | DC-INTEGRATION-ROADMAP.md, env vars, deployment doc |
| **Total** | **~5 days** | Spread across 1.5–2 calendar weeks |

---

## What we gain (concrete)

After migration:
- `cluster.scope('rooms')` available — RoomOwnershipService can drop 2/4 of its raw deps when paired with **DC-FR-3** improvements
- `cluster.snapshot()` available — `/internal/postmortem` endpoint is a 5-line addition
- `cluster.lock` factory available — replaces hand-wired DistributedLock
- Single `metrics: registry` config on the cluster — no per-primitive plumbing
- Raft is a config-flag flip when we're ready for Phase 4.2 (no Phase-3 rework needed)

---

## Decision matrix

| Path | Recommendation |
|---|---|
| **A: Migrate now** (social-api → gateway, ~5 days) | ✅ **GO** |
| **B: Wait for DC-FR-7** (single-node shortcut) | wait <2 weeks at most; otherwise just go without it |
| **C: Cherry-pick** ClusterScope on top of current createCluster | ❌ FR-3 isn't enough surface yet; not worth the complexity |
| **D: Defer to Phase 4** (combine with multi-node + Raft) | ❌ couples a known-easy migration to a known-hard one |

---

## Recommendation

**GO. Start with social-api.** No DC blockers, ~5 days of work, immediate access to v0.5.7+ ergonomics. Gateway follows after a 1-week soak on social-api.

The Phase 4 multi-node + Raft work is a *config flag flip* on top of the migrated facade — Phase 3 is the necessary precondition.
