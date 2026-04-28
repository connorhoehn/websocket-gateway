# Pipeline LLM-Streaming Audit

**Date:** 2026-04-27
**distributed-core version:** v0.3.2

## TL;DR

Streaming **already works end-to-end at the protocol level**: the executor consumes
`AsyncIterable<LLMChunk>` chunk-by-chunk and emits one `pipeline:llm:token` BusEvent per
token, the gateway bridge forwards every BusEvent to the per-run channel, and the frontend
reducer concatenates `ev.token` into `step.llm.response`. The only place tokens are *not*
visible token-by-token is the **replay scrubber**, which works off post-hoc `deriveEvents`
and synthesizes fake tokens from the final response. There is no real-time streaming gap;
the gap is in **backpressure plumbing** (no controller wired) and **per-step UI polish**
(no dedicated token panel — the response just appears letter-by-letter inside a step card).

## LLMClient streaming surface

`LLMClient.stream()` returns an `AsyncIterable<LLMChunk>`
(`distributed-core/src/applications/pipeline/LLMClient.ts:35-40`).

```ts
stream(model, systemPrompt, userPrompt, opts?: LLMStreamOptions): AsyncIterable<LLMChunk>
```

`LLMChunk` is a discriminated union (`LLMClient.ts:17-19`):
- `{ done: false; token: string }` — one per token
- `{ done: true; response: string; tokensIn: number; tokensOut: number }` — terminal sentinel

`LLMStreamOptions` (`LLMClient.ts:21-25`) carries `temperature`, `maxTokens`, and an
`AbortSignal`. The contract requires implementations to throw `AbortError` if the signal
is already aborted before iteration starts and to stop mid-stream if it fires later
(`LLMClient.ts:32-34`).

## Executor stream-handling

`PipelineExecutor.execLLM` (`distributed-core/src/applications/pipeline/PipelineExecutor.ts:638-728`)
**emits per chunk** — option (b), not (a). Inside the `for await` loop:

- `PipelineExecutor.ts:687-693` — for every `done: false` chunk, the executor awaits
  `eventBus.publish('pipeline:llm:token', { runId, stepId, token, at })` (and dual-emits
  the dot-form alias via `emit()` at `PipelineExecutor.ts:1131-1138`).
- `PipelineExecutor.ts:694-698` — on `done: true`, it captures `response`, `tokensIn`,
  `tokensOut` for the post-stream `pipeline:llm:response` event at
  `PipelineExecutor.ts:711-718`, but the per-token events have already gone out.

The executor does **not** buffer tokens — each `await this.emit(...)` flushes the
canonical event onto the EventBus before the next iterator pull. Token cadence on the
bus therefore mirrors the provider's network cadence.

## Bridge/Gateway re-emission

Two layers, both transparent.

**social-api bridge** (`websocket-gateway/social-api/src/pipeline/createBridge.ts`) —
this layer does **not** subscribe to events. It exposes only the lifecycle/query
surface (trigger, getRun, listActiveRuns, cancelRun, getHistory, getMetrics,
resolveApproval). EventBus subscription is done by the gateway (per the comment at
`createBridge.ts:18-21`).

**Gateway pipeline-bridge** (`websocket-gateway/src/pipeline-bridge/pipeline-bridge.js`)
subscribes to **every** BusEvent via `subscribeAll` (`pipeline-bridge.js:205-215`) —
including `pipeline:llm:token`. `_handleEvent` (`pipeline-bridge.js:292-341`) fans each
event onto three channels:
- `pipeline:run:{runId}` (`pipeline-bridge.js:330-332`) — the per-run firehose
- `pipeline:all` (`pipeline-bridge.js:335`) — global firehose
- `pipeline:approvals` (`pipeline-bridge.js:338-340`) — approval events only

Token events flow over `pipeline:run:{runId}` and `pipeline:all`. `PipelineService.emitEvent`
(`src/services/pipeline-service.js:542-564`) wraps each event in a `pipeline:event` frame
and routes it via `messageRouter.sendToChannel(channel, frame)`. WebSocket clients that
subscribed to `pipeline:run:{runId}` see every token frame.

The gateway bridge **also** maintains a token-rate ring buffer
(`pipeline-bridge.js:160-170`, `364-406`) and a per-run inter-token-arrival histogram
(`pipeline-bridge.js:177-178`, `450-554`) — observability is already richer than the UI
exposes.

## Frontend assumptions

The live UI **does** consume tokens. `PipelineRunsContext` reducer
(`frontend/src/components/pipelines/context/PipelineRunsContext.tsx:548-564`) handles
`pipeline.llm.token` by appending `ev.token` to `step.llm.response`:

```ts
response: (prev.llm?.response ?? '') + ev.token
```

`WebSocketEventAdapter` (`frontend/src/components/pipelines/context/WebSocketEventAdapter.ts:71-77`)
unwraps `pipeline:event` frames and dispatches each envelope into `EventStreamContext`,
which feeds the reducer above. So a live run on a per-run channel produces token-by-token
state updates in React; whatever component renders `step.llm.response` (e.g. an LLM step
card) will re-render on every token.

The replay path is the *one* place tokens are **synthetic**, not streamed:
`deriveEvents.synthesizeTokens` (`frontend/src/components/pipelines/replay/deriveEvents.ts:73-79`)
splits the persisted final response on whitespace and spaces those fake tokens evenly across
the step's wall-clock window (`deriveEvents.ts:201-218`). The header at lines 13-15
explicitly calls this out as a Phase-5 stand-in for true WAL replay. `Scrubber.tsx` itself
is type-agnostic — it renders a tick per envelope using `getEventGlyph` and never inspects
payload (`Scrubber.tsx:194-221`).

## Backpressure & cancellation

**Backpressure.** The gateway bridge accepts an optional `BackpressureController`
(`pipeline-bridge.js:185-192`) and accumulates `bp.dropped.count` events into per-strategy
counters (`pipeline-bridge.js:563-577`). The TODO at `pipeline-bridge.js:181-184` flags
that no controller is wired today — `_backpressureController` is `null` in the social-api
bootstrap. So if the LLM emits faster than the WebSocket drains, the path is:
*executor → EventBus.publish (await) → bridge handler (sync) → messageRouter.sendToChannel*.
Whatever buffering the messageRouter / WebSocket socket layer applies is the only backstop.
There is no drop-oldest, no rate limit, no high-watermark signal back to the executor.

**Cancellation.** The executor wires an `AbortController`
(`PipelineExecutor.ts:158`) into every LLM stream
(`PipelineExecutor.ts:680-684`). `cancel()` calls `abortController.abort()`
(`PipelineExecutor.ts:269`); the providers check `signal?.aborted` between iterator
events (`AnthropicLLMClient.ts:55-58`, `BedrockLLMClient.ts:62-64`) and throw `AbortError`
which the executor catches at `PipelineExecutor.ts:700-706`. The Anthropic client
additionally calls `stream.finalMessage().catch(...)` to gracefully close the SSE
connection (`AnthropicLLMClient.ts:56`). Cancellation is clean — the executor does **not**
wait for the full response.

## Provider parity table

| Provider  | Streams supported | Normalized to LLMChunk shape | Cancellation respected |
|-----------|------------------|------------------------------|------------------------|
| Anthropic | Yes — `messages.stream()` SSE consumed at `AnthropicLLMClient.ts:48-73` | Yes — `content_block_delta`/`text_delta` → `{done:false, token}`; final yield with `tokensIn`/`tokensOut` from `message_start`/`message_delta` usage events | Yes — pre-iteration check at `AnthropicLLMClient.ts:31-33`, mid-stream check at `:55-58`, plus `finalMessage().catch(()=>{})` for clean teardown |
| Bedrock   | Yes — `InvokeModelWithResponseStreamCommand` at `BedrockLLMClient.ts:47-92` | Yes — same Anthropic-on-Bedrock event shape, decoded from chunk bytes; same final yield contract | Yes — pre-iteration check at `:27-29`, mid-stream check at `:62-64`. **No** explicit response-stream `.destroy()` call — the `AbortError` throw drops out of the `for await` and the runtime closes the underlying socket. Less defensive than the Anthropic path but functional. |
| Fixture   | Yes — `FixtureLLMClient.stream` at `LLMClient.ts:71-105` | Yes (canonical reference impl: tokens are individual characters of the scripted response) | Yes — pre-iteration and per-char checks at `LLMClient.ts:84-91` |

All three converge on the same `LLMChunk` discriminator, so the executor's
provider-agnostic loop at `PipelineExecutor.ts:680-699` is the single normalization point.

## End-to-end gap

For "client gets tokens as they arrive" — **today this works**. For a *live* run on a
per-run channel, the chain is intact:

1. Provider yields `{done:false, token}` → already chunked.
2. Executor awaits `emit('pipeline:llm:token', ...)` per chunk → already per-token.
3. EventBus → gateway `subscribeAll` → `_handleEvent` → `emitEvent` per-run channel → already per-token.
4. `messageRouter.sendToChannel` → WebSocket frame → already per-token.
5. `WebSocketEventAdapter` → `EventStreamContext.dispatchEnvelope` → `PipelineRunsContext` reducer concatenates → already per-token.

The remaining UX gaps (none of them protocol blockers):

- **No dedicated token-streaming UI panel.** The response shows up as it grows inside whatever
  step-detail component reads `step.llm.response` from `PipelineRunsContext`. There's no
  blinking-cursor "AI typing" affordance.
- **Replay is synthetic.** `deriveEvents.synthesizeTokens` regenerates a fake token cadence
  from the persisted response — only the *live* path is real-time. Phase-5 WAL replay is
  the planned fix (called out in `deriveEvents.ts:13-15` and `Scrubber.tsx:7-9`).
- **No backpressure wiring.** The bridge has a slot but no controller; sustained 40 tok/s
  with multiple concurrent runs has no shed valve.
- **No frontend gap detection** for token events specifically. `seq` is forwarded
  (`pipeline-bridge.js:97-105`) but no UI surface flags missing token sequence numbers.

## Asks back to distributed-core

- Confirm **mid-stream Bedrock cancellation** actually closes the underlying HTTPS socket
  (the test infra uses `FixtureLLMClient`, so this isn't covered). The Bedrock
  `for await (chunk of response.body)` loop will terminate, but the AWS SDK's response
  body stream has historically held connections open until explicit `.destroy()`.
- Expose a **first-token latency** metric on `PipelineExecutor` or `PipelineModule` —
  currently we can compute it from BusEvent timestamps but a built-in TTFB would
  unblock SLO dashboards.
- Optional: emit a `pipeline:llm:stream:opened` event at `for await` entry so the gateway
  can distinguish "no tokens yet because slow" from "no tokens yet because cold start".
- Confirm whether `LLMStreamOptions` should grow `topP` / `stopSequences` for Phase-5 —
  current contract is intentionally minimal but providers support more.

## Asks for websocket-gateway

- **Wire a `BackpressureController`** into `pipeline-bridge.js`'s `backpressureController`
  slot at bridge construction in social-api bootstrap. The TODO at `pipeline-bridge.js:181-184`
  is the obvious entry point. Suggested strategy: drop-oldest on `pipeline:llm:token`
  events only — never drop step-lifecycle events.
- **Per-step token-streaming render**: a dedicated typing-affordance component subscribed
  to `step.llm.response` so users see streaming visually, not just "watch the string grow".
- **Frontend WAL playback** (Phase-5): replace `deriveEvents.synthesizeTokens` with
  `module.getHistory(runId, fromVersion)` — the surface already exists on the bridge
  (`createBridge.ts:65-72`).
- **`seq`-gap detection** in `PipelineRunsContext` for token events on a per-run channel —
  if `seq` jumps by N, the UI knows the bridge dropped frames (relevant once backpressure
  ships).
- **First-token-latency surface** in the gateway bridge's per-run inter-token histogram
  (`pipeline-bridge.js:450-482`): record the gap from `pipeline.llm.prompt` to the first
  `pipeline.llm.token` separately from token-to-token gaps.
