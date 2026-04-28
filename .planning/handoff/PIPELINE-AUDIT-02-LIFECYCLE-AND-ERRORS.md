# Pipeline Lifecycle & Error-Path Audit

**Date:** 2026-04-27
**distributed-core version:** v0.3.2

## TL;DR

The executor's runtime state machine is narrower than the type advertises (`'pending' | 'awaiting_approval'` are declared in `types.ts:196-202` but never written by the executor — runs go directly to `'running'` in `PipelineExecutor.ts:1076` and approvals stay at `'running'` while individual steps flip to `'awaiting'`). Cancellation is cooperative-with-abort: `AbortController` reaches the LLM stream, but in-flight `await this.eventBus.publish` calls and other awaits resume before the cooperative `if (this.cancelled)` guards run. The single most concerning gap is the **module-stop / shutdown race**: `module.stop()` calls `executor.cancel()` synchronously then immediately `await eventBus.stop()` — there is no await on the run promises, no grace period, and no WAL flush guarantee for the cancellation events.

## State machine diagram (text)

```
RunStatus (types.ts:196-202): 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'

Reality (executor):
                          (constructor)
                                |
                                v
                          [running]                    PipelineExecutor.ts:1076
                            /  |  \
                           /   |   \
       executeFromNode    /    |    \  cancel()
       resolves          /     |     \  PipelineExecutor.ts:264-321
                        /      |      \
                       v       v       v
              [completed] [failed]  [cancelled]
                  ^         ^
                  |         |
        run().then         run().catch
        line 231           line 246
```

**Key observations:**
- `'pending'` is declared in `types.ts:197` but **never assigned**. `initRun()` at `PipelineExecutor.ts:1071-1086` sets `status: 'running'` directly, before any work begins.
- `'awaiting_approval'` is declared in `types.ts:199` but **never written to `pipelineRun.status`**. While an approval blocks, `pipelineRun.status` stays `'running'`; only the *step* gets `step.status = 'awaiting'` (`PipelineExecutor.ts:787`). Bridge consumers cannot tell from `getRun(runId).status` that the run is blocked on a human.
- Run-level transitions are all written from the `.then()/.catch()/.finally()` chain at `PipelineExecutor.ts:228-259` and inside `cancel()` at `PipelineExecutor.ts:315`.
- Step-level statuses (`'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'awaiting'`, `types.ts:204-211`) are written in `executeNode` at lines 544, 578, 589, and in `cancel()` at lines 288, 299.

## State persistence

- **What the WAL captures.** Every event published via `this.emit(...)` is written through `EventBus` (`PipelineModule.ts:187-191`) and persisted to the file at `walFilePath` (`PipelineModule.ts:189`). The deprecated dot-form alias is also published but as fire-and-forget (`PipelineExecutor.ts:1136`).
- **What is NOT serialized.** `PipelineRun.context`, `PipelineRun.steps[*].input/output`, the `pendingApprovals` map, `joinStates`, `firedJoins`, `currentStepIds`, and the `AbortController` state live in **process memory only** on the `PipelineExecutor` instance. There is no checkpoint event that contains the run's full context snapshot.
- **`getHistory()`** (`PipelineModule.ts:571-585`) replays events but reconstructs nothing — callers get a flat `BusEvent[]`. Reconstructing `PipelineRun` from history is a consumer responsibility and no replayer ships in the module.
- **`completedRuns` Map** (`PipelineModule.ts:130`, FIFO-evicted at line 671-675) holds the in-memory snapshot only after a terminal event fires; it is not WAL-backed and does not survive restart.

## Error paths — by trigger source

| Source | Error type | Executor state after | Bridge surface | Test coverage |
|---|---|---|---|---|
| LLM stream throws (`llmClient.stream` rejects) | provider error | step `'failed'` (`PipelineExecutor.ts:705`), routed to `error` handle if wired, else propagates to `BranchFailure` → run `'failed'` (`PipelineExecutor.ts:241-256`) | `getRun()` returns `status: 'failed'` + `error.message`; **no rejection** on the run promise — `executor.run().catch()` at `PipelineModule.ts:367` only catches dispatch bugs, not branch failures | unanswerable from source — testing required |
| LLM `AbortError` mid-stream (cancel) | abort | catch at `PipelineExecutor.ts:702` → `status: 'cancelled'` returned, `cancel()` already wrote run state | `pipeline:run:cancelled` event; `getRun()` shows `'cancelled'` | unanswerable from source — testing required |
| Action/Transform throw inside `dispatch()` | uncaught throw | wrapped at `PipelineExecutor.ts:561-563` → `status: 'failed'` | identical to LLM throw above | unanswerable from source — testing required |
| No trigger node | validation | `status: 'failed'` set before `executeFromNode` is called (`PipelineExecutor.ts:197-206`) | `pipeline:run:failed` emitted; `run()` resolves (does not reject) | unanswerable from source — testing required |
| `BranchFailure` inside Fork branch with no Join | branch dies silently | other branches keep running (`PipelineExecutor.ts:447-454`); run continues toward `completed` even though one branch failed | only the per-step `step.failed` event surfaces; run terminates as `completed` | unanswerable from source — testing required |
| Approval timeout with no `timeoutAction` | timeout | defaults to `'reject'` (`PipelineExecutor.ts:804`); `'escalate'` is mapped to `'reject'` (per comment at line 801-802) | `pipeline:approval:recorded` with `userId: 'system:timeout'` (`PipelineExecutor.ts:807-809`) | unanswerable from source — testing required |
| `cancel()` while approval pending | external cancel | onCancel hook resolves with `'reject'` (`PipelineExecutor.ts:833-838`); approval step ends `'cancelled'` via `cancel()` snapshot at line 287-291 | run `'cancelled'`; approval row removed from `getPendingApprovals()` | unanswerable from source — testing required |
| `eventBus.publish()` throws | infra | `await this.emit(...)` at `PipelineExecutor.ts:1132` propagates the error up the dispatch chain; turns into a step `'failed'` via the catch at `PipelineExecutor.ts:561-563` | run `'failed'` with the publish error message; the failure event itself may have been the throwing publish — **not guaranteed to land** | unanswerable from source — testing required |

**Critical observation on bridge surface.** `executor.run()` is fire-and-forgotten in `PipelineModule.createResource()` at line 367-369: `executor.run().catch((err) => log)`. Run failures **do not propagate out of `createResource()`** — the route's `try/catch` in `pipelineTriggers.ts:506-517` only catches synchronous throws from `bridge.trigger()`. Wave 2's audit/logging on the route layer therefore can not surface mid-run failures; consumers must subscribe to the EventBus or poll `getRun()`.

## Orphan-run risks

1. **Process crash between `createResource()` and first `pipeline:run:started` event.** `activeExecutors.set(runId, executor)` at `PipelineModule.ts:296` happens **before** `executor.run()` is invoked at line 367. If the process dies between these lines, the run was never started but `PipelineRunResource` is returned to the caller with `status: 'running'`. **Severity: high.** No WAL entry exists for the run; recovery on restart cannot tell it ever existed.
2. **Process crash mid-run with WAL enabled.** WAL captures events but no full-context checkpoint exists. On restart, `module.stop()`-then-restart leaves the run with status `'running'` in the last replayed event but no executor instance is rehydrated — `bootstrap.ts` does not call any replay routine. **Severity: high.** No `pipeline:run:orphaned` is emitted on boot.
3. **`module.stop()` race.** `onStop()` at `PipelineModule.ts:212-227` calls `executor.cancel()` (synchronous) then `this.activeExecutors.clear()` then `await this.eventBus.stop()`. `cancel()` fires the `pipeline:run:cancelled` publish as **fire-and-forget** (`PipelineExecutor.ts:319: .catch(() => {})`). If `eventBus.stop()` resolves before the publish reaches the WAL, the cancel event is lost. **Severity: medium.** Run will look "still running" in WAL on restart.
4. **`AWAITING_APPROVAL` stuck forever.** When `data.timeoutMs` is undefined (`PipelineExecutor.ts:803`), no timer is created. The promise at line 789 only resolves on `resolveApproval()` or `cancel()`. With `module.stop()` between approval-request and approver-decision, the approval is `'reject'`-resolved by the cancel hook — but the resulting `'cancelled'` event is subject to issue #3 above. **Severity: medium.**
5. **Late join arrival to a fired join.** `firedJoins.add()` at `PipelineExecutor.ts:916` drops late arrivals silently (line 864). The branch the late arrival was on has its terminal events emitted, but its context is not merged into the join output — possible silent data loss. **Severity: low** (intentional per spec §17.2 but worth noting).
6. **`handleOrphanedNodeRuns()` only scans `completedRuns`.** `PipelineModule.ts:409` iterates the *completed* map — it never inspects `activeExecutors` of the departed node (which it can't from another node anyway, but also doesn't query the ResourceRouter as the comment at line 405 admits). **Severity: high** for multi-node deploys; **n/a** for the current single-node bootstrap.
7. **`pipeline:run:reassigned` placeholder.** `to: departedNodeId` (`PipelineModule.ts:427, 433`) is the *same* as `from` — Phase 5 placeholder. Consumers wiring on this event today get nonsense data. **Severity: low** (documented).

## Cancellation semantics — answer to Q3

Cancellation is **abort-augmented cooperative**:
- `AbortController.abort()` at `PipelineExecutor.ts:269` propagates into the LLM client's stream iteration via the `signal` option (`PipelineExecutor.ts:683`). If `LLMClient` honors `AbortSignal`, the network call aborts immediately. If it doesn't, the next `streamCancelled || this.cancelled` check at line 685 breaks the loop after the next chunk.
- All other awaited operations (`eventBus.publish`, `sleep`, etc.) finish their pending tick before the next `if (this.cancelled) return` guard. `sleep()` is interruptible via the `cancelHooks` set (`PipelineExecutor.ts:1147-1152`), so it returns immediately.
- Approval waits are interrupted via the same `cancelHooks` mechanism (`PipelineExecutor.ts:833-838`).
- **`cancel()` returns synchronously** (`PipelineExecutor.ts:264-321` — no `async`/`await`) but the executor's actual unwind is async. Anything observing `pipelineRun.status === 'cancelled'` immediately after `cancelRun()` returns may still see in-flight step events fire.

## `module.stop()` with active runs — answer to Q4

`PipelineModule.ts:212-227`:
1. Iterates `activeExecutors`, calls `executor.cancel()` on each (synchronous, fire-and-forget unwinds).
2. Clears `activeExecutors` immediately (line 220).
3. Awaits `eventBus.stop()` (line 223).

There is **no grace period** and **no await on run completion**. Runs are not marked persistently — only the in-memory `PipelineRun.status` is set. Resumability on next boot is **not implemented**: there is no replay/rehydrate path in `bootstrap.ts`. Active runs at restart time are effectively lost.

## Idempotency of trigger — answer to Q6

The executor does **not** dedup. `PipelineExecutor` constructor at `PipelineExecutor.ts:182` mints a fresh `randomUUID()` on every instantiation. `PipelineModule.createResource()` (`PipelineModule.ts:268-373`) creates a new executor per call with no triggerPayload-hash check. Two identical `triggerPayload`s submitted twice yield two runs.

The HTTP layer mitigates this via `idempotency({ scope: 'pipeline-trigger' })` at `pipelineTriggers.ts:471` (Redis-backed Idempotency-Key middleware), but **only if the client sends the header**. Webhook retries that don't send Idempotency-Key duplicate.

## Asks back to distributed-core

1. **Surface `'pending'` and `'awaiting_approval'` at the run level**, or remove them from `RunStatus`. The current state is misleading to consumers — `getRun()` cannot distinguish "actively executing" from "blocked on approval".
2. **Expose `executor.run()` promise via `PipelineModule`.** `createResource()` should return a handle whose run-completion promise consumers can `await` if they want synchronous error propagation. Today every error path forces consumers onto the EventBus.
3. **Add a checkpoint event** that captures `PipelineRun.context` + `currentStepIds` at WAL-friendly cadence (the `checkpointEveryN` config exists but is unused — `PipelineModule.ts:94`). Without this, WAL can replay events but cannot rehydrate a run.
4. **Add a grace period to `onStop()`** — await each `executor.run()` promise (or its terminal event) up to a configurable timeout before tearing down the EventBus. Today cancellation events can be dropped.
5. **Fix `handleOrphanedNodeRuns()` to query the resource router**, not the local `completedRuns` map (the inline comment at `PipelineModule.ts:405-406` already flags this). And replace the `to: departedNodeId` placeholder.
6. **Document `LLMClient` AbortSignal contract.** Cancellation correctness depends on every `LLMClient` implementation honoring `signal` — there is no test-time enforcement.

## Asks for websocket-gateway

1. **Don't trust `getRun().status` for "is this run blocked on a human?".** Add a derived view in the bridge that checks `executor.getPendingApprovalCount()` (or `getPendingApprovals()` via `PipelineModule`) and surfaces `'awaiting_approval'` in the API response shape regardless of the underlying executor's `'running'` state.
2. **Add a startup orphan scan in `bootstrap.ts`.** After `module.start()`, replay the WAL and emit `pipeline:run:orphaned` for any runId whose last event is non-terminal. Today there is no recovery story — `bootstrap.ts:425-426` initializes/starts the module but never reconciles WAL state.
3. **Lengthen `shutdown()` in `bootstrap.ts:436-453`.** Before calling `module.stop()`, allow up to a configurable grace (e.g., `PIPELINE_SHUTDOWN_GRACE_MS`) for active runs to terminate naturally; only then cancel them. Mirrors the ask to distributed-core but can be done at the gateway layer.
4. **Make the trigger route enforce Idempotency-Key for webhook triggers**, or require it for all non-manual `triggerType`s (`pipelineTriggers.ts:466-564`). Current code makes it optional — webhook retries without the header dup-trigger.
5. **Add a "run-failed" structured response surface** beyond the EventBus. The 202 returned from POST `/runs` (`pipelineTriggers.ts:561`) tells the client nothing about subsequent failure. A short-poll `GET /:runId` is the only path; consider a server-sent-events shim that closes when the run reaches terminal.
