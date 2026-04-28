# Pipeline Capability-Surface Audit

**Date:** 2026-04-27
**distributed-core version:** v0.3.2 (commit 1ff6e1b)
**Status:** Read-only audit; no code changes proposed in this doc.

## TL;DR

We consume roughly 8 of the ~20 public methods on `PipelineModule` (createResource, getRun, getHistory, listActiveRuns, cancelRun, resolveApproval, getPendingApprovals, getMetrics) and a single method on `PipelineExecutor` indirectly (via the module facade). The largest unused capability is the dual-emit migration on `pipeline:*:*` colon-form events plus the entire reassignment / orphan / pause / resume / retry event family — the gateway bridge currently flattens colon-form into legacy dot-form and routes only `pipeline.run.*`, `pipeline.step.*`, `pipeline.llm.*`, and `pipeline.approval.*`. WAL-backed `compact()` and durable subscriptions on `EventBus` are also entirely unused.

## PipelineModule — full surface

All paths absolute; line numbers cite `/Users/connorhoehn/Projects/distributed-core/src/applications/pipeline/PipelineModule.ts` (PM) and `/Users/connorhoehn/Projects/websocket-gateway/social-api/src/pipeline/createBridge.ts` (CB) or `/Users/connorhoehn/Projects/websocket-gateway/src/pipeline-bridge/pipeline-bridge.js` (PB).

| Method / Event | Signature | Consumed by us? | Where (file:line) | Notes |
|---|---|---|---|---|
| `constructor` | `(config: PipelineModuleConfig)` | Yes | `social-api/src/pipeline/bootstrap.ts:415` (per Grep) | Wires `llmClient`, optional `walFilePath`, `eventBusTopic`. |
| `onInitialize` | `protected (context) => Promise<void>` | Indirect | called from inherited `initialize()` PM:169 | Reads `context.configuration.pubsub`. |
| `onStart` / `onStop` / `onConfigurationUpdate` | `protected () => Promise<void>` | Indirect | PM:208, PM:212, PM:229 | Triggered by the inherited `start()` / `stop()`. |
| `getResourceTypeDefinitions` | `protected () => ResourceTypeDefinition[]` | No | PM:233 | Internal to base class registration. |
| `createResource` | `(metadata: Partial<ResourceMetadata>) => Promise<ResourceMetadata>` | Yes | CB:45 | Bridge calls it through the `trigger` shape. |
| `scaleResource` | `(resourceId, strategy) => Promise<void>` | No | PM:375 | No-op; intentionally not wired. |
| `deleteResource` | `(resourceId: string) => Promise<void>` | Partial | PB:627 | `bindPipelineModule` wires it as the legacy cancel handler; the typed bridge in CB uses `cancelRun` instead. |
| `handleOrphanedNodeRuns` | `private (departedNodeId: string) => Promise<void>` | No | PM:401 | Private; emits orphan + reassigned events on `member-left`. |
| `getMetrics` | `() => Promise<ApplicationModuleMetrics & {...pipeline-specific...}>` | Yes (partial) | CB:100 | Bridge reads `runsAwaitingApproval` only — discards `runsStarted`, `runsCompleted`, `runsFailed`, `runsActive`, `avgDurationMs`, `llmTokensIn`, `llmTokensOut`. |
| `getDashboardData` | `() => Promise<ApplicationModuleDashboardData>` | No | PM:496 | Returns charts (Run Outcomes, LLM Token Usage, Avg Run Duration) + alerts. |
| `getEventBus` | `() => EventBus<PipelineEventMap>` | Yes | CB:20 (comment), `social-api/src/pipeline/bootstrap.ts:43` | Bridge subscribes via `subscribeAll` per PB:205. |
| `getRun` | `(runId: string) => PipelineRun \| null` | Yes | CB:62 | Active wins over completed. |
| `getHistory` | `(runId, fromVersion = 0) => Promise<BusEvent[]>` | Yes | CB:70 | Returns `[]` cleanly when WAL not configured (PM:580). |
| `listActiveRuns` | `() => PipelineRunResource[]` | Yes | CB:80 | Bridge flattens each resource's `applicationData` into a snapshot. |
| `cancelRun` | `(runId: string) => void` | Yes | CB:92 | |
| `resolveApproval` | `(runId, stepId, userId, decision, comment?) => void` | Yes | CB:75 | |
| `getPendingApprovals` | `() => PendingApprovalRow[]` | Yes | CB:96 | Bridge casts directly to its own row type. |
| `finaliseRun` | `private (runId: string) => void` | No | PM:662 | Private; FIFO eviction at `maxCompletedRuns` cap. |
| Inherited `initialize` | `(context) => Promise<void>` | Yes | base ApplicationModule.ts:34 | Called by bootstrap. |
| Inherited `start` / `stop` | `() => Promise<void>` | Yes | base ApplicationModule.ts:58, 70 | Called by bootstrap. |
| Inherited `getResources` | `() => Promise<ResourceMetadata[]>` | No | base ApplicationModule.ts:105 | Pulls from `context.resourceRegistry`. Bridge uses `listActiveRuns()` instead. |
| Inherited `healthCheck` | `() => Promise<{healthy, details?}>` | No | base ApplicationModule.ts:129 | Computed from `getMetrics()`. |
| Inherited `updateConfiguration` | `(newConfig) => Promise<void>` | No | base ApplicationModule.ts:151 | |
| Inherited `getConfiguration` | `() => ApplicationModuleConfig` | No | base ApplicationModule.ts:161 | |
| EventEmitter `module:initializing` / `:initialized` / `:started` / `:stopping` / `:stopped` / `:error` / `:configuration-updated` | from base | No | base ApplicationModule.ts:37, 47, 64, 72, 77, 50, 155 | Module-lifecycle events on the EventEmitter; bridge does not listen. |

## PipelineExecutor — full surface

The executor is constructed by `PipelineModule` itself; consumers normally interact via the module facade. All citations refer to `/Users/connorhoehn/Projects/distributed-core/src/applications/pipeline/PipelineExecutor.ts`.

| Method / Event | Signature | Consumed by us? | Where (file:line) | Notes |
|---|---|---|---|---|
| `constructor` | `(opts: PipelineExecutorOptions)` | Indirect | called from PM:293 | Bridge does not construct directly. |
| `runId` | `readonly string` | Indirect | PM:294 returns it via the resource. |
| `run` | `() => Promise<PipelineRun>` | No (fire-and-forget) | PM:367 | Module starts then ignores the promise; bridge has no access. |
| `cancel` | `() => void` | Indirect | PM:218, PM:383, PM:623 | Routed via `module.cancelRun()` / `deleteResource`. |
| `resolveApproval` | `(runId, stepId, userId, decision, comment?) => void` | Indirect | PM:635 | Routed via `module.resolveApproval()`. |
| `getPendingApprovals` | `() => Array<{stepId, approvers, message?, requestedAt}>` | Indirect | PM:651 | Module aggregates per-executor results. |
| `getPendingApprovalCount` | `() => number` | Indirect | PM:468 | Module sums for `runsAwaitingApproval`. |
| `getCurrentRun` | `() => PipelineRun` | Indirect | PM:561 | `module.getRun()` falls through to this. |
| All emitted events | see PipelineEventMap below | Bridge subscribes via EventBus | PB:205-220 | Both colon and dot forms are dual-emitted (lines 49-71). |

### Events emitted by `PipelineExecutor` (canonical names) and gateway-side handling

Each is dual-emitted with the dot-form alias (executor.ts:48-71). The gateway bridge canonicalises colon → dot in `mapBusEventToWireEvent` at PB:97-105 before fan-out. The gateway then routes by **dot-form prefix**, so anything outside the four prefixes below is delivered ONLY through `pipeline:all` (PB:335) and never the run-specific or approvals channels.

| Event | Payload (from `types.ts`) | Routed to run channel? | Routed to approvals channel? | Notes |
|---|---|---|---|---|
| `pipeline:run:started` | `{runId, pipelineId, triggeredBy, at}` types.ts:288 | Yes (PB:330) | No | |
| `pipeline:run:completed` | `{runId, durationMs, at}` types.ts:294 | Yes | No | Terminal — flushes per-run histogram (PB:48-52). |
| `pipeline:run:failed` | `{runId, error, at}` types.ts:299 | Yes | No | Terminal. |
| `pipeline:run:cancelled` | `{runId, at}` types.ts:304 | Yes | No | Terminal. |
| `pipeline:run:orphaned` | `{runId, previousOwner, at}` types.ts:310 | Yes (has runId) | No | Emitted from PM:412/417 on `member-left`. **Not specifically observed** by either bridge — only flows through `pipeline:all`. |
| `pipeline:run:reassigned` | `{runId, from, to, at}` types.ts:315 | Yes (has runId) | No | Emitted at PM:424/430. Placeholder `to === from` (PM:427 comment). **Not specifically observed.** |
| `pipeline:step:started` | `{runId, stepId, nodeType, at}` types.ts:323 | Yes | No | |
| `pipeline:step:completed` | `{runId, stepId, durationMs, output?, at}` types.ts:329 | Yes | No | |
| `pipeline:step:failed` | `{runId, stepId, error, at}` types.ts:336 | Yes | No | |
| `pipeline:step:skipped` | `{runId, stepId, reason, at}` types.ts:342 | Yes | No | |
| `pipeline:step:cancelled` | `{runId, stepId, at}` types.ts:348 | Yes | No | |
| `pipeline:llm:prompt` | `{runId, stepId, model, prompt, at}` types.ts:355 | Yes | No | |
| `pipeline:llm:token` | `{runId, stepId, token, at}` types.ts:362 | Yes | No | Bridge accumulates token-rate ring buffer + per-run inter-token histogram (PB:315-321). |
| `pipeline:llm:response` | `{runId, stepId, response, tokensIn, tokensOut, at}` types.ts:368 | Yes | No | |
| `pipeline:approval:requested` | `{runId, stepId, approvers, at}` types.ts:378 | Yes | Yes (PB:338) | |
| `pipeline:approval:recorded` | `{runId, stepId, userId, decision, at}` types.ts:384 | Yes | Yes | |
| `pipeline:run:paused` | `{runId, atStepIds, at}` types.ts:393 | Yes (has runId) | No | **Declared in event map but never emitted by the executor** — Phase 3+. No producer found. |
| `pipeline:run:resumed` | `{runId, at}` types.ts:398 | Yes | No | **Never emitted**; no producer found. |
| `pipeline:run:resume-from-step` | `{runId, fromNodeId, at}` types.ts:402 | Yes | No | **Never emitted**; no producer found. The legacy alias `pipeline.run.resumeFromStep` is camelCase, not dot-cased. |
| `pipeline:run:retry` | `{newRunId, previousRunId, at}` types.ts:407 | No (no `runId`!) | No | **Never emitted**; payload uses `newRunId`/`previousRunId`, so PB:330 will not route to `pipeline:run:{runId}` even if it were emitted. |
| `pipeline:join:waiting` | `{runId, stepId, received, required, at}` types.ts:414 | Yes | No | Emitted on every join arrival (executor.ts:901). Currently only flows through `pipeline:all` because `pipeline.join.*` is not in any prefix filter. |
| `pipeline:join:fired` | `{runId, stepId, inputs, at}` types.ts:421 | Yes | No | Same as above. |

### EventEmitter events from base class (still inherited)

`PipelineModule extends ApplicationModule extends EventEmitter`. The base emits `module:initializing`, `module:initialized`, `module:started`, `module:stopping`, `module:stopped`, `module:error`, `module:configuration-updated` (base ApplicationModule.ts:37, 47, 50, 64, 72, 77, 155). **Not consumed.**

## Public types we should know about

All re-exported via `index.ts:5-8`. Most-relevant:

- `PipelineModuleConfig` (PM:77) — `walFilePath`, `eventBusTopic`, `maxActiveRuns`, `maxCompletedRuns`, `checkpointEveryN`.
- `PipelineRunResource` (PM:45) — what `listActiveRuns()` returns.
- `PendingApprovalRow` (PM:63) — exact shape returned by `getPendingApprovals()`; bridge casts to its own copy at CB:96.
- `PipelineExecutorOptions` (PipelineExecutor.ts:77) — includes test-only `failureRateLLM`, `failureRateOther`, `speedMultiplier`.
- `PipelineDefinition`, `PipelineNode`, `PipelineEdge`, `NodeData` discriminated union (types.ts:11-190).
- `PipelineRun`, `StepExecution`, `RunStatus`, `StepStatus`, `ApprovalRecord` (types.ts:196-269).
- `PipelineEventMap` (types.ts:282-585) — both colon and dot variants.
- `ValidationCode`, `ValidationIssue`, `ValidationResult` (types.ts:591-621) — **shape only; no validator implementation is exported.**
- `LLMClient`, `LLMChunk`, `LLMStreamOptions` (LLMClient.ts:17-41).
- `BusEvent` re-exported via `PipelineModule.ts:39`.

## Unused capabilities, ranked by user impact

1. **HIGH — Run distribution events (`pipeline:run:orphaned`, `pipeline:run:reassigned`).** Producer exists at PM:412-435. The gateway bridge has no special handling, so a frontend "this run was moved to node X" affordance is impossible without changes to PB:330-340 routing. UI feature: cluster-aware run-detail surfaces ("recovered from `node-2` after failover").
2. **HIGH — `getDashboardData()` charts (PM:496).** Bridge ignores the entire return; the frontend has to roll its own from `getMetrics()`. UI feature: a drop-in observability tab. Current frontend uses none of `runsCompleted`, `runsFailed`, `runsActive`, `avgDurationMs`, `llmTokensIn`, `llmTokensOut` returned by `getMetrics` (CB:100-103 reads `runsAwaitingApproval` only).
3. **HIGH — Join lifecycle events (`pipeline:join:waiting`, `pipeline:join:fired`).** Emitted on every Join (executor.ts:901, executor.ts:1001). The gateway bridge does not give them a dedicated channel and does not include them in any prefix-filtered routing. UI feature: live "waiting on N branches" UI for Fork/Join graphs.
4. **MEDIUM — `EventBus.compact()` and auto-compaction.** `EventBusConfig.autoCompactIntervalMs` exists (EventBus.ts:36) and `compact()` is exported (EventBus.ts:405). bootstrap.ts does not set it; long-running deployments with `walFilePath` set will accumulate WAL forever.
5. **MEDIUM — `EventBus.subscribeDurable()` (EventBus.ts:274).** Would let the gateway resume from the last delivered version after a restart instead of re-sending the entire history. Currently the gateway uses `subscribeAll` (PB:205), so each restart blasts the full WAL replay through `getHistory` lookups.
6. **MEDIUM — `healthCheck()` (base ApplicationModule.ts:129).** Existing route `/pipeline/health` (per Grep at `social-api/src/routes/pipelineHealth.ts:29`) implements its own probe; it could just call the base method.
7. **LOW — Pause / resume / retry event types.** Declared in `PipelineEventMap` (types.ts:393-411) but **no producer exists in the executor** — confirmed by Grep at `PipelineModule.ts` and `PipelineExecutor.ts`: only the alias-table strings exist (executor.ts:65-68). `pipeline:run:retry` payload uses `newRunId`/`previousRunId` (no `runId`), which the gateway bridge cannot route to a run-specific channel (PB:330).
8. **LOW — `getResources()` (base).** Pulls from `context.resourceRegistry`, which is a different code path than `listActiveRuns()` and could surface remote-node resources. Bridge ignores it.
9. **LOW — `module:*` EventEmitter lifecycle events.** Could power a "pipeline subsystem health" indicator on the operator dashboard.
10. **LOW — `ValidationCode`/`ValidationResult` types.** Shapes are exported but no validator function is. Frontend either ships its own validator or trusts the executor to fail at runtime.

## Asks back to distributed-core

1. **Type vs. behavior gap on `getHistory`.** Signature says `Promise<BusEvent[]>` (PM:571) but the implementation swallows `WalNotConfiguredError` and returns `[]` (PM:579-583). Either widen the type with a discriminated `{ ok: true; events } | { ok: false; reason }` or document on the signature itself; today CB:65-72 has to encode that contract in a comment.
2. **`pipeline:run:retry` payload.** Payload is `{ newRunId, previousRunId, at }` (types.ts:407-411), no `runId`. Run-keyed wire fan-out (PB:330) cannot route it. Either add `runId` (= `newRunId`) or document that this event is only ever delivered through firehose channels.
3. **Pause / resume / retry are in `PipelineEventMap` but unimplemented.** Producers do not exist anywhere in `PipelineModule.ts` or `PipelineExecutor.ts` (Grep at lines 196-399 of PM and 65-68 of executor only contain the dual-emit alias rows). Either ship producers or remove the type entries until Phase 5 lands so consumers don't dead-code-handle them.
4. **`pipeline:run:reassigned` placeholder semantics.** PM:427 leaves `to === from` "placeholder — Phase 5 sets the actual new owner". Either gate the event on a real reassignment or surface a flag (`isPlaceholder: true`) so frontends do not show an incorrect "reassigned to itself" affordance.
5. **`PendingApprovalRow` is duplicated.** Exported at PM:63 but the gateway re-declares the same shape in `social-api/src/routes/pipelineTriggers.ts` and CB:96 casts to it. Consider re-exporting the row type so consumers can import directly.
6. **`getDashboardData` returns hard-coded chart titles** (PM:511, PM:520, PM:528). If the gateway is ever expected to render this verbatim, lift labels into i18n keys; otherwise rename to make it clear the data is the contract, not the labels.

## Asks for websocket-gateway side

1. **Route the unobserved colon-form events.** Update `pipeline-bridge.js` channel routing (PB:330-340) to add channels (or extend existing prefix filters) for `pipeline.run.orphaned`, `pipeline.run.reassigned`, `pipeline.join.waiting`, `pipeline.join.fired`. Today these only reach `pipeline:all`.
2. **Surface remaining `getMetrics` fields.** Extend `createBridge.ts:99-103` to expose `runsActive`, `runsStarted`, `runsCompleted`, `runsFailed`, `avgDurationMs`, `llmTokensIn`, `llmTokensOut` so `pipelineHealth` and the dashboard can render token-budget and outcome charts without a parallel computation.
3. **Wire `getDashboardData` into the existing dashboard route** (or decide to drop the call site). Currently it is a free, fully-implemented method we ignore.
4. **Decide between `cancelRun` vs `deleteResource`.** `bindPipelineModule` (PB:627) wires `deleteResource` as the cancel handler; the typed bridge (CB:92) uses `cancelRun`. They have different semantics — `deleteResource` also evicts from `completedRuns` (PM:386), `cancelRun` does not. Pick one.
5. **Switch to `subscribeDurable`** once the bootstrap is configured with a `walFilePath`. Today the bridge uses `subscribeAll` (PB:205) and replays the entire WAL on each restart; using `subscribeDurable` with a checkpoint store would deliver only post-checkpoint events.
6. **Configure auto-compaction.** Pass `autoCompactIntervalMs` and `autoCompactOptions` in `EventBusConfig` from `bootstrap.ts` once a `walFilePath` is wired in production — otherwise WAL grows unbounded.
7. **Re-evaluate `pipelineHealth`.** It implements its own probe; switching to the base class `healthCheck()` (ApplicationModule.ts:129) would deliver the same shape "for free" plus inherit any future enhancements.
8. **Note the placeholder reassignment.** Until distributed-core Phase 5 lands, the gateway should either suppress `pipeline:run:reassigned` events whose `from === to` or render them as "checkpoint reload" rather than "moved to node X".
