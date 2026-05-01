// frontend/src/types/pipeline.ts
//
// Data model for pipelines — the visual workflow builder that replaces
// the old workflow system. Definitions are templates (nodes + edges);
// runs are per-execution state snapshots. See PIPELINES_PLAN.md §5/§6/§17.
//
// Type-only module — no runtime code. Shared with backend via
// type-only imports when distributed-core integration begins (Phase 3).

// ---------------------------------------------------------------------------
// Node types and per-type config (discriminated union keyed on `type`)
// ---------------------------------------------------------------------------

export type NodeType =
  | 'trigger'
  | 'llm'
  | 'transform'
  | 'condition'
  | 'action'
  | 'fork'
  | 'join'
  | 'approval';

export type TriggerType =
  | 'manual'
  | 'document.finalize'
  | 'document.comment'
  | 'document.submit'
  | 'schedule'
  | 'webhook';

export interface TriggerNodeData {
  type: 'trigger';
  triggerType: TriggerType;
  /** Required for `document.*` triggers. */
  documentTypeId?: string;
  /** Cron expression; required when `triggerType === 'schedule'`. */
  schedule?: string;
  /** Required when `triggerType === 'webhook'`. */
  webhookPath?: string;
}

export type LLMProvider = 'anthropic' | 'bedrock';

export interface LLMNodeData {
  type: 'llm';
  provider: LLMProvider;
  /** Model identifier, e.g. 'claude-sonnet-4-6'. */
  model: string;
  systemPrompt: string;
  /** Supports `{{context.foo}}` substitution. */
  userPromptTemplate: string;
  temperature?: number;
  maxTokens?: number;
  streaming: boolean;
  retryPolicy?: RetryPolicy;
}

export type TransformType = 'jsonpath' | 'template' | 'javascript';

export interface TransformNodeData {
  type: 'transform';
  transformType: TransformType;
  expression: string;
  /** Where in context to write the result; defaults to merging into root. */
  outputKey?: string;
  /** Marks this node as an intentional terminal/sink — silences DEAD_END lint. */
  terminal?: boolean;
  retryPolicy?: RetryPolicy;
}

export interface ConditionNodeData {
  type: 'condition';
  /** JSONPath or boolean expression evaluated over context. */
  expression: string;
  /** UI label shown on the node. */
  label?: string;
}

export type ActionType =
  | 'update-document'
  | 'post-comment'
  | 'notify'
  | 'webhook'
  | 'mcp-tool';

export interface ActionNodeData {
  type: 'action';
  actionType: ActionType;
  /** Shape varies per `actionType`; refined in Phase 2. */
  config: Record<string, unknown>;
  idempotent?: boolean;
  onError?: 'route-error' | 'fail-run';
  retryPolicy?: RetryPolicy;
}

export interface ForkNodeData {
  type: 'fork';
  /** Number of parallel output branches (2..8). */
  branchCount: number;
  branchLabels?: string[];
}

export type JoinMode = 'all' | 'any' | 'n_of_m';
export type JoinMergeStrategy = 'deep-merge' | 'array-collect' | 'last-writer-wins';

export interface JoinNodeData {
  type: 'join';
  mode: JoinMode;
  /** Required when `mode === 'n_of_m'`. */
  n?: number;
  mergeStrategy: JoinMergeStrategy;
}

export interface Approver {
  type: 'user' | 'role';
  value: string;
}

export type ApprovalTimeoutAction = 'reject' | 'approve' | 'escalate';

export interface ApprovalNodeData {
  type: 'approval';
  approvers: Approver[];
  /** n-of-m — how many approvals required to pass. */
  requiredCount: number;
  timeoutMs?: number;
  timeoutAction?: ApprovalTimeoutAction;
  /** Message shown to the approver. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Retry policy — optional per-node resilience config (Phase 50 durability)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
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

// ---------------------------------------------------------------------------
// Definition (template) — persisted, versioned, published
// ---------------------------------------------------------------------------

export interface PipelineNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  /** Discriminated union keyed on `data.type`. */
  data: NodeData;
}

export interface PipelineEdge {
  id: string;
  source: string;
  /** 'out', 'true'/'false', 'branch-N', 'approved'/'rejected', 'error'. */
  sourceHandle: string;
  target: string;
  /** 'in' or 'in-N' for Join. */
  targetHandle: string;
}

export interface TriggerBinding {
  event: TriggerType;
  documentTypeId?: string;
  schedule?: string;
  webhookPath?: string;
  /**
   * 32-byte hex secret used to verify HMAC-SHA256 signatures on incoming
   * webhook payloads. Generated server-side by social-api the first time a
   * webhook trigger binding is saved (see
   * `social-api/src/routes/pipelineDefinitions.ts`). The frontend never
   * mints this — it only displays it so the user can copy it into the
   * external webhook source's "secret" field. Absent → the route falls
   * back to Phase-1 unsigned-OK behavior.
   */
  webhookSecret?: string;
}

export type PipelineStatus = 'draft' | 'published' | 'archived';

export interface PipelineDefinition {
  id: string;
  name: string;
  description?: string;
  /** Free-form labels for filtering / grouping in the list view. Stored normalized (lowercase, trimmed). */
  tags?: string[];
  icon?: string;
  /** Bumped on each save. */
  version: number;
  status: PipelineStatus;
  /** Snapshot of `version` at last publish; runs trigger on this version. */
  publishedVersion?: number;
  /**
   * Deep clone of the definition as it existed at the last `publishPipeline`
   * call (minus this field, to avoid recursion). Enables the VersionDiffModal
   * to show real per-node/edge differences between the current draft and the
   * last-published state. Populated by `publishPipeline`.
   */
  publishedSnapshot?: Omit<PipelineDefinition, 'publishedSnapshot'>;
  /** Cached for fast lookup by trigger dispatch. */
  triggerBinding?: TriggerBinding;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Runtime (execution)
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'awaiting';

export interface ApprovalRecord {
  userId: string;
  decision: 'approve' | 'reject';
  comment?: string;
  at: string;
}

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
  llm?: {
    prompt: string;
    response: string;
    tokensIn: number;
    tokensOut: number;
    /** True between `pipeline.llm.stream.opened` and the first token; cleared when tokensOut > 0. */
    streamOpened?: boolean;
    /** Wall-clock ms from stream open to first token (DC v0.3.7+). */
    firstTokenLatencyMs?: number;
  };
  // Approval-specific
  approvals?: ApprovalRecord[];
}

export interface PipelineRunTrigger {
  userId?: string;
  triggerType: string;
  payload: Record<string, unknown>;
}

export interface PipelineRunError {
  nodeId: string;
  message: string;
  stack?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineVersion: number;
  status: RunStatus;
  triggeredBy: PipelineRunTrigger;
  /** Distributed-core ResourceRouter owner. */
  ownerNodeId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  /** Active frontier — can be > 1 with Fork. */
  currentStepIds: string[];
  steps: Record<string, StepExecution>;
  /** Accumulated as the run progresses. */
  context: Record<string, unknown>;
  error?: PipelineRunError;
}

// ---------------------------------------------------------------------------
// Event map — the executor contract (Phase 1 mock and Phase 3 distributed
// implementation both emit this exact shape; see §17)
// ---------------------------------------------------------------------------

export type PipelineEventMap = {
  // Run lifecycle
  'pipeline.run.started': {
    runId: string;
    pipelineId: string;
    triggeredBy: PipelineRunTrigger;
    at: string;
  };
  'pipeline.run.completed': {
    runId: string;
    durationMs: number;
    at: string;
  };
  'pipeline.run.failed': {
    runId: string;
    error: PipelineRunError;
    at: string;
  };
  'pipeline.run.cancelled': {
    runId: string;
    at: string;
  };

  // Distribution events (from ResourceRouter)
  'pipeline.run.orphaned': {
    runId: string;
    previousOwner: string;
    at: string;
  };
  'pipeline.run.reassigned': {
    runId: string;
    from: string;
    to: string;
    at: string;
  };

  // Step lifecycle
  'pipeline.step.started': {
    runId: string;
    stepId: string;
    nodeType: NodeType;
    at: string;
  };
  'pipeline.step.completed': {
    runId: string;
    stepId: string;
    durationMs: number;
    output?: unknown;
    at: string;
  };
  'pipeline.step.failed': {
    runId: string;
    stepId: string;
    error: string;
    at: string;
  };
  'pipeline.step.skipped': {
    runId: string;
    stepId: string;
    reason: string;
    at: string;
  };
  'pipeline.step.cancelled': {
    runId: string;
    stepId: string;
    at: string;
  };

  // LLM streaming
  'pipeline.llm.prompt': {
    runId: string;
    stepId: string;
    model: string;
    prompt: string;
    at: string;
  };
  // DC-14: emitted when the LLM stream opens, before any tokens arrive. Pairs
  // with `pipeline.llm.token` — the time between this event and the first
  // token is the per-step `firstTokenLatencyMs`.
  'pipeline.llm.stream.opened': {
    runId: string;
    stepId: string;
    model: string;
    openedAt: string;
  };
  'pipeline.llm.token': {
    runId: string;
    stepId: string;
    token: string;
    at: string;
  };
  'pipeline.llm.response': {
    runId: string;
    stepId: string;
    response: string;
    tokensIn: number;
    tokensOut: number;
    at: string;
  };

  // Approval
  'pipeline.approval.requested': {
    runId: string;
    stepId: string;
    approvers: ApprovalNodeData['approvers'];
    at: string;
  };
  'pipeline.approval.recorded': {
    runId: string;
    stepId: string;
    userId: string;
    decision: 'approve' | 'reject';
    at: string;
  };

  // Pause / resume / retry (Phase 3+, with manual retry available in Phase 1)
  'pipeline.run.paused': {
    runId: string;
    atStepIds: string[];
    at: string;
  };
  'pipeline.run.resumed': {
    runId: string;
    at: string;
  };
  'pipeline.run.resumeFromStep': {
    runId: string;
    fromNodeId: string;
    at: string;
  };
  'pipeline.run.retry': {
    newRunId: string;
    previousRunId: string;
    at: string;
  };

  // External webhook arrived at /hooks/pipeline/:path. Phase 4 will deliver
  // these from the gateway bridge to the frontend so `useWebhookTriggers` can
  // match and fire a run; Phase 1 the event type exists but no producer is
  // wired (the social-api route only logs + 202s).
  'pipeline.webhook.triggered': {
    webhookPath: string;
    body: unknown;
    headers: Record<string, string>;
    at: string;
  };

  // Join bookkeeping (observability / debugging)
  'pipeline.join.waiting': {
    runId: string;
    stepId: string;
    received: number;
    required: number;
    at: string;
  };
  'pipeline.join.fired': {
    runId: string;
    stepId: string;
    inputs: string[];
    at: string;
  };
};

/**
 * Wire envelope that wraps every PipelineEventMap event as it crosses the
 * network boundary (mock adapter in Phase 1, WebSocket in Phase 4+). Carries
 * ordering metadata that lets the frontend dedupe replayed events after a
 * ResourceRouter-orphaned run is resumed on a new owner.
 */
export interface PipelineWireEvent<K extends keyof PipelineEventMap = keyof PipelineEventMap> {
  eventType: K;
  payload: PipelineEventMap[K];
  /** Monotonic per-run sequence — starts at 0, increments on each emit. Stable across replays. */
  seq: number;
  /** Node id that emitted the event. For observability + debugging. */
  sourceNodeId: string;
  /** Wall-clock emission time (ms). Re-stamped on replay — NEVER use for dedupe. */
  emittedAt: number;
}

// ---------------------------------------------------------------------------
// Validation (§16) — pure function `validatePipeline` produces a ValidationResult
// ---------------------------------------------------------------------------

export type ValidationCode =
  | 'NO_TRIGGER'
  | 'MULTIPLE_TRIGGERS'
  | 'CYCLE_DETECTED'
  | 'INVALID_HANDLE'
  | 'MISSING_CONFIG'
  | 'APPROVAL_NO_APPROVERS'
  | 'JOIN_INSUFFICIENT_INPUTS'
  | 'ORPHAN_NODE'
  | 'DEAD_END'
  | 'UNUSED_FORK_BRANCH'
  | 'UNUSED_CONDITION_BRANCH'
  // Advisory design-quality lints (warnings only)
  | 'NO_ERROR_HANDLER'
  | 'LLM_NO_MAX_TOKENS'
  | 'UNGUARDED_APPROVAL_TIMEOUT'
  | 'LARGE_FORK'
  | 'DEEP_CHAIN'
  | 'DUPLICATE_NODE_NAME'
  | 'LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT'
  | 'NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED'
  | 'UNREACHABLE_AFTER_CONDITION_FALSE'
  | 'FORK_WITHOUT_MATCHING_JOIN';

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  /** For config errors — which field on the node is at fault. */
  field?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** `errors.length === 0`. */
  isValid: boolean;
  /** `errors.length === 0` — blocks publish (and therefore run), not save. */
  canPublish: boolean;
}
