# Phase 50 — lib-expansion-3 Adoption Plan (T12 → T13+T1 → T9+T1)

**Status:** planning, code wiring blocked on hub#35 (operator-driven `v0.11.0` release cut of distributed-core).
**Owner:** websocket-gateway agent.
**Reference handoffs:** orchestrator hub#13/#14, distributed-core hub#15, gateway hub#16; tracker is hub#37 (planning) → hub#38 (code wiring, blocked).

This doc is the mechanical adoption recipe for the three lib-expansion-3 primitives that move Phase 50 (Pipeline Error Visibility & Health) forward. distributed-core has already shipped them additively to local main (HEAD `f842e96`); the gateway cannot install them until the v0.11.0 tag exists on origin.

---

## 1. Reality check

| | State |
|---|---|
| Gateway pin (root) | `distributed-core` → `github:connorhoehn/distributed-core#v0.10.0` (`5bbbe26`) |
| Gateway pin (social-api) | same |
| dist-core local HEAD | `0b9eb15` (verified 2026-04-30) |
| dist-core origin/main | `667cabb` |
| Available tags | up through `v0.10.0` only — `v0.11.0` does NOT exist |
| Pin path A (`#v0.11.0`) | tag missing — install will fail |
| Pin path B (`#f842e96`) | sha not on origin — install will fail |
| Worker policy | local-only, no push of dist-core. Release cut is operator-driven (hub#35). |

**Hard gate:** code wiring (Steps 1–3 below) cannot land until either (a) hub#35 lands and origin has `v0.11.0`, or (b) distributed-core operator pushes its local main and we SHA-pin to a resolvable origin SHA.

---

## 2. Step 1 — T12 consumer-lag metrics (zero T1 dep)

Smallest, safest first. New module names use `dc_` prefix and `_` separators; existing gateway names use `.` separators — no collision (handoff #15 Q4).

**Pin bump (one commit, gates the whole step):**
- `package.json:49` — `distributed-core` → `^0.11.0`
- `social-api/package.json:23` — same
- regenerate both lockfiles
- run all three test suites; existing 372/193/913 totals must stay green before any T12 wiring lands

**Wire points:**

| File | Change |
|---|---|
| `src/observability/metrics.js` | After `getRegistry()`, add `getQueueMetrics(queueName)` returning a memoized `QueueMetrics` instance per queue label. Bounded enum: `'run-queue' \| 'trigger-queue' \| 'dlq'`. Export. |
| `social-api/src/observability/metrics.ts` | Same shape; same enum. Export. |
| `social-api/src/pipeline/bootstrap.ts` | After `getMetricsRegistry()`, instantiate `QueueMetrics` for `'run-queue'` and subscribe to `module.getEventBus()` for `pipeline.run.{started,completed,failed}` — translate to `recordEnqueued / recordCompleted / recordFailed` calls. |
| `social-api/src/pipeline/config/pipelineModule.ts` | No change. T12 wires at the EventBus subscription layer, not in PipelineModule config. |

**Cardinality discipline (gateway-owned, library does NOT enforce):**
- `queue` label is the bounded enum above. Never run ids, tenant ids, or roomIds.
- Per-partition lag/committed-offset gauges multiply cardinality. Until T6 lands the gateway has one logical partition per worker — low cardinality, fine.

**Verification:**
- `/internal/metrics` Prometheus scrape on both gateway and social-api includes new `dc_queue_*` lines for at least the `run-queue` label.
- Trigger a synthetic run; `dc_queue_throughput_enqueued_total{queue="run-queue"}` ticks up.
- Existing test totals stay green.

---

## 3. Step 2 — T13 introspection + T1 boundary adapter

Free composition over the bridge. Adopts T1 Envelope at the Inspector boundary only — does not ripple through PipelineModule, ResourceRegistry, or state-machine commands.

**Wire points:**

| File | Change |
|---|---|
| `social-api/src/pipeline/createBridge.ts` | Add `asEnvelope(run: PipelineRunSnapshot): Envelope<PipelineRunSnapshot>` and `leaseAsLeaseLike(...)` adapters (~15 LOC each). Add `getInspector(): QueueInspector<PipelineRunSnapshot>` to `PipelineBridge`, returning `new InMemoryQueueInspector({ pending: () => bridge.listActiveRuns().map(asEnvelope), inflight: ..., dlq: ... })`. |
| `social-api/src/routes/pipelineTriggers.ts` | Add `PipelineBridge.getInspector` to the public bridge type union. |
| `social-api/src/routes/pipelineInspector.ts` (new) | GET `/api/pipelines/inspector/pending`, `/inflight`, `/summary`, `/peek/:runId`. Read-rate-limited (mirror existing `pipelineReadRateLimit` middleware). Pass-through to `bridge.getInspector()`. |
| `social-api/src/app.ts` | Mount `pipelineInspectorRouter` at `/api/pipelines/inspector`. |

**T1 adapter sketch (per handoff #15 Q3, ~15 LOC):**
```ts
function asEnvelope(run: PipelineRunSnapshot): Envelope<PipelineRunSnapshot> {
  return wrap(run, {
    id: run.runId,
    now: () => new Date(run.startedAt ?? run.asOf ?? 0).getTime(),
    attemptCount: 0,
  });
}
```

**Verification:**
- Inspector summary returns matching counts vs `bridge.getMetrics()` for active runs.
- `peek/:runId` returns the same `runId` / `pipelineId` fields as `getRun(:runId)`.
- New unit test under `social-api/src/pipeline/__tests__/inspector.test.ts`.

---

## 4. Step 3 — T9 DLQ inspect/redrive + T1 boundary adapter

Replaces the existing `eventBusDeadLetterHandler` callback (which currently just bumps a counter via `incrementBusDeadLetter`) with a structured DLQ store.

**Wire points:**

| File | Change |
|---|---|
| `social-api/src/pipeline/bootstrap.ts` | After registry+module init, instantiate `new InMemoryDeadLetterQueue<BusEvent>()`. Replace the existing `eventBusDeadLetterHandler` body: `(event, error) => { incrementBusDeadLetter(error.name); dlq.put(asEnvelope(event), { lastError: error.message, failedAtMs: Date.now() }); }`. |
| `social-api/src/pipeline/createBridge.ts` | Take `dlq` as a constructor param. Add `bridge.getDLQ(): DeadLetterQueue<BusEvent>`. The Inspector from Step 2 already accepts a `dlq` getter; wire it. |
| `social-api/src/routes/pipelineDLQ.ts` (new) | GET `/api/pipelines/dlq` (list + filter), GET `/api/pipelines/dlq/:id` (peek), POST `/api/pipelines/dlq/redrive` (admin auth). Reuses inspector's auth/rate-limit. |
| `social-api/src/app.ts` | Mount `pipelineDLQRouter` at `/api/pipelines/dlq`. |

**Authz note:** redrive/purge are destructive-shaped. Gate behind the same admin role check as the cancel/approve endpoints in `pipelineTriggers.ts`. Library does NOT ship authz (handoff #15 Q3 sketch).

**Verification:**
- Trigger a synthetic subscriber-throw; DLQ list returns the failed event with `lastError` matching the thrown message.
- `redrive(ids, { resetAttempts: true })` returns `{ redriven: 1, failed: [] }` and the run reappears in `bridge.listActiveRuns()`.
- New unit tests under `social-api/src/pipeline/__tests__/dlq.test.ts`.

---

## 5. Out of scope

- **T6 ConsumerGroups** — parked at distributed-core hub#18; revisit when ≥2 nodes / Phase 4 Raft leaves scoping.
- **T16 JobResult** — parked per gateway handoff #10; four unpark triggers documented.
- **T8 Subscriber, T11 Drain** — separate roadmap items. T11's k8s preStop recipe is hub#36 (P3, gateway not in pull).
- **CloudWatch cutover** — independent track per `DC-INTEGRATION-ROADMAP.md` Phase 2.

---

## 6. Risks

- **Lockfile churn on the pin bump.** Both `package-lock.json` files regenerate. Inspect for unintended transitive bumps; gate on existing test totals (372/193/913).
- **Inspector cardinality if a pipeline run leaks into the `queue` label.** Mitigation: bounded enum check in `getQueueMetrics`. Throw on unknown queue name in tests.
- **DLQ memory growth.** `InMemoryDeadLetterQueue` is in-memory only; gateway's pipeline today is fire-and-forget (per memory `queue-decision-threshold`). DLQ growth is bounded by failure rate × WAL retention. If WAL is tuned to many days, add a `purge` schedule (cron-like, daily). Track as Phase 50 follow-up if it surfaces in load testing.

---

## 7. When to execute

Steps 1–3 land in order, one PR per step, on local `main` per repo policy. Each step is a single commit (or two — pin bump separated from wiring) so test totals can be re-verified after each.

Trigger to start: orchestrator handoff confirming hub#35 has cut `v0.11.0` AND origin has the tag, OR distributed-core handoff with a resolvable origin SHA.
