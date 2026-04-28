# Pipeline Metrics Data-Availability Audit

**Date:** 2026-04-27
**distributed-core version:** v0.3.2
**Refines:** Spec gap DC-PIPELINE-1.

## TL;DR

Of the 9 fields the bridge currently nulls out, **8 are tracked-but-not-exposed** and only **1 (`estimatedCostUsd`) is genuinely not tracked**. `PipelineModule.getMetrics()` already computes `runsStarted`, `runsCompleted`, `runsFailed`, `runsActive`, `avgDurationMs`, `llmTokensIn`, and `llmTokensOut` (PipelineModule.ts:471-493). The bridge wrapper in social-api simply isn't reading them — fixing this is an exposure problem on the bridge boundary, not a tracking problem in distributed-core.

## Per-field status table

| Field | Tracked internally? | Citation | Exposure path needed | Severity |
|---|---|---|---|---|
| `runsStarted` | yes | `PipelineModule.ts:297` (`this.metrics.runsStarted++` in `createResource`); returned at `PipelineModule.ts:485` | Already on `getMetrics()` return shape — bridge layer must stop hard-coding `null`. | LOW |
| `runsCompleted` | yes | `PipelineModule.ts:334` (`this.metrics.runsCompleted++` in `pipeline:run:completed` sub); returned at `PipelineModule.ts:486` | Same — bridge must read `m.runsCompleted`. | LOW |
| `runsFailed` | yes | `PipelineModule.ts:346` (`this.metrics.runsFailed++` in `pipeline:run:failed` sub); returned at `PipelineModule.ts:487` | Same — bridge must read `m.runsFailed`. | LOW |
| `runsActive` | yes | `PipelineModule.ts:488` (`runsActive: this.activeExecutors.size`) | Same — bridge must read `m.runsActive`. | HIGH (operator-facing) |
| `avgDurationMs` | yes | Computed at `PipelineModule.ts:455-458` (`this.metrics.totalDurationMs / this.metrics.completedCount`); accumulated at `PipelineModule.ts:336` (`this.metrics.totalDurationMs += event.payload.durationMs`); returned at `PipelineModule.ts:490`. Per-run `durationMs` is also recorded on `PipelineRun` at `PipelineExecutor.ts:233-234`. | Same — bridge must read `m.avgDurationMs`. | MED |
| `llmTokensIn` | yes | Subscribed and accumulated at `PipelineModule.ts:325-329` (`this.metrics.llmTokensIn += event.payload.tokensIn`); returned at `PipelineModule.ts:491`. Per-step persisted on `StepExecution.llm.tokensIn` at `PipelineExecutor.ts:721`. | Same — bridge must read `m.llmTokensIn`. | MED |
| `llmTokensOut` | yes | Subscribed and accumulated at `PipelineModule.ts:329` (`this.metrics.llmTokensOut += event.payload.tokensOut`); returned at `PipelineModule.ts:492`. Per-step persisted at `PipelineExecutor.ts:721`. | Same — bridge must read `m.llmTokensOut`. | MED |
| `estimatedCostUsd` | **no** | No reference to "cost", "usd", or pricing in `PipelineModule.ts`, `PipelineExecutor.ts`, `LLMClient.ts`, or `types.ts`. Stub fabricates it from token counts at `pipelineMetrics.ts:71-72` using a hardcoded `(in/1M)*3 + (out/1M)*15` formula. | Either compute on the websocket-gateway side (cost is a presentation concern over the already-tracked tokens), or add a per-model price table + `estimatedCostUsd` field to `PipelineMetricsState`. | LOW |
| `asOf` | yes (trivially) | `PipelineModule.ts:473` (`timestamp: Date.now()` on returned metrics object) | Bridge must convert `m.timestamp` (epoch ms) to ISO string, or `getMetrics()` could be augmented with an ISO `asOf`. | LOW (cosmetic) |

## Token tracking — special case

`LLMClient.LLMChunk` (LLMClient.ts:17-19) defines the terminal chunk as `{ done: true; response: string; tokensIn: number; tokensOut: number }` — both directions are first-class fields on the interface, so any conforming implementation (Anthropic, Bedrock, OpenAI, fixture) is required to surface `usage.input_tokens` / `usage.output_tokens` in the final chunk.

The executor records them in two places on every LLM step:

1. Emits `pipeline:llm:response` with `tokensIn` / `tokensOut` at `PipelineExecutor.ts:711-718`.
2. Persists them on `StepExecution.llm` at `PipelineExecutor.ts:721`: `step.llm = { prompt, response, tokensIn, tokensOut }`.

The module then sums them across all runs in its event subscription at `PipelineModule.ts:325-329`. So both per-step and aggregate token counts are fully tracked — they just aren't reaching the bridge.

## Cost calculation

There is **no cost-per-token table** anywhere in `distributed-core/src/applications/pipeline/`. `LLMNodeData` (types.ts:48-59) carries `provider` and `model` strings but no pricing metadata, and `PipelineMetricsState` (PipelineModule.ts:109-119) tracks token totals but not dollars.

The only cost arithmetic in the codebase lives in `getPipelineMetricsStub()` at `pipelineMetrics.ts:71-72`:

```
const estimatedCostUsd =
  Math.round(((llmTokensIn / 1_000_000) * 3 + (llmTokensOut / 1_000_000) * 15) * 100) / 100;
```

Those rates (`$3/Mtok in, $15/Mtok out`) are hardcoded for one model class with no provenance. Treat `estimatedCostUsd` as a dashboard-layer concern: once the bridge ships real `llmTokensIn` / `llmTokensOut`, the social-api layer can compute cost from the same formula (or a richer per-model table) without distributed-core change.

## Asks back to distributed-core

Prioritized:

1. **None of the 8 tracked fields require new code in distributed-core** — `PipelineModule.getMetrics()` already returns them. The fix lives in the websocket-gateway bridge wrapper.
2. *(optional, cosmetic)* Add an ISO `asOf: string` field alongside the existing epoch `timestamp: number` on `getMetrics()`'s return so consumers don't have to convert.
3. *(optional, future)* If cost is to be canonical (not dashboard-derived), thread an optional `pricing?: { inputUsdPerMtok: number; outputUsdPerMtok: number }` into `LLMNodeData` and accumulate `estimatedCostUsd` in `PipelineMetricsState`. Low priority — the data is derivable downstream.

## Asks for websocket-gateway

1. **Replace the `null`-fill in `pipelineMetrics.ts:140-152` with a pass-through from `bridge.getMetrics()`.** All 7 numeric fields plus `runsAwaitingApproval` are present on the module's return shape (PipelineModule.ts:445-454); the bridge currently throws away 7 of 8.
2. **Compute `estimatedCostUsd` on the gateway side** from `llmTokensIn` / `llmTokensOut` returned by the bridge — same formula as `getPipelineMetricsStub()` line 71-72. Document that it is a derived/presentation field.
3. **Convert `m.timestamp` (epoch ms) to `asOf` (ISO)** in the bridge wrapper, e.g. `asOf: new Date(m.timestamp).toISOString()`.
4. **Once the bridge passes through real values, the `'stub'` source should be retained** for environments where `getPipelineBridge()` returns null (no cluster wired) — the demo banner is still useful. The `'error'` branch (pipelineMetrics.ts:154-159) is already correct; do not deprecate it.
5. **Frontend rendering of `null`:** with the bridge fix above, no field should be `null` for a wired bridge. If the bridge contract still allows it (e.g. a future field), keep the existing "render `null` as em-dash" convention for forward compatibility.

### Single highest-impact follow-up

`runsActive` — it's the one field operators look at first to know "is the executor doing anything right now?" and it's literally `this.activeExecutors.size` on PipelineModule (PipelineModule.ts:488). One-line bridge change.
