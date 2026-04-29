# Cardinality Audit — Wave 2 Metrics

**Date:** 2026-04-28
**Scope:** Prometheus counters/histograms/gauges added during Wave 4 integration
between `websocket-gateway` and `distributed-core`. Threaded via the shared
`MetricsRegistry` exposed at `GET /internal/metrics`.

**Goal:** confirm no metric labels by `roomId`, `runId`, `userId`, or any other
unbounded identifier — those would multiply time-series count without bound and
blow up Prometheus storage.

**TL;DR:** No unbounded labels found. Every Wave-2 label is either a bounded
enum (`result`, `outcome`, `reason`) or a per-cluster-node identity
(`node_id`, `service`) that scales with cluster size. **No upstream DC asks
required, no local fixes required.** Continue to enforce this in review going
forward — see "Forward-looking risks" below.

---

## Source-of-truth scan

Each row links a metric to the file + line where it is declared/incremented.
I read the actual `.counter(` / `.histogram(` / `.gauge(` calls; the label
arguments are reproduced verbatim in the table.

| Metric | Type | Source | Labels at call site |
|---|---|---|---|
| `resource.claim.count` | counter | `distributed-core/src/routing/ResourceRouter.ts:212,217` | `{ result: 'success' }`, `{ result: 'conflict' }` |
| `resource.claim.latency_ms` | histogram | `distributed-core/src/routing/ResourceRouter.ts:213` | _(none)_ |
| `resource.local.gauge` | gauge | `distributed-core/src/routing/ResourceRouter.ts:214,231` | _(none)_ |
| `resource.release.count` | counter | `distributed-core/src/routing/ResourceRouter.ts:230` | _(none)_ |
| `resource.transfer.count` | counter | `distributed-core/src/routing/ResourceRouter.ts:276` | _(none)_ |
| `resource.orphaned.count` | counter | `distributed-core/src/routing/ResourceRouter.ts:440` | _(none)_ |
| `rebalance.triggered.count` | counter | `distributed-core/src/cluster/topology/RebalanceManager.ts:444` | `{ reason: RebalanceReason }` |
| `rebalance.duration_ms` | histogram | `distributed-core/src/cluster/topology/RebalanceManager.ts:473` | `{ reason: RebalanceReason }` |
| `gateway_message_peer_routed_count` | counter | `websocket-gateway/src/observability/metrics.js:50,55` | `{ ...BASE_LABELS, outcome: 'ok' }`, `{ ...BASE_LABELS, outcome: 'peer_failed_fallback' }` |
| `gateway_message_peer_received_count` | _(not yet present in tree)_ | n/a | — |
| `wsg_active_connections` | gauge | `websocket-gateway/src/observability/metrics.js:29` | `BASE_LABELS = { service, node_id }` |
| `wsg_messages_total` | counter | `websocket-gateway/src/observability/metrics.js:30` | `BASE_LABELS` |
| `wsg_reconnect_attempts_total` | counter | `websocket-gateway/src/observability/metrics.js:31` | `BASE_LABELS` |
| `wsg_reconnect_successes_total` | counter | `websocket-gateway/src/observability/metrics.js:32` | `BASE_LABELS` |
| `wsg_reconnect_failures_total` | counter | `websocket-gateway/src/observability/metrics.js:33` | `BASE_LABELS` |
| `wsg_connection_failures_total` | counter | `websocket-gateway/src/observability/metrics.js:34` | `BASE_LABELS` |
| `pipeline_triggers_total` | counter | `websocket-gateway/src/observability/metrics.js:38` | `BASE_LABELS` |
| `pipeline_approvals_total` | counter | `websocket-gateway/src/observability/metrics.js:39` | `BASE_LABELS` |
| `pipeline_cancels_total` | counter | `websocket-gateway/src/observability/metrics.js:40` | `BASE_LABELS` |
| `pipeline_errors_total` | counter | `websocket-gateway/src/observability/metrics.js:41` | `BASE_LABELS` |

`BASE_LABELS = { service: WSG_SERVICE_NAME ?? 'gateway', node_id: WSG_NODE_ID ?? os.hostname() }`.

`RebalanceReason = 'manual' | 'member-joined' | 'member-left' | 'interval' | 'topology-recommendation'`.

> Note on the registry. `MetricsRegistry.counter(name, labels)` keys a unique
> series on `(name, labels)` — see `buildKey()` in
> `distributed-core/src/monitoring/metrics/MetricsRegistry.ts:37-39`. Labels
> are baked at construction time, so each unique label combination is one
> persistent series for the lifetime of the registry. The cardinality
> question reduces to: how many distinct label combinations does each call
> site produce?

---

## Categorization

| Metric | Label keys | Category | Risk | Notes |
|---|---|---|---|---|
| `resource.claim.count` | `result` | **Bounded** (2 values: `success`, `conflict`) | none | |
| `resource.claim.latency_ms` | _(none)_ | **Bounded** (1 series) | none | |
| `resource.local.gauge` | _(none)_ | **Bounded** (1 series) | none | |
| `resource.release.count` | _(none)_ | **Bounded** (1 series) | none | |
| `resource.transfer.count` | _(none)_ | **Bounded** (1 series) | none | |
| `resource.orphaned.count` | _(none)_ | **Bounded** (1 series) | none | |
| `rebalance.triggered.count` | `reason` | **Bounded** (5 enum values) | none | Type union enforced by TS. |
| `rebalance.duration_ms` | `reason` | **Bounded** (5 enum values) | none | |
| `gateway_message_peer_routed_count` | `service`, `node_id`, `outcome` | **Bounded × per-node** (2 outcomes × #nodes) | low | `outcome` is a 2-value enum. `node_id` is per-cluster-member. |
| `wsg_*` (all gauges/counters with BASE_LABELS only) | `service`, `node_id` | **Per-node** (#nodes series each) | low | Scales linearly with cluster size, not with traffic. |
| `pipeline_*_total` (all four) | `service`, `node_id` | **Per-node** | low | Same as `wsg_*`. |

**No metric labels by `roomId`, `runId`, `userId`, `topic`, `correlationId`, or
any other unbounded identifier.** No `topic_class`-style bucketing is needed
because no per-message-key labels exist anywhere on the audited surfaces.

### Per-node label sizing

`service` is constant per process (a deploy decides it). `node_id` is per
cluster member; with WAL-persisted `WSG_CLUSTER_IDENTITY_FILE` /
`PIPELINE_IDENTITY_FILE` it is stable across restarts and recycles for the
same node. With ephemeral identity (default in tests) every restart mints a
fresh id, so each metric grows by one series per restart.

- **Single-digit cluster (current target):** ≤ 10 distinct `node_id` values.
  All metrics together emit < 200 series. Trivial.
- **Hundreds-of-nodes fleet (future):** still bounded by cluster size; no risk
  of unbounded explosion. Series cleanup of dead-node `node_id`s would still
  be advisable but is a Prometheus-side retention concern, not a registry
  bug.
- **Frequent-restart-without-identity-file (mostly tests):** each restart
  leaks one series per metric. Tests run in-process and tear the registry
  down with the gateway, so the leak does not survive the process. **Do not
  run production with `WSG_CLUSTER_IDENTITY_FILE` unset** — the env-var doc
  flags this.

---

## Findings — risk levels

- **HIGH (unbounded labels):** none.
- **MEDIUM (per-message-key labels):** none.
- **LOW (per-node identity):** all `wsg_*`, all `pipeline_*_total`, and
  `gateway_message_peer_routed_count`. Acceptable for the current cluster
  size; revisit if the fleet grows past a few hundred nodes or if ephemeral
  identity is used in production.
- **None (bounded enums or label-less):** every DC primitive metric.

---

## Recommendations

1. **No code changes required at this wave.** Every label is either a bounded
   enum or per-node, both of which Prometheus handles fine at our scale.

2. **Forward-looking guardrails.** When the gateway adds new metrics in
   future waves, the review rule is:
   - Any label whose value derives from a request payload, room/run/user
     identifier, topic, correlation id, or other dynamic field is presumed
     unbounded and must either be dropped or pre-bucketed (e.g. `topic`
     → `topic_class` with a fixed enum of buckets like `presence`, `chat`,
     `pipeline`, `other`).
   - Per-node labels are fine; per-deploy labels (`service`, `region`,
     `env`) are fine; everything else needs justification.

3. **`gateway_message_peer_received_count` (not yet present).** When the
   sister agent lands it, the same rule applies: if it adds an `outcome` or
   `result` label, fine; do not add `peer_id`, `topic`, or any
   payload-derived label without bucketing.

4. **Identity stability in production.** Operators should set
   `WSG_CLUSTER_IDENTITY_FILE` (and the corresponding
   `PIPELINE_IDENTITY_FILE` on social-api) to a persistent path so
   `node_id` recycles across restarts. This bounds the per-node label
   universe to actual fleet size rather than cumulative-restart count.
   Documented in `ENV-VARS-WAVE2.md`.

5. **Histogram bucket count.** `MetricsRegistry.Histogram` defaults to 1000
   stored observations per series (ring buffer; see
   `MetricsRegistry.ts:91`). Each unique label combination on a histogram
   metric allocates its own 1000-element buffer. Currently histograms only
   come from
   - `resource.claim.latency_ms` — 1 series
   - `rebalance.duration_ms` — up to 5 series (`reason` enum)
   so the memory cost is < 50 KB per node. No action required, but worth
   keeping in mind: introducing a per-node histogram label would allocate one
   ring buffer per `node_id`, which is fine at current scale but compounds
   if combined with another bounded label.

---

## Upstream asks for distributed-core

**None for this audit.** Both `ResourceRouter` and `RebalanceManager` use
exclusively bounded enums (`result`, `reason`) or label-less metrics. They
already follow Prometheus best practices.

Tagging this as a non-finding so the DC asks list does not grow a phantom
FR-9 — there is nothing to fix here. If a future DC primitive proposes a
label like `topic`, `entityId`, or similar dynamic key, that would warrant a
new FR.

---

## Local fixes applied at this wave

**None.** The gateway-side `metrics.js` only labels by `service` + `node_id`
(via `BASE_LABELS`) plus a single bounded `outcome` on
`gateway_message_peer_routed_count`. No local code edits required.
