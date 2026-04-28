# Pipeline Frontend Gap Audit

**Date:** 2026-04-27
**Inputs:** AUDIT-01 through AUDIT-05.

## TL;DR

The single most-broken UI surface is **observability**: the dashboard / metrics pages happily render zeros when the bridge nulls out 7 of 8 numeric fields (AUDIT-05) and the `source: 'bridge' | 'stub' | 'error'` discriminator the API now returns is silently dropped by `usePipelineMetrics` — operators cannot tell live data from fixture. Close runner-up: the **WebSocket adapter only subscribes to `pipeline:all`** (`usePipelineSource.ts:37`), so per-run firehose events from AUDIT-01 (`orphaned`, `reassigned`, `join.*`) plus all per-run streaming actually flow through one broad channel — `subscribeToRun` is fully implemented but never called from any page. Approvals UX has zero authorization gating and treats the run as a single gate.

## Punch list — organized by user-facing feature

### A. Dashboard & Metrics

| Component | File | Gap | Fix | Severity |
|---|---|---|---|---|
| `usePipelineMetrics` hook | `frontend/src/components/observability/hooks/usePipelineMetrics.ts:19-30` | Type omits `source: 'bridge' \| 'stub' \| 'error'` returned by `social-api/src/routes/pipelineMetrics.ts:112-113`. Field is silently dropped on parse. | Add `source` to `PipelineMetrics`, surface via hook return as `dataSource`. | HIGH |
| `DashboardPage` data-source chip | `DashboardPage.tsx:317-331` | Chip toggles "live data" / "fixture" purely on `isLiveData` boolean from `ObservabilityContext`, NOT on the metrics-route discriminator. When `source==='stub'` user sees "live data" but numbers are fabricated by `getPipelineMetricsStub()`. | Render distinct "demo" / "live" / "stale" chip from `metrics.source`. | HIGH |
| `DashboardPage` KPIs | `DashboardPage.tsx:250-257` | Reads `runsStarted`/`runsActive`/`runsAwaitingApproval`/`runsFailed`. AUDIT-05 says bridge currently nulls these → falls back to `0` via `?? 0`. UI shows "Runs today: 0" instead of "—" when bridge unwired. | When `metrics.source==='stub'` or value is null, render em-dash instead of `0`. Add tooltip "no bridge wired". | HIGH |
| `DashboardPage` active runs table | `DashboardPage.tsx:55, 371-380` | Uses hardcoded `PHASE1_ACTIVE_RUNS: ActiveRunRow[] = []`. Even with bridge live, table is empty — `bridge.listActiveRuns()` (CB:80) is never consumed. | Replace with `useActiveRuns()` hook calling `/api/pipelines/active`. | HIGH |
| `MetricsPage` live overlays | `MetricsPage.tsx:212-255` | `liveSeries` uses `metricsRing` driven by polling. Once bridge nulls out, ring stays at `0` and chart looks flatlined as if no activity. | Same: branch on `source`, render fixture pattern with "demo" overlay watermark when not bridged. | MED |
| `MetricsPage` cost card | `MetricsPage.tsx:351-357` | Reads `m.estimatedCostUsd`. AUDIT-05 confirms cost is computed at the gateway only when bridge tokens flow; today always 0. | Once bridge ships, OK; until then, hide card or label "estimate unavailable". | LOW |
| Dashboard `getDashboardData()` consumer | n/a | AUDIT-01 #2: distributed-core's `getDashboardData()` (PM:496) is fully implemented with chart definitions but **no frontend consumer**. The metrics-page seeds 10 hand-rolled charts instead. | Wire a `useDashboardData()` hook against the gateway forwarding endpoint once added. | MED |
| `PipelineStatsPage` (per-pipeline) | `PipelineStatsPage.tsx:362-366` | Pulls runs from `localStorage` only. Run history persisted in DynamoDB via Phase-4 audit table is not surfaced here. | Add server-source toggle: prefer `/api/pipelines/:id/runs?source=server`. | MED |

### B. LLM Streaming Display

| Component | File | Gap | Fix | Severity |
|---|---|---|---|---|
| Token reducer | `PipelineRunsContext.tsx:548-564` | Works correctly: appends each token, increments `tokensOut` by 1 per token. AUDIT-04 confirms protocol path is intact. | None. | OK |
| `LLMNode` response footer | `nodes/llm/LLMNode.tsx:36-91` | Has a "streaming…" label (line 75) but no blinking-cursor or "AI typing" affordance. Tokens append silently inside the collapsed 1-line footer at `maxHeight: '1.4em'` (line 56). User will not see them grow unless they expand the response. | Auto-expand footer while `state==='running'`; add a CSS-only blinking caret span at end of `info.response`. | MED |
| Replay scrubber tokens | `replay/deriveEvents.ts:73-79`, `Scrubber.tsx:7-9` | `synthesizeTokens` splits the persisted final response on whitespace + punctuation and spaces fake ticks across the step's wall-clock window (`deriveEvents.ts:201-218`). Scrubber renders one tick per envelope — replays look authentic but token cadence is fabricated. AUDIT-04 calls this Phase-5 stand-in. | Real WAL replay path: replace `synthesizeTokens` with a fetch to `bridge.getHistory(runId)` (CB:65-72) which returns the actual `BusEvent[]`. Hook already exists conceptually — needs `useReplayDriver` to consume server events instead. | MED |
| Per-step typing panel | n/a | AUDIT-04 ask #2: no dedicated typing-affordance component. Currently the response just appears letter-by-letter inside the LLM step card's collapsed footer. | New `<LLMStreamingPanel>` rendered in the right rail of `PipelineEditorPage` while a step is `running` and `_state` includes `_llmResponse`. | LOW |
| Backpressure indicator | n/a | `BackpressureController` slot exists at `pipeline-bridge.js:185-192` but is never wired (AUDIT-04). No frontend surface either. | After gateway wires controller, expose via `bridge.getMetrics().backpressure` and render a "tokens dropped: N" warning chip on `LLMNode`. | LOW |
| Token `seq`-gap detection | `WebSocketEventAdapter.ts:88` | `seq` is parsed but `EventStreamContext.dispatchEnvelope` does not check for gaps on `pipeline.llm.token` per-run. AUDIT-04 ask #4. | Track last-seen `seq` per `(runId, stepId)`; when a gap > 0, emit a synthetic "[N tokens dropped]" marker into the response string. | LOW |

### C. Approvals

| Component | File | Gap | Fix | Severity |
|---|---|---|---|---|
| `PendingApprovalsPage` per-step rendering | `PendingApprovalsPage.tsx:227-247, 310-320` | Each `(runId, stepId)` row IS distinct (good — multi-step supported). However the card shows `runIdTail(row.runId)` only — multiple gates in the same run all show the same tail. | Add `stepId` (or node label from `loadPipeline`) to the card sub-line. | MED |
| Approver authorization | `PendingApprovalsPage.tsx:179-186` | Approve/Reject buttons are always enabled. AUDIT-03: anyone authenticated can resolve. Backend has zero authorization (`pipelineExecutor.ts:323-361`). No `useIdentityContext()` import in this file. | Read `useIdentityContext().userId`; disable buttons (with tooltip) when `userId ∉ row.approvers.map(a => a.value)` for `type:'user'`, AND not in any role group. Defense-in-depth — fix server-side too (AUDIT-03 ask #1). | HIGH |
| Approver identity in run history | `PipelineRunReplayPage.tsx:401-447` | Renders `triggeredByLabel` but no per-approval "approved by X at T" line in the timeline. Reducer at `PipelineRunsContext.tsx:600-611` stores `ApprovalRecord{userId, decision, at}` on `step.approvals` but no view consumes it. | Add an "Approvals" sub-section in the right-rail step inspector listing each `step.approvals[]` entry with userId + decision + relative time. | MED |
| Approver dedup affordance | `PendingApprovalsPage.tsx:128-129` | Renders `recordedCount/required`. But AUDIT-03 #5 (HIGH) says the same user can satisfy `requiredCount=2` by approving twice. UI does not warn. | Once backend lands per-user dedup, show "you've already approved" disabled state when current `userId` appears in `step.approvals.filter(a => decision==='approve')`. | MED |
| Comment loss | `PendingApprovalsPage.tsx:170-177` | Frontend collects `comment`; AUDIT-03 ask #2 says the `pipeline.approval.recorded` payload **drops it**. Replay therefore won't show comments. | Either consume `GET /api/pipelines/:runId/audit` (AUDIT-03 ask #5) for replay rendering, or wait for distributed-core to add `comment` to event payload. | LOW |
| Stub-mode silent success | `PendingApprovalsPage.tsx:265-269` (optimistic remove) | AUDIT-03 ask #4: when bridge isn't wired, `pipelineTriggers.ts:1027-1039` returns 204 without recording. UI removes the row optimistically and never restores it — operator thinks they approved something. | If `bridge unwired` (need a server-side flag in the response), display a toast "Demo mode: approval not persisted". | MED |

### D. Run lifecycle states

| Component | File | Gap | Fix | Severity |
|---|---|---|---|---|
| `PipelineRunsContext` reducer | `PipelineRunsContext.tsx:582-595` | Sets `run.status = 'awaiting_approval'` on `pipeline.approval.requested`. AUDIT-02 says **executor never writes this state** — the run stays `'running'`. So when the bridged path is live, frontend reduces correctly from the event but `getRun(runId).status` from server says `'running'`. Risk: page reloads (which fall back to `bridge.getRun()`) flip status from `awaiting_approval` back to `running`. | Treat any run with one or more `step.status==='awaiting'` as `'awaiting_approval'` regardless of `run.status` (mirror AUDIT-02 ask #1 server-side). | HIGH |
| `'pending'` status | `PipelineRunsContext.tsx:107-108`, `PipelineRunsPage.tsx:172-173` | Three places branch on `'pending'` but executor never emits it (AUDIT-02). Dead code path. | Document as future-only; remove from active filters. | LOW |
| Cancel/complete-by attribution | `PipelineRunReplayPage.tsx:402, 446` | Shows `run.triggeredBy.userId ?? triggerType` only. No "cancelled by" or "approved by" attribution. AUDIT-02 + AUDIT-03 note audit-trail data exists in DynamoDB. | New right-rail `<RunAuditTimeline>` consuming `GET /api/pipelines/:runId/audit`. | MED |
| Orphan / shutdown surface | n/a | AUDIT-02 #1-#3: process crashes can leave runs `'running'` forever. UI has no "this run was abandoned" affordance. | Add a "stale run" badge if `run.status==='running'` AND no events in 60s AND `lastEventAt > 60s old`. | MED |
| Pause / resume / retry events | `PipelineRunsContext.tsx:613` (default branch), `eventGlyphs.ts:42-67`, `SimulatorPanel.tsx:36-60` | Reducer has no case for `pipeline.run.paused`/`resumed`/`resumeFromStep`/`retry`/`orphaned`/`reassigned`/`join.*`. Glyphs and simulator dropdowns include them, but they're unrendered in the live runs view. AUDIT-01 #7: producers don't exist anyway. | Either add pass-through reducer cases (no state change, just keep envelope for replay timeline), or trim from `SimulatorPanel.tsx` so the dev-tool can't generate them. | LOW |

### E. Real-time event channels

| Component | File | Gap | Fix | Severity |
|---|---|---|---|---|
| `usePipelineSource` channel | `hooks/usePipelineSource.ts:37` | Subscribes to `'pipeline:all'` only. `subscribeToRun` is fully implemented in `WebSocketEventAdapter.ts:156-160` but NEVER called from any page. | When a user opens `PipelineEditorPage` with a `currentRunId`, call `usePipelineWsCommands().subscribeToRun(runId)` and unsub on change. Reduces firehose. | HIGH |
| Per-run channel events from AUDIT-01 | `pipeline-bridge.js:330-340` (gateway) | AUDIT-01 #1: `orphaned`, `reassigned`, `join.waiting`, `join.fired` ride only `pipeline:all`. Today the frontend subscribes to `pipeline:all` so the events DO arrive — but no reducer case handles them (see Section D). When the gateway is fixed to route them per-run, frontend per-run subscribers will see them only after the channel-routing fix lands. | Pair with gateway fix; add reducer cases that augment `run.steps` with `joinState{received, required}` for `join.waiting`, etc. | MED |
| Approvals channel | `WebSocketEventAdapter.ts:174-181` | `subscribeToApprovals` is implemented but `PendingApprovalsPage` doesn't call it. Page relies on the editor-page's `pipeline:all` subscription via `EventStreamContext`. If that subscription is scoped (per Section E row 1), approvals data goes silent on this page. | Have `PendingApprovalsPage` mount its own `subscribeToApprovals()` lifecycle, independent of editor-page. | HIGH |
| Webhook trigger event | `useWebhookTriggers.ts:47` | Subscribes to `'pipeline.webhook.triggered'`. AUDIT-01 confirms no producer exists in distributed-core today; route just 202s and logs. Hook is dead code in production. | Document as Phase-5; gate registration on a feature flag so it doesn't claim to listen. | LOW |
| `seq`-based dedupe | `WebSocketEventAdapter.ts:85-93` | Phase-1 sentinel `seq=0` is tolerated. Once gateway sends real seqs the dedupe in `EventStreamContext.dispatchEnvelope` will activate — but no UI exists to surface dedupe drops. | Diagnostics panel: counter "duplicates dropped" + "seq gaps". | LOW |

## Playwright test scenarios to author

1. Trigger a pipeline run; expect dashboard `runsActive` KPI to increment within 1s.
2. With backend unreachable, dashboard renders metrics chip "demo" (not "live"); KPI values render "—" not "0".
3. Trigger run with two parallel approval gates (Fork → 2× Approval); expect `PendingApprovalsPage` to render 2 distinct cards keyed `(runId, stepId)`.
4. Submit approval as user A then as user A again; expect second submission to display "you've already approved" disabled state.
5. Submit approval as user not in `approvers[]`; expect Approve/Reject buttons disabled with tooltip explaining authorization.
6. Trigger run with LLM step; expect token-by-token visible growth in `LLMNode` response footer (auto-expanded while running, blinking caret at tail).
7. Cancel a run mid-LLM-stream; expect `pipeline.run.cancelled` event to flip step state to `cancelled` within 500ms and `LLMNode` to stop appending tokens.
8. Open `PipelineRunReplayPage` for a completed run with approval; expect a "Approvals" sub-section listing approver userId + decision + time.
9. Open replay scrubber; expect tick count == event count from `getHistory(runId)` (when WAL replay lands), not synthetic split count.
10. Trigger run, navigate to `PendingApprovalsPage` while in `awaiting_approval`; expect the page to render the row even after a hard reload (regression for the `'awaiting_approval'` reducer flip described in D).
11. With `VITE_PIPELINE_SOURCE=websocket`, open editor page for a specific runId; expect `subscribeToRun(runId)` frame on the WS (currently no page calls it).
12. Resolve an approval in stub mode (no bridge wired); expect a toast warning "demo mode — not persisted".
13. Receive a `pipeline.run.orphaned` envelope; expect run row to show a "stale" badge (currently silently swallowed).
14. Backend metrics endpoint returns `source:'error'`; expect dashboard chip "stale" with retry CTA.

## Asks for websocket-gateway (work tracks)

**Phase F1 — Fix the lying dashboard (HIGH).** Punch-list rows: A1, A2, A3, A4. Surface the `source` discriminator end-to-end; render em-dashes when bridge unwired; replace `PHASE1_ACTIVE_RUNS` empty array with a real hook against `bridge.listActiveRuns()`.

**Phase F2 — Wire per-run subscriptions (HIGH).** Punch-list rows: E1, E3. Make `PipelineEditorPage` call `subscribeToRun(currentRunId)`; make `PendingApprovalsPage` call `subscribeToApprovals()`. Closes the per-run channel gap so AUDIT-01 #1 routing fix has a consumer.

**Phase F3 — Approvals authorization + multi-gate clarity (HIGH).** Punch-list rows: C2, C1, C4. Add `useIdentityContext` + role expansion check to `PendingApprovalsPage`; show stepId/node label per gate; disable button on per-user dedup once backend lands.

**Phase F4 — Lifecycle truth (MEDIUM).** Punch-list rows: D1, D3, D5, B5. Treat any `step.awaiting` as run-level `'awaiting_approval'`; add `<RunAuditTimeline>` for who-triggered/approved/cancelled; flag stale-running; trim or document dead pause/resume/retry handlers.

**Phase F5 — Streaming polish + replay realism (LOW/MED).** Punch-list rows: B2, B3, B4. Auto-expand LLM footer + caret; replace `synthesizeTokens` with `bridge.getHistory(runId)` once Phase-5 ships; add a typing panel.
