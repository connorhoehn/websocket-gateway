# Pipeline Audit Roll-up — for distributed-core team

**Date:** 2026-04-28
**Author:** websocket-gateway integration team
**Companion:** docs/handoff/v0.3.1-response.md (your repo)
**distributed-core version evaluated:** v0.3.2 / v0.3.3

## TL;DR

Six parallel audits found that distributed-core v0.3.2 is structurally sound — the executor, EventBus, and LLM streaming surface all work correctly end-to-end — but a handful of correctness gaps and unimplemented-but-typed features force consumers into unsafe defaults. **15 distinct asks back to distributed-core** (4 HIGH, 7 MEDIUM, 4 LOW); none are large rewrites, several are one-line type or payload changes. The single most-impactful issue is **`resolveApproval` has zero per-user dedup**, allowing one user to satisfy `requiredCount=N` by clicking Approve N times. Most other findings either already shipped (see "addressed" section) or are exposure problems on our side, not yours.

## Summary by audit

### 01 — Capability Surface
**File:** [PIPELINE-AUDIT-01-CAPABILITY-SURFACE.md](./PIPELINE-AUDIT-01-CAPABILITY-SURFACE.md)
**Severity:** MEDIUM
We consume ~8 of ~20 public methods on `PipelineModule`. The dual-emit colon-form events for `run:orphaned`, `run:reassigned`, and `join:waiting`/`join:fired` are emitted by the executor but flow only through the firehose channel because our bridge prefix-routes by dot-form. `getDashboardData()` is fully implemented and entirely unused by us. Several event types (`pause`/`resume`/`retry`) are declared in `PipelineEventMap` but have no producer.

### 02 — Lifecycle & Errors
**File:** [PIPELINE-AUDIT-02-LIFECYCLE-AND-ERRORS.md](./PIPELINE-AUDIT-02-LIFECYCLE-AND-ERRORS.md)
**Severity:** HIGH
`RunStatus` declares `'pending'` and `'awaiting_approval'` but the executor never writes them — runs go directly to `'running'` and stay there even while blocked on a human. `executor.run()` is fire-and-forgotten inside `createResource()`, so consumers cannot await run completion. `module.stop()` cancels synchronously then immediately stops the EventBus, risking lost cancellation events. WAL captures events but no checkpoint event captures `PipelineRun.context`, so restart cannot rehydrate.

### 03 — Approval Semantics
**File:** [PIPELINE-AUDIT-03-APPROVAL-SEMANTICS.md](./PIPELINE-AUDIT-03-APPROVAL-SEMANTICS.md)
**Severity:** HIGH
Multi-step approvals work (one `PendingApproval` per `stepId`), but `resolveApproval` does no authorization (caller-supplied `userId` is trusted) and **no per-approver dedup** — one user can satisfy `requiredCount=2` by clicking twice. `comment` is stored on the in-memory record but dropped from the `pipeline:approval:recorded` event payload. Concurrent resolves can produce duplicate audit rows.

### 04 — LLM Streaming
**File:** [PIPELINE-AUDIT-04-LLM-STREAMING.md](./PIPELINE-AUDIT-04-LLM-STREAMING.md)
**Severity:** LOW
Streaming works end-to-end at the protocol level: provider → executor (per-chunk emit) → EventBus → gateway → frontend reducer all chunk per token. Anthropic and Bedrock both honor `AbortSignal`. Open questions: confirm Bedrock socket close on abort, expose first-token-latency, and consider a `pipeline:llm:stream:opened` event so consumers can distinguish "slow" from "cold start".

### 05 — Metrics Data
**File:** [PIPELINE-AUDIT-05-METRICS-DATA.md](./PIPELINE-AUDIT-05-METRICS-DATA.md)
**Severity:** LOW (for distributed-core)
Of the 9 fields our bridge currently nulls out, **8 are already tracked and returned by `PipelineModule.getMetrics()`** — the gap is on our side. Only `estimatedCostUsd` is genuinely not tracked, and that's appropriately a presentation-layer concern. Optional cosmetic ask: add an ISO `asOf` field alongside the existing epoch `timestamp`.

### 06 — Frontend Gaps
**File:** [PIPELINE-AUDIT-06-FRONTEND-GAPS.md](./PIPELINE-AUDIT-06-FRONTEND-GAPS.md)
**Severity:** N/A — websocket-gateway side
(Note: this one is on the websocket-gateway side. Included so you see the full picture, not because there's an ask back.) The dashboard renders zeros instead of em-dashes when the bridge nulls metrics; the WebSocket adapter only subscribes to the firehose `pipeline:all` rather than per-run channels; approval buttons are not gated on approver identity. All fixable on our side.

## Consolidated asks back to distributed-core

| ID | Severity | Ask | Source audit |
|---|---|---|---|
| DC-1 | HIGH | Per-approver dedup in `resolveApproval` — refuse a second `approve` from the same `userId` for the same `(runId, stepId)`. Today one user can satisfy `requiredCount=N` alone (`PipelineExecutor.ts:355-356`). | 03 |
| DC-2 | HIGH | Surface `'pending'` and `'awaiting_approval'` at the run level, or remove them from `RunStatus`. Today `getRun()` cannot distinguish "actively executing" from "blocked on approval". | 02, 06 |
| DC-3 | HIGH | Add a checkpoint event capturing `PipelineRun.context` + `currentStepIds` at WAL-friendly cadence (the `checkpointEveryN` config exists but is unused). Without this, WAL replays events but cannot rehydrate a run. | 02 |
| DC-4 | HIGH | Fix `handleOrphanedNodeRuns()` to query the resource router instead of the local `completedRuns` map (the inline TODO at `PipelineModule.ts:405-406` already flags this), and replace the `to: departedNodeId` self-placeholder. | 01, 02 |
| DC-5 | MEDIUM | Expose `executor.run()` promise via `PipelineModule.createResource()` so consumers can `await` run completion and propagate errors synchronously instead of being forced onto the EventBus. | 02 |
| DC-6 | MEDIUM | Add `comment` to the `pipeline:approval:recorded` event payload. Today it's stored on the in-memory record but dropped from the wire event, so WAL replay loses comments. | 03 |
| DC-7 | MEDIUM | Race-safe `resolveApproval` — wrap the early-return-then-mutate region in a per-step lock or compare-and-swap so two concurrent `approve` calls can't both push records and both fire `approval:recorded`. | 03 |
| DC-8 | MEDIUM | Add a grace period to `onStop()` — await each `executor.run()` promise (or its terminal event) up to a configurable timeout before tearing down the EventBus. Today cancellation events can be dropped. | 02 |
| DC-9 | MEDIUM | Pause / resume / retry are declared in `PipelineEventMap` but have no producer anywhere in the executor. Either ship producers or remove the type entries until Phase 5 lands so consumers don't dead-code-handle them. | 01 |
| DC-10 | MEDIUM | `pipeline:run:retry` payload is `{ newRunId, previousRunId, at }` — no `runId`, so run-keyed wire fan-out cannot route it. Either add `runId` (= `newRunId`) or document that it's firehose-only. | 01 |
| DC-11 | MEDIUM | Optional `authorizeApproval?: (runId, stepId, userId) => boolean` hook on `PipelineModuleConfig` so consuming projects can plug role/team checks without forking. | 03 |
| DC-12 | LOW | Type-vs-behavior gap on `getHistory`: signature says `Promise<BusEvent[]>` but the impl swallows `WalNotConfiguredError` and returns `[]`. Either widen to a discriminated result or document on the signature. | 01 |
| DC-13 | LOW | Confirm Bedrock mid-stream cancellation actually closes the underlying HTTPS socket (the `for await` loop terminates, but the AWS SDK has historically held connections open until explicit `.destroy()`). | 04 |
| DC-14 | LOW | Expose a first-token-latency metric on `PipelineExecutor` or `PipelineModule` for SLO dashboards. Optional companion: emit a `pipeline:llm:stream:opened` event at `for await` entry. | 04 |
| DC-15 | LOW | Re-export `PendingApprovalRow` (currently declared in `PipelineModule.ts:63`) so consumers can import the row type instead of re-declaring it. Cosmetic: also add ISO `asOf` alongside epoch `timestamp` on `getMetrics()`. | 01, 05 |

**Totals:** 4 HIGH, 7 MEDIUM, 4 LOW.

## Bugs we surfaced that you've already addressed

(Cross-reference to `docs/handoff/v0.3.1-response.md` in your repo.) None of the 15 asks above appear in v0.3.1's resolved-findings list — these are net-new from this round of audits run against v0.3.2. If v0.3.3 has shipped any of DC-1 through DC-15, please mark them so we can drop them from our tracking and re-test.

## Bugs we found on our side (websocket-gateway), for context

These are ours to fix and should not block any distributed-core work; listed only so you see the full surface:

- Bridge wrapper hard-codes 7 of 8 metric fields to `null` despite `getMetrics()` returning them (AUDIT-05). One-file fix in `social-api/src/routes/pipelineMetrics.ts`.
- Gateway prefix-routing in `pipeline-bridge.js` ignores `pipeline.run.orphaned`, `pipeline.run.reassigned`, `pipeline.join.waiting`, `pipeline.join.fired` — they only reach `pipeline:all`.
- `BackpressureController` slot exists in the gateway bridge but no controller is wired (AUDIT-04).
- Frontend subscribes only to the firehose `pipeline:all`; `subscribeToRun` and `subscribeToApprovals` are implemented but never called (AUDIT-06).
- Dashboard renders `0` instead of em-dash when bridge is unwired; UI cannot tell stub from live data (AUDIT-06).
- Approve/Reject buttons are not gated on `req.user.sub ∈ approvers` either client-side or server-side — defense-in-depth gap (AUDIT-03, AUDIT-06).
- No replay-from-WAL: `synthesizeTokens` fakes token cadence from the persisted final response. Will switch to `bridge.getHistory(runId)` once DC-3 lands.
- Idempotency-Key is optional on webhook trigger and approval-resolve routes; webhook retries can dup-trigger.

## Suggested order of attention

1. **DC-1 (per-approver dedup)** — single highest-impact. One-line change in `resolveApproval` plus a contract test. Closes a real authorization-style bug.
2. **DC-2 (surface `awaiting_approval`)** — small change; unblocks correct UI status without us having to fan-out reducer logic. Pair naturally with DC-9 cleanup of the unimplemented states.
3. **DC-6 + DC-7 (approval payload + race safety)** — both touch the same `resolveApproval` region; ship together with DC-1.
4. **DC-3 + DC-8 + DC-4 (durability/lifecycle)** — checkpoint event, stop grace period, and orphan-router fix. Together these close the "what happens on restart / failover" story. Bigger lift than 1-3 but aligned with Phase 5 work.
5. **DC-5 (run promise) + DC-10/DC-12 (type tightening)** — nice-to-haves; defer if Phase-5 work is heavy.

LOW items (DC-13, DC-14, DC-15) are batch-able into a polish PR whenever convenient.
