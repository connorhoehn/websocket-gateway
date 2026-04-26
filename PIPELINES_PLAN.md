# Pipelines + Observability — Plan

Visual React Flow workflow editor with deep real-time observability into a distributed execution platform. UI-focused build over several months, no AWS dependency.

The existing `DocumentTypeWorkflow` / `ApprovalWorkflow` / `WorkflowPanel` system is being **deleted wholesale**. Pipelines replace it. Human approvals become one node type (`Approval`) among many.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vite, months of UI work)                              │
│                                                                   │
│  /pipelines/:id                 /observability                   │
│  ─────────────                  ──────────────                   │
│  React Flow canvas              Cluster dashboard                │
│    + config panels                (nodes, health, hotspots)      │
│    + live step overlay          Run timeline (WAL scrubber)      │
│    + execution log              Pipeline run list                │
│                                 Metrics graphs                    │
│                                 Chaos injection controls         │
│                                                                   │
│                     both subscribe to:                            │
│                     EventStream (WebSocket)                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  GATEWAY (Node.js, local — no AWS)                               │
│  pipeline-bridge.ts                                              │
│    - EventBus.subscribeAll → WebSocket broadcast                 │
│    - REST: GET  /observability/dashboard                         │
│    - REST: POST /pipelines/:id/runs                              │
│    - REST: GET  /pipelines/:id/runs/:runId/replay                │
└────────────────────────┬─────────────────────────────────────────┘
                         │ (embedded, in-memory transport)
┌────────────────────────▼─────────────────────────────────────────┐
│  DISTRIBUTED-CORE CLUSTER (embedded in gateway process)          │
│                                                                   │
│  createCluster({ size: 3, transport: 'in-memory' })              │
│                                                                   │
│  PipelineModule extends ApplicationModule                         │
│    - Registers resource type 'pipeline-run'                      │
│    - ResourceRouter.claim(runId) for ownership                   │
│    - Orphan detection → automatic re-assignment on node death    │
│                                                                   │
│  EventBus<PipelineEventMap> (WAL-backed, replayable)             │
│  ObservabilityManager (ClusterDashboard API)                     │
│  CheckpointWriter (fast cold-start for historical replay)        │
│  ChaosInjector (demos: partition, latency, node kill)            │
└──────────────────────────────────────────────────────────────────┘
                         │
                    LLM provider
                (Anthropic SDK / Bedrock — env var)
```

---

## 2. Distributed-core primitives we use

| Primitive | Role |
|---|---|
| `createCluster({ size: 3, transport: 'in-memory' })` | 3-node cluster embedded in gateway process |
| `PipelineModule extends ApplicationModule` | Plugin managing `'pipeline-run'` resource type |
| `ResourceRouter.claim(runId)` | Pipeline run ownership; emits `resource:orphaned` on node death |
| `EventBus<PipelineEventMap>` | Typed pub/sub, WAL-backed, supports `replay(fromVersion)` |
| `CheckpointWriter` | Periodic entity snapshots — replay historical runs in ms, not seconds |
| `ObservabilityManager.getDashboard()` | Pre-built `ClusterDashboard` (nodes, regions, hotspots, trends, alerts) |
| `MetricsTracker` / `MetricsExporter` | Prom-style counters/gauges/histograms; Prometheus/Datadog export |
| `ClusterIntrospection` | Membership, topology, stability, partition detection |
| `ChaosInjector` | Inject latency, partitions, node crashes — observable via same event stream |
| `FailureDetector` | SWIM-style; drives orphan-run reassignment |
| `RetryManager` + `CircuitBreaker` | Wraps LLM provider calls for reliability |

---

## 3. Route structure

```
/pipelines                       → list view
/pipelines/:id                   → editor + live execution overlay
/pipelines/:id/runs/:runId       → replay historical run (WAL + checkpoint driven)
/observability                   → cluster dashboard overview
/observability/nodes             → per-node detail + chaos controls
/observability/events            → raw EventBus timeline (scrubbable)
/observability/metrics           → Prometheus-style graphs
```

Both `/pipelines/:id` and `/observability` subscribe to the **same EventBus stream** over WebSocket; they differ only in filter.

---

## 4. Existing workflow system — deletion

**Decision:** remove the entire approval/workflow system. Human approvals are reborn as the `Approval` pipeline node type.

To delete / gut (exact paths populated by deletion-scope agent, in progress):

- Frontend:
  - `WorkflowPanel.tsx`, `useWorkflows.ts`, workflow types in `types/documentType.ts` (`DocumentTypeWorkflow`, `WorkflowStep`, `WorkflowApprover`, factories)
  - The workflows step in `DocumentTypeWizard`
  - Workflow nav/menu entries in `AppLayout`
- Backend (`social-api`):
  - `ApprovalWorkflowRepository`, workflow routes under `/api/documents/:id/workflows/*`, `/api/workflows/pending`
  - MCP tools: `document_get_workflow`, `document_advance_workflow`, `my_pending_workflows`
  - Broadcast events: `doc:workflow_advanced`, `doc:workflow_completed`
- Tests that cover the above
- Any DynamoDB table config for workflows (CDK stack)

Replacement mapping:
- Document finalize → `Trigger` node (`event: 'document.finalize'`)
- Sequential approvers → chain of `Approval` nodes
- Parallel "any-of" / "all-of" → `Fork` → N `Approval` nodes → `Join` (mode `any` / `all` / `n_of_m`)
- Pending approvals queue → filter over active `awaiting_approval` runs

Nothing in the existing workflow system survives. The new system is greenfield.

---

## 5. Node type specifications

Eight node types. Each has a strict handle contract and a typed config. Connection rules are enforced by React Flow `isValidConnection`.

### 5.1 `Trigger`
- **Inputs:** 0
- **Outputs:** 1 (`out`)
- **Config:**
  ```ts
  { triggerType: 'manual' | 'document.finalize' | 'document.comment' | 'document.submit' | 'schedule' | 'webhook',
    documentTypeId?: string,    // for document.* triggers
    schedule?: string,          // cron, for 'schedule'
    webhookPath?: string }      // for 'webhook'
  ```
- **Rule:** exactly one `Trigger` per pipeline, at position (0, 0) by convention. Cannot delete last one.
- **Execution:** emits `context = { trigger, payload }` downstream.

### 5.2 `LLM`
- **Inputs:** 1 (`in`)
- **Outputs:** 2 (`out`, `error`)
- **Config:**
  ```ts
  { provider: 'anthropic' | 'bedrock',
    model: string,              // 'claude-sonnet-4-6', etc.
    systemPrompt: string,
    userPromptTemplate: string, // {{context.foo}} substitution
    temperature?: number,
    maxTokens?: number,
    streaming: boolean }
  ```
- **Execution:** builds prompt via template, calls provider (wrapped in `RetryManager` + `CircuitBreaker`), streams tokens if enabled. Merges `{ llmResponse, tokensIn, tokensOut }` into context on `out`. Routes to `error` on terminal failure.

### 5.3 `Transform`
- **Inputs:** 1 (`in`)
- **Outputs:** 1 (`out`)
- **Config:**
  ```ts
  { transformType: 'jsonpath' | 'template' | 'javascript',
    expression: string,
    outputKey?: string }        // where in context to write result (default: merge into root)
  ```
- **Execution:** runs expression against input context, merges result. JavaScript is sandboxed (restricted runtime).

### 5.4 `Condition`
- **Inputs:** 1 (`in`)
- **Outputs:** 2 (`true`, `false`)
- **Config:**
  ```ts
  { expression: string,         // JSONPath or boolean expr over context
    label?: string }            // UI label shown on node
  ```
- **Execution:** evaluates expression; routes context unchanged to `true` or `false`.

### 5.5 `Action`
- **Inputs:** 1 (`in`)
- **Outputs:** 2 (`out`, `error`)
- **Config:**
  ```ts
  { actionType: 'update-document' | 'post-comment' | 'notify' | 'webhook' | 'mcp-tool',
    config: ActionConfig }      // shape varies per actionType
  ```
- **Execution:** performs side-effect, outputs result merged into context, or routes to `error`.
- MCP-tool action invokes any tool exposed by the existing `document-mcp-server.js`.

### 5.6 `Fork`
- **Inputs:** 1 (`in`)
- **Outputs:** N (`branch-0`, `branch-1`, …, `branch-(N-1)`)
- **Config:**
  ```ts
  { branchCount: number }       // 2..8
  ```
- **Execution:** copies context to all N outputs simultaneously; all branches run in parallel.
- UI: adjustable number of output handles on the right side.

### 5.7 `Join`
- **Inputs:** N (`in-0`, `in-1`, …)
- **Outputs:** 1 (`out`)
- **Config:**
  ```ts
  { mode: 'all' | 'any' | 'n_of_m',
    n?: number,                 // required when mode === 'n_of_m'
    mergeStrategy: 'deep-merge' | 'array-collect' | 'last-writer-wins' }
  ```
- **Execution:** collects inputs. `all`: wait for every connected input. `any`: fire on first. `n_of_m`: fire when n arrive. Merges contexts per strategy.

### 5.8 `Approval`
- **Inputs:** 1 (`in`)
- **Outputs:** 2 (`approved`, `rejected`)
- **Config:**
  ```ts
  { approvers: Array<{ type: 'user' | 'role'; value: string }>,
    requiredCount: number,      // n-of-m
    timeoutMs?: number,         // auto-reject (or configurable default-action) after timeout
    timeoutAction?: 'reject' | 'approve' | 'escalate',
    message?: string }          // shown to approver
  ```
- **Execution:** run enters `awaiting_approval` state, emits `pipeline.approval.requested` event, blocks until resolved. Frontend renders pending approvals in a dedicated panel; approvers act via the same UI. On resolve, routes to `approved` or `rejected`.

### Connection validation rules (enforced in `isValidConnection`)
- No self-loops.
- Cannot form cycles (run a topological check on add-edge).
- Handle types must match: only certain output handles go to certain input handles (see handle-type table below).
- `Trigger` has no inputs; `End`-like terminals are inferred (nodes with no outgoing edges = terminal).
- `Join` must have ≥ 2 incoming edges to be "connected" (warning state otherwise).

### Handle-type table

| From handle | To handle | Valid? |
|---|---|---|
| `Trigger.out` → any `.in` | ✓ |
| `LLM.out`, `LLM.error` → any `.in` | ✓ |
| `Condition.true`, `Condition.false` → any `.in` | ✓ |
| `Fork.branch-N` → any `.in` | ✓ |
| any `.out` → `Join.in-N` | ✓ |
| `Approval.approved`, `Approval.rejected` → any `.in` | ✓ |
| any output → `Trigger.*` | ✗ (no inputs) |

---

## 6. Data model

All schemas live in `frontend/src/types/pipeline.ts`. Shared with backend via type-only imports when distributed-core integration begins (Phase 3).

```ts
// ─── Definition (template) ──────────────────────────────────────

export interface PipelineDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;                  // bumped on save
  triggerBinding?: TriggerBinding;  // cached for fast lookup
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface TriggerBinding {
  event: 'manual' | 'document.finalize' | 'document.comment' | 'document.submit' | 'schedule' | 'webhook';
  documentTypeId?: string;
  schedule?: string;
  webhookPath?: string;
}

export type NodeType = 'trigger' | 'llm' | 'transform' | 'condition' | 'action' | 'fork' | 'join' | 'approval';

export interface PipelineNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;                   // discriminated union keyed on `type`
}

export type NodeData =
  | TriggerNodeData
  | LLMNodeData
  | TransformNodeData
  | ConditionNodeData
  | ActionNodeData
  | ForkNodeData
  | JoinNodeData
  | ApprovalNodeData;
// (each *NodeData shape per section 5 above)

export interface PipelineEdge {
  id: string;
  source: string;                   // source node id
  sourceHandle: string;             // 'out', 'true'/'false', 'branch-N', 'approved'/'rejected', 'error'
  target: string;
  targetHandle: string;             // 'in' or 'in-N' for Join
}

// ─── Runtime (execution) ────────────────────────────────────────

export type RunStatus =
  | 'pending' | 'running' | 'awaiting_approval'
  | 'completed' | 'failed' | 'cancelled';

export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineVersion: number;
  status: RunStatus;
  triggeredBy: {
    userId?: string;
    triggerType: string;
    payload: Record<string, unknown>;
  };
  ownerNodeId: string;              // from ResourceRouter
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  currentStepIds: string[];         // active frontier (can be > 1 with Fork)
  steps: Record<string, StepExecution>;
  context: Record<string, unknown>; // accumulated as run progresses
  error?: { nodeId: string; message: string; stack?: string };
}

export type StepStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting';

export interface StepExecution {
  nodeId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  // LLM-specific
  llm?: { prompt: string; response: string; tokensIn: number; tokensOut: number };
  // Approval-specific
  approvals?: Array<{
    userId: string;
    decision: 'approve' | 'reject';
    comment?: string;
    at: string;
  }>;
}

// ─── Event map (the contract) ───────────────────────────────────

export type PipelineEventMap = {
  // Run lifecycle
  'pipeline.run.started':       { runId: string; pipelineId: string; triggeredBy: PipelineRun['triggeredBy']; at: string };
  'pipeline.run.completed':     { runId: string; durationMs: number; at: string };
  'pipeline.run.failed':        { runId: string; error: PipelineRun['error']; at: string };
  'pipeline.run.cancelled':     { runId: string; at: string };
  // Distribution events (from ResourceRouter)
  'pipeline.run.orphaned':      { runId: string; previousOwner: string; at: string };
  'pipeline.run.reassigned':    { runId: string; from: string; to: string; at: string };
  // Step lifecycle
  'pipeline.step.started':      { runId: string; stepId: string; nodeType: NodeType; at: string };
  'pipeline.step.completed':    { runId: string; stepId: string; durationMs: number; output?: unknown; at: string };
  'pipeline.step.failed':       { runId: string; stepId: string; error: string; at: string };
  'pipeline.step.skipped':      { runId: string; stepId: string; reason: string; at: string };
  // LLM streaming
  'pipeline.llm.prompt':        { runId: string; stepId: string; model: string; prompt: string; at: string };
  'pipeline.llm.token':         { runId: string; stepId: string; token: string; at: string };
  'pipeline.llm.response':      { runId: string; stepId: string; response: string; tokensIn: number; tokensOut: number; at: string };
  // Approval
  'pipeline.approval.requested': { runId: string; stepId: string; approvers: ApprovalNodeData['approvers']; at: string };
  'pipeline.approval.recorded': { runId: string; stepId: string; userId: string; decision: 'approve' | 'reject'; at: string };
  // Cancel / retry / pause / resume
  'pipeline.step.cancelled':     { runId: string; stepId: string; at: string };
  'pipeline.run.paused':         { runId: string; atStepIds: string[]; at: string };         // Phase 3+
  'pipeline.run.resumed':        { runId: string; at: string };                              // Phase 3+
  'pipeline.run.resumeFromStep': { runId: string; fromNodeId: string; at: string };          // manual retry-from-node
  'pipeline.run.retry':          { newRunId: string; previousRunId: string; at: string };
  // Join bookkeeping (useful for observability / debugging)
  'pipeline.join.waiting':       { runId: string; stepId: string; received: number; required: number; at: string };
  'pipeline.join.fired':         { runId: string; stepId: string; inputs: string[]; at: string };
};
```

---

## 7. Visual language

### 7.1 Node states (applied as a `data-state` attribute → CSS)

| State | Border | Background | Adornment | Animation |
|---|---|---|---|---|
| `idle` | `#d1d5db` 1px | `#ffffff` | — | none |
| `pending` | `#93c5fd` 1px dashed | `#eff6ff` | — | subtle pulse (opacity 0.8→1.0, 2s) |
| `running` | `#2563eb` 2px | `#eff6ff` | spinning dot, top-right | gradient sweep across border (1.5s loop) |
| `awaiting` | `#f59e0b` 2px | `#fffbeb` | hourglass icon | slow pulse |
| `completed` | `#16a34a` 1px | `#f0fdf4` | ✓ in green circle, top-right | brief flash on enter (500ms) |
| `failed` | `#dc2626` 2px | `#fef2f2` | ✕ in red circle, top-right | subtle shake on enter |
| `skipped` | `#d1d5db` 1px dashed | `#f9fafb`, 0.5 opacity | — | none |

### 7.2 Edges

- **default** — `stroke: #cbd5e1; stroke-width: 1.5`
- **active (data flowing)** — animated `stroke-dasharray: 6 4; stroke-dashoffset: animated; stroke: #2563eb; stroke-width: 2`
- **traversed-success** — solid `stroke: #16a34a; stroke-width: 2`
- **traversed-failure** — solid `stroke: #dc2626; stroke-width: 2`
- **branch label** — small pill near source handle showing `true`/`false`/`approved`/`rejected`/`branch-N`

### 7.3 LLM streaming

Node expands vertically to reveal a response body. Tokens fade in one at a time with a blinking cursor block. Height animates smoothly. On `pipeline.llm.response` event, cursor vanishes and a small footer shows `tokensIn → tokensOut`. Click-to-expand keeps long responses from blowing out the canvas.

### 7.4 Errors

Failed nodes show red border + a tooltip with the error message. An inline "⟳ Retry from here" button (canvas-runtime only) re-runs the pipeline starting at that node with the same upstream context. Downstream nodes become `skipped`.

### 7.5 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [← Pipelines]  Pipeline name  [Draft|Saved]   [▶ Run] [⋯]    │  top bar (44px)
├──────┬────────────────────────────────────┬──────────────────┤
│      │                                    │                  │
│ node │                                    │   selected-node  │
│ pal- │          React Flow canvas         │   config panel   │
│ ette │                                    │   (slides in)    │
│ 220px│          (fills available)         │       320px      │
│      │                                    │                  │
├──────┴────────────────────────────────────┴──────────────────┤
│ ▸ Execution log ({count} events)   [filter]   [clear] [⛶]   │  bottom bar
└──────────────────────────────────────────────────────────────┘                  (collapsible, 40px → 240px)
```

- Left palette: drag-to-add. Each node-type card shows icon + name + one-line description.
- Right config panel: opens when a node is selected; closes on canvas click.
- Bottom execution log: collapsed by default; expands to show the live `PipelineEventMap` stream filtered to this run, with per-event expansion for detail.

### 7.6 Color system

Follow existing app palette — `#646cff` primary (reuse), plus status colors as above. Dark-mode support deferred to a post-Phase-5 polish pass.

---

## 8. Mock executor spec (Phase 1)

Lives in `frontend/src/pipelines/mockExecutor.ts`. Given a `PipelineDefinition` + trigger payload, emits `PipelineEventMap` events via a callback. Runs entirely in-browser, no backend needed. This is the contract surface the real distributed-core `PipelineModule` will implement identically in Phase 3.

### 8.1 API

```ts
export interface MockExecutorOptions {
  definition: PipelineDefinition;
  triggerPayload?: Record<string, unknown>;
  failureRateLLM?: number;        // default 0.10
  failureRateOther?: number;      // default 0.02
  speedMultiplier?: number;       // default 1.0 (1.0 = realistic; 0.1 = dev speed)
  onEvent: <K extends keyof PipelineEventMap>(type: K, payload: PipelineEventMap[K]) => void;
}

export class MockExecutor {
  constructor(opts: MockExecutorOptions);
  run(): Promise<PipelineRun>;
  cancel(): void;
  resolveApproval(runId: string, stepId: string, userId: string, decision: 'approve' | 'reject'): void;
}
```

### 8.2 Step-duration profiles (normal distribution, clamped ≥ 50ms)

| Node type | Mean | Stdev | Notes |
|---|---|---|---|
| `trigger` | 10ms | 5ms | |
| `llm` | 3500ms | 1500ms | tokens emitted at ~40/s with jitter |
| `transform` | 120ms | 60ms | |
| `condition` | 30ms | 15ms | |
| `action` | 900ms | 400ms | |
| `fork` | 10ms | 5ms | instant |
| `join` | 10ms | 5ms | plus wait-time for inputs |
| `approval` | — | — | blocks until `resolveApproval()` or timeout |

All durations scale by `speedMultiplier`.

### 8.3 LLM simulation

- Generates a plausible-looking response from a small library of fixtures (markdown, JSON, plain text — picked by system-prompt sniffing, or random if none match).
- Streams tokens at 40/s ± 15/s jitter.
- Emits `pipeline.llm.prompt` → N × `pipeline.llm.token` → `pipeline.llm.response`.
- Fails per `failureRateLLM` — emits `pipeline.step.failed`, routes to `error` handle.

### 8.4 Condition simulation

- If expression matches a well-known pattern (`context.foo === "x"`), evaluates against `context`.
- Otherwise, randomly picks `true`/`false` (60/40 split toward true).

### 8.5 Approval simulation

- `timeoutMs` unset → blocks indefinitely until `resolveApproval()`.
- `timeoutMs` set → schedules auto-resolve per `timeoutAction`.
- Pending approvals are discoverable via an exposed `getPendingApprovals()` method — the UI renders them in the execution log so the user can click to approve/reject during a demo.

### 8.6 Dependency tracking

- Builds an adjacency map from edges.
- For each node, tracks `remainingInputs` (initially = incoming edge count).
- A node fires when `remainingInputs === 0`.
- `Fork` decrements its target branches' counters all at once.
- `Join` uses its `mode` to decide when to fire.
- `Condition` decrements only the taken branch's targets.

### 8.7 Cancellation

- `cancel()` emits `pipeline.run.cancelled` immediately.
- All in-flight step timers cleared.
- Running-but-not-yet-emitted LLM tokens stop.

### 8.8 Fidelity to the real executor

The mock's event shapes, ordering invariants (started-before-completed, run-started-before-any-step, etc.), and failure semantics must match the Phase 3 `PipelineModule`. A shared test suite (`pipelineExecutor.contract.test.ts`) runs against both.

---

## 9. Decisions locked

- **Delete all existing workflow code** — no migration, no backwards compat. The `Approval` node replaces it.
- **No AWS** — Lambda/EventBridge/SQS out. Everything runs on `npm run dev`.
- **Distributed-core embedded** in gateway process (Phases 1–4), separate processes in Phase 5+.
- **Pipeline definitions in localStorage** (Phases 1–2), migrate to distributed-core `ResourceRouter`-owned resources (Phase 3+).
- **LLM via direct SDK call** — `@anthropic-ai/sdk` or `@aws-sdk/client-bedrock-runtime`, env var switch.
- **React Flow v12** (`@xyflow/react`) as the canvas.
- **Two views of the same data:** editor canvas has live overlay; `/observability` is dedicated dashboard.
- **Chaos events** ride on a separate `cluster.*` EventBus, multiplexed at the gateway relay.
- **No scheduled-trigger node in Phase 1** — `schedule` appears in `TriggerBinding` shape for forward-compat but UI/execution land in Phase 5.
- **PipelineDefinition versioning** — simple integer, bumped on save. Runs reference the specific version they executed against.
- **Draft vs Published** — `PipelineDefinition.status: 'draft' | 'published'`. Draft can have validation errors and save freely but cannot be triggered. Publish requires zero errors. Runs record the published version at trigger time.
- **State management: React Context + plain hooks only.** No Zustand, no Redux, no Jotai.
- **Side-effect rollback: none.** Actions that ran before cancel/failure are not rolled back — this is the caller's responsibility via idempotency + compensating Actions if needed.
- **Pause/Resume deferred to Phase 3+** — requires distributed-core checkpointing. Phase 1 supports cancel only.
- **Retry-from-step is canvas-runtime only (Phase 1).** Manual click on a failed node re-runs from there with upstream context. Persistent auto-retry-on-orphan arrives in Phase 3 with `ResourceRouter`.

---

## 10. Build phases

### Phase 0 — Purge the old workflow system (days, one PR) [✅ Done]
- Delete files enumerated by the deletion-scope agent.
- Remove workflow nav entries, imports, tests.
- Verify `npm run build` clean; run app to confirm doc editor still works.
- **Shipped:** all 6 files in §12.1 deleted (`useWorkflows.ts`, `WorkflowPanel.tsx`, `ApprovalWorkflowRepository.ts`, `approvalWorkflows.ts`, `WorkflowEngine.ts`, the workflow-focused wizard test); `documentType.ts` / `DocumentTypeWizard.tsx` / `useSidebarPanels.ts` / `routes/index.ts` / `repositories/index.ts` / `broadcast.ts` / `document-exporter.ts` / `document-mcp-server.js` / `tool-handler.js` modifications all landed; build clean; tests green.

### Phase 1 — Canvas + mocked execution (weeks 1–8) [✅ Done]
- Install `@xyflow/react`
- `/pipelines` list, `/pipelines/:id` editor
- All 8 node types per section 5, with config panels
- Connection validation per the handle-type table
- Save to localStorage (`ws_pipelines_v1`)
- `MockExecutor` per section 8
- Live overlay: node states + LLM streaming + edges animate per section 7
- **Outcome:** full editor + execution UX, no backend needed. Demos end-to-end.
- **Shipped:** `frontend/src/components/pipelines/{PipelinesPage,PipelineEditorPage,PipelineRunsPage,PipelineRunReplayPage,PipelineStatsPage,PendingApprovalsPage,TemplatesModal}.tsx`; `canvas/{PipelineCanvas,NodePalette,ConfigPanel,ExecutionLog,QuickInsertPopover}.tsx` + animated `edges/`; all 8 node-type folders under `nodes/` (trigger, llm, transform, condition, action, fork, join, approval) each with `*Node.tsx` + `*Config.tsx` + `types.ts`; `mock/MockExecutor.ts` + `llmFixtures.ts`; `validation/{validatePipeline,handleCompatibility,detectCycles}.ts`; `persistence/{pipelineStorage,pipelineStorageRemote,runHistory}.ts`; `replay/{Scrubber,deriveEvents,useReplayDriver}.ts`; `versions/{VersionDiffModal,diffDefinitions}.ts`; `cost/{llmPricing,useRunCost}.ts`; `templates/`, `export/toMermaid.ts`, `dev/SimulatorPanel.tsx`. Contract test `pipelineExecutor.contract.test.ts` passing.

### Phase 2 — Observability shell (weeks 6–12, overlapping) [✅ Done]
- `/observability` route with subpages per section 3
- All panels built against a hard-coded `ClusterDashboard` JSON fixture (type from distributed-core)
- Node grid, health indicators, hotspot table, alerts, regions
- EventBus timeline component with scrubbing (localStorage-backed runs at first)
- Metric graph component (line charts, stacked areas)
- Chaos panel UI (buttons are no-ops initially)
- **Outcome:** observability UX complete before backend exists.
- **Shipped:** `frontend/src/components/observability/{ObservabilityLayout,DashboardPage,NodesPage,EventsPage,MetricsPage}.tsx`; `components/{KPICard,NodeGrid,NodeGridTile,ActiveRunsTable,AlertsPanel,ChaosPanel,EventTimeline,EventDetailPane,MetricCard,MetricsGraph}.tsx`; `context/ObservabilityContext.tsx`; `fixtures/dashboardFixture.ts`; `hooks/{useDashboard,useMetricsHistory,usePipelineMetrics,useAlertToasts}.ts`. Backend `observabilityRouter` (`/api/observability/dashboard`, `/api/observability/metrics`) returns deterministic-bucketed stub data so dashboards light up without a live cluster.

### Phase 3 — PipelineModule in distributed-core (weeks 10–18) [🟡 Partial]
- New module: `distributed-core/src/applications/pipeline/PipelineModule.ts`
- `PipelineDefinition` and `PipelineRun` as `ResourceRouter`-owned resources
- `EventBus<PipelineEventMap>` with WAL at `./wal/pipelines.wal`
- `CheckpointWriter` every N events
- LLM step: `@anthropic-ai/sdk` / Bedrock SDK, wrapped in `RetryManager` + `CircuitBreaker`
- Approval step: awaits `resolveApproval` message from gateway
- Shared contract test (`pipelineExecutor.contract.test.ts`) — must pass against both `MockExecutor` and `PipelineModule`
- Local test: `createCluster({ size: 3 })`, trigger 10 runs, verify distribution + failover
- **Status:** owned by the distributed-core sibling-repo session. LLM client implementations have already been split out of the kernel into social-api (`social-api/src/pipeline/{LLMClient,AnthropicLLMClient,BedrockLLMClient,createLLMClient}.ts`) so the kernel stays SDK-free. Awaiting: `exports` map publish from distributed-core, the 5 PipelineModule API additions agreed cross-repo (see §11.5), and `examples/pipelines/bootstrap.ts`.

### Phase 4 — Gateway bridge (weeks 16–22) [🔵 Prep done, awaiting Phase 3]
- Embed `createCluster` in social-api startup (in-memory transport)
- `pipeline-bridge.ts`: `EventBus.subscribeAll` → gateway WebSocket broadcast on `pipeline:events`
- REST endpoints: `POST /api/pipelines/:id/runs`, `POST /api/pipelines/:runId/approvals`, `GET /api/observability/dashboard`
- Frontend: swap `MockExecutor` for real WebSocket stream behind a feature flag
- **Outcome:** real executions driving the canvas.
- **Shipped (staged for wire-up):**
  - `src/pipeline-bridge/pipeline-bridge.js` — accepts both EventEmitter (Phase 1 simulator) and distributed-core `EventBus.subscribeAll` (Phase 4); `BusEvent` → `PipelineWireEvent` mapper; ring-buffer token-rate counter (1s/10s/60s windows).
  - `src/services/pipeline-service.js` — every WS action implemented (subscribe, unsubscribe, trigger, cancel, resolveApproval, resumeFromStep, getRun, getHistory); pluggable `setPipelineModule()` / `setCancelHandler()` / `setResolveApprovalHandler()` so the kernel can be swapped in without code change.
  - REST surface: `routes/pipelineDefinitions.ts` (CRUD + publish), `routes/pipelineTriggers.ts` (POST runs, GET run snapshot, GET history, POST approvals), `routes/pipelineMetrics.ts` (`/api/pipelines/metrics` + `/api/observability/dashboard|metrics`). All write endpoints use Redis-backed `middleware/idempotency.ts` (24h TTL, body-hash conflict detection, in-memory fallback for tests).
  - `social-api/src/pipeline/createLLMClient.ts` — `PIPELINE_LLM_PROVIDER` env-var dispatcher (anthropic / bedrock).
  - Frontend: `usePipelineSource.ts` + `WebSocketEventAdapter.ts` flip to WS at `VITE_PIPELINE_SOURCE=websocket`; `PipelineService` shim contract documented in `pipelineTriggers.ts`.

### Phase 5 — WAL replay, chaos demos, gateway consolidation (weeks 22+) [⏸ Deferred]
- `/pipelines/:id/runs/:runId` wired to checkpoint + WAL replay (millisecond seek)
- Chaos panel calls `ChaosInjector` — inject latency/partitions/node kill, watch runs reassign
- Scheduled-trigger node activated (distributed cron)
- Optional: migrate gateway's Redis pubsub/presence/channels to distributed-core `PubSubManager`/`PresenceManager`/`ChannelManager`
- Metrics export to Prometheus via `MetricsExporter`
- **Status:** not started. Frontend Chaos panel exists as UI shell only; replay page reads from in-browser run history (Phase 1 stand-in for WAL).

### 10.6 Phase 4 wire-up checklist

Do-exactly-this sequence agreed with the distributed-core sibling session on 2026-04-25 (see §11.5 "Resolved 2026-04-25" for the WHY behind each step). Execute top-to-bottom; do not reorder.

**Phase-4-A status (2026-04-26): SHIPPED** at commit `d64e21c`. The full bootstrap-through-bridge-wiring path is in production; what's outstanding is Phase-4-B real-credential E2E and the gateway-process IPC plumbing. File map of what landed:

| Step | Status | Lands in |
|---|---|---|
| 1. Pull `distributed-core` | ✓ at SHA `4833c3a` (frontdoor exposed at root) |
| 2. Install via `file:` protocol | ✓ | `social-api/package.json` |
| 3. Bump `redis@4` → `redis@5` | ✓ | `/package.json` + `social-api/package.json` |
| 4. Read reference bootstrap | ✓ | (read-only) |
| 5. Port `bootstrap.ts` | ✓ single-node in-process Cluster + PipelineModule | `social-api/src/pipeline/bootstrap.ts` |
| 6. Wire six bridge surfaces | ✓ wrapper exists; reassigned event subscription deferred to Phase-4-B | `social-api/src/pipeline/createBridge.ts`, `setPipelineBridge` call in `social-api/src/index.ts` |
| 7. Set env vars | ✓ already in `.env.example` | `social-api/.env.example`, `frontend/.env.example` |
| 8. Restart processes | ✓ verified in test boot | `social-api/src/index.ts` graceful shutdown |
| 9. Smoke test (real credentials) | ⏳ Phase-4-B (per-developer; needs real Anthropic key) | — |
| 10. Toggle off mock | ⏳ Phase-4-B follows step 9 | — |

Test coverage shipped alongside: `social-api/src/pipeline/__tests__/bootstrap.test.ts` (real cluster lifecycle, 3 tests) + `social-api/src/pipeline/__tests__/createBridge.test.ts` (mock-PipelineModule surface coverage, 20 tests). `+23` jest tests; full social-api suite at 155/155.

The original 10-step procedure follows for reference (do not re-execute):

1. **Pull `distributed-core`** — `git pull` the sibling repo. Required artifacts: the `Cluster.create({...})` facade, `PipelineModule` with the six bridge surfaces locked below, the `exports` map (root + `./applications/pipeline` + `./gateway` + `./routing` subpaths), and `examples/pipelines/cluster-bootstrap.ts` + `trigger-and-watch.ts`.
2. **Bump `distributed-core` in social-api** — update `social-api/package.json` to the new version (file:/link path), then `npm install` in `social-api/`. social-api stays CJS (`"module": "commonjs"`, no `"type": "module"`); the package's conditional exports (`require → CJS`, `import → ESM`) resolve to CJS automatically. No rename, no `.cjs` shim, no ESM conversion required — we are explicitly the path-(a) consumer.
3. **Bump Redis client to v5** — in both `/package.json` (gateway root) and `social-api/package.json`, bump `redis@^4.6.x` → `redis@^5` and run `npm install` at each. Distributed-core's `RedisPubSubManager` targets v5. Migration is cheap: we only use basic pub/sub + get/set, no RedisJSON / RedisSearch.
4. **Read the reference bootstrap** — open `distributed-core/examples/pipelines/cluster-bootstrap.ts` (exported helper that stands up an N-node in-memory cluster with `PipelineModule` registered + `FixtureLLMClient`; documents the 6-field `ApplicationModuleContext` wiring inline) and `distributed-core/examples/pipelines/trigger-and-watch.ts` (runnable ~16s smoke test, exits 0). The second file is the template for our integration smoke test in step 9.
5. **Port `bootstrap.ts` into social-api** — create `social-api/src/pipeline/bootstrap.ts` modeled on `cluster-bootstrap.ts`. Call `Cluster.create({...})` with this shape:
   - **Required:** `nodeId`, `topic`, `transport`, `registry`.
   - **Phase-4 registry value:** `registry: { type: 'memory' }` (single-node bridge, no durability). Phase-5+ flips to `registry: { type: 'wal', walPath: '<social-api-data>/pipeline-runs.wal' }`. We are NOT using a CRDT registry — no multi-master writes on the same run record; `ResourceRouter` mediates ownership.
   - **Pass from day one:** `metrics` and `logger` (Pino/Winston-shaped). `locks?: { ttlMs?: number }` is optional; leave default unless we hit lock contention.
   - **Defaulted (do not override in Phase 4):** `placement: LocalPlacement`, `failureDetection: { heartbeatMs: 1000, deadTimeoutMs: 6000, activeProbing: true }`, `autoReclaim: { jitterMs: 500 }` (default-on).
   - **RebalancePolicy params (when constructed):** mean-relative formula `abs(localLoad - meanLoad) / max(meanLoad, 1)`, threshold `0.2` (20% deviation from cluster mean), asymmetric direction (only rebalance away from hot nodes), P95 over 60s window for dampening. Load fn: `() => activeRuns` (count of locally-owned pipeline runs). Composite load (`runs + tokensPerSec * weight`) is Phase-5+ only.
   - Resolve `LLMClient` via the existing `social-api/src/pipeline/createLLMClient.ts` factory (already SDK-aware via `PIPELINE_LLM_PROVIDER`). The kernel stays SDK-free.
   - Export the constructed `PipelineModule` instance into module-scoped state for the bridge wiring in step 6.
6. **Wire the six PipelineModule bridge surfaces** — at gateway startup, plug the `PipelineModule` instance from step 5 into the existing bridge / service shims. All six surfaces are confirmed shipped on `PipelineModule` (last cross-repo SHA used: `7eae4f2`):
   - `getRun(runId)` — single-run snapshot.
   - `getHistory({ pipelineId, limit?, cursor? })` — historical runs.
   - `listActiveRuns()` — currently-executing runs across this node.
   - `getMetrics()` — includes `runsAwaitingApproval: number` count.
   - `getPendingApprovals(): PendingApprovalRow[]` — synchronous, in-memory, per-node. `PendingApprovalRow = { runId, stepId, pipelineId, approvers: ApprovalNodeData['approvers'], message?, requestedAt: ISO 8601 }`. Bridge merges across cluster nodes; no dedup needed (each row appears exactly once).
   - `pipeline.run.reassigned` event — payload `{ runId, from: string, to: string, at: string }`. `from`/`to` are raw cluster node UUIDs. `to === from` is a Phase-4 placeholder; real reassignment lands in Phase-5.

   Wire in: `setPipelineBridge(...)` in `pipelineTriggers.ts`; `setPipelineModule(...)` / `setResolveApprovalHandler(...)` / `setCancelHandler(...)` on `pipeline-service.js`. Bridge translation between distributed-core's colon-form (`pipeline:run:reassigned`) and our dot-form `PipelineEventMap` types (`pipeline.run.reassigned`) is already handled by `mapBusEventToWireEvent` in `src/pipeline-bridge/pipeline-bridge.js`.
7. **Set env vars** — on the gateway / social-api side: `PIPELINE_LLM_PROVIDER=anthropic` (or `bedrock`). On the frontend build: `VITE_PIPELINE_SOURCE=websocket`.
8. **Restart processes** — bring up social-api + websocket-gateway with the new env. The in-memory cluster boots inside the social-api process.
9. **Smoke test** — flip `VITE_PIPELINE_SOURCE=websocket` and trigger a run via `POST /api/pipelines/:id/runs`. Use `trigger-and-watch.ts` as the template. Confirm:
   - `BusEvent`s flow through the bridge and hit `pipeline:all` / `pipeline:run:{runId}` channels.
   - Frontend dedupe key `(runId, stepId, version)` deduplicates correctly. `BusEvent.version` is a per-`EventBus`-instance monotonic counter, restored from max-persisted-version on `start()` once WAL is enabled (Phase-5); `replay(fromVersion, handler)` delivers events with their ORIGINAL version (no re-publishing), so the dedupe key is stable across replay. Phase-5 checkpoint resume gets fresh higher versions — that's intentional, dedupe naturally accepts as new work.
   - Canvas animates in real time.
10. **Toggle off the mock** — once stable, the frontend `MockExecutor` becomes dev-only (`SimulatorPanel`); production reads exclusively from the WS adapter.

---

## 11. Killer demos

1. **Mid-run failover** — kill a node via Chaos panel. Watch its 3 in-flight runs get orphaned and re-picked-up by surviving nodes. EventBus timeline shows every transfer event. Canvas nodes keep animating.
2. **Partition recovery** — inject a network partition. Watch the cluster detect minority partition, pause writes, recover on heal.
3. **Historical scrub** — open a completed run, drag the scrubber back to step 3, canvas re-animates from that point. Checkpoint + WAL makes it instant.
4. **Approval + LLM loop** — document-finalize trigger → LLM summary → Approval (human reviews, gets the LLM summary in context) → Action (post comment with approved text).

### 11.5 Cross-repo coordination resolved

State of the websocket-gateway ↔ distributed-core agreement, after the Phase 4 prep pass:

- The other session is shipping the `exports` map plus `examples/pipelines/` to unblock Phase 4 wire-up — once landed, §10.6 step 1 starts.
- 5 `PipelineModule` API additions agreed cross-repo: `getRun(runId)`, `getHistory(runId, fromVersion)`, `listActiveRuns()`, a `runsAwaitingApproval` field on `getMetrics()`, and a `pipeline.run.reassigned` event (paired with `pipeline.run.orphaned`, see §17.9 ordering invariants).
- Dot-form event names (`pipeline.run.started`, `pipeline.step.completed`, …) are retained on the wire; deprecation deferred — both repos and the frontend wire-event mapper key off this shape.
- `PIPELINE_LLM_PROVIDER` env var lives on the websocket-gateway side, consumed by `social-api/src/pipeline/createLLMClient.ts`. The kernel stays SDK-free; provider selection is a host-process concern.

#### Resolved 2026-04-25

Outcomes of the two-consumer (websocket-gateway + live-video-streaming) coordination round with distributed-core. One-line entries; consult §10.6 for the executable checklist, the architecture sections (§1, §2, §4, §5) for upstream context.

- **Six bridge surfaces locked on `PipelineModule`** — `getRun(runId)`, `getHistory({ pipelineId, limit?, cursor? })`, `listActiveRuns()`, `getMetrics()` (now includes `runsAwaitingApproval: number`), `getPendingApprovals(): PendingApprovalRow[]` (shipped at distributed-core SHA `7eae4f2`), and `pipeline.run.reassigned` event. Supersedes the original 5-API list above; `getHistory` signature was clarified to `{ pipelineId, limit?, cursor? }`.
- **`PendingApprovalRow` shape** — `{ runId, stepId, pipelineId, approvers: ApprovalNodeData['approvers'], message?, requestedAt: ISO 8601 }`. Synchronous, in-memory, per-node; bridge merges across cluster nodes with no dedup (each row appears exactly once).
- **`pipeline.run.reassigned` payload** — `{ runId, from: string, to: string, at: string }`. `from`/`to` are raw cluster node UUIDs. `to === from` is a Phase-4 placeholder; real reassignment lands in Phase-5.
- **§5 `Cluster.create({...})` facade shape locked** — required: `nodeId`, `topic`, `transport`, `registry`. Defaulted: `placement: LocalPlacement`, `failureDetection: { heartbeatMs: 1000, deadTimeoutMs: 6000, activeProbing: true }`, `autoReclaim: { jitterMs: 500 }` (default-on). Optional: `metrics?`, `logger?` (Pino/Winston-shaped), `locks?: { ttlMs?: number }`. Phase-4 from our side passes `metrics` + `logger` from day one.
- **§1 fencing-token / registry trajectory** — Phase-4: `registry: { type: 'memory' }`; Phase-5+: `registry: { type: 'wal', walPath: '<social-api-data>/pipeline-runs.wal' }`. NOT using a CRDT registry — no multi-master writes on the same run record; `ResourceRouter` mediates ownership.
- **§2 RebalancePolicy** — formula `abs(localLoad - meanLoad) / max(meanLoad, 1)`, threshold `0.2`, asymmetric direction (only rebalance away from hot nodes), P95 over 60s window for dampening. Load fn: `() => activeRuns`. Composite (`runs + tokensPerSec * weight`) deferred to Phase-5+.
- **§4 Redis backplane bump** — Phase-4 wire-up PR will bump `redis@^4.6.x` → `redis@^5` in both `/package.json` and `social-api/package.json` (distributed-core's `RedisPubSubManager` target). Cheap migration: only basic pub/sub + get/set in use.
- **Imports / exports map** — distributed-core ships conditional exports per subpath (`require → CJS`, `import → ESM`). social-api is CJS (no `"type": "module"`) → resolves to CJS automatically. We are the path-(a) consumer; no rename, no `.cjs` shim, no ESM conversion.
- **Module subpaths exposed by distributed-core** — `.` (root: `EventBus`, `ResourceRouter`, `FixtureLLMClient`, `LLMClient` type), `./applications/pipeline` (`PipelineModule`, `PipelineExecutor`, types), `./gateway` (pubsub, presence, channel, queue, `MessageRouter`), `./routing` (`ResourceRouter`, `ForwardingRouter`, placement). Most consumers should import from root; subpaths exist for narrow imports only.
- **Reference artifacts in distributed-core** — `examples/pipelines/cluster-bootstrap.ts` (exported helper standing up an N-node in-memory cluster with `PipelineModule` + `FixtureLLMClient`; documents the 6-field `ApplicationModuleContext` wiring inline) and `examples/pipelines/trigger-and-watch.ts` (runnable ~16s smoke test, exits 0; template for our integration smoke test). Read both before writing `social-api/src/pipeline/bootstrap.ts`.
- **WAL replay / dedupe stability** — `BusEvent.version` is a per-`EventBus`-instance monotonic counter, restored from max-persisted-version on `start()` with WAL. `replay(fromVersion, handler)` delivers events with their ORIGINAL version (no re-publishing). Frontend dedupe key `(runId, stepId, version)` is correct and stable across replay. Phase-5 checkpoint resume gets fresh higher versions — intentional, dedupe naturally accepts as new work.
- **Event-name canonicalization** — distributed-core `EventBus` emits colon-form (`pipeline:run:reassigned`); our `PipelineEventMap` types use dot-form (`pipeline.run.reassigned`). Bridge translation in `src/pipeline-bridge/pipeline-bridge.js` via existing `mapBusEventToWireEvent` handles the canonicalization. No protocol change required.

---

## 12. Deletion scope — Phase 0 checklist

### 12.1 Delete entirely (6 files)

- [ ] `frontend/src/hooks/useWorkflows.ts`
- [ ] `frontend/src/components/doc-editor/WorkflowPanel.tsx`
- [ ] `social-api/src/repositories/ApprovalWorkflowRepository.ts`
- [ ] `social-api/src/routes/approvalWorkflows.ts`
- [ ] `social-api/src/services/WorkflowEngine.ts`
- [ ] `frontend/src/components/doc-types/__tests__/DocumentTypeWizard.test.tsx` — if ≥90% of cases are workflow-focused; otherwise gut the workflow-specific `describe` block

### 12.2 Modify — frontend

- [ ] `frontend/src/components/doc-editor/DocumentEditorPage.tsx`
  - Remove `import WorkflowPanel`, `showWorkflows`, `toggleWorkflows`, `handleToggleWorkflows`, and the workflow sidebar conditional render block
- [ ] `frontend/src/types/documentType.ts`
  - Remove `WorkflowApprover`, `WorkflowStep`, `DocumentTypeWorkflow` interfaces
  - Remove `workflows` field from `DocumentType`
  - Remove factory helpers: `makeEmptyWorkflow`, `makeEmptyStep`, `makeEmptyApprover`
- [ ] `frontend/src/components/doc-types/DocumentTypeWizard.tsx`
  - Remove `'Workflows'` from `STEP_LABELS`
  - Remove the entire Step 4 section: `ApproverEdit`, `StepEdit`, `WorkflowCard`, `Step4Workflows` components
  - Remove workflow state, handlers, and `workflows` from `onSave` payload
- [ ] `frontend/src/components/doc-editor/useSidebarPanels.ts`
  - Remove `'workflows'` from `SidebarPanel` union, `showWorkflows`, `toggleWorkflows`

### 12.3 Modify — backend (social-api)

- [ ] `social-api/src/repositories/index.ts` — remove `ApprovalWorkflowRepository` import + export, `approvalWorkflowRepo` instance
- [ ] `social-api/src/routes/index.ts` — remove `approvalWorkflowsRouter`, `pendingWorkflowsRouter` wiring
- [ ] `social-api/src/services/broadcast.ts` — remove `'doc:workflow_advanced'`, `'doc:workflow_completed'` from `SocialEventType`
- [ ] `social-api/src/services/document-exporter.ts` — remove `ApprovalWorkflow` import, `workflows` field from `DocumentExportData`, workflow export in JSON and Markdown builders
- [ ] `social-api/src/mcp/document-mcp-server.js` — remove tool definitions: `document_get_workflow`, `document_advance_workflow`, `my_pending_workflows`
- [ ] `social-api/src/mcp/tool-handler.js` — remove case branches and methods: `getWorkflow()`, `advanceWorkflow()`, `myPendingWorkflows()`

### 12.4 Modify — tests

- [ ] `frontend/src/components/doc-editor/useSidebarPanels.test.ts` — strip `showWorkflows` / `toggleWorkflows` / `'workflows'` cases
- [ ] `frontend/src/hooks/__tests__/useDocumentTypes.test.ts` — strip `workflows: []` from fixtures; remove workflow validation tests
- [ ] `frontend/src/components/doc-types/__tests__/DocumentTypesPage.test.tsx` — remove "displays workflow count" test; strip `workflows` from fixtures
- [ ] `test/document-exporter.test.ts` — strip `workflows: []` from fixtures

### 12.5 Modify — infrastructure

- [ ] `infra/dynamodb-schemas.json` — remove `approval-workflows` table definition block

### 12.6 Verification after Phase 0

- [ ] `npm run build` clean in `frontend/`
- [ ] `npm run build` clean in `social-api/`
- [ ] `npm test` passes (or the remaining tests after deletion pass)
- [ ] Manual smoke test: create a doc type, create a document, edit sections, comment — all still work
- [ ] `grep -ri "workflow" frontend/src social-api/src | grep -v node_modules` returns only incidental matches (e.g., unrelated comments), not structural references

---

## 13. Frontend state management

Plain React Context + hooks. No external state library. Context slices split by scope; `useEffect` handles subscriptions with cleanup.

### 13.1 Three context slices

| Context | Scope | Provider mounted at | Purpose |
|---|---|---|---|
| `EventStreamContext` | App singleton | `App.tsx` (under `WebSocketProvider`) | Single WS dispatcher — incoming `pipeline:event` frames fan out to registered listeners |
| `PipelineEditorContext` | Per `/pipelines/:id` | `PipelineEditorPage.tsx` | The `PipelineDefinition`, dirty flag, selection, validation, persistence |
| `PipelineRunsContext` | Per `/pipelines/:id` | `PipelineEditorPage.tsx` (below editor provider) | Active + recent runs for this pipeline; subscribes to `EventStream` |
| `ObservabilityContext` | Per `/observability/*` | `ObservabilityLayout.tsx` | `ClusterDashboard` snapshot + subscribers; REST polling + WS push |

### 13.2 EventStreamContext — the key abstraction

The dispatcher pattern both the canvas and the observability dashboard build on. Mock (Phase 1) and WebSocket (Phase 4+) are interchangeable sources.

```ts
interface EventStreamValue {
  // Listener registration — cleanup returned for useEffect
  subscribe<K extends keyof PipelineEventMap>(
    type: K | '*',
    handler: (payload: PipelineEventMap[K]) => void,
  ): () => void;

  // Server-side subscription control (no-op in mock mode)
  subscribeToRun(runId: string): () => void;
  subscribeToAll(): () => void;
  subscribeToApprovals(): () => void;

  // Client → server commands
  triggerRun(pipelineId: string, payload?: Record<string, unknown>): Promise<string>;
  cancelRun(runId: string): void;
  resolveApproval(runId: string, stepId: string, decision: 'approve' | 'reject', comment?: string): void;
  requestResumeFromStep(runId: string, fromNodeId: string): void;

  // Source toggle
  source: 'mock' | 'websocket';
}
```

### 13.3 Hook surface

```ts
// Editor (scoped to /pipelines/:id)
usePipelineEditor():       PipelineEditorValue;
useSelectedNode():         PipelineNode | null;
usePipelineValidation():   ValidationResult;        // memo of validatePipeline(definition)

// Runs
useRun(runId: string):               PipelineRun | null;
useRunsForPipeline(pipelineId):      PipelineRun[];
usePendingApprovals():               PendingApproval[];

// Event stream
useEventStream<K>(type: K | '*', handler): void;   // lifecycle-safe subscribe

// Observability
useDashboard():            ClusterDashboard | null;
useNodeSummary(nodeId):    NodeSummary | null;
```

### 13.4 Persistence strategy

- Definitions: `localStorage` keyed `ws_pipelines_v1:{pipelineId}`, debounced 500ms after last edit via `useEffect`.
- Index: `ws_pipelines_v1_index` — `{ id, name, updatedAt }[]` so the list view doesn't parse every definition.
- Runs: ephemeral in memory in Phase 1; last 50 kept per pipeline. Phase 3+ migrates to distributed-core `StateStore`.

### 13.5 Re-render discipline

- Editor context splits the volatile bits (`selectedNodeId`, viewport) from the stable definition via **two** nested providers so `NodePalette` doesn't re-render on every node click.
- Selector hooks (`useSelectedNode`) memo derived data.
- React Flow's own `useNodesState` / `useEdgesState` handle canvas reactivity; we sync its state to our definition on change.

---

## 14. WebSocket protocol

Extends the existing gateway message convention `{ service, action, channel?, ...payload }`. New service: `pipeline`. Messages designed so the `MockExecutor.onEvent` callback (Phase 1) and the WebSocket frame pipeline (Phase 4) are interchangeable — swapping the source layer requires no changes in UI components.

### 14.1 Channels

| Channel | Events delivered | Subscribers |
|---|---|---|
| `pipeline:run:{runId}` | All events for one run | Editor canvas when `/pipelines/:id` has an active run |
| `pipeline:all` | Every pipeline event | Observability dashboard |
| `pipeline:approvals` | `pipeline.approval.requested`, `pipeline.approval.recorded` | Navbar badge, pending-approvals panel |

### 14.2 Client → server

```jsonc
// Subscription
{ "service": "pipeline", "action": "subscribe",   "channel": "pipeline:run:abc123" }
{ "service": "pipeline", "action": "unsubscribe", "channel": "pipeline:run:abc123" }

// Execution control
{ "service": "pipeline", "action": "trigger",    "pipelineId": "p1", "triggerPayload": { ... },
  "correlationId": "ui-1234" }
{ "service": "pipeline", "action": "cancel",     "runId": "abc123" }
{ "service": "pipeline", "action": "resolveApproval",
  "runId": "abc123", "stepId": "approval-1", "decision": "approve", "comment": "lgtm" }
{ "service": "pipeline", "action": "resumeFromStep", "runId": "abc123", "fromNodeId": "llm-2" }

// Queries
{ "service": "pipeline", "action": "getRun",     "runId": "abc123" }
{ "service": "pipeline", "action": "getHistory", "runId": "abc123", "fromVersion": 0 }  // WAL replay
```

### 14.3 Server → client

One primary event frame — a direct projection of `PipelineEventMap`:

```jsonc
{ "type": "pipeline:event",
  "eventType": "pipeline.step.started",
  "payload":   { "runId": "abc123", "stepId": "llm-1", "nodeType": "llm", "at": "2026-04-23T…" },
  "channel":   "pipeline:run:abc123" }
```

Supporting frames:

```jsonc
{ "type": "pipeline:ack",
  "action": "trigger",
  "correlationId": "ui-1234",
  "runId": "abc123" }

{ "type": "pipeline:snapshot", "runId": "abc123", "run": { /* PipelineRun */ } }

{ "type": "pipeline:history",  "runId": "abc123",
  "fromVersion": 0, "events": [ /* BusEvent[] */ ] }

{ "type": "pipeline:error",
  "error": "invalid_pipeline: CYCLE_DETECTED",
  "correlationId": "ui-1234" }
```

### 14.4 MockExecutor <—> WS adapter

Both sources end at `EventStreamContext.subscribe(type, handler)`. The adapter boundary:

```ts
// Phase 1 source
mockExecutor.onEvent = (type, payload) => eventStream.dispatch(type, payload);

// Phase 4 source
onMessage((msg) => {
  if (msg.type === 'pipeline:event') {
    eventStream.dispatch(msg.eventType, msg.payload);
  }
});
```

UI components never see the difference.

### 14.5 Backpressure

- Server-side: distributed-core's `BackpressureController` already batches per-channel.
- Client-side: `requestAnimationFrame`-coalesced UI updates on high-frequency events (`pipeline.llm.token` — up to 40/s per active run × many runs). React Flow node re-renders are the bottleneck.

---

## 15. Directory layout

Feature-colocated, matching the existing `doc-editor/`, `doc-types/` conventions.

```
frontend/src/
├── components/
│   ├── pipelines/
│   │   ├── PipelinesPage.tsx              # /pipelines — list view
│   │   ├── PipelineEditorPage.tsx         # /pipelines/:id
│   │   ├── PipelineRunReplayPage.tsx      # /pipelines/:id/runs/:runId
│   │   ├── canvas/
│   │   │   ├── PipelineCanvas.tsx         # React Flow wrapper
│   │   │   ├── NodePalette.tsx
│   │   │   ├── ConfigPanel.tsx            # dispatches to node-type configs
│   │   │   ├── ExecutionLog.tsx
│   │   │   └── edges/
│   │   │       └── AnimatedEdge.tsx
│   │   ├── nodes/
│   │   │   ├── index.ts                   # nodeTypes registry
│   │   │   ├── BaseNode.tsx               # shared state/visual wrapper
│   │   │   ├── trigger/
│   │   │   │   ├── TriggerNode.tsx
│   │   │   │   ├── TriggerConfig.tsx
│   │   │   │   └── types.ts
│   │   │   ├── llm/             ...
│   │   │   ├── transform/       ...
│   │   │   ├── condition/       ...
│   │   │   ├── action/          ...
│   │   │   ├── fork/            ...
│   │   │   ├── join/            ...
│   │   │   └── approval/        ...
│   │   ├── context/
│   │   │   ├── PipelineEditorContext.tsx
│   │   │   ├── PipelineRunsContext.tsx
│   │   │   └── EventStreamContext.tsx
│   │   ├── hooks/
│   │   │   ├── usePipelineEditor.ts
│   │   │   ├── useRun.ts
│   │   │   ├── useEventStream.ts
│   │   │   ├── usePipelineValidation.ts
│   │   │   └── usePendingApprovals.ts
│   │   ├── validation/
│   │   │   ├── validatePipeline.ts
│   │   │   ├── detectCycles.ts
│   │   │   └── handleCompatibility.ts
│   │   ├── mock/
│   │   │   └── MockExecutor.ts
│   │   ├── persistence/
│   │   │   └── pipelineStorage.ts         # localStorage + index helpers
│   │   └── __tests__/
│   │       ├── MockExecutor.test.ts
│   │       ├── validatePipeline.test.ts
│   │       ├── detectCycles.test.ts
│   │       └── pipelineExecutor.contract.test.ts    # shared with backend in Phase 3
│   ├── observability/
│   │   ├── ObservabilityLayout.tsx        # /observability layout (sub-nav)
│   │   ├── DashboardPage.tsx              # /observability
│   │   ├── NodesPage.tsx                  # /observability/nodes
│   │   ├── EventsPage.tsx                 # /observability/events
│   │   ├── MetricsPage.tsx                # /observability/metrics
│   │   ├── components/
│   │   │   ├── NodeGrid.tsx
│   │   │   ├── EventTimeline.tsx
│   │   │   ├── MetricsGraph.tsx
│   │   │   ├── ChaosPanel.tsx
│   │   │   └── AlertsPanel.tsx
│   │   ├── context/
│   │   │   └── ObservabilityContext.tsx
│   │   ├── hooks/
│   │   │   ├── useDashboard.ts
│   │   │   └── useMetricsHistory.ts
│   │   ├── fixtures/
│   │   │   └── dashboardFixture.ts        # Phase 2 stand-in
│   │   └── __tests__/
│   └── AppLayout.tsx                      # add Pipelines + Observability nav items
└── types/
    └── pipeline.ts                        # all types from §6
```

Conventions:
- Each node type is a folder: component, config panel, local types. Registry assembled in `nodes/index.ts`.
- Contexts live beside the route pages that mount them. Only `EventStreamContext` is app-level.
- `__tests__/` per feature folder; the shared contract test lives in `pipelines/__tests__/` and is imported by the distributed-core test suite in Phase 3.

---

## 16. Pipeline validation

Single pure function `validatePipeline(def: PipelineDefinition): ValidationResult`. Called by `usePipelineValidation()`, memoed on the definition. Errors block **publish** (and therefore run), not save.

### 16.1 Types

```ts
export interface ValidationIssue {
  code: ValidationCode;       // machine-readable
  message: string;            // human-readable
  severity: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  field?: string;             // for config errors
}

export type ValidationCode =
  | 'NO_TRIGGER' | 'MULTIPLE_TRIGGERS'
  | 'CYCLE_DETECTED'
  | 'INVALID_HANDLE'
  | 'MISSING_CONFIG'
  | 'APPROVAL_NO_APPROVERS'
  | 'JOIN_INSUFFICIENT_INPUTS'
  | 'ORPHAN_NODE'
  | 'DEAD_END'
  | 'UNUSED_FORK_BRANCH'
  | 'UNUSED_CONDITION_BRANCH';

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValid: boolean;     // errors.length === 0
  canPublish: boolean;  // errors.length === 0
}
```

### 16.2 Rules

**Errors:**

| Code | Condition |
|---|---|
| `NO_TRIGGER` | zero `Trigger` nodes |
| `MULTIPLE_TRIGGERS` | more than one `Trigger` node |
| `CYCLE_DETECTED` | DFS finds a back-edge (emit on the back-edge's `edgeId`) |
| `INVALID_HANDLE` | edge connects handles not in §5 validity table |
| `MISSING_CONFIG` | required field empty for node type (per-type rule table) |
| `APPROVAL_NO_APPROVERS` | `Approval` node with `approvers.length === 0` |
| `JOIN_INSUFFICIENT_INPUTS` | `Join` node with fewer than 2 incoming edges |

Per-type required fields:
- `LLM`: `provider`, `model`, `systemPrompt`, `userPromptTemplate`
- `Transform`: `transformType`, `expression`
- `Condition`: `expression`
- `Action`: `actionType` + action-specific required fields (varies)
- `Fork`: `branchCount ≥ 2`
- `Join`: `mode`, `mergeStrategy`, and `n` when `mode === 'n_of_m'`
- `Approval`: `approvers.length ≥ 1`, `requiredCount ≥ 1`

**Warnings** (visual indicators, no save/publish block):

| Code | Condition |
|---|---|
| `ORPHAN_NODE` | node unreachable from Trigger via forward BFS |
| `DEAD_END` | node has no outgoing edges AND isn't a terminal node type (currently none are terminal; all dead-ends warn) |
| `UNUSED_FORK_BRANCH` | `Fork` output handle with no connected edge |
| `UNUSED_CONDITION_BRANCH` | `Condition`'s `true` or `false` handle with no connection |

### 16.3 Algorithmic notes

- **Cycle detection:** iterative DFS with WHITE/GRAY/BLACK coloring; back-edge to a GRAY node triggers `CYCLE_DETECTED` with the offending `edgeId`.
- **Reachability:** BFS from the `Trigger` node following outgoing edges (respecting handle semantics for `Condition` — both branches count as reachable since either may fire at runtime).
- Both run in O(V + E); even a large pipeline (1000 nodes) validates in sub-ms.

### 16.4 Save vs Publish lifecycle

```
[Draft]
   │  save() — any state, validation non-blocking, writes to localStorage, version++
   │
   │  publish() — requires errors.length === 0
   ▼
[Published]  status: 'published', publishedVersion: snapshot of current version
   │
   │  edit — transitions back to 'draft' implicitly, publishedVersion retained
   ▼
[Draft (with publishedVersion)]  — runs continue triggering on publishedVersion until re-published
```

`PipelineDefinition` gains:
```ts
status: 'draft' | 'published';
publishedVersion?: number;     // set on first publish; updated on each publish
```

Trigger resolution at runtime: uses the **published** version (by reading `publishedVersion`). The draft is never executed.

---

## 17. Executor contract — edge cases

These behaviors are codified in `pipelineExecutor.contract.test.ts`. Both `MockExecutor` (Phase 1) and the distributed-core `PipelineModule` (Phase 3) must pass the same suite.

### 17.1 Fork with partial branch failure

- Each `Fork` output edge starts an independent execution path.
- A branch is `completed` when it reaches a terminal node (no outgoing edges).
- A branch is `failed` when any node on the path emits `pipeline.step.failed` and no `error`-output path recovers.
- A branch is `cancelled` if the run is cancelled or if Join-mode `any` has already fired.
- Downstream `Join` sees the status of each connected incoming branch.

### 17.2 Join modes

| Mode | Fires when | Behavior on failed inputs |
|---|---|---|
| `all` | every connected input arrives (completed or failed) | Join emits `step.failed` if any input failed; otherwise `step.completed` with merged context |
| `any` | first `completed` input arrives | Remaining branches receive `pipeline.step.cancelled`; Join fires on the first success |
| `n_of_m` | N inputs have `completed` | Remaining branches cancelled; fires with N collected contexts |

All join modes emit `pipeline.join.waiting` on each input arrival (observability signal) and `pipeline.join.fired` on completion.

### 17.3 Approval timeout

- `timeoutMs` unset → wait forever.
- `timeoutMs` set → schedule a timer. On fire: apply `timeoutAction`:
  - `'reject'` — emit `pipeline.approval.recorded` with `userId: 'system:timeout', decision: 'reject'`
  - `'approve'` — same with `decision: 'approve'`
  - `'escalate'` — **deferred to Phase 5** (requires role hierarchy)
- Actual user resolution before timeout cancels the timer.

### 17.4 Cancel

- Cancels the **run**, not a branch.
- In-flight steps: per-step `pipeline.step.cancelled`.
- Pending steps: `pipeline.step.skipped` with `reason: 'run_cancelled'`.
- Final event: `pipeline.run.cancelled`.
- **Side effects already committed (Actions that completed) are NOT rolled back.** Caller is responsible for compensating actions.
- Context frozen at the moment of cancel; available in the run snapshot.

### 17.5 Pause / Resume (Phase 3+)

Not in Phase 1. When introduced:

- `pause(runId)`: stop scheduling new steps; in-flight steps run to completion; state is checkpointed via `CheckpointWriter`.
- `resume(runId)`: load latest checkpoint, rebuild the frontier, schedule pending steps.
- Events: `pipeline.run.paused` / `pipeline.run.resumed`.
- Phase 1 `MockExecutor` exposes the API as no-ops (or "stop scheduling, don't persist") so UI affordances exist.

### 17.6 Retry

- **Automatic** intra-step retry: handled inside node execution (`RetryManager` for LLM/Action). Transparent to run-level state.
- **Manual retry-from-node:** user clicks "⟳ Retry from here" on a failed node. Emits `pipeline.run.resumeFromStep` with `fromNodeId`. Executor re-runs that node and proceeds forward. Upstream steps are not re-run; their recorded outputs are reused.
- **Whole-run retry:** "Re-run" button on a failed/completed run. Emits `pipeline.run.retry` with a new `runId`. Original trigger payload is copied; the new run is independent.
- **Auto-retry on orphan** (Phase 3+, distributed-core): `ResourceRouter.resource:orphaned` handler claims the run on a surviving node and resumes from the latest checkpoint.

### 17.7 Idempotency

- Each step attempt has a deterministic id: `{runId}::{nodeId}::{attemptNumber}`.
- Action nodes declare `idempotent: boolean` (config default `false`).
- On retry of a non-idempotent action that has already emitted `pipeline.step.completed`: the executor emits `pipeline.step.skipped` with `reason: 'non_idempotent_already_completed'` and advances.
- Phase 1 mock: flag exists in config; mock always retries regardless (for demo-ability). Real enforcement begins Phase 3.

### 17.8 Context accumulation

- Each step's output is written under `context.steps[stepId] = output` (stable, stepId-keyed, no collisions).
- For convenience, each step also merges into the top-level context — unless the node declares `outputKey`, in which case the merge is scoped: `context[outputKey] = output`.
- Collision detection: if two nodes both target the same top-level key without `outputKey` scoping, validator emits warning (`CONTEXT_KEY_CONFLICT` — add to §16 as a post-Phase-1 refinement).

### 17.9 Ordering invariants (enforced by contract test)

- `pipeline.run.started` precedes every `pipeline.step.started` for that run.
- For each `stepId`, exactly one of `{completed, failed, skipped, cancelled}` terminates it; none may overlap.
- `pipeline.llm.prompt` precedes all `pipeline.llm.token` which precede `pipeline.llm.response` for the same `stepId`.
- `pipeline.approval.requested` precedes any `pipeline.approval.recorded` for the same `stepId`.
- `pipeline.run.completed` / `failed` / `cancelled` are terminal; no further events for that run.
- Orphan → reassigned ordering: `pipeline.run.orphaned` precedes `pipeline.run.reassigned`; steps continue on the new owner.

## 17.10 API spec

- OpenAPI: `social-api/openapi/pipelines.yaml`
- JSON Schema: `schemas/pipeline.schema.json`

These are generated/maintained by hand and must be kept in sync with
`frontend/src/types/pipeline.ts` per `TYPES_SYNC.md`. A CI check (see
`scripts/check-types-sync.mjs`) catches drift between the type file and
the schema.

## 17.11 Operational instrumentation

These exist so Phase 4 wiring is observable from the operator's seat without needing to attach a debugger.

- **`/api/pipelines/health`** — health endpoint that surfaces bridge state, last-seen BusEvent timestamp, and PipelineModule liveness. *(Planned alongside §10.6 step 5; will join `routes/pipelineMetrics.ts` so the static `/health` segment registers before the `:pipelineId` mount.)*
- **Bridge token-rate counter** — `PipelineBridge.getTokenRate()` returns `{ perSec1s, perSec10s, perSec60s, windowSize }` from a 5000-entry ring buffer (~2 minutes of headroom at 40 tok/s). Exposed today via the bridge instance; will be lifted into `/api/pipelines/health` when that endpoint lands.
- **Frontend `SourceDiagnosticBanner`** — *(planned, not yet built)*: appears when `VITE_PIPELINE_SOURCE=websocket` is set but no events have arrived in N seconds, so an operator can immediately tell whether the WS path or the kernel is silent. Wires off the existing `EventStreamContext` source flag + last-event-at timestamp.

---

## 18. UI design

This section defines the built surface. Visual-language primitives (§7) supply the vocabulary — node state colors, edge animations, streaming behavior. This section defines the grammar: how pages compose, how interactions unfold, how empty and error states look, how motion is orchestrated.

All measurements assume 1440px as the design target; minimum supported is 1280px. Dark mode deferred to post-Phase-5. Inline-style object pattern, 13px base text, `#646cff` primary, `#e2e8f0` borders, `#f8fafc/#fafbfc` surfaces — consistent with the rest of the app.

### 18.1 Design principles

Eight tiebreakers for in-code decisions. When something feels wrong, check these.

1. **The system is the protagonist.** The user's job is to observe, shape, and intervene. Never force them to drive every click. A pipeline should feel like a living machine, not a form wizard.

2. **Motion conveys state; labels disambiguate.** A running node animates; a completed node settles. Badges and text are supporting cast, not load-bearing. If you removed every text label, status should still be legible.

3. **LLM output is first-class.** Tokens stream inline in the node where the LLM runs, not hidden behind "view response." The graph is the log; the log is the graph.

4. **Never hide the graph.** Config panels slide over; modals are reserved for destructive confirms. The canvas is always visible, always orientable.

5. **Failure is observable, not fatal.** Red borders + inline retry, not alert dialogs. The run continues past errors when it can; when it can't, the failed node is the locus of recovery.

6. **Density over chrome.** The editor is a workshop, not a product page. Tight gutters, information-dense cards, compact toolbars. A screen should feel *rich*, not *airy*.

7. **Read like a dashboard, drive like a workshop.** `/observability` reads — live data, no tools, no CTAs. `/pipelines/:id` works — everything is editable, grabbable, draggable.

8. **Replay is a first-class mode.** Historical runs get the full canvas experience with scrubbing. A completed run should be as inspectable as a live one.

### 18.2 Navigation structure

Top-level app nav gains two entries. AppLayout sub-nav shows context-sensitive children.

```
┌────────────────────────────────────────────────────────────────────┐
│  [Logo]   Documents   Pipelines   Observability   Data Types  ...  │   top nav (40px)
├────────────────────────────────────────────────────────────────────┤
│  [context-sensitive sub-nav — see below]                           │   sub-nav (32px)
└────────────────────────────────────────────────────────────────────┘
```

Sub-nav contents by primary:

| Primary | Sub-nav |
|---|---|
| Pipelines | `All pipelines` · `Pending approvals (N)` |
| Observability | `Dashboard` · `Nodes` · `Events` · `Metrics` |

Pending-approvals badge count in sub-nav is driven by `usePendingApprovals()` subscribing to `pipeline:approvals` channel — badge pulses amber when count increases.

Breadcrumb inside the editor and replay pages: `Pipelines / {pipeline.name} [/ Run {runId}]`. Click segments to navigate.

### 18.3 Route: `/pipelines` — list view

Master-list, single-pane, scrollable.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Pipelines                                              [+ New]       │  header (56px)
├──────────────────────────────────────────────────────────────────────┤
│ [🔍 Search…]  Status: [All ▼]  Trigger: [All ▼]  Sort: [Updated ▼]  │  filter bar (40px)
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────...│
│  │ 📋  Invoice summary  │  │ 🔔  New doc alert    │  │            │
│  │ Published · v4       │  │ Draft · v2           │  │            │   card grid
│  │ ▶ Manual trigger     │  │ 🗎 On doc.finalize   │  │  ...       │
│  │ 7 nodes · 3 runs tod.│  │ 4 nodes · never run  │  │            │
│  │                      │  │                      │  │            │
│  │ [Run] [Edit] [⋯]     │  │ [Edit] [⋯]           │  │            │
│  └──────────────────────┘  └──────────────────────┘  └──────────...│
└──────────────────────────────────────────────────────────────────────┘
```

**Card** (280×160):
- Row 1: large icon (pipeline's emoji/icon, chosen by user or inferred from trigger type), name (bold 14px, ellipsis)
- Row 2: status chip (`Published · v4` in green / `Draft · v2` in gray) — if draft-with-published, show `Draft · v2 (published v1)` in amber
- Row 3: trigger summary icon + text (`▶ Manual` / `🗎 On doc.finalize` / `⏱ Every 15min` / `🔌 Webhook /foo`)
- Row 4 meta: `{nodeCount} nodes · {runsToday} runs today` (or `· never run` if none) — dimmed 12px
- Row 5: action row. Primary button `Run` (only if published, disabled with tooltip otherwise), secondary `Edit`, overflow menu `⋯` (Duplicate, Export JSON, Delete)
- Hover: subtle border-color shift to `#646cff`, 100ms

Grid: `minmax(260px, 1fr)` columns, 16px gap. On narrow viewports collapses to fewer columns; at 1280px ~ 4 columns.

**Filters:**
- Status: All / Draft / Published / With published changes
- Trigger: All / Manual / Document event / Schedule / Webhook
- Sort: Recently updated (default) / Name A-Z / Most runs today / Recently run

**Search:** matches name + description + trigger-config text (e.g., document type names, webhook paths). Client-side since list is small.

**Empty state:**
```
                    ┌─┐
                    │ │
                   ─┤ ├─
                  ╱   ╲
                 ╱  +  ╲
                 ╲     ╱
                  ╲___╱

            No pipelines yet
    Design your first one — from scratch
    or pick a template to start from.

          [+ New pipeline]   [Browse templates]
```
(Templates is a Phase 5+ feature; button shows coming-soon tooltip in Phases 1–4.)

**Loading state:** skeleton cards with shimmer — 6 visible at first paint.

**Error state:** centered error glyph, `"Couldn't load pipelines"`, `[Retry]` button. Details below in small text if available.

### 18.4 Route: `/pipelines/:id` — editor

The densest surface in the app. Four regions — top bar, palette, canvas, config panel — plus a collapsible execution log. The top bar and palette are fixed; the config panel is a slide-over; the log is a bottom strip.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Invoice summary    ✓ Saved    v4 · Published        [▶ Run]  [⋯]        │  top bar (44)
├────────┬──────────────────────────────────────────────────────┬────────────┤
│ 🔍     │                                                      │            │
│ ┌────┐ │                                                      │ [×] LLM    │
│ │Trg │ │                                                      │            │
│ ├────┤ │            [React Flow canvas]                       │ Config     │
│ │LLM │ │           — background: dot grid                     │            │
│ ├────┤ │           — minimap: bottom-right (toggleable)       │ Provider   │
│ │Trf │ │           — controls: bottom-left                    │ [Anthrop▼] │
│ ├────┤ │           — fit-view: top-right floating             │            │
│ │Cnd │ │                                                      │ Model      │
│ ├────┤ │                                                      │ [claude-…] │
│ │Act │ │                                                      │            │
│ ├────┤ │                                                      │ System     │
│ │Frk │ │                                                      │ ┌────────┐ │
│ ├────┤ │                                                      │ │        │ │
│ │Jn  │ │                                                      │ └────────┘ │
│ ├────┤ │                                                      │            │
│ │Apv │ │                                                      │ [⋯ more]   │
│ └────┘ │                                                      │            │
│ 220px  │                                                      │   320px    │
├────────┴──────────────────────────────────────────────────────┴────────────┤
│ ▸  Execution log · 0 events                              [⛶] [filter] [⌫] │  40px collapsed
└────────────────────────────────────────────────────────────────────────────┘
```

#### 18.4.1 Top bar (44px)

Left → right:

- Back chevron (←), returns to `/pipelines`
- Pipeline name, editable on click (becomes `<input>` inline; blur or Enter commits; Esc reverts)
- Save status chip: `✓ Saved` / `Saving…` / `✗ Save failed (retry)` — color-coded, animates transitions
- Version badge: `v4 · Published` (green) / `v4 · Draft` (gray) / `v4 · Draft (pub v2)` (amber) — click to show version popover with `Revert to published`
- Validation indicator: `✓ Valid` (green, if no errors) / `⚠ 2 warnings` (amber) / `✗ 3 errors` (red) — click to open issues popover listing `ValidationIssue[]` with jump-to-node links
- (spacer)
- **Run button.** Disabled if not published or has errors. Label reads `▶ Run` in idle; `⏹ Cancel` when a run is active on this page; `↻ Re-run` when a run just finished. Primary color.
- More menu `⋯`: Duplicate, Export JSON, Import JSON, Publish (with confirm), Revert to published, Delete (with confirm)

The top bar never scrolls. Validation errors block publishing but not saving — the badge communicates why the Run button is disabled.

#### 18.4.2 Node palette (220px)

Left rail, always visible. Contains:

- Search input at top (1.5em, rounded, placeholder "Search nodes…") — Cmd/Ctrl+F focuses it
- Scrollable categorized list:
  - **Sources** — Trigger
  - **Language** — LLM
  - **Data** — Transform, Condition
  - **Flow** — Fork, Join
  - **Outputs** — Action
  - **Human** — Approval
- Each card: 44px tall, icon + name + tiny description. Hover: subtle bg, cursor grab. Dragging: scales to 0.9, follows cursor, canvas shows ghost outline at drop position.
- Footer strip: keyboard hint `Tip: Press 1–8 to insert at center` in 10px muted text.

Single-click behavior: node inserts at viewport center with auto-pan to ensure visibility. Drag behavior: node inserts at drop position.

Only one Trigger allowed — the Trigger card shows `Placed` with a strike-through when one already exists; dragging it becomes a no-op with a toast.

#### 18.4.3 Canvas

Full React Flow with the following custom behavior:

- **Background:** dot pattern (React Flow's `variant="dots"`), color `#e2e8f0`, gap 16px, size 1px.
- **MiniMap:** bottom-right, 180×120, toggleable via `[M]` key. Nodes colored by state.
- **Controls:** bottom-left. Zoom in, zoom out, fit view, lock (disables dragging). Styled with the app's border/background conventions, not React Flow defaults.
- **Fit-view auto-trigger:** on pipeline load and on "Jump to node" from validation popover. Smooth 500ms ease-out.
- **Snap-to-grid:** 16px grid, enabled by default, toggleable with `[G]`.
- **Alignment guides:** when dragging a node, vertical/horizontal blue 1px lines appear when edges align with other nodes. Guide at top/middle/bottom or left/center/right matching.
- **Edge routing:** stepped/smoothstep (React Flow `smoothstep`), with branch labels near source handle for condition/fork/approval outputs.
- **Connection validation:** on drag-to-create-edge, invalid targets show red handle (instead of React Flow's default green). Invalid edges cannot be dropped; valid edges animate in 200ms.
- **Double-click on blank canvas:** opens a quick-insert palette at cursor (type to filter, Enter to insert).
- **Selection:**
  - Click: select single
  - Shift+click: add to selection
  - Drag on blank canvas: rubber-band select
  - Cmd/Ctrl+A: select all nodes (not edges)
- **Copy/paste:** selected nodes + connecting edges. Paste offsets by 32/32 from source. Ids regenerated.
- **Duplicate:** Cmd/Ctrl+D duplicates selection in place with 32/32 offset.
- **Delete:** Backspace or Delete key. Connecting edges auto-removed.
- **Nudge:** arrow keys move selection by 4px; Shift+arrow moves by 16px (grid).
- **Undo/redo:** Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z. History is local to the editor session, 50 steps. Tracks node/edge/config changes. Does not track viewport.

#### 18.4.4 Node appearance

A node is 200px wide by default, height flexes with content. Rendered by `BaseNode.tsx` which wraps a type-specific body.

```
╭───────────────────────────────╮
│ 🧠 LLM  · claude-sonnet-4-6  ●│    ← header: icon · subtitle · status dot
├───────────────────────────────┤
│                               │
│  "Summarize the document…"    │    ← summary preview (2-3 lines, ellipsis)
│                               │
├───────────────────────────────┤
│  ▸ Response                   │    ← expands when streaming/complete
╰─●─────────────────────────────●╯
                                 └── handles (in left, out right)
```

- **Header row:** 28px. Icon (16px emoji or SVG) + type + comma + brief config detail (e.g., model name, condition expression, approver count). Status dot at far right is the authoritative source of state — color follows §7.1.
- **Body:** 2-3 line preview of the primary config field, italicized, dimmed (`#64748b`). Empty: "Not configured" in even lighter gray + warning icon.
- **Expandable footer:** for LLM nodes, a `▸ Response` disclosure that appears when streaming/completed, animating height expansion. Shows tokens as they arrive per §7.3. Collapsible back with `▾`.
- **Selection:** 2px primary-color outline + soft glow (`0 0 0 4px rgba(100,108,255,0.18)`).
- **Handles:** 10px circles, colored per handle type (input: neutral gray; out: neutral; error: red; true/approved: green; false/rejected: orange; branch-N: blue). Connecting drag shows matching-color pulse on valid targets.
- **Inline controls:** on failed state, a small `⟳ Retry` pill appears inline below the header. On approval-awaiting state, `Resolve…` pill → jumps focus to the inline approval mini-form.

#### 18.4.5 Config panel (320px, right, slide-over)

Opens when a single node is selected. Closes on `Esc`, clicking the canvas, or `×`. Multi-selection shows a compact "N nodes selected" pane with bulk-delete / bulk-duplicate; per-node config only appears for single selection.

```
╭──────────────────────────────────╮
│ 🧠 LLM Prompt              [×]  │  header (44px)
├──────────────────────────────────┤
│ [ Config ] [ Runs ] [ Docs ]     │  tabs (36px)
├──────────────────────────────────┤
│                                  │
│  (tab content scrolls)           │
│                                  │
│                                  │
│                                  │
│                                  │
├──────────────────────────────────┤
│ [🗑 Delete node]    [⧉ Duplicate]│  footer (40px)
╰──────────────────────────────────╯
```

Tabs:
- **Config** — the form for the node (detailed per §18.10).
- **Runs** — last 10 executions of this node across all runs. Each row: timestamp, run status, duration, expand-for-payload.
- **Docs** — inline help for this node type. Short paragraph + list of config-field explanations + 1-2 example snippets.

Motion: slides in from right in 200ms `cubic-bezier(0.4, 0, 0.2, 1)`. On close, slides out 160ms faster.

#### 18.4.6 Execution log (bottom strip)

Collapsed (40px): a horizontal strip with status text, filter count, expand control.

```
▸  Execution log · Ready                      [All ▼] [clear] [⛶ expand]
```

When a run is live:
```
▸  Running · 3 active steps · 0 errors        [All ▼] [pause ❚❚] [⛶]
```

Expanded (240px): list of events in reverse-chronological (newest top). Virtualized.

```
▾  Execution log · 47 events                  [All ▼] [pause ❚❚] [⛶]
├───────────────────────────────────────────────────────────────────┤
│ 12:04:31.024  ✓  step.completed  · llm-2 · 2840ms                 │
│ 12:04:30.918  ⟳  llm.response    · llm-2 · 124→387 tokens         │
│ 12:04:28.084  ▶  step.started    · llm-2 · type: llm              │
│ 12:04:28.012  ✓  step.completed  · transform-1 · 98ms             │
│ 12:04:27.912  ▶  step.started    · transform-1 · type: transform  │
│ …                                                                 │
└───────────────────────────────────────────────────────────────────┘
```

Row: timestamp (mono 11px), glyph (derived from event type), event summary, key payload fields. Click row to expand inline with pretty-printed JSON. Double-click jumps canvas to the corresponding node.

Filters: All / Errors only / Approvals / LLM / Run lifecycle. Pause stops new events from appearing; resuming flushes the buffer with a fade. `⛶` makes the log full-screen (overlay).

Autoscroll: pinned to bottom by default; user scroll up detaches, "Jump to latest" pill appears floating bottom-right.

### 18.5 Route: `/pipelines/:id/runs/:runId` — replay

Same frame as the editor, with:

- **Top bar** shows `Run from {date} by {user}` and a terminal status badge. Save chip replaced by `Re-run` button. More menu: `Copy runId`, `Export run`, `Open as new draft`.
- **Palette** hidden (read-only mode). Space reclaimed for a wider canvas.
- **Canvas** is not editable: no drag, no edge create, no config edits. Nodes still selectable for Config tab (read-only) and Runs tab (shows this run highlighted).
- **Execution log** replaced by a **scrubber strip** (see below).

```
┌─────────────────────────────────────────────────────────────────────┐
│  [‹] Invoice summary · Run from Apr 23, 12:04             [↻ Re-run] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                      [canvas — replay mode]                          │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [◼ ▶ ❚]  [1×▼]    ├──●──────●──●─────────●─●┤  12.3s / 14.1s        │
│                    ↑ tick marks = events                              │
└──────────────────────────────────────────────────────────────────────┘
```

Scrubber:
- Play/pause/stop
- Speed selector (0.25× · 0.5× · 1× · 2× · 4× · instant)
- Timeline with tick marks — one per event; tick color by event type. Hover tick: tooltip with event summary. Click: seek.
- Time readout: current / total
- Dragging the playhead re-animates the canvas from the nearest checkpoint forward to the playhead position (Phase 5 uses the WAL+checkpoint for ms-level seek).

The canvas responds to playhead position: node states, edge traversal highlights, LLM streamed text all re-animate. Scrubbing back rewinds the visual state (but emits nothing — doesn't re-execute).

`Re-run` copies the original trigger payload and navigates to the new run.

### 18.6 Route: `/observability` — dashboard

Read-only overview. Single vertical scroll. No CTAs. Everything clickable drills deeper.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dashboard    Nodes    Events    Metrics                 [● Live]    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Runs     │  │ Active   │  │ Pending  │  │ Failed   │   KPI row   │
│  │ today    │  │ now      │  │ approvals│  │ (24h)    │   (96px)    │
│  │  1,247   │  │    3     │  │    2     │  │    7     │             │
│  │ ▲ 12%    │  │          │  │          │  │ ▼ 4%     │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Cluster health                                      [3/3 ✓] │   │
│  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │   │
│  │ │ node-0       │ │ node-1       │ │ node-2       │  node    │   │
│  │ │ ● healthy    │ │ ● healthy    │ │ ● healthy    │  grid    │   │
│  │ │ CPU ▁▂▁▃▂    │ │ CPU ▁▁▂▁▁    │ │ CPU ▂▁▃▂▁    │          │   │
│  │ │ 12 conns     │ │ 15 conns     │ │ 9 conns      │          │   │
│  │ │ 2 runs       │ │ 1 run        │ │ — idle       │          │   │
│  │ └──────────────┘ └──────────────┘ └──────────────┘          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Active runs (3)                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Invoice summary       · step 3/7 (llm)  · node-0  · 00:12    │   │
│  │ New doc alert         · step 2/4        · node-1  · 00:04    │   │
│  │ Weekly digest         · awaiting appr   · node-0  · 02:31    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Recent events (last 20)                     [▸ view all]            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 12:04:31  ✓  run.completed · Invoice summary · 4200ms        │   │
│  │ 12:04:28  ▶  step.started  · llm-2  · node-0                 │   │
│  │ …                                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Alerts (0)                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ No active alerts.                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**KPI cards:**
- Runs today (+/- vs yesterday in small delta indicator, hour-of-day sparkline inside)
- Active now (large number; click → scrolls to Active runs list)
- Pending approvals (large number; click → `/pipelines?filter=pending-approvals` or a dedicated panel)
- Failed (24h) (large number; click → `/observability/events?filter=errors`)

**Cluster health** card: one tile per node. Status dot, CPU sparkline (last 60s, 8 samples visible), connection count, active-run count (or `— idle`). Click tile → `/observability/nodes?selected={id}`. Card header count `[3/3 ✓]` turns amber/red on degradation.

**Active runs list:** compact table. Columns: pipeline name · step indicator · owner node · elapsed. Hover: row highlights. Click: jumps to `/pipelines/:pipelineId/runs/:runId`.

**Recent events:** same format as execution log, last 20 across all pipelines. `view all` → `/observability/events`.

**Alerts:** empty-state preferred (good); when populated, each alert is a card with severity icon, message, timestamp, context link, dismiss button.

**Live toggle** in top-right of page: pauses the auto-refreshing sections (useful for screenshot/investigation).

### 18.7 Route: `/observability/nodes`

Three-region: chaos rail (left, 240px), node grid (center), node detail drawer (right, 320px, conditional).

```
┌──────────────────────────────────────────────────────────────────────┐
│ Dashboard  [Nodes]  Events  Metrics                                  │
├──────────┬───────────────────────────────────────────────────────────┤
│ CHAOS    │                                                           │
│          │   ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│ Latency  │   │ node-0  ●  │ │ node-1  ●  │ │ node-2  ●  │           │
│ [  0 ms] │   │            │ │            │ │            │           │
│ [Apply]  │   │ role: wrk  │ │ role: wrk  │ │ role: wrk  │           │
│          │   │ CPU:  12%  │ │ CPU:  8%   │ │ CPU:  19%  │           │
│ Partition│   │ MEM:  340M │ │ MEM:  280M │ │ MEM:  395M │           │
│ [select] │   │ CONN: 12   │ │ CONN: 15   │ │ CONN: 9    │           │
│ [Inject] │   │ RUNS: 2    │ │ RUNS: 1    │ │ RUNS: —    │           │
│          │   │            │ │            │ │            │           │
│ Drop msgs│   │ ▂▃▁▄▂▅▂   │ │ ▁▂▁▁▁▂▁   │ │ ▃▄▂▅▃▆▃   │           │
│ [  0 %]  │   │            │ │            │ │            │           │
│ [Apply]  │   │ [● kill]   │ │ [● kill]   │ │ [● kill]   │           │
│          │   └────────────┘ └────────────┘ └────────────┘           │
│ Kill all │                                                           │
│ [Reset]  │   (more nodes wrap to next row)                            │
└──────────┴───────────────────────────────────────────────────────────┘
```

**Chaos rail** (always visible):
- Latency injection: ms input + Apply (applies to all nodes; per-node via drawer)
- Partition injection: click-to-select nodes to isolate, then Inject
- Message drop: percentage input + Apply
- Kill all (destructive): confirm dialog
- Reset: clears all injections, emits `chaos:reset`

**Node card** (220×220):
- Header: id + status dot. Degraded/dead show red/amber ring.
- Role + region tags
- CPU % · MEM bytes · CONN count · owned resource count
- Sparkline (CPU over last 60s)
- Per-node actions: kill, add latency (opens drawer)

**Detail drawer** (opens on card click):
- Full metrics panel (charts)
- Resources owned (list of runIds with state)
- Events originating from this node (filtered feed)
- Chaos controls scoped to this node
- Transfer resource: drag a resource out to another node's card (visual drop target), confirms with modal

### 18.8 Route: `/observability/events`

Three-pane. Filter rail (240px, collapsible), event list (center, virtualized), detail panel (right, 320px).

```
┌──────────────────────────────────────────────────────────────────────┐
│ Dashboard  Nodes  [Events]  Metrics      Live / Paused  [time range] │
├──────────┬───────────────────────────────────────────────────┬───────┤
│ FILTERS  │ 12:04:31.024  ✓  run.completed     run abc123     │ Event │
│          │ 12:04:30.918  ⟳  llm.response      run abc123     │       │
│ ☑ All    │ 12:04:30.802  ▶  llm.token         run abc123     │ JSON  │
│ ☐ Errors │ …                                                 │       │
│ ☐ LLM    │                                                   │ links │
│ ☐ Approv │                                                   │       │
│ ☐ Lifecy │                                                   │       │
│          │                                                   │       │
│ Runs     │                                                   │       │
│ [select] │                                                   │       │
│          │                                                   │       │
│ Pipelines│                                                   │       │
│ [select] │                                                   │       │
│          │                                                   │       │
│ Nodes    │                                                   │       │
│ ☑ node-0 │                                                   │       │
│ ☑ node-1 │                                                   │       │
│ ☑ node-2 │                                                   │       │
│          │                                                   │       │
│ [Clear]  │                                                   │       │
└──────────┴───────────────────────────────────────────────────┴───────┘
```

- Event list is virtualized (react-window or similar) — handles 10k+ events smoothly.
- Live stream prepends rows; scroll-up detaches, "Jump to live ↓" pill appears.
- Detail panel shows full event payload (collapsible JSON tree), pipeline link, run link, node link.
- Time range controls at the top: Last 15m / 1h / 6h / 24h / Custom · with `[Live]` ↔ `[Paused]` toggle (Paused uses a scrub slider on top of the event list).
- Export: `[Export JSONL]` button in the header.

### 18.9 Route: `/observability/metrics`

Grid of charts. 2 columns at 1280-1599, 3 at 1600+. Each chart is a card (220px tall by default; click to maximize overlay).

Chart cards:

- **Runs per minute** — stacked area (started/completed/failed)
- **Step duration** — line, p50/p95/p99 by node type (one series per type, color-coded)
- **LLM tokens** — dual-axis, input vs output tokens over time
- **Estimated LLM cost** — line (derived from tokens × provider pricing, visible only when configured)
- **Cluster CPU** — line, one series per node
- **Cluster memory** — line, one series per node
- **Event rate** — line, events/sec
- **Active runs over time** — line (run count sampled every 5s)
- **Failure rate by node type** — stacked bar, type × outcome
- **Approval latency** — histogram, wait-time distribution

Top controls: time range, refresh interval, reset zoom, `[Export CSV]`.

Each chart supports: hover crosshair with time-indexed tooltip, click-drag to zoom, double-click to reset zoom, legend click to toggle series.

### 18.10 Node config panels (per type)

All panels share a form layout: label above field, 12px vertical rhythm between fields, required fields marked with `●` at the label. Invalid fields show red border + message below in 11px red. "Preview with sample context" button appears at the bottom of types that can be tested.

#### Trigger

```
Trigger type ●
[ Manual                    ▼ ]

(if Document event:)
Document type ●
[ Project status report       ▼ ]

Event ●
( ) On finalize
(●) On submit for review
( ) On comment added

(if Schedule:)
Schedule (cron) ●
[ 0 */15 * * * *              ]
Next fires:
  · Apr 23, 12:00
  · Apr 23, 12:15
  · Apr 23, 12:30

(if Webhook:)
Path ●
[ /pipeline/weekly-digest     ]
Full URL:
  https://gateway.local:3001/hooks/pipeline/weekly-digest
  [📋 copy]
```

#### LLM

```
Provider ●
[ Anthropic                 ▼ ]

Model ●
[ claude-sonnet-4-6         ▼ ]

System prompt ●
┌────────────────────────────────────┐
│ You are a helpful assistant that   │
│ summarizes documents for executive │
│ review. Keep output under 200      │
│ words.                             │
│                                    │
└─ [⛶ expand]────────────────────────┘

User prompt template ●
┌────────────────────────────────────┐
│ Summarize this document:           │
│                                    │
│ {{ context.doc.body }}             │
└────────────────────────────────────┘
Available variables:                  ← pill row, click to insert
  [ context.doc.body ]
  [ context.doc.title ]
  [ context.trigger.userId ]
  [ context.steps.transform-1.output ]

▸ Advanced
  Temperature        [ 0.7 ─────○── ]
  Max tokens         [ 1024         ]
  Streaming          [●] enabled

[ ▶ Preview with sample context ]
```

Preview opens a modal: paste or select a sample context, see prompt rendered and (in Phase 3+) live LLM response.

#### Transform

```
Type ●
(●) JSONPath     ( ) Template     ( ) JavaScript

Expression ●
┌────────────────────────────────────┐
│ $.items[?(@.status == 'active')]   │
└────────────────────────────────────┘

Output key (optional)
[ activeItems                       ]
  If set, writes to context.activeItems
  Otherwise, merges into root context.

Sample input (for preview)
┌──────────────────┐  Sample output:
│ { items: [...]}  │  [ ... ]
└──────────────────┘
```

#### Condition

```
Expression ●
┌────────────────────────────────────┐
│ context.llm.response.length > 500  │
└────────────────────────────────────┘

Label (optional — shown on node face)
[ Long summary?                     ]

[ ▶ Preview with sample context ]
```

#### Action

```
Action type ●
[ Update document                ▼ ]  options: Update document,
                                               Post comment,
                                               Notify user,
                                               Webhook,
                                               MCP tool

(subtype config per action)

Idempotent
[ ] This action is safe to retry

On error
(●) Route to error handle
( ) Halt pipeline
( ) Retry up to [ 3 ] times
```

#### Fork

```
Branch count ●
[ 2 ─○─────── ] 2

Branch labels (optional)
Branch 0:  [ primary                ]
Branch 1:  [ audit                  ]
```

#### Join

```
Mode ●
(●) All — wait for every input
( ) Any — fire on first
( ) N of M — fire after [ 2 ] inputs

Merge strategy ●
(●) Deep merge
( ) Array collect (→ context.joinInputs[])
( ) Last writer wins

Current inputs: 3
```

#### Approval

```
Approvers ●                                 [+ Add]
┌────────────────────────────────────┐
│ 👤 sarah@example.com           [×] │
│ 🎖 reviewer                    [×] │
└────────────────────────────────────┘

Required count ●
[ 1 ─○────── ] 1 of 2

Timeout
[ 24 ] [hours ▼]
  If timeout: (●) Reject  ( ) Approve

Message for approver (optional)
┌────────────────────────────────────┐
│ Please review the summary before   │
│ it's posted to the document.       │
└────────────────────────────────────┘
```

### 18.11 Canvas interactions

**Insertion:**
- Drag from palette → ghost outline at cursor, snaps to grid on move. Drop on blank canvas creates the node; drop on a handle auto-creates a connecting edge.
- Single-click palette item → insert at viewport center + 32/32 offset from any existing node at center.
- Double-click blank canvas → quick-insert palette at cursor.
- Keyboard number keys 1-8 map to node types in palette order; press number to insert at viewport center.

**Selection:**
- Click node: single select.
- Shift+click node: toggle in selection.
- Drag on blank canvas: rubber-band multi-select.
- Cmd/Ctrl+A: select all nodes.
- Esc: clear selection + close config panel.

**Edges:**
- Drag from a handle → line follows cursor. Valid drop targets pulse; invalid show red.
- Click on edge: select (highlights with primary color). Delete key removes.
- Double-click edge: inserts a waypoint (future; Phase 1 skip).
- Edge label visible near source handle for branching outputs (`true`/`false`/`branch-2`/`approved`/`rejected`/`error`).

**Move:**
- Drag selected nodes: alignment guides appear at grid snaps and at edges/centers of adjacent nodes. Multi-select moves as a unit.
- Arrow keys nudge 4px; Shift+arrow nudges 16px (grid).

**Copy/paste/duplicate/delete:**
- Cmd/Ctrl+C/X: copy/cut selection.
- Cmd/Ctrl+V: paste at +32/+32 offset. Ids regenerated. Orphan edges (targeting not-selected nodes) dropped.
- Cmd/Ctrl+D: duplicate selection in-place with offset.
- Backspace/Delete: remove selected nodes + connected edges.

**Undo/redo:**
- Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z.
- Step granularity: each committed change (config save, node add, edge add/remove, position change after drag-end).
- History: 50 entries, session-scoped. Cleared on route leave.

**Viewport:**
- Pan: space+drag, or middle-mouse drag, or two-finger scroll.
- Zoom: Cmd/Ctrl+scroll, or pinch. Bounds: 0.25×–2.0×.
- Fit view: `F` key.
- Zoom to selection: Shift+`F`.
- Reset to 1.0× centered: Cmd/Ctrl+0.

**Run controls while active:**
- Click an active node: opens Runs tab in config panel (read-only), shows live step trace.
- Retry from here (on failed node): small `⟳` button appears inline below header.
- Cancel run: Cmd/Ctrl+`.` or Cancel button in top bar.

### 18.12 Motion system

Durations, easings, and orchestration. Inline styles use `transition` properties; longer orchestrated animations use framer-motion or React Flow's own animation hooks.

**Easing library (one curve per semantic role):**
- `snap` — `cubic-bezier(0.4, 0, 0.2, 1)` — default for most enter/exit (React Material standard)
- `soft` — `cubic-bezier(0.25, 0.1, 0.25, 1.0)` — slow entrances (view switches)
- `spring` — framer-motion spring `{ stiffness: 260, damping: 20 }` — for node drops, selection
- `linear` — for indefinite loops (running sweep, pulse)

**Duration tiers:**
- `micro`: 100ms — hover state, focus ring, button press
- `small`: 200ms — config panel slide, chip updates, edge creation
- `medium`: 300ms — node state transition, validation popover
- `long`: 500ms — canvas fit-view, panel expand-to-fullscreen

**Specific choreography:**

- **Config panel slide-in:** opacity 0 → 1 (100ms `snap`), transform `translateX(16px) → 0` (200ms `snap`).
- **Node drop (from palette):** scale 0.9 → 1.05 → 1.0 via `spring`, opacity 0 → 1 over 150ms.
- **Node state change (e.g., pending → running):** border color and background transition 200ms `snap`; adornment icon fades in over 100ms with 50ms delay.
- **Running gradient sweep:** 1500ms `linear` infinite, a linear-gradient mask animating `background-position-x` from `-100%` to `200%`.
- **Pending pulse:** opacity 0.8 → 1.0 → 0.8, 2000ms `soft` infinite.
- **Awaiting pulse (approval):** same as pending but color amber and 3000ms.
- **Completed flash:** background flashes to `#bbf7d0` for 200ms then settles to `#f0fdf4` over 300ms.
- **Failed shake:** translateX `0 → -4px → +4px → -2px → +2px → 0` over 480ms (6 cycles, 80ms each).
- **LLM token fade-in:** each token appears with opacity 0 → 1 + translateY 2px → 0 over 150ms `snap`. A blinking caret (`█`, opacity 1 ↔ 0, 1000ms) trails the last token. On response complete, caret fades out over 200ms.
- **Edge activation:** `stroke-dasharray: 6 4; stroke-dashoffset` animates from 0 to -200 linearly over 2s, infinite while active. Stops and fades to solid traversed color over 300ms on completion.
- **Edge success:** transitions from active blue → solid `#16a34a` over 300ms `snap`.
- **Orphan → reassigned:** the orphaned run's owning node-grid tile flashes red for 300ms, then the run's events are re-homed in the observability UI — the run row animates its `owner` column from `node-X` to `node-Y` with a 500ms slide.

**`prefers-reduced-motion`:**
- Pulses and sweeps disable (status shown by static color + adornment).
- State transitions remain but snap to 0ms.
- Panel slides remain but at 100ms duration.
- LLM streaming: tokens appear without fade; caret doesn't blink.

### 18.13 Keyboard shortcuts

Complete map. Platform: use `⌘` on macOS, `Ctrl` on Windows/Linux. Shown with `⌘/Ctrl` below.

**Global:**
- `⌘/Ctrl + K` — Command palette (Phase 5; placeholder in Phase 1)
- `?` — Show shortcut help overlay
- `g p` — go to Pipelines
- `g o` — go to Observability dashboard

**List view (`/pipelines`):**
- `⌘/Ctrl + N` — New pipeline
- `/` — Focus search
- Enter (on focused card) — Open editor
- `R` (on focused card, if published) — Run

**Editor (`/pipelines/:id`):**
- `⌘/Ctrl + S` — Save now (outside of debounced autosave)
- `⌘/Ctrl + Enter` — Run (if published)
- `⌘/Ctrl + .` — Cancel running
- `⌘/Ctrl + Shift + P` — Publish
- `⌘/Ctrl + Z` / `⌘/Ctrl + Shift + Z` — Undo / Redo
- `⌘/Ctrl + C` / `X` / `V` / `D` — Copy / Cut / Paste / Duplicate
- `⌘/Ctrl + A` — Select all nodes
- `⌘/Ctrl + F` — Focus palette search
- `Backspace` / `Delete` — Delete selection
- `1`–`8` — Insert node type by palette order
- Arrow keys — Nudge 4px; `Shift+Arrow` — Nudge 16px
- `F` — Fit view
- `Shift + F` — Zoom to selection
- `⌘/Ctrl + 0` — Reset zoom to 1.0×
- `M` — Toggle minimap
- `G` — Toggle grid snap
- `⌘/Ctrl + /` — Toggle execution log
- `Space + drag` — Pan canvas
- `Esc` — Deselect / close config panel / close modal

**Replay view:**
- `Space` — Play/pause
- `←` / `→` — Seek to previous / next event
- `Shift + ← / →` — Seek by 5 events
- `0` — Restart from beginning

**Observability events view:**
- `/` — Focus filter search
- `L` — Toggle Live/Paused
- `⌘/Ctrl + E` — Export JSONL
- Arrow keys — Navigate event list; Enter to open in detail pane

### 18.14 State inventory (empty / loading / error)

Cataloged per view. Each state has a specified visual treatment to prevent in-code drift.

**Loading:**
- Short (<200ms): no indicator (don't flash).
- Medium: skeleton (content-shaped placeholders with shimmer — `linear-gradient` moving left to right, 1400ms loop).
- Long (>2s): skeleton + progress indication (indeterminate bar at top of page).

**Empty:**
- Centered illustration + headline + body + primary CTA.
- Illustration: soft gray line art, 120×120, semantically tied to the page (pipeline diagram for list, node graph for canvas, empty clipboard for events).

**Error:**
- Non-blocking (toast): dismissible toast top-right, `#dc2626` border, icon, message, optional retry.
- Page-level: centered error card with icon, "Something went wrong", short detail, `[Retry]` + `[Report]`.
- Field-level: inline red text below the field + red border on the field.

Per view:

| View | Empty | Loading | Error |
|---|---|---|---|
| `/pipelines` | "No pipelines yet" + illustration + [New] [Templates] | skeleton cards | error card |
| `/pipelines/:id` (new draft) | Canvas with just Trigger + hint "Drag a node from the palette" | skeleton frame | "Pipeline not found" page |
| `/pipelines/:id` (config panel, no selection) | "Select a node to configure" centered in panel | — | — |
| `/pipelines/:id` (execution log, ready) | "No runs yet — click Run to trigger." | — | — |
| `/pipelines/:id/runs/:runId` | (not applicable — always has events by definition) | skeleton canvas + scrubber | "Run not found" |
| `/observability` (no cluster) | "Cluster is starting…" + spinner | skeleton panels | "Cluster offline" + reconnect indicator |
| `/observability/nodes` | (always populated if cluster up) | skeleton cards | "Can't reach cluster" |
| `/observability/events` | "No events yet" (only possible at first boot) | skeleton rows | error card |
| `/observability/metrics` | "No metric data yet" per chart | skeleton charts | error card |
| Pending approvals pane (empty) | "No approvals waiting for you." | skeleton rows | error card |

**Network conditions:**
- Offline: persistent banner top of page — `● Reconnecting…` on amber background. Data refreshes automatically on reconnect. Canvas disables Run button with tooltip "Waiting for cluster".
- Degraded: events lag indicator `(buffered: N)` in top bar.

### 18.15 Accessibility

- All interactive elements keyboard-reachable; Tab order follows reading order.
- Visible focus ring on every focusable element: 2px solid `#646cff` with 2px offset.
- React Flow canvas: as a complete a11y target, the canvas itself is limited. Mitigate by:
  - List-view alternate representation accessible at `/pipelines/:id/list` (Phase 5; link available in top bar).
  - All node-level operations (insert/delete/connect/configure) also exposed via keyboard shortcuts (§18.13) that work when a node is focused.
  - Tab cycles through nodes in graph order (topological).
- ARIA live regions:
  - Run status changes → announce in an off-screen `aria-live="polite"` region ("Pipeline started", "Step LLM completed", "Run failed at Action step").
  - Toasts → `aria-live="assertive"`.
- Color is never the sole signal for state. Every state also has a glyph adornment (✓ / ✕ / hourglass / blank / etc.).
- Color contrast: all text ≥ WCAG AA (4.5:1 for body, 3:1 for large). Status colors chosen to meet this on their respective backgrounds.
- Form fields have `<label>` above, `aria-describedby` wiring help + error text.
- Config panel announces on open: "Configuration panel for LLM node llm-2 opened".

### 18.16 Responsive behavior

- **Primary target:** 1440×900.
- **Supported minimum:** 1280×720. Below this, show persistent top banner: `For best experience, use a wider window.` but allow usage.
- **Between 1280 and 1440 on the editor:**
  - Config panel becomes modal (centered, 480×auto, max 80vh) instead of slide-over, to preserve canvas area.
  - Palette collapses to icon-only rail (60px wide) with tooltips on hover; expand button toggles full.
  - Execution log collapsed by default.
- **Between 1280 and 1440 on observability:**
  - Metrics grid drops from 3 to 2 columns.
  - Nodes detail drawer opens as modal.
- **Below 1280:** degraded experience; core views still work but not optimized.
- **Mobile (< 1024):** read-only fallback — show pipelines list and run status, block editing with a "Edit on desktop" message. Post-Phase-5 polish.

### 18.17 Visual design system (consistency anchors)

Pinning exact values so components stay visually aligned. Uses existing app conventions; adds only where missing.

**Typography:**
- Base: `13px / 1.5` system-ui
- Small: `11px / 1.4` (metadata, timestamps, badges)
- Mono: `11px / 1.4` SF Mono / Menlo (timestamps, IDs, JSON)
- Labels: `12px / 1.4` weight 600
- Page titles: `18px / 1.3` weight 700
- Section titles: `14px / 1.3` weight 600

**Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48.

**Border radii:** 4 (chips, small buttons), 6 (fields, medium buttons), 8 (cards), 10 (panels), 12 (modals).

**Colors (beyond the state palette in §7):**
- Primary: `#646cff` (existing)
- Primary-hover: `#4f55ff`
- Text: `#0f172a` primary, `#475569` secondary, `#94a3b8` tertiary, `#cbd5e1` disabled
- Surfaces: `#ffffff` card, `#fafbfc` inset, `#f8fafc` panel, `#f1f5f9` hover
- Borders: `#e2e8f0` default, `#cbd5e1` emphasized, `#d1d5db` field

**Shadows:**
- Card: none (border-only)
- Panel slide-over: `0 8px 24px rgba(15, 23, 42, 0.08)`
- Modal: `0 16px 48px rgba(15, 23, 42, 0.18)`
- Node hover: `0 2px 8px rgba(100, 108, 255, 0.10)`
- Node selected: `0 0 0 4px rgba(100, 108, 255, 0.18)`

**Icons:**
- 16px default, 20px for headers, 12px for inline chips.
- Inline emoji acceptable for domain-level iconography (node type icons, pipeline icons). Custom SVG for control affordances (fit-view, minimap toggle, expand/collapse).

### 18.18 Component inventory

The shippable list. Each is built once, used everywhere.

**Primitive:**
- `Button` — primary, secondary, danger, ghost; sizes sm/md; loading/disabled states
- `IconButton` — button with only an icon + tooltip
- `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Slider`
- `Chip` — status chip with glyph + label + color-variant
- `Tooltip`
- `Menu` — dropdown menu for overflow (`⋯`) actions
- `Modal` — centered dialog with backdrop, focus trap
- `Toast` — corner notification
- `Popover`
- `Tabs`
- `SkeletonRow`, `SkeletonCard`, `SkeletonChart`
- `Spinner`
- `EmptyState` — illustration + text + action

**Compound:**
- `CodeEditor` — monaco-based textarea for expressions, templates, JSON (lazy-loaded)
- `JSONTree` — collapsible tree for payloads
- `Sparkline` — inline tiny line chart
- `Chart` — wrapper around recharts/visx with the app's styling
- `Timeline` — vertical event list with glyph column
- `ScrubberStrip` — horizontal time slider with tick marks

**Pipelines:**
- `PipelineCard` — list view card
- `NodePalette`, `NodePaletteCard`
- `ConfigPanel` — with tabs + footer
- `BaseNode` — React Flow custom node wrapper
- `LLMNode`, `TriggerNode`, etc. — 8 concrete nodes
- `AnimatedEdge` — custom React Flow edge
- `ExecutionLog`
- `ValidationPopover`

**Observability:**
- `KPICard`
- `NodeGridTile`
- `ActiveRunsTable`
- `ChaosRail`
- `EventRow`, `EventDetailPane`
- `MetricCard`

Each primitive and compound is built in Phase 1's first two weeks. The library is what every subsequent component consumes — no ad-hoc styling.

### 18.19 Copy and microcopy

Voice: direct, present-tense, second-person where addressed. No marketing language. No exclamation points. Prefer verb-first actions.

Standard phrases:
- Buttons: `Run`, `Cancel`, `Save`, `Publish`, `Delete`, `Duplicate`, `Export`, `Import`, `Retry`, `Approve`, `Reject`, `Resume`.
- Destructive confirms: `Delete this pipeline? This can't be undone.` + `[Delete]` / `[Cancel]`.
- Save states: `Saved` · `Saving…` · `Save failed — retry`.
- Run states: `Ready` · `Running · {n} active` · `Completed · {d}ms` · `Failed at {node}` · `Cancelled`.
- Validation: `Fix {n} error{s} before publishing.` · `Ready to publish.`.
- Empty: `No {thing} yet` + one-sentence next-step.
- Error: `Something went wrong` + short detail + action.

Timestamps: relative for recent (`just now`, `2m ago`, `5h ago`, `yesterday`), absolute after 3 days (`Apr 20, 12:04`).

Duration: human-readable (`1.2s`, `42ms`, `3m 12s`).

IDs: first 6 chars when shown as shorthand, click-to-copy full.

### 18.20 Approval UX (resolved)

Approvals appear in four places, consistent affordance:

1. **Sub-nav badge** `Pending approvals (N)` — pulses on new.
2. **Pending-approvals panel** `/pipelines?filter=pending-approvals` (or as a popover from the badge): list of pending approvals across all pipelines. Row: pipeline name, step name, triggered by, how long ago, `[Approve]` `[Reject]` inline, `[View pipeline]` link.
3. **On the canvas itself**, the awaiting-approval node shows a small `Resolve…` pill inline. Click → opens a mini-form inline on the node (or in the config panel) with `[Approve]` / `[Reject]` + comment textarea.
4. **Execution log / events view:** approval-requested and approval-recorded events are color-coded amber (like the awaiting state), clickable to jump to the approving UI.

Approving an item emits `pipeline.approval.recorded`; the badge count decrements; the pipeline run continues. Approvers can see but not interact with approvals not assigned to them (grayed pill with tooltip `Not assigned to you`).

### 18.21 Summary — UI is planned [✅ shipped against the spec]

The surface is specified end-to-end: three routes for pipelines, four for observability, eight node types, their config panels, canvas interactions, motion, keyboard map, state inventory, accessibility, responsive behavior, design system, component inventory, microcopy, and approval UX. §19 reconciles this with existing patterns in the app.

**Status update:** the UI surface above is built. Pipelines routes (`/pipelines`, `/pipelines/:id`, `/pipelines/:id/runs/:runId`, `/pipelines?filter=pending-approvals`, plus a runs-list and stats page) and all four observability routes (`/observability/{dashboard,nodes,events,metrics}`) ship. All eight node types have node + config components. Frontend test suite: **719 passed / 7 skipped (54 files).** What remains is wiring real BusEvents through the bridge — the UX is ready to receive them.

---

## 19. Integration with the existing UI

Guiding rule: **the existing UI is preserved by default.** Most of §18 either reuses existing patterns or extends them; where §18 departs, this section says why. A small number of additive refactors make sense — each is DRY-driven, not destructive, and explicit.

For every area: one of **Reuse** (use as-is), **Extend** (new things that match existing style), **Small-refactor** (generalize one or two existing things), **Net-new** (invent, but consistent), or **Depart** (intentional divergence, justified).

### 19.1 Navigation — Extend

`AppLayout` already exposes a top nav with sub-nav items (`Documents`, `Data Types`, `Social`, …) and a hamburger menu. Integration:

- **Two new top-nav entries:** `Pipelines` and `Observability`. Slot alphabetically or by importance — user decides in-code.
- **Sub-nav per new primary:**
  - `Pipelines` → `All pipelines` · `Pending approvals (N)` (the badge)
  - `Observability` → `Dashboard` · `Nodes` · `Events` · `Metrics`
- **Hamburger menu entries** mirror the top-nav additions so narrow viewports still get access.
- **No removals** from existing nav. Nothing existing changes.

`§18.2` stands as-is with this explicit mapping.

### 19.2 Routing — Reuse

Existing React Router v7 + lazy-load pattern in `app/App.tsx`. New routes added under the same pattern:

```tsx
const PipelinesPage = lazy(() => import('../components/pipelines/PipelinesPage'));
const PipelineEditorPage = lazy(() => import('../components/pipelines/PipelineEditorPage'));
// ...
```

No `ProtectedRoute` wrapper changes needed — existing auth wraps AppLayout.

### 19.3 List page pattern — Depart (with justification)

Existing `DocumentTypesPage` uses **master-detail** (264px left list sidebar + right edit panel). `/pipelines` uses a **card grid → dedicated editor page** per §18.3.

**Why depart:** a pipeline editor is a full canvas that needs every available pixel of width (palette 220 + canvas + config panel 320 = ~1440 minimum). Squeezing that into a right panel with a 264px master sidebar already taken doesn't work. A dedicated `/pipelines/:id` editor route is the right fit — this also matches how `Documents` work today (list → click → full editor page at `/docs/:id`).

**What we preserve from `DocumentTypesPage` style:**
- `TypeListItem` row design at the micro level — the Pipeline card reuses the same visual treatment for status chips, action button positions, hover glow, icon + name layout.
- `IdlePanel` empty-state pattern (centered emoji + title + body + CTA) reused verbatim as the `/pipelines` empty state.
- Save feedback banner at the sidebar bottom (`✓ "{name}" updated`) reused for the pipeline editor's top-bar save chip.

### 19.4 Modals — Small-refactor

Existing modals are inline-styled ad-hoc: `DeleteConfirmModal` inside `DocumentTypesPage`, `NewDocumentModal`, etc. Each redefines backdrop / centering / escape-key logic.

**Proposal:** extract one thin `Modal.tsx` primitive matching the existing look exactly:
- Backdrop: `rgba(0,0,0,0.45)`
- Card: white, 12px radius, `28px 24px` padding, max-width customizable (380 for confirm, 480 for forms, 720 for wide)
- Shadow: `0 8px 32px rgba(0,0,0,0.18)`
- Click-outside to close; Esc to close; initial focus on first focusable.
- Footer slot for buttons; body slot for content.

**Refactor scope:** convert `DeleteConfirmModal` (inside `DocumentTypesPage.tsx`) and `NewDocumentModal.tsx` to use the new `Modal` primitive. **Visual output unchanged.** DRY-only.

All new pipeline-system modals (publish confirm, delete pipeline, etc.) consume `Modal`.

### 19.5 Buttons / fields / menu items — Reuse (no shared primitives)

Existing convention: per-component inline-style objects. `DocumentTypesPage` defines `menuBtn`; `AttachmentsPanel` defines `fieldStyle`, `saveBtnStyle(disabled)`, `cancelBtnStyle`. No shared `Button.tsx`. This is a deliberate pattern in the app.

**Pipeline code follows suit.** Each component defines its own micro-styles using the same shape and values. `§18.18 Component inventory` is revised to **remove** these generic primitives:

- ~~`Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Slider`, `Chip`, `Menu`~~ — all deleted from the inventory.
- Instead: a shared `constants/styles.ts` file exports the canonical objects (`fieldStyle`, `saveBtnStyle`, `cancelBtnStyle`, `menuBtn`, `chipStyle`) that any component can spread-import. Matches the literal values used in `AttachmentsPanel.tsx` et al.
- Components that need variations define their own next to usage.

**What stays in `§18.18` Component inventory (revised):**

- Compound: `Modal`, `Tooltip`, `Popover`, `Tabs`, `Toast`, `SkeletonRow`, `SkeletonCard`, `SkeletonChart`, `Spinner`, `EmptyState`, `CodeEditor`, `JSONTree`, `Sparkline`, `Chart`, `Timeline`, `ScrubberStrip`, `UserPicker`
- Pipelines: `PipelineCard`, `NodePalette`, `NodePaletteCard`, `ConfigPanel`, `BaseNode`, eight concrete node components, `AnimatedEdge`, `ExecutionLog`, `ValidationPopover`
- Observability: `KPICard`, `NodeGridTile`, `ActiveRunsTable`, `ChaosRail`, `EventRow`, `EventDetailPane`, `MetricCard`

No attempt to unify `Chip` / `Button` / `Input` at the primitive level. The app doesn't want it.

### 19.6 Sidebar panels (editor chrome) — Net-new concept, visual reuse

`DocumentEditorPage` uses `useSidebarPanels` for activity / comments / participants — a toggleable set of right-hand reading panels. The pipeline editor's right panel is different: it's a **selection-driven config panel** that opens only when a node is selected and closes on deselect.

**Different concept** — so the pipeline editor does **not** consume `useSidebarPanels`. But:

- Same visual frame — 320px width, `#ffffff` bg, 1px `#e2e8f0` left border, `0 8px 24px rgba(15, 23, 42, 0.08)` shadow when overlaid (the slide-over variant).
- Same header bar pattern — 44px, title + close `×` at right.
- Same footer bar pattern — 40px, destructive action at left, neutral at right.

Result: the pipeline config panel feels like part of the same system even though its trigger logic differs.

### 19.7 Activity display components — Extend + Small-refactor

Existing:
- `ActivityFeed` — document-scoped activity stream (stays, unchanged).
- `ActivityPanel` — current-user personal activity (stays, unchanged).
- `BigBrotherPanel` — cluster-wide activity event dashboard.

The observability `/observability/events` view has similar requirements to `BigBrotherPanel`: real-time event stream, type-to-icon mapping, timestamp rendering, severity coloring.

**Proposal (small refactor):** extract `BigBrotherPanel`'s row-rendering and event-type mapping into a shared `EventRow.tsx` + `eventGlyphs.ts`. Both `BigBrotherPanel` (if it's still used elsewhere) and `/observability/events` consume them. **No change** to `ActivityFeed` or `ActivityPanel`.

If `BigBrotherPanel` is no longer used anywhere after `/observability/events` is built: deprecate and remove in Phase 5 polish (deferred; not blocking).

**What `/observability/events` adds beyond existing:** pipeline-event types in the icon/color map, filter rail (§18.8), detail panel on right, virtualized list. None of this invalidates `ActivityFeed`/`ActivityPanel`.

### 19.8 Empty states — Reuse

`DocumentTypesPage.IdlePanel` is the canonical pattern: centered large emoji, 52px; 17px weight-600 headline; 13px secondary body, 340px max-width; primary button below. `§18.14 State inventory` empty states follow this exactly. No new convention.

### 19.9 Loading states — Extend

No standard skeleton component exists yet. Need `SkeletonRow`, `SkeletonCard`, `SkeletonChart` (per `§18.18` revised). They match the existing app's idle visual weight (`#f1f5f9` base with shimmer). Additive.

### 19.10 Save feedback — Reuse

`DocumentTypesPage` shows a `✓ "{name}" updated` banner pinned to the bottom of the left sidebar with a `key={Date.now()}` remount for the animation. Apply the same component to pipeline editor's save chip in the top bar. No visual invention.

### 19.11 User picker (for `Approval` node approvers) — Net-new (small)

No user-picker component exists today. The `Approval` node config needs one: search by name/email, multi-select, chips for selected users.

**Net-new component:** `UserPicker.tsx`, ~100 lines.

**Uses existing `social-api`:**
- `GET /api/profiles?q={search}` — if the endpoint doesn't exist yet, add it (small backend addition; drops into the existing `ProfileRepository`). A handful of lines.
- Falls back to typing a raw userId if desired.

Same pattern could later drive `@mention` pickers elsewhere — but that's a follow-up, not scope.

### 19.12 Icons — Reuse

Domain icons: emoji (`📋`, `🧩`, `🗎`, `🔔`, `⚙️`), matching the existing app's usage across `DocumentTypesPage`, `AppLayout`, `AttachmentsPanel`. Control affordances: inline SVG.

Pipeline node-type icons: emoji picks —
- `Trigger` ▶ · `LLM` 🧠 · `Transform` ✨ · `Condition` ❓ · `Action` ⚡ · `Fork` ⑂ · `Join` ⑃ · `Approval` ✋

(User can override the emoji per pipeline in the list view; the Pipeline card shows whatever icon the user set.)

### 19.13 Auth / user identity — Reuse

Existing Cognito auth flows. Current-user identity via the existing `AuthContext`/`useAuth` hook pattern. `UserPicker` (§19.11) lists other users via the existing `/api/profiles` REST endpoint.

Approval assignment can reference either a specific user (userId) or a role (string name) — matches what the existing approval system had, except now stored in the pipeline `Approval` node config rather than in a separate workflow model.

### 19.14 WebSocket context — Extend

Existing `WebSocketContext` already provides `sendMessage`, `onMessage`, `connectionState`. No changes there.

`EventStreamContext` (§13.2) layers on top as a second context — it consumes `useWebSocket` internally and exposes the typed pipeline-event subscription API. **The existing WebSocket service handlers in the gateway (`chat`, `crdt`, `social`, `activity`, …) are untouched.** A new `pipeline` service handler gets added (Phase 4+); it doesn't interfere with the others.

### 19.15 Keyboard shortcuts — Net-new, no conflicts detected

The existing app has no global keyboard shortcut system as far as I've seen. The pipeline editor shortcut map in `§18.13` is net-new.

**Guardrail:** before Phase 1 implementation, grep `frontend/src` for any existing `keydown` listeners; if conflicts surface (unlikely), resolve them on case-by-case basis. No bulk refactor expected.

### 19.16 Removed / absorbed components (from Phase 0 deletion)

Already enumerated in §12 — the entire approval/workflow UI (`WorkflowPanel`, `useWorkflows`, the DocumentTypeWizard Step 4 block, pending-approvals nav entry if any) goes. Everything else **stays**.

### 19.17 Net-new files introduced

For reference (Phase 1 starts creating these):

```
frontend/src/
├── components/
│   ├── pipelines/                          — entire tree (§15)
│   ├── observability/                      — entire tree (§15)
│   └── shared/
│       ├── Modal.tsx                       — extracted (§19.4)
│       ├── EmptyState.tsx                  — extracted IdlePanel generalized
│       ├── EventRow.tsx                    — extracted (§19.7)
│       ├── UserPicker.tsx                  — net-new (§19.11)
│       ├── Sparkline.tsx                   — net-new
│       ├── Chart.tsx                       — recharts wrapper, net-new
│       ├── CodeEditor.tsx                  — monaco wrapper, net-new
│       ├── JSONTree.tsx                    — net-new
│       ├── SkeletonCard.tsx                — net-new
│       └── ScrubberStrip.tsx               — net-new
├── constants/
│   └── styles.ts                           — shared inline-style objects
├── contexts/
│   └── EventStreamContext.tsx              — net-new (§13.2)
└── types/
    └── pipeline.ts                         — net-new (§6)
```

Plus Phase 0 deletions per §12.

### 19.18 Refactors that touch existing files (summary)

Minimal and purely DRY-driven:

1. `DocumentTypesPage.tsx`: extract `DeleteConfirmModal` internals to use the new `Modal` primitive. Visual unchanged.
2. `DocumentTypesPage.tsx`: extract `IdlePanel` to a shared `EmptyState` component. Visual unchanged.
3. `NewDocumentModal.tsx`: consume shared `Modal` primitive. Visual unchanged.
4. `BigBrotherPanel.tsx`: extract row-rendering + event-type icon/color map to shared `EventRow.tsx` + `eventGlyphs.ts`. Visual unchanged.
5. `AppLayout.tsx`: add `Pipelines` and `Observability` nav entries + their sub-navs. Additive.
6. `app/App.tsx`: add lazy-loaded routes for the new pages. Additive.
7. (Phase 4) `social-api`: add `GET /api/profiles?q={search}` endpoint. Additive.

**Not refactored, not replaced:** `ActivityFeed`, `ActivityPanel`, `DocumentEditorPage`, `DocumentTypeWizard` (beyond Phase 0 deletion of the Step 4 workflow block), `AttachmentsPanel`, `SectionList`, `SectionBlock`, `TiptapEditor`, `DataTypesPage` (formerly FieldTypes), all of `social/`, `chat/`, etc. — everything currently in the app that isn't the approval/workflow system **is preserved**.

### 19.19 Summary

New UI surface slots into existing chrome:
- AppLayout gets two nav entries, two sub-navs — additive.
- Routes lazy-load the same way everything else does — additive.
- Styles match existing literal values and inline-object pattern — reuse.
- Empty/loading/save-feedback patterns cloned from `DocumentTypesPage` — reuse.
- Modal + EmptyState + EventRow extracted into shared primitives — small refactor, visual output unchanged.
- One net-new compound component (`UserPicker`) uses existing `/api/profiles`.
- The pipeline canvas editor is necessarily greenfield (React Flow is a new primitive), but its chrome (top bar, config panel frame, execution log) reuses existing styling.
- The approval/workflow system is the only removal.

Existing UI is preserved. Phase 1 can proceed against this plan.

