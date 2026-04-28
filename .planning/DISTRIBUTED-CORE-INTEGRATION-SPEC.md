# Distributed-Core Integration Spec

**Status:** Live (v0.3.0 response received; gaps closed; partition decision locked)
**Date:** 2026-04-27 (drafted) / 2026-04-27 (v0.3.0 response folded in)
**Source project:** `websocket-gateway` (`/Users/connorhoehn/Projects/websocket-gateway`)
**Target project:** `distributed-core` (`/Users/connorhoehn/Projects/distributed-core`)
**Audience:** distributed-core maintainers; secondarily, websocket-gateway engineers picking up the integration phases.

## Status update — 2026-04-27 (v0.3.2)

distributed-core shipped **v0.3.1** closing all original spec gaps and **v0.3.2** fixing the AutoReclaim graceful-stop window (path-C). Wave 4 is now unblocked. Authoritative response doc: `distributed-core/docs/handoff/v0.3.1-response.md`.

Tag history:
- **v0.3.0** — pre-existing Tier-1 release (`ownsRouter` / `onReclaim`), unrelated to spec.
- **v0.3.1** (commit `b3bdad8`) — closes DC-1.1 through DC-6.3 + DC-2.4. CRDT remote-event fix + self-replay short-circuit. RebalanceManager event coverage. `examples/room-ownership/`.
- **v0.3.2** (commit `1ff6e1b`) — Path-C fix. ResourceRouter listens for `member:joined` / `member:updated`. AutoReclaim now fires during the LEAVING window; ownership-vacuum collapses from ~5–6 s to ~50 ms.

Substantive changes since the original draft:

- **DC-1.1, 1.2, 1.3** closed: multi-node example, graceful-leave docs, `loadOrCreateNodeId(filePath)` + `NodeOptions.identityFile`.
- **DC-2.1–2.4** closed: integration docs §8.1–§8.3 + `MetricsRegistry.counter(name, labels, description?)` (the `# HELP undefined` issue I surfaced from a test run).
- **DC-3.1–3.4** closed: WAL path convention, `eventbus.wal.replay.entries` metric + log line, `WALSegmentManager` (which fixed a latent crash bug — 100MB hard-fail removed), publish-path error semantics documented.
- **DC-4.1** closed: `RebalanceManager` ships as a full orchestrator (path A from the original ask). `ownership:gained` / `ownership:lost` events on the manager (DC-4.3).
- **DC-4.4 NOT closed** — see Partition Decision below.
- **DC-5.1, 5.2, 5.3** closed: failure-detector metrics; `installSignalHandlers` on ChaosInjector; `maxConcurrentFaults` / `maxFaultsPerMinute` chaos budget.
- **DC-6.1, 6.2, 6.3** closed: `examples/chat/src/ChatApplicationModule.ts` annotated as the third-party module template; versioning + cross-module routing in INTEGRATION.md §8b.
- **Beyond spec:** `distributed-core/testing` subpath ships `FixtureCluster`, `FixtureEventBus`, `FixtureLLMClient` — closes Open Question #2.

### Partition decision (Track 4) — locked

distributed-core surfaced a partition-safety finding while writing the v0.3.0 response: `AutoReclaimPolicy` does **not** auto-reconcile after partition heal. `InMemoryEntityRegistry.applyRemoteUpdate` for `CREATE` is guarded by `if (!has(entityId))`, so cross-half messages are silently dropped on heal. Three options were offered:

1. Manual reconciliation on `partition-heal` — rejected. Brittle (every resource type needs hand-written loser-side teardown).
2. **CrdtEntityRegistry** — accepted. Real LWW with logical-clock timestamps and lexicographic nodeId tiebreak; tombstones prevent zombie-CREATE-after-DELETE; reachable via `EntityRegistryFactory.create({ type: 'crdt', nodeId, options: { tombstoneTTLMs: 7 * 24 * 3600 * 1000 } })`.
3. Fencing tokens — rejected. Right primitive for storage APIs with monotonic write tokens; rooms don't have that shape.

**CRDT does not prevent conflicts during partition** — only resolves them on heal. The `ownership:lost` handler must do per-resource-type teardown (presence flush, message buffer drain, Y.js doc state). For chat / presence / reactions: discard. For CRDT-editor docs: separately planned (likely stays single-owner-per-doc with explicit "no partition tolerance" stance).

### Wave 4 verification work (locked, in this order)

1. Confirm `RebalanceManager.ownership:lost` fires when registry is `CrdtEntityRegistry`. distributed-core has an open issue to verify; will close before Wave 4 starts.
2. Y.js loser-side handling: discard for chat/presence/reactions; merge story for CRDT-editor is its own design.
3. `tombstoneTTLMs` set explicitly to 7 days. Default `POSITIVE_INFINITY` allows resurrected deletes if partition outlives the TTL.

### Versioning

- distributed-core tags v0.3.0; pin to **git tag**, not `^0.3.0` semver. Pre-1.0 minor bumps are allowed to break public surface.
- Spec §3 single-region scope confirmed by both sides. CRDT-over-WAN re-evaluated if multi-region returns.


This document specifies six integration tracks between `websocket-gateway` and `distributed-core`. For each track it states what websocket-gateway intends to consume, the current state of the relevant distributed-core surfaces (per the audit on 2026-04-27), the concrete gaps that need to close on the distributed-core side, and the acceptance criteria that mark the integration as done.

It is **not** a redesign of either project. It is a contract — what each side commits to ship, in what order, with what test surface.

---

## TL;DR

- `websocket-gateway` consumes `distributed-core` from one place today (`social-api/src/pipeline/`), uses one application module (`PipelineModule`), and runs as a single-node, in-memory cluster.
- Six tracks are proposed, in three tiers:
  - **Tier 1 (low-risk pickups):** MetricsRegistry swap (Track 2), WAL-on for the pipeline bus (part of Track 3).
  - **Tier 2 (build, with primitives in place):** Multi-node cluster (Track 1), ResourceRegistry-backed room ownership (Track 4), FailureDetector + ChaosInjector wiring (Track 5).
  - **Tier 3 (architectural change):** Custom `SocialApplicationModule` (Track 6).
- The audit found `distributed-core` healthier than expected (2122 unit + 278 integration tests green; zero TODO/FIXME/NotImplementedError in `src/`), but flagged real gaps — the load-bearing one is **`ResourceTopologyManager` is observer-only, not an orchestrator** (Track 4).
- Two stale references in `websocket-gateway` need closing as part of this work: the `Phase-5 deployment concern` comment in `social-api/src/pipeline/bootstrap.ts:8`, and the no-op stubs at `bootstrap.ts:96-109` for `resourceRegistry`, `topologyManager`, and `moduleRegistry`.

---

## 1. Background

`websocket-gateway` is a real-time platform with three runtime services:

- **gateway** (`src/`) — Node.js WebSocket server; presence, chat, CRDT, reactions; Redis pub/sub for cross-node fan-out; hand-rolled metrics in `src/utils/metrics-collector.js`.
- **social-api** (`social-api/`) — Express service; user profiles, follow graph, groups, rooms, posts, comments, likes, reactions; DynamoDB-backed transactional outbox (`social-api/src/services/outbox-publisher.ts`); EventBridge → SQS → Lambda activity-log pipeline.
- **frontend** (`frontend/`) — React; consumes both services.

`distributed-core` was integrated in March 2026 to provide a pipelines runtime (LLM orchestration with run history, approvals, metrics). The integration is the *Phase-4 distributed-core bridge* visible in commits `d64e21c` (2026-03-15) and `8addfaf` (2026-03-19). It is single-node by design.

This spec extends the integration beyond pipelines.

---

## 2. Current Footprint

### 2.1 Files that import `distributed-core`

| File | What it imports | Purpose |
|---|---|---|
| `social-api/src/pipeline/bootstrap.ts` | `createCluster`, `PipelineModule`, `ApplicationModuleContext`, `ClusterManager`, `ResourceRegistry`, `ResourceTopologyManager`, `ApplicationRegistry` | Boots a 1-node in-memory cluster, registers `PipelineModule` |
| `social-api/src/pipeline/createBridge.ts` | `PipelineModule` (type-only) | Wraps the live module behind the `PipelineBridge` shape that routes consume |
| `social-api/src/pipeline/createLLMClient.ts` | (transitive) | Constructs Anthropic/Bedrock clients |
| `social-api/src/pipeline/LLMClient.ts` | `LLMClient`, `LLMChunk`, `LLMStreamOptions` (re-exports) | Type pass-through |
| `social-api/src/pipeline/__tests__/bootstrap.test.ts` | `FixtureLLMClient` | Test double |
| `social-api/src/pipeline/__tests__/createBridge.test.ts` | `PipelineModule` (type-only) | |

### 2.2 Boundary on the gateway side

`src/pipeline-bridge/pipeline-bridge.js` subscribes to `module.getEventBus()` and relays `pipeline.run.reassigned` events out over WebSockets. This is the only gateway-side touch point.

### 2.3 What the bootstrap stubs out

`social-api/src/pipeline/bootstrap.ts:96-109` constructs no-op stubs for three context fields, with a comment noting these are "fine for single-node":

```ts
const resourceRegistry = { registerResourceType: () => {}, getResourcesByType: () => [] } as unknown as ResourceRegistry;
const topologyManager = {} as unknown as ResourceTopologyManager;
const moduleRegistry  = { registerModule: async () => {}, /* ... */ } as unknown as ApplicationRegistry;
```

Tracks 1, 4, and 6 require these to be replaced with the real distributed-core implementations.

### 2.4 What the bootstrap leaves in-memory

`social-api/src/pipeline/bootstrap.ts:46-51`:

```ts
walFilePath?: string;  // Phase-4 leaves this undefined (in-memory only).
```

Pipeline EventBus state is lost on restart. Track 3 closes this.

---

## 3. Goals & Non-Goals

### Goals

- Replace hand-rolled gateway metrics with `MetricsRegistry` and a single Prometheus scrape endpoint covering both gateway and social-api.
- Run social-api as a multi-node cluster so pipeline runs survive single-node failure.
- Use `ResourceRegistry` + `AutoReclaimPolicy` to assign room ownership to specific cluster nodes, replacing the current "every gateway node fans out via Redis pub/sub" model. This is the path to v5.0 Phase 49 (presence sharding).
- Identify and close the gaps in `distributed-core` that the above directions surface.

### Non-Goals

- Replacing the DynamoDB-backed transactional outbox (`social-api/src/services/outbox-publisher.ts`). The outbox is correct, durable, and consumed by an existing SQS → Lambda → activity-log pipeline. Track 6 *could* eventually replace it, but it is explicitly out of scope here.
- Multi-region. All tracks assume single-region deployment.
- Replacing Cognito for auth. Identity stays Cognito; cluster identity is separate.
- Replacing CRDT (Y.js) for collaborative editing. CRDT pipeline already has its own checkpoint flow (Phase 38–41).

---

## 4. Tracks

Each track is structured as:

- **Goal** — what websocket-gateway will be able to do once shipped.
- **Surfaces** — distributed-core APIs involved.
- **Current state** — what works today, what doesn't (with file:line citations from the audit).
- **Gaps to close in distributed-core** — explicit work items for the distributed-core team.
- **Websocket-gateway changes** — work items on this side.
- **Acceptance criteria** — observable predicates that mark the track done.
- **Test plan** — how it gets verified.
- **Effort estimate** — engineer-days, ballpark.

---

### Track 1 — Multi-Node Cluster Bootstrap

**Goal.** Run two or more `social-api` processes as a real cluster so a pipeline run survives a single-node failure. Replace the in-memory transport with the real one.

**Surfaces.**
- `createCluster({ size, transport, autoStart })` from `distributed-core`
- `ClusterManager`
- `MembershipTable` (`src/cluster/membership/MembershipTable.ts`)
- Gossip transport (`src/gossip/`)

**Current state.**
- Bootstrap pins `size: 1` and `transport: 'in-memory'` (`social-api/src/pipeline/bootstrap.ts:77-81`).
- Audit verdict: **multi-node is production-grade in distributed-core.** Gossip, membership, failure detector, hash ring all implemented and tested. The "Phase-5+ deployment concern" comment at `bootstrap.ts:8` is **outdated** and is itself a deliverable to remove.
- No deployment scaffolding in `websocket-gateway` for multi-replica social-api.

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-1.1 | `createCluster()` documentation: a runnable example for `transport: 'tcp'` (or whatever the production transport name is) with a real seed-node list. The README has cluster examples but the websocket-gateway integrator should not have to read internals. | Documentation |
| DC-1.2 | Confirm and document graceful-leave semantics: when a node receives SIGTERM, what does the rest of the cluster see? Are pending pipeline runs reassigned, or do they fail? Track 4 depends on the answer. | Documentation + possibly behavior |
| DC-1.3 | Stable cluster identity across restarts. A node restarting should rejoin under its previous identity if its membership marker is still alive. Verify this works; if it doesn't, that's a blocker for safe rolling deploys. | Behavior |

**Websocket-gateway changes.**
- `social-api/src/pipeline/bootstrap.ts:8` — delete the "Phase-5 deployment concern" comment.
- `social-api/src/pipeline/bootstrap.ts:46-51` — accept `seedNodes: string[]` and `transport: 'in-memory' | 'tcp'` options; default `in-memory` for tests, override via env (`PIPELINE_CLUSTER_SEEDS`, `PIPELINE_CLUSTER_TRANSPORT`).
- `docker-compose.yml` — replicate social-api to N=2 with mutual seed wiring; expose cluster gossip ports.
- New script `scripts/cluster-smoke.sh` — kill node A, assert pipeline run on node B continues.

**Acceptance criteria.**
1. `docker compose up` brings up two social-api nodes that converge into a single membership view within 5s.
2. Killing one node mid-pipeline-run (`docker kill social-api-2`) leaves the run on the surviving node retrievable via the bridge's `getRun(runId)` for at least 60s.
3. Restarting the killed node rejoins the cluster under the same node identity (assumes DC-1.3 lands).
4. The "Phase-5 deployment concern" comment is gone.

**Test plan.**
- Unit: existing bootstrap tests parameterized to run `size: 2` with `in-memory` transport.
- Integration: `cluster-smoke.sh` against docker-compose, asserting (1)–(3).
- Chaos: 10-iteration loop killing a random node every iteration; outbox event count must equal expected count (no event loss).

**Effort.** 3–5 engineer-days. Most cost is deployment scaffolding, not code.

---

### Track 2 — MetricsRegistry Adoption

**Goal.** Replace `src/utils/metrics-collector.js` (gateway) and any ad-hoc counters in social-api with `distributed-core`'s `MetricsRegistry` + `PrometheusExporter`. Single `/metrics` scrape endpoint per service; consistent label conventions across the whole platform.

**Surfaces.**
- `MetricsRegistry` (`src/monitoring/metrics/MetricsRegistry.ts`)
- `MetricsTracker` (`src/monitoring/metrics/MetricsTracker.ts`)
- `PrometheusExporter` (`src/monitoring/metrics/MetricsExporter.ts`)
- Types: `MetricLabels`, `MetricSample`, `HistogramSnapshot`, `RegistrySnapshot`

**Current state.**
- Audit verdict: **production-grade.** Counter, Gauge, Histogram (ring-buffer, default 1000 observations); full Prometheus 0.0.4 text format; integrated into `ForwardingServer` as of CHANGELOG v0.2.0.
- websocket-gateway: hand-rolled `metrics-collector.js` (`src/utils/metrics-collector.js:171-195` for reconnection metrics, plus health-check tracking at `:49,197-211`).

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-2.1 | Stable label convention guidance. websocket-gateway will emit metrics from gateway *and* social-api into the same Prometheus; we need a documented convention for distinguishing service, node, and instance labels. If distributed-core has internal conventions, they should be documented and followed. | Documentation |
| DC-2.2 | Histogram bucket configuration: the ring-buffer default of 1000 observations means in low-traffic windows the histogram is dominated by stale data. Confirm whether the implementation does sliding-window or simple ring; document expected p99 stability under bursty load. | Documentation; possibly enhancement |
| DC-2.3 | Confirm `PrometheusExporter` can be mounted on an arbitrary Express/HTTP path (e.g., `/internal/metrics`) — the websocket-gateway public API path conventions need it under `/internal/`. | Documentation |

**Websocket-gateway changes.**
- New module: `src/observability/metrics.js` — single `MetricsRegistry` instance, exports `recordX(...)` helpers that mirror the existing `metrics-collector.js` API one-for-one.
- Replace every call site of `metricsCollector.recordX(...)` with the new module. Keep the function signatures identical to minimize blast radius.
- Mount `PrometheusExporter` at `GET /internal/metrics` on both gateway and social-api.
- Delete `src/utils/metrics-collector.js` once all call sites migrated.
- Add `prom-client` dev-only dependency for asserting exporter output in tests, if not already present transitively.

**Acceptance criteria.**
1. `curl http://gateway/internal/metrics` returns Prometheus text format with at least: `wsg_connections_total`, `wsg_messages_in_total`, `wsg_messages_out_total`, `wsg_reconnections_total`, `wsg_reconnect_latency_seconds` (histogram).
2. `curl http://social-api/internal/metrics` returns the same plus pipeline-specific metrics (`pipeline_runs_total`, `pipeline_run_duration_seconds`).
3. Every metric carries `service` and `node_id` labels.
4. `src/utils/metrics-collector.js` is deleted; no remaining imports.
5. The reconnection-handler tests at `test/session-recovery.test.js` still pass without modification (they assert on metric names, not on collector internals).

**Test plan.**
- Unit: assert that calling each helper produces a `MetricSample` matching the expected name and labels.
- Snapshot: capture exporter output and compare against a golden file (`test/fixtures/metrics-output.txt`).

**Effort.** 1–2 engineer-days.

---

### Track 3 — WAL Durability for the Pipeline Bus

**Goal.** Pipeline run state survives `social-api` process restart. Today it is in-memory and a restart loses everything that hasn't yet been mirrored into the gateway's bridge cache or downstream DynamoDB.

**Surfaces.**
- `WriteAheadLog` (`src/persistence/WriteAheadLog.ts`)
- `WALWriter` / `WALFile` (`src/persistence/wal/`)
- `BroadcastBuffer`
- `EventBus` (consumed via `pubsub` in `ApplicationModuleContext`)

**Current state.**
- Audit verdict: **WAL is production-grade** (fsync + atomic rename via `src/persistence/atomicWrite.ts:27`). EventBus restores its version counter from the max persisted entry on restart (CHANGELOG v0.2.0).
- websocket-gateway leaves `walFilePath: undefined` in `social-api/src/pipeline/bootstrap.ts:46-51`. Pipeline state is in-memory.

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-3.1 | A documented file-layout convention: where should `walFilePath` point when `social-api` runs in Docker? `/var/lib/distributed-core/wal/<nodeId>.log` is a reasonable default, but distributed-core should publish the convention so multiple consumers don't diverge. | Documentation |
| DC-3.2 | Recovery-on-startup observability. When the WAL replays N entries on bootstrap, that should be a metric (`distributed_core_wal_replay_entries_total`) and a log line. Currently unclear what's surfaced. | Enhancement |
| DC-3.3 | Bounded WAL size / rotation policy. A long-running cluster will accumulate WAL forever. distributed-core needs a documented compaction or rotation strategy (size-based or time-based) and a runtime-configurable policy. | Behavior + documentation |
| DC-3.4 | Document semantics when WAL fsync fails (disk full, permission error). Does the EventBus surface the error to publishers, or silently drop? Critical for getting the right error handling on the websocket-gateway side. | Documentation |

**Websocket-gateway changes.**
- `social-api/src/pipeline/bootstrap.ts:46-51` — read `PIPELINE_WAL_PATH` env var; default to `/tmp/pipeline-wal.log` for local dev, `/var/lib/social-api/pipeline-wal.log` in Docker.
- `docker-compose.yml` — add a volume mount for `/var/lib/social-api`.
- Add startup-log assertion: when WAL replays >0 entries, log `[pipeline] resumed from WAL: <N> entries`.

**Acceptance criteria.**
1. With WAL enabled, kill social-api mid-run; restart; the run is retrievable via `bridge.getRun(runId)` in the same state it was in pre-kill.
2. WAL file is created on first run and persists across container restart (volume mount).
3. The startup log line shows the replay count when restarting after a non-empty run.
4. Failure mode: if `PIPELINE_WAL_PATH` is unwritable, social-api fails fast at startup with a clear error (does not silently fall back to in-memory).

**Test plan.**
- Integration: `scripts/wal-recovery-smoke.sh` — start a run, `docker kill`, restart, assert run state persisted.
- Unit: bootstrap tests verifying a custom `walFilePath` is plumbed through to the real cluster (currently this can only be asserted at the boundary).

**Effort.** 1 engineer-day, blocked on DC-3.3 if you want the rotation story closed before going to production.

---

### Track 4 — ResourceRegistry-Backed Room Ownership

**Goal.** Replace the current "every gateway node sees every event via Redis pub/sub" model with explicit room ownership. Each room has one owning node; broadcasts to a room are routed to that node and fanned out from there. This is the architectural unlock for v5.0 Phase 49 (presence sharding) — instead of every gateway holding presence state for every channel, ownership is sharded by `hash(roomId) % N`.

**Surfaces.**
- `ResourceRegistry` (`src/cluster/resources/ResourceRegistry.ts`)
- `ResourceTypeRegistry` (`src/cluster/resources/ResourceTypeRegistry.ts`)
- `ResourceRouter` (existence implied by audit; needs documentation)
- `AutoReclaimPolicy` (CHANGELOG v0.2.0)
- `PlacementStrategy` (`LocalPlacement`, `HashPlacement`, `LeastLoadedPlacement`)
- `ResourceTopologyManager` (`src/cluster/topology/ResourceTopologyManager.ts`) — **observer only, see gap DC-4.1**

**Current state.**
- websocket-gateway: rooms are stored in DynamoDB (`social-rooms`, `social-room-members`). Each gateway node subscribes to Redis pub/sub for every channel any of its connected clients is in. There is no concept of "this room's authoritative state lives on node X."
- distributed-core: resource primitives exist but are **not full topology orchestration**.

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-4.1 | **`ResourceTopologyManager` is observer-only.** It collects state and exposes utilization data (`src/cluster/topology/ResourceTopologyManager.ts:70+`) but does **not** trigger migrations on its own. The actual orchestration lives in `AutoReclaimPolicy` + `ResourceRouter`. **The integrator currently has to wire a rebalance loop themselves.** Either ship that loop in distributed-core, or document explicitly that `ResourceTopologyManager` is a *registry*, not an *orchestrator*, and provide a recipe for the rebalance loop using existing primitives. | **Blocker — needs a decision** |
| DC-4.2 | Document the `ResourceRouter` + `PlacementStrategy` contract. The audit found these primitives but didn't surface a worked example of "user requests roomId X → router determines node Y owns it → request is forwarded." We need an end-to-end example or this becomes a research project. | Documentation |
| DC-4.3 | A first-class hook for "this node just took ownership of resource X" and "this node just lost ownership of resource X." websocket-gateway needs to load presence state on ownership-gained and flush it on ownership-lost. Without this hook, ownership transitions silently break presence. | Behavior — likely an event subscription on `ResourceRegistry` |
| DC-4.4 | `AutoReclaimPolicy` behavior under network partition: if node A and node B both think they own roomId X (split-brain), what happens? distributed-core docs explicitly state "no split-brain consensus" — we need to know whether AutoReclaimPolicy detects and resolves this, or if double-ownership is a real failure mode the integrator must guard against. | Documentation; possibly behavior |

**Websocket-gateway changes** *(after DC-4.1 lands)*.
- New service: `src/services/room-ownership-service.js` — wraps `ResourceRegistry`. On `ownership-gained(roomId)`, hydrates presence state into the local Redis. On `ownership-lost(roomId)`, flushes.
- `src/core/message-router.js:634-708` — when broadcasting to a room, look up the owning node via `ResourceRouter`. If local, fan out; if remote, forward via the cluster transport (no more Redis pub/sub for cross-node fan-out).
- `src/services/presence-service.js` — keyed on `(nodeId, roomId)` instead of just `roomId`; reads only presence for rooms this node owns.

**Acceptance criteria.**
1. With 3 social-api / gateway nodes running, every roomId has exactly one owning node, deterministic by `hash(roomId)`.
2. Killing the owning node for roomId X causes another node to take ownership within 5s; presence state is hydrated on the new owner.
3. A broadcast to roomId X originating on a non-owning node is forwarded once to the owner (not fanned to all nodes via Redis).
4. Under chaos (random kills every 10s), no roomId ever has zero owners for >10s.
5. Under partition (network split), the spec is explicit about which nodes "win" ownership — must align with whatever DC-4.4 documents.

**Test plan.**
- Integration: 3-node `docker-compose.yml`; smoke script that creates 100 rooms, asserts ownership distribution within 10% of `1/N`.
- Chaos: kill loop with assertions on (4).
- Partition: `iptables`-based partition, run for 30s, heal, assert state converges.

**Effort.** This is the largest track. **2–3 engineer-weeks**, with most of the cost on the websocket-gateway side. If DC-4.1 lands as "use these primitives, here's the recipe," the recipe still has to be written and tested. If DC-4.1 lands as "we ship a `RebalanceManager`," call it 1 week.

---

### Track 5 — FailureDetector + ChaosInjector

**Goal.** Once Track 1 is shipped, `FailureDetector` is consumed implicitly (the cluster uses it). Make it explicit: emit metrics and logs for every suspected/confirmed failure, and use `ChaosInjector` in pre-prod test runs to verify the rest of the integration is robust under realistic faults.

**Surfaces.**
- `FailureDetector` (`src/monitoring/FailureDetector.ts:39+`) — phi-accrual style, production-grade per audit.
- `ChaosInjector` (`src/diagnostics/ChaosInjector.ts:15+`) — BETA per audit.

**Current state.**
- Audit: FailureDetector is production-grade. ChaosInjector is functional but not production-hardened (no rate limiting per scenario, no automatic cleanup on unplanned exits).

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-5.1 | Surface FailureDetector events as metrics: `distributed_core_node_suspected_total`, `distributed_core_node_confirmed_failed_total`, `distributed_core_phi_seconds` (histogram). If these already exist, document them. | Documentation; possibly enhancement |
| DC-5.2 | ChaosInjector cleanup-on-exit: if the injector process crashes mid-scenario, it currently leaves the cluster in a degraded state. Add a finalizer that resets all injected faults on `SIGINT`/`SIGTERM`. | Enhancement |
| DC-5.3 | A "chaos budget" — rate-limit injected faults so a runaway test doesn't take down the entire cluster. Configurable max-concurrent-faults and max-faults-per-minute. | Enhancement |

**Websocket-gateway changes.**
- New CI job: `chaos-smoke.yml` runs ChaosInjector for 60s against the 3-node test cluster; asserts no message loss against the outbox.
- Subscribe to FailureDetector events in `pipeline-bridge.js`; emit `wsg_cluster_node_failed_total` metric.

**Acceptance criteria.**
1. `wsg_cluster_node_failed_total` increments when a node is killed in chaos tests.
2. Chaos test job runs in CI for 60s with random faults, completes with zero message loss.
3. ChaosInjector cleans up on `SIGTERM` (asserted via the chaos test never leaving the cluster in a degraded state on CI cancel).

**Test plan.**
- Integration: chaos-smoke job in CI.
- Unit: subscribe to a mock `FailureDetector`, assert the metric increments.

**Effort.** 2–3 engineer-days, mostly waiting on DC-5.2.

---

### Track 6 — Custom `SocialApplicationModule`

**Goal.** Lift social-event publishing into a `SocialApplicationModule` that lives alongside `PipelineModule` in the same cluster. Social events become first-class cluster citizens — published through `EventBus`, durable via WAL, observable via the cluster's metrics + introspection. This *partially* obsoletes the DynamoDB outbox + EventBridge pipeline.

**This is an architectural change, not a refactor. It is Tier 3 — last to ship, only after Tiers 1 and 2 are proven in production.** It is included here so the distributed-core team understands where the integration is heading, not as a near-term ask.

**Surfaces.**
- `ApplicationModule` (abstract; `src/applications/ApplicationModule.ts:18+`)
- `ApplicationRegistry.registerModule` (`src/applications/ApplicationRegistry.ts:69+`)
- `EventBus` via `ApplicationModuleContext.pubsub`

**Current state.**
- Audit: `ApplicationModule` is a real public extension point with a clean lifecycle (`initialize`, `start`, `stop`).
- websocket-gateway's `outbox-publisher.ts` and Lambda relay are correct, durable, and tested. There is no urgency to replace them — this track is about *what comes next* once the simpler tracks have established trust in distributed-core's runtime.

**Gaps to close in distributed-core.**

| ID | Description | Severity |
|---|---|---|
| DC-6.1 | A worked example of a non-trivial third-party `ApplicationModule` in `distributed-core/examples/`. PipelineModule is the only existing example and it's deeply baked in. The integrator needs a "build your own module" template covering: lifecycle, EventBus consumption, ResourceRegistry registration, error handling, metrics. | Example |
| DC-6.2 | A versioning story for module wire formats. If `SocialApplicationModule` v1 ships and v2 changes the event shape, what does upgrade look like in a rolling deploy where some nodes are v1 and some are v2? distributed-core does not solve this for you today; either ship a story or document the limitation. | Documentation; possibly behavior |
| DC-6.3 | Cross-module event routing: can `PipelineModule` emit an event that `SocialApplicationModule` consumes? If yes, document the topic-name convention. If no, document the constraint. | Documentation |

**Websocket-gateway changes.**
- New package: `social-api/src/social-module/` — implements `SocialApplicationModule extends ApplicationModule`.
- Migration plan: dual-write (outbox + module) → switch reads → drop outbox. Estimated 6+ weeks of careful work, **only relevant if multi-region or sub-100ms event-fanout becomes a real requirement.**

**Acceptance criteria.** *(Defined when this track is unblocked. Not specified now.)*

**Effort.** Not estimated. Re-evaluate after Tracks 1–4 ship.

---

## 5. Sequencing

```
Tier 1 (parallel, low risk):
  ├─ Track 2 — MetricsRegistry swap            [1–2 days]
  └─ Track 3 — WAL on for pipeline bus         [1 day]

Tier 2 (after Tier 1, depends on Track 1 first):
  ├─ Track 1 — Multi-node cluster bootstrap    [3–5 days, prerequisite for 4 & 5]
  ├─ Track 4 — ResourceRegistry room ownership [2–3 weeks; gated on DC-4.1]
  └─ Track 5 — FailureDetector + ChaosInjector [2–3 days; can land anytime after Track 1]

Tier 3 (only after Tiers 1 & 2 are stable in production):
  └─ Track 6 — Custom SocialApplicationModule   [not estimated]
```

**Critical path:** DC-4.1 is the largest single decision. The track owner on the distributed-core side should pick one of:

- **(a)** Ship a `RebalanceManager` that turns `ResourceTopologyManager` from observer to orchestrator. Larger scope on the distributed-core side; smaller scope on the consumer side.
- **(b)** Document `ResourceTopologyManager` honestly as a registry, and publish a "rebalance recipe" using `AutoReclaimPolicy` + `ResourceRouter` + `PlacementStrategy`. Smaller scope on the distributed-core side; the consumer (websocket-gateway) writes the rebalance loop.

Either is acceptable. The integration cannot start Track 4 until one is chosen.

---

## 6. Distributed-Core Gap Summary

Roll-up of every gap raised in the tracks. ✅ closed in v0.3.0; ⚠️ partial; ❌ open.

| ID | Status (post-v0.3.0) | Notes |
|---|---|---|
| DC-1.1 | ✅ | `examples/cluster-multinode/` — two-process tcp/websocket with seed wiring |
| DC-1.2 | ✅ | ARCHITECTURE.md "Graceful leave" + integration test; ALIVE → LEAVING within one gossip interval |
| DC-1.3 | ✅ | `loadOrCreateNodeId(filePath)` + `NodeOptions.identityFile` |
| DC-2.1 | ✅ | INTEGRATION.md §8.1 |
| DC-2.2 | ✅ | INTEGRATION.md §8.2 |
| DC-2.3 | ✅ | INTEGRATION.md §8.3 |
| DC-2.4 | ✅ | `MetricsRegistry.counter(name, labels, description?)` — picked up in our Wave 2 |
| DC-3.1 | ✅ | INTEGRATION.md §8a.1 — `<dataDir>/wal/<nodeId>.log` |
| DC-3.2 | ✅ | `eventbus.wal.replay.entries` counter + structured log on resume |
| DC-3.3 | ✅ | `WALSegmentManager` — also fixed a latent 100MB-hard-fail crash bug |
| DC-3.4 | ✅ | INTEGRATION.md §8a.2 — sync errors propagate; background sync errors logged + swallowed (acknowledged limitation) |
| DC-4.1 | ✅ | `RebalanceManager` — full orchestrator (path A) |
| DC-4.2 | ✅ | `examples/room-ownership/` |
| DC-4.3 | ✅ | `ownership:gained` / `ownership:lost` events on `RebalanceManager` |
| DC-4.4 | ✅ | **Decision: CrdtEntityRegistry.** v0.3.1 added remote-event fix + self-replay short-circuit; v0.3.2 fixed AutoReclaim during LEAVING window (path-C). RebalanceManager event coverage in distributed-core's tests; our verification work now lives in this repo (Wave 4a). |
| DC-5.1 | ✅ | `failure_detector.node_suspected.total`, `failure_detector.node_failed.total`, `failure_detector.phi.value` |
| DC-5.2 | ✅ | `installSignalHandlers?: boolean` (default true) on ChaosInjector |
| DC-5.3 | ✅ | `maxConcurrentFaults`, `maxFaultsPerMinute` with `'fault-dropped'` event |
| DC-6.1 | ✅ | `examples/chat/src/ChatApplicationModule.ts` annotated as template |
| DC-6.2 | ✅ | INTEGRATION.md §8b.1 |
| DC-6.3 | ✅ | INTEGRATION.md §8b.2 |

### New gaps surfaced post-v0.3.0

| ID | Severity | Description |
|---|---|---|
| DC-PIPELINE-1 | Enhancement | `PipelineModule.getMetrics()` returns only `{ runsAwaitingApproval }`. The dashboard needs `runsStarted`, `runsCompleted`, `runsFailed`, `runsActive`, `avgDurationMs`, `llmTokensIn`, `llmTokensOut`, `estimatedCostUsd`, `asOf`. websocket-gateway currently fills these as `null` and tags response `source: 'bridge'` so the frontend can render a partial-data state. |
| DC-PIPELINE-2 | ✅ closed in v0.3.1+v0.3.2 | RebalanceManager event coverage shipped; AutoReclaim graceful-stop fix shipped. We still write a Wave-4a verification test against our own stack to lock the integration. |
| DC-PIPELINE-3 | Ergonomics (low) | `NodeHandle` exposes accessors for cluster/pubsub/router but not for the registries. Bootstrap had to instantiate `ResourceRegistry` / `ResourceTopologyManager` / `ApplicationRegistry` directly, mirroring distributed-core's own test harness. Convenience accessors would simplify integrators. |
| DC-3.5 | ✅ root-caused, fix queued | **Stale `dist/` masked v0.3.2's path-C fix.** Wave 4a's verification test only passed after running `npm run build` locally on the sibling repo. Connor explained: dist was rebuilt after the path-C source landed but NOT after the v0.3.3 double-fire guard, and dist is gitignored — path-deps don't reliably re-run the `prepare` hook. Fix queued: GitHub Actions on tag-push runs `npm run build` + asserts dist exists, plus `prepublishOnly`. Lands before v0.3.4. |
| DC-PIPELINE-4 | Documentation correction | `EntityRegistryFactory.create` takes `crdtOptions: { tombstoneTTLMs }`, NOT `options: { tombstoneTTLMs }` (silently ignored). Surfaced from Wave 4a. Connor patching `docs/handoff/v0.3.1-response.md` inline. Spec corrected. |
| DC-PIPELINE-5 | Behavior fix queued | `examples/room-ownership/run.ts` uses teardown-then-stop ordering. For consumers needing `ownership:lost` to flush local state, the correct order is **stop first** (so peers see LEAVING + the cluster reacts), **then teardown** so the manager is still subscribed. Connor patching example + adding "flush owned resources before stop" comment. Wave 4b's room-ownership-service implements stop-then-teardown directly. |
| DC-PIPELINE-6 → M11 (v0.4.x) | Enhancement tracked | `RebalanceManager.ownerCache` is empty for router-only setups (no `ResourceRegistry`). `previousOwnerId` on `ownership:gained` is `null` until the consumer maintains its own cache. Connor will seed the cache from the registry on `start()` in v0.4.x; until then, our room-ownership-service maintains a `roomId → lastKnownOwnerId` map locally. |
| DC-PIPELINE-7 | New gap (blocking owner-aware routing in websocket-gateway) | The bootstrap surface used by websocket-gateway (`createCluster` → `ClusterHandle` → `NodeHandle`) does not expose any way to send an arbitrary application payload to a specific peer node id. PubSub is broadcast-only; `Transport.send(message, NodeId)` exists but is reserved for cluster-internal `JOIN` / `GOSSIP` types — peer-side `ClusterCommunication.handleMessage()` only switches on those two cases and silently drops everything else. The gateway-side `gateway/routing/MessageRouter` does have `sendToClient` over transport, but `Node.start()` never wires `transport.onMessage` to it (lines 197–200 are commented out), so even messages sent that way would never reach userland. See "DC-PIPELINE-7 — Peer-addressed send API" below for the requested surface. |

### DC-PIPELINE-7 — Peer-addressed send API

**Why we need it.** Wave 4c step 1 added owner-aware routing scaffolding to `websocket-gateway/src/core/message-router.js#sendToChannel()`. When the room-ownership service identifies a remote owner, the gateway today logs the forward intent and falls through to the existing Redis pub/sub fan-out. The deferred wiring (C1) is the actual `cluster.send(peerNodeId, envelope)` call: deliver the channel-message envelope to the owning peer instead of fan-out, so the owner can be the single authoritative writer for that room.

**What exists today.**

- `NodeHandle.getCluster()` / `.getRouter()` / `.getMessageRouter()` are exposed, but none of them surface a "send arbitrary payload to a peer by node id" method on the `ClusterHandle` / `NodeHandle` API.
- `Transport.send(message: Message, target: NodeId)` exists on the `Transport` abstract class and is reachable via `node.transport` (or `clusterManager.transport`). However, on the receiving side the only `transport.onMessage` listener wired by `Node.start()` is `ClusterManager`'s, whose handler dispatches strictly on `'JOIN' | 'GOSSIP'`. `MessageType.CUSTOM` payloads are silently dropped.
- `PubSubManager.publish(topic, payload)` is the only cross-node application-message channel today, and it is fan-out-by-topic — no per-peer addressing, no early-exit "deliver only to the owner" path.

**Method shape requested (preferred).**

```ts
// On ClusterHandle (preferred — gateway already holds a ClusterHandle):
clusterHandle.send(peerNodeId: string, payload: unknown): Promise<void>;

// Equivalent on NodeHandle would also work:
nodeHandle.send(peerNodeId: string, payload: unknown): Promise<void>;
```

The receiving-side counterpart needs to be reachable from userland too — either:

1. An `onMessage(handler: (fromNodeId: string, payload: unknown) => void)` registration on the same handle, OR
2. An event the handle emits, e.g. `handle.on('peer-message', ({ fromNodeId, payload }) => …)`.

Either form is acceptable; pick whichever fits distributed-core's existing event/registration idiom best.

**Delivery semantics.** Best-effort, fire-and-forget at the API surface; the websocket-gateway caller will `await` the returned `Promise` only to catch synchronous send failures (unknown peer, transport down) and `.catch()` them off the hot path. We do **not** require at-least-once. The Promise should:

- Resolve when the send was handed to the transport (even if the peer hasn't acked).
- Reject with a typed error (e.g. `UnknownPeerError`) if `peerNodeId` is not in the local membership table at call time.
- Reject (or resolve — either is fine, document the choice) on transport-layer failures; the caller will fall back to Redis fan-out either way.

**Reasoning.** Without this surface, the deferred forward in `src/core/message-router.js#sendToChannel()` cannot be implemented through the public bootstrap API. The alternatives we considered and rejected:

- **Reach into `node.transport` and call `transport.send` directly with `MessageType.CUSTOM`.** Receiving side has no userland handler wired (Node.start lines 197–200 are commented out), so the peer would silently drop the message. Even if we wired `transport.onMessage` ourselves, that's an internal API and not safe for the gateway to depend on.
- **Use PubSub and address by topic naming convention (e.g. `peer:<nodeId>`).** Works, but every peer pays the deliver-locally + cluster-fan-out cost on every send and the topic registry grows unbounded with cluster size. Defeats the whole point of owner-aware routing (which exists to reduce work, not add a layer).
- **Stand up a sidecar HTTP transport per gateway node** (similar to `HttpForwardingTransport` from `routing/`). Heavier than what the integration warrants for a single-process forward; introduces a second network surface to operate.

Until this lands, the C1-deferred forward stays a log-only intent and the broadcast falls through to Redis fan-out (today's behavior, no regression). The comment in `src/core/message-router.js#sendToChannel()` points at this section.

---

## 7. Open Questions

1. **Versioning.** What's distributed-core's policy for breaking changes pre-1.0? `package.json` declares `file:../../distributed-core` as a path-based dependency, so semver doesn't protect us. Should we tag releases?
2. **Test fixtures.** `FixtureLLMClient` is consumed in websocket-gateway tests. Are other fixtures (`FixtureCluster`, `FixtureEventBus`) available or planned? Tracks 4 and 6 will need them.
3. **CI.** Should websocket-gateway's CI pin a specific distributed-core commit/tag? Today it consumes whatever's at `../../distributed-core`. A drift-detection check would help.
4. **Operational ownership.** Once Tier 2 ships, who is on-call for cluster issues? distributed-core team, websocket-gateway team, or shared? Worth deciding before Track 4 lands in production.

---

## 8. Glossary

- **Bridge** — `social-api/src/pipeline/createBridge.ts`. Adapter from `PipelineModule` to the `PipelineBridge` interface that route handlers consume.
- **Outbox** — DynamoDB `social-outbox` table. Atomic write of social mutation + event in one `TransactWriteCommand`. Relay Lambda publishes to SQS.
- **Owning node** — In Track 4, the cluster node that is authoritative for a given roomId at a given moment.
- **Phase X** — A milestone in `.planning/ROADMAP.md`. Tracks 1–6 here are forward-looking; their numbering does not align with phase numbers.
- **WAL** — Write-Ahead Log. distributed-core's `src/persistence/WriteAheadLog.ts`.

---

## 9. Sign-off

This spec is **draft**. Sign-offs needed before any track starts:

- [ ] distributed-core lead — confirms gap list is accurate, picks a path on DC-4.1.
- [ ] websocket-gateway lead — confirms scope and sequencing.
- [ ] Operations — confirms deployment scaffolding for multi-node (Track 1) is in scope.
