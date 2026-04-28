# Pipeline Approval Semantics Audit

**Date:** 2026-04-27
**distributed-core version:** v0.3.2

## TL;DR

The executor supports **multiple concurrent approval gates per run** (one `PendingApproval` per Approval node, keyed by `stepId`), but it does **zero authorization** — `resolveApproval` accepts any caller-supplied `userId` and writes it directly into the approval record. The route layer also doesn't authorize, so anyone authenticated can resolve anyone else's approval. There is also **no idempotency / no race protection** on the resolve path: a second `approve` after threshold simply silently no-ops, but during a race two concurrent calls can both push records and both fire `approval:recorded`.

## Approval lifecycle (text diagram)

```
trigger → … → execApproval(stepId, data)
            ├─ emit pipeline:approval:requested      (PipelineExecutor.ts:780)
            ├─ step.status = 'awaiting'               (:786-787)
            ├─ register PendingApproval keyed on stepId (:790-829)
            │   - resolve closure
            │   - optional timer (timeoutMs → timeoutAction) (:803-827)
            │   - cancelHook (run cancel ⇒ resolve('reject'))   (:833-838)
            │
            └─ await Promise<'approve'|'reject'>
                 ↑
                 │ resolveApproval(runId, stepId, userId, decision, comment)
                 │   (PipelineExecutor.ts:323-361)
                 │   • push ApprovalRecord into pending.recorded   (:334-335)
                 │   • append to step.approvals                    (:337-338)
                 │   • emit pipeline:approval:recorded             (:340-346)
                 │   • reject ⇒ resolve('reject') immediately      (:348-353)
                 │   • approve ⇒ resolve('approve') iff
                 │       recorded.filter(approve).length >= requiredCount (:355-360)
                 │
                 ▼
            outcome.sourceHandle = 'approved' | 'rejected'   (:843-844)
            → routes to next edge
```

## Authorization model

- **Executor:** No authorization. `resolveApproval` does not look at `pending.approvers` to decide if `userId` is allowed (`PipelineExecutor.ts:323-361`). The `Approver[]` config is metadata for UIs, not a runtime check.
- **PipelineModule:** Pure forwarder — no check (`PipelineModule.ts:627-636`).
- **Route layer (`pipelineTriggers.ts`):** No check. The handler validates `stepId`/`decision`/`comment` shapes (lines 1017-1025) and passes `req.user!.sub` straight to `bridge.resolveApproval` (line 1069). Audit row records `actorUserId: userId` (line 1097-1102) but does not gate.
- **Frontend:** Renders approver chips for display only (`PendingApprovalsPage.tsx:158-167`); does not hide the Approve/Reject buttons based on `req.user.sub ∈ approvers`.

**Gap:** anyone with a valid session can resolve any pending approval in the cluster. The audit log is the only after-the-fact record. This must be fixed at the route layer (executor is intentionally policy-free).

## Idempotency & race semantics

| Case | Behavior | Citation | Severity |
|---|---|---|---|
| `resolveApproval` called for unknown `runId` | Silent no-op (early return) | `PipelineExecutor.ts:330` | low |
| `resolveApproval` called for unknown `stepId` | Silent no-op (pending map miss) | `PipelineExecutor.ts:331-332` | low |
| Two `approve` calls, `requiredCount=1` | First resolves & deletes pending; second is silent no-op (pending no longer in map) | `:331-332`, `:355-360` | low |
| Two `approve` calls land before either deletes pending (race) | Both push records, both emit `approval:recorded`, both call `pending.resolve('approve')`; second `resolve` is a no-op on the Promise but the duplicate event is observable downstream | `:334-346`, `:355-360` | **medium** — duplicate `approval:recorded` events; double audit rows |
| `approve` then `reject` | First approval recorded; if threshold not met, run continues awaiting. `reject` then drops pending and resolves `'reject'`, even though prior approves exist | `:348-353` | **medium** — last-writer-wins for reject |
| `reject` then `approve` | Reject deletes pending immediately; second call hits empty map, no-ops | `:348-353`, `:331-332` | low |
| Two `reject`s race | Both push records & emit `approval:recorded`; both attempt to delete & resolve. `pending.resolve` is idempotent (Promise resolves once) but second event leaks | `:348-353` | **medium** |
| Resolve after timeout fired | Timer auto-records `system:timeout` and deletes pending; user resolve is no-op | `:803-827` | low |
| Same approver decides twice | Both records appended; threshold counter uses `recorded.filter(approve).length`, so one user can satisfy `requiredCount=2` by hitting Approve twice | `:355-356` | **HIGH** — no per-user dedup |

There is **no `approvalId`, no idempotency-key, no version/ETag** on the resolve path. Spec mismatch with our route handler, which mounts the `idempotency` middleware on POST `/api/pipelines/:runId/approvals` (`pipelineTriggers.ts:1006`) — but that only dedupes identical HTTP requests at the edge; it does NOT protect against two distinct approvers double-counting.

## Multi-step support

**Supported.** Each Approval node creates its own `PendingApproval` keyed on `stepId` (`PipelineExecutor.ts:150`, `:829`). `getPendingApprovals()` returns one row per awaiting node (`:363-375`), and the integration test `[scenario 11]` (`pipelineModule.integration.test.ts:738-792`) and contract test "returns multiple rows when multiple approval nodes are awaiting" (`pipelineExecutor.contract.test.ts:961-1007`) cover Fork → two parallel approvals.

Sequencing is controlled by graph topology — the executor itself doesn't sequence approvals, it just blocks at each Approval node it reaches. There is **no run-level "approval gate" abstraction**; everything is per-step.

The route's resolve endpoint takes `(runId, stepId)` (`pipelineTriggers.ts:1004-1116`), which is the right shape — but the in-memory `stubRunStore` has a single `awaiting-approval` status (`pipelineTriggers.ts:282`) that doesn't model multi-gate state. This is fine for the bridged path (executor owns truth) but the stub list/active endpoints will misreport multi-gate runs.

## `approvalId` shape & reuse

There is **no `approvalId`**. The executor identifies approvals by `(runId, stepId)`. `stepId === node.id`, taken from `PipelineDefinition.nodes[*].id` — caller-supplied via the pipeline definition, not random. **The same `(runId, stepId)` cannot reappear in the same run** (executor never re-enters a finished step in Phase 3 — `resumeFromStep` is unimplemented per the skipped contract test at `pipelineExecutor.contract.test.ts:1049`). Across different runs the same `stepId` is reused (it's the node id), but `runId` differs (UUID v4 from `randomUUID()` at `:182`), so `(runId, stepId)` is globally unique per gate instance.

## Approver attribution in run history

- **Executor** stores `ApprovalRecord = { userId, decision, comment?, at }` on `step.approvals` (`PipelineExecutor.ts:337-338`, type at `types.ts:213-218`). Persists in `PipelineRun.steps[stepId].approvals`.
- The `pipeline:approval:recorded` event payload carries `{ runId, stepId, userId, decision, at }` (`types.ts:384-390`), and `getHistory(runId)` returns all WAL events filtered by `runId` (`PipelineModule.ts:571-585`) — so when a WAL is configured, the executor's own history records who approved each gate.
- **No comment in event payload.** The `comment` field is stored on the in-memory `ApprovalRecord` but **dropped from the event** (compare `:334` with `:340-346`). Anyone reading history-via-events loses the comment.

## Asks back to distributed-core

1. **Per-approver dedup in `resolveApproval`** — refuse a second `approve` from the same `userId` for the same `(runId, stepId)`. Today one user can satisfy `requiredCount=N` alone (`PipelineExecutor.ts:355-356`). One-line proposed test: assert `recorded.filter(r => r.decision === 'approve' && r.userId === 'alice').length <= 1` after two `resolveApproval(... 'alice', 'approve')` calls with `requiredCount=2`.
2. **Add `comment` to `pipeline:approval:recorded` payload** — keep audit-via-WAL parity with in-memory record. (`types.ts:384-390`.)
3. **Race-safe resolve** — wrap the early-return-then-mutate region (`PipelineExecutor.ts:330-360`) in a per-step lock or compare-and-swap so two concurrent `approve` calls that both pass the early-return can't both push records. Today the only barrier is single-threaded JS event loop, but each `await`/microtask boundary is a yield point inside `emit`.
4. **Approval timeout vs cluster failover** — proposed test: trigger an approval with `timeoutMs=10000`, kill the owner node at t=2s, and verify the surviving node's resumed run still expires at t=10s (today the timer is in-process and dies with the node — timer state isn't in the WAL).
5. **Authorization hook** — surface an optional `authorizeApproval?: (runId, stepId, userId) => boolean` on `PipelineModuleConfig` so the consuming project can plug in role/team checks without forking the executor.

## Asks for websocket-gateway

1. **Authorize in route**, not just audit. Before calling `bridge.resolveApproval`, fetch the run snapshot, look up `step.approvers`, and 403 if `req.user.sub` is not in the list (or in any role group — role expansion lives in social-api). Path: `pipelineTriggers.ts:1004-1116`.
2. **Idempotency-Key requirement on resolve** — current `idempotency({ scope: 'pipeline-approval' })` middleware (`:1006`) only dedupes when the client sends the header. Make it required for `/approvals` POSTs, since duplicates produce duplicate audit rows + duplicate `pipeline:approval:recorded` events.
3. **Approver identity on the wire** — the route already passes `userId = req.user!.sub` (line 1009, line 1069). Audit log uses it. But the route does NOT validate that body's stepId actually exists in the run (a typo/forged stepId silently no-ops in the executor and returns 204). Add a presence check by reading `bridge.getPendingApprovals()` for that `runId` and 404 on miss.
4. **Stub branch parity** — `pipelineTriggers.ts:1027-1039` returns 204 on stub-mode approval without recording the decision anywhere. The frontend's optimistic-removal (`PendingApprovalsPage.tsx:265-269`) treats this as success forever. Either drop the stub branch or have it append to `stubRunStore` with an awaiting/resolved transition.
5. **Surface `comment` to UI** — frontend collects the comment (`PendingApprovalsPage.tsx:170-177`), POSTs it (resolved via `usePipelineRuns().resolveApproval`), but the recorded event omits it (see ask #2 to distributed-core). Until that lands, the audit row is the only place comments live; expose them via a `GET /api/pipelines/:runId/audit` if comments are user-visible.
