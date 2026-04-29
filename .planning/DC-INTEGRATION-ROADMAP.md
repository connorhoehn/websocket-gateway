# Distributed-Core Integration Roadmap

**Status:** living document
**Last updated:** 2026-04-28
**DC version pinned to:** v0.6.3 (currently `file:../distributed-core` path-dep)

This roadmap captures (a) what's already integrated, (b) the phased plan to take the codebase from "wired up to v0.4.0 single-node" to "production multi-node Raft", and (c) the asks we need distributed-core to add for parts of (b) to be feasible.

It supersedes the v0.4.0-era `.planning/DISTRIBUTED-CORE-INTEGRATION-SPEC.md` but doesn't replace it — that doc is the snapshot of how we did the v0.3.x → v0.4.0 jump.

---

## Phase 0 — done (v0.4.0 baseline + recent wave)

**Cluster substrate (gateway, single-node)**
- `createCluster({ size: 1, transport: 'in-memory', autoStart: true })` in `src/cluster/cluster-bootstrap.js`
- CrdtEntityRegistry (`type: 'crdt'`, `tombstoneTTLMs: 7 days`)
- ResourceRouter with HashPlacement
- RebalanceManager with `seedOwnership: true` (DC v0.4.0 M11)
- Stop-first-then-teardown shutdown ordering
- Identity persistence via `loadOrCreateNodeId(WSG_CLUSTER_IDENTITY_FILE)`

**Pipeline (social-api, single-node)**
- ResourceRegistry, ResourceTopologyManager, ApplicationRegistry, StateAggregator, MetricsTracker — all real instances (no stubs)
- PipelineModule wired with EventBus WAL (`PIPELINE_WAL_PATH`)
- ResourceRegistry on `entityRegistryType: 'wal'` (today's work) — restart durability

**Wire surfaces**
- 6 PipelineBridge surfaces: trigger, getRun, getHistory, listActiveRuns, getMetrics, getPendingApprovals, cancelRun, resolveApproval
- 9 metrics fields forwarded through createBridge (incl. `avgFirstTokenLatencyMs` from DC v0.3.7+)
- `pipeline.llm.stream.opened` event relay (frontend reducer + glyph)
- DC-PIPELINE-7 peer-addressed send: `peerMessaging.sendToPeer(ownerId, topic, payload, { deliverySemantics: 'at-least-once' })` with Redis fallback

**Observability**
- MetricsRegistry singleton on gateway and social-api
- DC primitives now thread through it: `resource.{claim,release,transfer,orphaned}.count`, `resource.local.gauge`, `rebalance.{triggered,duration_ms}` histograms

**Consumer types**
- Local `PipelineRunSnapshot`, `BusEvent`, `PendingApprovalRow` definitions replaced with DC public-types extensions

---

## Phase 1 — finish what we started (next 1–2 weeks)

| Task | Why | Where |
|---|---|---|
| Register `onPeerMessage('wsg.channel.*')` handler on receiving node | DC-PIPELINE-7 peer-send currently lands on the peer but auto-acks with no fan-out — local subscribers don't see the message. Without this handler, peer-send is wired but functionally a no-op | `src/server.js` `setupNodeMessageHandlers()` |
| Pin distributed-core to a git tag | Currently `file:../distributed-core` — drift risk on every `git pull` of the sibling repo | `package.json` (root + social-api) |
| WAL recovery integration test | Boot social-api, trigger 5 pipeline runs, kill -9, restart, verify all 5 runs visible in registry. Smoke test exists at `scripts/wal-recovery-smoke.sh` — make it part of CI | `scripts/wal-recovery-smoke.sh` + GitHub Actions |
| `/internal/metrics` cardinality audit | New `resource.*` and `rebalance.*` counters could blow up label cardinality if we fan by roomId. Verify default labels are bounded | `src/observability/metrics.js` |
| Document the new env vars | `PIPELINE_REGISTRY_WAL_PATH`, `WSG_CLUSTER_IDENTITY_FILE`, `WSG_TEARDOWN_DELAY_MS`, `WSG_TOMBSTONE_TTL_MS` | `README` or deployment doc |

**Effort estimate:** 3–5 days. Mostly small, isolated changes.

---

## Phase 2 — adopt v0.5.x features that didn't make Phase 0 (2–4 weeks)

These are additive features that are available now in v0.6.3 but require deliberate adoption.

### 2.1 TTL-aware EntityRegistry for ephemeral data
DC v0.5.0 added optional `ttlMs` on `proposeEntity()` / `updateEntity()`. Lazy expiry on read; CRDT/WAL compaction strips expired entries.

**Candidates:**
- **Presence entries** (currently in local Maps inside `presence-service.js`): switch to TTL'd entity registry entries with `ttlMs: 30_000`. Auto-expires when a user goes offline without explicit cleanup.
- **Auth session tokens** (if/when we move them to DC): natural TTL match to JWT expiry.
- **Cursor positions** in collaborative docs: 5-second TTL is fine.

**Impact:** removes explicit cleanup timers + reduces leaked-presence bugs.

### 2.2 At-least-once defaults for critical paths
DC v0.5.1 made `deliverySemantics` configurable. We default to at-most-once everywhere except DC-PIPELINE-7. Worth auditing:
- Pipeline event fan-out to subscribed clients (currently best-effort) — at-least-once would let us drop the dedupe-on-reconnect logic
- Approval resolution acks — should be at-least-once already

### 2.3 mTLS on transport (production prep)
DC v0.5.3 adds mTLS for WebSocket and TCP transports. Today our gateway uses `in-memory` (single-node) — this only matters when we move to a real network transport in Phase 4.

### 2.4 KeyManager JWK export + key rotation (auth path)
DC v0.5.4 shipped JWK export and rotation primitives. Our auth-middleware does JWT verification — moving to DC's KeyManager would centralize key material and give us rotation without code changes.

**Owner:** auth team (whenever we have one).

### 2.5 `ApplicationRegistry.register()` auto-context (cleanup pass)
DC v0.5.7 added `register(module, configOverrides?)` that auto-wires the 6-field `ApplicationModuleContext`. Our `social-api/src/pipeline/bootstrap.ts` hand-constructs it. Switching to `register()` removes ~40 lines.

**Effort:** half a day. Tracked separately because it's bootstrap-only.

### 2.6 Test-noise reduction
DC v0.6.3 added `suppressLogsInTestEnv` and a fast-timer config. Adopt these in our test setup so the social-api Jest output is readable.

---

## Phase 3 — `Cluster.create()` facade migration (1–2 months)

**This is the biggest architectural decision in the roadmap.** Today we use `createCluster()` (the multi-node test factory). To unlock most v0.5.x/v0.6.x features cleanly, we need to switch to `Cluster.create()` (the production single-process facade).

### Why this matters
- `createCluster().getNode(0).getCluster()` returns a `ClusterManager` (legacy/internal class), NOT a `Cluster` instance.
- Several features only exist on `Cluster`:
  - `cluster.scope('domain')` (v0.5.7) — would simplify RoomOwnershipService if it had richer surface
  - `cluster.snapshot()` (v0.4.0) — postmortem aggregator for incident response
  - DistributedLock with cluster-aware sync adapter
  - `metrics?: MetricsRegistry` threaded through every primitive in one place
  - PubSubManager wiring (today we use Redis directly via `src/core/message-router.js`)

### What changes
- `src/cluster/cluster-bootstrap.js` — replace `createCluster({...})` with `Cluster.create({ nodeId, topic, pubsub, registry, transport, ... })`
- `social-api/src/pipeline/bootstrap.ts` — same; pipeline gets its own `Cluster` instance with `registry: { type: 'wal', walPath: ... }`
- Side effect: gateway gets a real PubSubManager instance that we can plumb through (today the gateway uses Redis directly, separately from DC's pubsub layer)

### Risks
- `Cluster.create()` requires `pubsub` (no longer optional in v0.4.0+). Today we'd pass `{ type: 'memory' }` for single-node and `{ type: 'redis', url, createClient }` for multi-node.
- Behavior changes around membership/failure-detection — needs integration test pass.
- The gateway has a custom auth/session lifecycle that's wired tightly into the current `createCluster` shape. Refactor needs care.

### Sequencing
1. Migrate social-api/pipeline first (lower-risk, no auth/session coupling)
2. Validate single-node Raft option (we can lazily flip to `type: 'raft'` once on the facade)
3. Migrate gateway second (more invasive — auth, sessions, message-router all touch this)

**Effort estimate:** 3–4 weeks for the migration + 1 week for integration testing.

---

## Phase 4 — multi-node production (3–6 months)

Once Phase 3 is done and we're on `Cluster.create()`, multi-node is a config flag.

### 4.1 Real network transport
DC v0.4.1 shipped `tcp` / `websocket` / `http` for cluster gossip. Today we use `'in-memory'`.

```typescript
Cluster.create({
  transport: { type: 'tcp', port: 7100, seedNodes: ['node1:7100', 'node2:7100'] },
  pubsub: { type: 'redis', url: ... },
  ...
});
```

### 4.2 Switch pipeline registry to Raft (linearizable approvals)
**This is the consistency upgrade.** When approvals/cancels hit different nodes simultaneously, CRDT's last-write-wins can silently lose one. Raft serializes through a leader.

```typescript
Cluster.create({
  registry: { type: 'raft', raftConfig: { dataDir: '/var/lib/social-api/raft' } },
  ...
});
```

**Operational requirements:**
- Persistent `dataDir` on every social-api instance
- Disk monitoring (raft.wal grows until snapshot)
- `snapshotThreshold: 10_000` default is fine for our load
- Election tuning: `electionTimeoutMin/Max`: 150–300ms (defaults)

**Failure modes:**
- WAL corruption → registry refuses to start (safety-first)
- `persistent-state` (currentTerm/votedFor) loss → split-brain risk; back this up with the WAL

### 4.3 Joint consensus for rolling deploys
DC v0.6.0 implemented joint consensus (§6 of Raft thesis). Add/remove cluster members safely during rolling deploys.

### 4.4 Read-index optimization
`leaseReadEnabled: true` (default) gives us ~50ms-stale reads without quorum round-trip. For approval status checks (read-heavy), this is a win.

### 4.5 Multi-region (optional)
- Single Raft cluster across regions: high latency, not great
- Geo-partitioned (per-region cluster, async cross-region replication): real architectural decision, defer

**Effort estimate:** 6–8 weeks for full multi-node deployment + chaos testing.

---

## Phase 5 — advanced (6+ months, optional)

- **Room ownership on Raft.** Currently CRDT (correct for presence-style data). Switch only if conflicts emerge.
- **Linearizability checker** (Jepsen-style). DC's v0.6.x roadmap has this — adopt their harness once shipped.
- **Chaos testing.** Random kill/restart, partition/heal cycles. Will catch the long-tail bugs that integration tests don't.

---

## DC asks (features needed from distributed-core)

These are blockers or major friction points we've encountered. Each maps to a concrete code path in our repo.

### DC-FR-1 · Thread `MetricsRegistry` deeper

**Where it's missing:**
- `ResourceRegistryConfig` (no `metrics` field)
- `EntityRegistryFactoryConfig` (no `metrics` field — CRDT/WAL/Raft registries don't emit per-update counters)
- `PipelineModuleConfig` (no `metrics` field — runs counters come from PipelineMetricsTracker, fine, but other internals are dark)

**Why it matters:** today our gateway and social-api have a complete prometheus-style observability story for HTTP/WS, but DC's WAL/CRDT/Raft internals are invisible. Adding `metrics?: MetricsRegistry` on these configs (with the same null-safe `this.metrics?.counter(...)` pattern DC already uses on ResourceRouter) gives consumers free instrumentation.

**Suggested counters:**
- `entity_registry.update.count{nodeId,type}` — every applyRemoteUpdate / proposeEntity
- `entity_registry.lookup.count{nodeId,type,result}` — getEntity hit/miss
- `entity_registry.compaction.count{nodeId,type,evicted}` — visible compaction pressure
- `pipeline.run.{started,completed,failed}.count{pipelineId}` — already exists on the tracker but should surface via the threaded registry

**Filed:** open. Severity: medium (we have workarounds at the bridge layer).

---

### DC-FR-2 · `createCluster()` should expose `Cluster` (or an equivalent surface)

**Today:** `createCluster()` returns `ClusterHandle` → `.getNode(0)` returns `NodeHandle` → `.getCluster()` returns `ClusterManager` (the legacy/internal cluster class).

**The problem:** `ClusterManager` does NOT have:
- `.scope('domain')` (v0.5.7)
- `.snapshot()` (v0.4.0)
- The per-cluster MetricsRegistry threading
- The DistributedLock factory

These all live on the new `Cluster` class. So consumers using the front-door multi-node factory can't access the v0.5.x/v0.6.x ergonomics without rewriting bootstrap to use `Cluster.create()` directly.

**Suggested surface (any of):**
- (a) `ClusterHandle.getCluster(idx)` returns `Cluster`, not `ClusterManager` — rename current `getCluster` to `getClusterManager`
- (b) `NodeHandle.cluster` getter that returns the `Cluster` instance
- (c) Surface `.scope()`, `.snapshot()`, `.lock()` directly on `NodeHandle`

**Why it matters:** without this, every consumer adopting v0.5.x/v0.6.x features pays a full bootstrap rewrite (Phase 3 in this roadmap).

**Filed:** open. Severity: high (blocks Phase 3 simplification).

---

### DC-FR-3 · `ClusterScope` expanded surface

**Today:** ClusterScope is a thin proxy with 5 methods: `lock`, `claim`, `release`, `route`, `election`.

**What's missing for our use case** (RoomOwnershipService):
- `on('ownership:gained' | 'ownership:lost')` — auto-strip the prefix from `resourceId` so consumers see plain `roomId`
- `on('entity:created' | 'entity:transferred' | 'entity:updated' | 'entity:deleted')` — same prefix-stripping
- `getEntity(id)` — for the primary owner-lookup path
- `isLocal(id)` — for the final-fallback path

**Why it matters:** today RoomOwnershipService holds 4 raw deps (router, registry, rebalanceManager, nodeId). ClusterScope as-is would replace 2 of those calls but you'd still need the other 4. Net effect: more deps, not fewer. **Adoption deferred until ClusterScope can fully replace the raw primitives.**

**Filed:** open. Severity: low (current code works; this is ergonomics).

---

### DC-FR-4 · Resolve `PendingApprovalRow` shape conflict

**The drift inside DC v0.6.0:**
- `src/applications/pipeline/PipelineModule.ts` declares: `{ runId, stepId, pipelineId, approvers: ApprovalNodeData['approvers'], message?, requestedAt }` — this is what `getPendingApprovals()` returns at runtime
- `src/applications/pipeline/public-types.ts` declares: `{ runId, stepId, approvers: Approver[], requiredCount, recordedApprovals, requestedAt, timeoutAt? }` — this is what's exported as `PendingApprovalRow`

The `index.ts` re-export from `public-types` wins at the consumer surface, but the runtime data carries the other shape. Worse: `Approver = { type, value }` (public-types) has no `userId` field, but runtime data + tests use `{ userId, role? }`.

**Impact:** social-api's `?userId=` filter on the pending approvals route relies on `approvers[i].userId`, which doesn't exist on the public-typed shape.

**Suggested fix:** make `PipelineModule.getPendingApprovals(): PendingApprovalRow[]` return the public-types shape, OR converge the public type to match runtime data.

**Filed:** open. Severity: medium (we worked around it locally with an extension interface).

---

### DC-FR-5 · `PublicBusEvent` should include common envelope fields

**Today:** `PublicBusEvent<T>` has `{ type, payload, timestamp? }`.

**What consumers commonly need:**
- `at: string` (ISO timestamp) — convention across our codebase
- `version: number` (sequence number) — for ordering and dedupe

**Workaround today:** every consumer extends the type to add these back. We did the same in social-api.

**Filed:** open. Severity: low (extension works).

---

### DC-FR-6 · `createCluster()` should accept `metrics?: MetricsRegistry`

**Today:** `ClusterOptions.metrics?: boolean` (a flag). The inner `Cluster.create()` accepts a real `MetricsRegistry` instance, but the front-door multi-node factory only takes a boolean.

**Suggested:** match `Cluster.create()`'s shape — `metrics?: MetricsRegistry`.

**Filed:** open. Severity: low (we thread metrics via the per-primitive configs directly).

---

### DC-FR-7 · Single-node `Cluster.createSingleNode()` shortcut

**Today:** there's no ergonomic single-node `Cluster.create()` shortcut. To stand up a single-node cluster you fill out the full config: `{ nodeId, topic, pubsub, registry, transport, ... }`.

**Suggested:** `Cluster.createSingleNode({ nodeId, registry })` that:
- Defaults `pubsub: { type: 'memory' }`
- Defaults `transport: { type: 'in-memory' }`
- Auto-generates `topic` from `nodeId`
- Returns the same `Cluster` instance shape

**Why it matters:** social-api today is single-node and likely will be for some time. The migration in Phase 3 is much easier if there's a 1-line single-node path.

**Filed:** open. Severity: low (would shorten Phase 3 work by ~1 week).

---

### DC-FR-8 · `RaftEntityRegistry` via `EntityRegistryFactory.create({ type: 'raft' })`

**Today:** `EntityRegistryFactory.create({ type: 'raft' })` throws — Raft requires injected dependencies (RaftNode, RaftRpcRouter, RaftLog, RaftStateMachine, ...). Only `Cluster.create()` wires these correctly.

**Suggested:** add a `EntityRegistryFactory.createRaftFromConfig({ nodeId, raftConfig, peerMessaging })` that builds the full Raft stack from a single config object, returning a working RaftEntityRegistry.

**Why it matters:** consumers who don't want the full `Cluster.create()` facade (e.g., they have their own pubsub/transport) but DO want Raft consistency are blocked. This is Phase 4.2 in our roadmap.

**Filed:** open. Severity: medium (only matters if Phase 3 facade migration is too costly).

---

## Backlog / out of scope

- iOS client integration (deferred)
- Custom `RotatingKeyManager` for auth (depends on FR-4 resolution timing)
- Geo-partitioned multi-region (Phase 5+)
- Linearizability checker / Jepsen testing (DC's v0.6.x roadmap)

---

## Open questions

1. **WAL durability for room ownership.** Currently CRDT in-memory. If a process crashes, we lose all room ownership state and ResourceRouter rebuilds it from peer gossip. Acceptable for now, but worth revisiting in Phase 4.
2. **Pipeline run history.** Today we have EventBus WAL for run events + DynamoDB audit log. With Phase 4.2 Raft registry, run state itself is durable too. Do we keep the audit log, or is the Raft WAL the source of truth?
3. **Multi-tenancy.** Currently single-tenant deployment. If we ever go multi-tenant, the `topic` config in `Cluster.create()` becomes per-tenant.
