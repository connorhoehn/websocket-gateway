// frontend/src/components/pipelines/persistence/pipelineStorage.ts
//
// localStorage-backed persistence for pipeline definitions.
// See PIPELINES_PLAN.md §13.4. Pure module — functions only, no import-time side effects.
//
// Storage layout:
//   ws_pipelines_v1:{pipelineId}   — full PipelineDefinition JSON
//   ws_pipelines_v1_index          — PipelineIndexEntry[] for list views

import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import pipelineSchema from '../../../../../schemas/pipeline.schema.json';
import type {
  ActionNodeData,
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  PipelineStatus,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Constants / key helpers
// ---------------------------------------------------------------------------

const INDEX_KEY = 'ws_pipelines_v1_index';
const PIPELINE_KEY_PREFIX = 'ws_pipelines_v1:';

function pipelineKey(id: string): string {
  return `${PIPELINE_KEY_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineIndexEntry {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
  icon?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Silent-failure write helper (QuotaExceeded, serialization errors, etc.)
// ---------------------------------------------------------------------------

let quotaWarned = false;

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (!quotaWarned) {
      quotaWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[pipelineStorage] localStorage write failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Index access
// ---------------------------------------------------------------------------

function readIndex(): PipelineIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PipelineIndexEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: PipelineIndexEntry[]): void {
  safeWrite(INDEX_KEY, JSON.stringify(entries));
}

function upsertIndexEntry(def: PipelineDefinition): void {
  const entries = readIndex();
  const entry: PipelineIndexEntry = {
    id: def.id,
    name: def.name,
    status: def.status,
    updatedAt: def.updatedAt,
  };
  const idx = entries.findIndex(e => e.id === def.id);
  if (idx === -1) {
    // Copy icon and tags from the def on first insert.
    if (def.icon) entry.icon = def.icon;
    if (def.tags && def.tags.length > 0) entry.tags = [...def.tags];
    entries.push(entry);
  } else {
    // Prefer the icon on the def (latest edit); fall back to the existing
    // index entry's icon so a partial save without def.icon doesn't blow it
    // away. Tags follow the same pattern.
    const nextIcon = def.icon ?? entries[idx].icon;
    const nextTags = def.tags ?? entries[idx].tags;
    const merged: PipelineIndexEntry = { ...entry };
    if (nextIcon) merged.icon = nextIcon;
    if (nextTags && nextTags.length > 0) merged.tags = [...nextTags];
    entries[idx] = merged;
  }
  writeIndex(entries);
}

function removeIndexEntry(id: string): void {
  const entries = readIndex().filter(e => e.id !== id);
  writeIndex(entries);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listPipelines(): PipelineIndexEntry[] {
  return readIndex();
}

export function loadPipeline(id: string): PipelineDefinition | null {
  try {
    const raw = localStorage.getItem(pipelineKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as PipelineDefinition;
  } catch {
    return null;
  }
}

export function savePipeline(def: PipelineDefinition): void {
  def.version = (def.version ?? 0) + 1;
  def.updatedAt = new Date().toISOString();
  safeWrite(pipelineKey(def.id), JSON.stringify(def));
  upsertIndexEntry(def);
}

export function deletePipeline(id: string): void {
  try {
    localStorage.removeItem(pipelineKey(id));
  } catch {
    // ignore
  }
  removeIndexEntry(id);
}

export function createPipeline(
  partial: Partial<PipelineDefinition> & { name: string; createdBy: string },
): PipelineDefinition {
  const now = new Date().toISOString();
  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
  const triggerNode: PipelineNode = {
    id: crypto.randomUUID(),
    type: 'trigger',
    position: { x: 40, y: 120 },
    data: triggerData,
  };

  const def: PipelineDefinition = {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    description: partial.description,
    tags: partial.tags ?? [],
    icon: partial.icon ?? '🔀',
    version: 0,
    status: 'draft' as PipelineStatus,
    publishedVersion: partial.publishedVersion,
    triggerBinding: partial.triggerBinding,
    nodes: partial.nodes ?? [triggerNode],
    edges: partial.edges ?? [],
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    createdBy: partial.createdBy,
  };

  savePipeline(def);
  return def;
}

// ---------------------------------------------------------------------------
// Demo pipeline seed — a showcase document-summary flow users can spawn from
// the empty state to see the full node vocabulary wired together (trigger,
// LLM, condition, fork → parallel actions → join, approval, final action).
//
// Lint hygiene: the seed is structured to silence every advisory warning.
// LLM_NO_MAX_TOKENS, DUPLICATE_NODE_NAME, UNUSED_FORK_BRANCH,
// UNUSED_CONDITION_BRANCH, UNGUARDED_APPROVAL_TIMEOUT, ORPHAN_NODE,
// FORK_WITHOUT_MATCHING_JOIN, DEEP_CHAIN, and LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT
// are all silenced by construction. The terminal `transform` sink opts into
// `terminal: true` to silence DEAD_END.
//
// The two fork-branch actions (post-comment, notify) deliberately leave
// their `error` handles unwired so MockExecutor's fork-failure path can
// deliver a `failed` JoinArrival to the downstream `mode: 'all'` Join
// (see MockExecutor.executeFromNode → fork branch handling and
// PIPELINES_PLAN.md §17.1–17.2). NO_ERROR_HANDLER includes a structural
// exemption for exactly this topology — a node downstream of a Fork AND
// upstream of a Join via success edges — so leaving the error handles
// unwired is the correct, lint-clean choice.
// ---------------------------------------------------------------------------

export function createDemoPipeline(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  // ── Node IDs (captured so edges can reference them) ──────────────────────
  const triggerId = crypto.randomUUID();
  const llmId = crypto.randomUUID();
  const conditionId = crypto.randomUUID();
  const forkId = crypto.randomUUID();
  const postCommentId = crypto.randomUUID();
  const notifyBranchId = crypto.randomUUID();
  const joinId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const updateDocId = crypto.randomUUID();
  const shortSummaryId = crypto.randomUUID();
  const errorHandlerId = crypto.randomUUID();
  const finalSinkId = crypto.randomUUID();

  // ── Node data payloads (discriminated unions) ────────────────────────────
  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };

  // `maxTokens` set so LLM_NO_MAX_TOKENS does not fire. Temperature kept
  // ≤ 0.8 so LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT does not fire on the
  // templated prompt.
  const llmData: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Summarize this document',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.3,
    maxTokens: 1024,
    streaming: true,
  };

  const conditionData: ConditionNodeData = {
    type: 'condition',
    expression: `context.steps.${llmId}.llm.tokensOut > 200`,
    label: 'Long summary?',
  };

  const forkData: ForkNodeData = {
    type: 'fork',
    branchCount: 2,
    branchLabels: ['post-comment', 'notify-user'],
  };

  // Each leaf action gets a distinct `actionType` so `nodeLabel` produces
  // distinct names — DUPLICATE_NODE_NAME stays quiet.
  const postCommentData: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: '{{context.steps.' + llmId + '.response}}' },
    onError: 'route-error',
  };

  const notifyBranchData: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {
      recipient: '{{context.triggeredBy.userId}}',
      message: 'Your document summary is ready for review.',
    },
    onError: 'route-error',
  };

  const joinData: JoinNodeData = {
    type: 'join',
    mode: 'all',
    mergeStrategy: 'deep-merge',
  };

  const approvalData: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'user', value: 'demo-user' }],
    requiredCount: 1,
    timeoutMs: 24 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: 'Please review before posting.',
  };

  const updateDocData: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: { summary: '{{context.steps.' + llmId + '.response}}' },
    onError: 'route-error',
  };

  // Short-summary branch (condition.false). Uses `mcp-tool` so its action
  // name is unique vs. the `notify` branch action above.
  const shortSummaryData: ActionNodeData = {
    type: 'action',
    actionType: 'mcp-tool',
    config: {
      tool: 'send-short-summary',
      recipient: '{{context.triggeredBy.userId}}',
      message: 'Short summary generated.',
    },
    onError: 'route-error',
  };

  // Shared error sink for every llm/action error handle. Uses `webhook` so
  // its name is unique among the demo's actions. Both its `out` and `error`
  // handles route to the final sink so it isn't itself a dead end and its
  // own error handle is wired (silences NO_ERROR_HANDLER for this node).
  const errorHandlerData: ActionNodeData = {
    type: 'action',
    actionType: 'webhook',
    config: {
      url: 'https://example.invalid/pipeline-errors',
      method: 'POST',
      bodyTemplate: '{ "runId": "{{runId}}", "stage": "error-handler" }',
    },
    idempotent: true,
    onError: 'route-error',
  };

  // Final convergence sink. A `transform` is used (rather than an action or
  // join) so the inevitable single-terminal node carries no NO_ERROR_HANDLER
  // (transforms have no error handle), no UNUSED_*_BRANCH (transforms have
  // only `out`), and no FORK_WITHOUT_MATCHING_JOIN (transforms aren't joins).
  // `terminal: true` opts this node out of the DEAD_END lint — it's the
  // intentional sink at the end of the DAG.
  const finalSinkData: TransformNodeData = {
    type: 'transform',
    transformType: 'template',
    expression: 'pipeline-complete',
    outputKey: 'pipelineCompletion',
    terminal: true,
  };

  // ── Node layout ──────────────────────────────────────────────────────────
  // Columns are spaced 280px apart. Branch rows use ±60px from the centerline.
  const nodes: PipelineNode[] = [
    { id: triggerId,       type: 'trigger',   position: { x: 40,   y: 200 }, data: triggerData },
    { id: llmId,           type: 'llm',       position: { x: 320,  y: 200 }, data: llmData },
    { id: conditionId,     type: 'condition', position: { x: 620,  y: 200 }, data: conditionData },
    { id: forkId,          type: 'fork',      position: { x: 900,  y: 120 }, data: forkData },
    { id: postCommentId,   type: 'action',    position: { x: 1180, y: 60  }, data: postCommentData },
    { id: notifyBranchId,  type: 'action',    position: { x: 1180, y: 180 }, data: notifyBranchData },
    { id: joinId,          type: 'join',      position: { x: 1480, y: 120 }, data: joinData },
    { id: approvalId,      type: 'approval',  position: { x: 1780, y: 120 }, data: approvalData },
    { id: updateDocId,     type: 'action',    position: { x: 2080, y: 120 }, data: updateDocData },
    { id: shortSummaryId,  type: 'action',    position: { x: 900,  y: 320 }, data: shortSummaryData },
    { id: errorHandlerId,  type: 'action',    position: { x: 1480, y: 420 }, data: errorHandlerData },
    { id: finalSinkId,     type: 'transform', position: { x: 2380, y: 200 }, data: finalSinkData },
  ];

  const mkEdge = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ): PipelineEdge => ({
    id: crypto.randomUUID(),
    source,
    sourceHandle,
    target,
    targetHandle,
  });

  // ── Edges (handle-type table §5) ─────────────────────────────────────────
  const edges: PipelineEdge[] = [
    // Happy path: trigger → llm → condition → fork → (postComment | notify) → join → approval → updateDoc → finalSink
    mkEdge(triggerId,      'out',      llmId,         'in'),
    mkEdge(llmId,          'out',      conditionId,   'in'),
    mkEdge(conditionId,    'true',     forkId,        'in'),
    mkEdge(conditionId,    'false',    shortSummaryId,'in'),
    mkEdge(forkId,         'branch-0', postCommentId, 'in'),
    mkEdge(forkId,         'branch-1', notifyBranchId,'in'),
    mkEdge(postCommentId,  'out',      joinId,        'in-0'),
    mkEdge(notifyBranchId, 'out',      joinId,        'in-1'),
    mkEdge(joinId,         'out',      approvalId,    'in'),
    mkEdge(approvalId,     'approved', updateDocId,   'in'),

    // Terminal `out` paths converge on the final sink. Each leaf wires `out`
    // so DEAD_END only fires for the sink itself.
    mkEdge(updateDocId,    'out',      finalSinkId,   'in'),
    mkEdge(shortSummaryId, 'out',      finalSinkId,   'in'),

    // Approval rejection routes through the shared error handler. Wiring
    // `rejected` is hygiene only — there is no UNUSED_APPROVAL_BRANCH lint —
    // but it keeps the rejection path observable.
    mkEdge(approvalId,     'rejected', errorHandlerId,'in'),

    // Every llm/action `error` handle routes to the shared error handler so
    // NO_ERROR_HANDLER stays silent on each one. Exception: the two actions
    // *inside* the fork (postComment, notifyBranch) intentionally leave their
    // error handles unwired so the executor's fork-failure path can still
    // deliver a failed JoinArrival to the downstream Join (mode='all'). With
    // an explicit error edge, an action failure inside a fork would route
    // away from the Join and the Join would hang waiting for the missing
    // arrival. NO_ERROR_HANDLER's structural exemption (downstream-of-Fork
    // AND upstream-of-Join) covers these two nodes, so the demo stays
    // lint-clean while preserving fork-join 'all' runtime semantics.
    mkEdge(llmId,          'error',    errorHandlerId,'in'),
    mkEdge(updateDocId,    'error',    errorHandlerId,'in'),
    mkEdge(shortSummaryId, 'error',    errorHandlerId,'in'),

    // The error handler itself drains into the final sink on both handles
    // so it is not a dead end and its own `error` handle is wired (silencing
    // NO_ERROR_HANDLER for the error-handler node).
    mkEdge(errorHandlerId, 'out',      finalSinkId,   'in'),
    mkEdge(errorHandlerId, 'error',    finalSinkId,   'in'),
  ];

  const def: PipelineDefinition = {
    id: crypto.randomUUID(),
    name: 'Document Summary Pipeline (Demo)',
    description:
      'A showcase pipeline demonstrating LLM summarization, branching, approval, parallel actions, and a shared error handler.',
    icon: '📄',
    version: 0,
    status: 'published' as PipelineStatus,
    publishedVersion: 1,
    triggerBinding: { event: 'manual' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  // savePipeline increments version from 0 → 1 and mirrors def.icon into the
  // index entry.
  savePipeline(def);

  return def;
}

export function publishPipeline(id: string): PipelineDefinition | null {
  const def = loadPipeline(id);
  if (!def) return null;
  def.status = 'published';
  // savePipeline bumps version — predict the bump so publishedVersion matches
  // the version actually written to storage.
  def.publishedVersion = def.version + 1;
  // Stash a deep clone of the current def (minus publishedSnapshot itself, to
  // avoid recursion) so the VersionDiffModal has a real "at publish time"
  // snapshot to diff against on subsequent drafts.
  const { publishedSnapshot: _prev, ...rest } = def;
  void _prev;
  def.publishedSnapshot = JSON.parse(
    JSON.stringify(rest),
  ) as Omit<PipelineDefinition, 'publishedSnapshot'>;
  savePipeline(def);
  return def;
}

/**
 * Archive a pipeline (soft-hide). If the pipeline is already archived this
 * acts as an "unarchive" — restoring `'draft'` status. Used by the bulk-action
 * toolbar on the pipelines list page.
 *
 * Distinct from `deletePipeline`: nothing is removed from storage. The caller
 * is responsible for any UI filtering (e.g. hiding archived rows by default).
 */
export function archivePipeline(id: string): PipelineDefinition | null {
  const def = loadPipeline(id);
  if (!def) return null;
  // Toggle: archived → draft (recover); anything else → archived.
  def.status = def.status === 'archived' ? 'draft' : 'archived';
  savePipeline(def);
  return def;
}

export function duplicatePipeline(
  id: string,
  newName?: string,
): PipelineDefinition | null {
  const src = loadPipeline(id);
  if (!src) return null;

  // Remap node IDs so edges can be rewritten.
  const idMap = new Map<string, string>();
  const nodes: PipelineNode[] = src.nodes.map(n => {
    const fresh = crypto.randomUUID();
    idMap.set(n.id, fresh);
    return { ...n, id: fresh, data: { ...n.data } };
  });
  const edges = src.edges.map(e => ({
    ...e,
    id: crypto.randomUUID(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));

  const now = new Date().toISOString();
  const clone: PipelineDefinition = {
    ...src,
    id: crypto.randomUUID(),
    name: newName ?? `${src.name} (copy)`,
    // Spread preserves tags from the source; defensive-copy the array so
    // later mutation of the clone can't alias the source's tag list.
    tags: src.tags ? [...src.tags] : undefined,
    version: 0,
    status: 'draft',
    publishedVersion: undefined,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };

  savePipeline(clone);
  return clone;
}

export function exportPipelineJSON(id: string): string | null {
  const def = loadPipeline(id);
  if (!def) return null;
  return JSON.stringify(def, null, 2);
}

// ---------------------------------------------------------------------------
// JSON Schema validation (AJV) for importPipelineJSON.
//
// The authoritative schema lives at `/schemas/pipeline.schema.json` (Draft
// 2020-12). The installed AJV (v6) targets Draft-07, which is a superset of
// what we use here (refs, enum, const, oneOf, required, type); we strip the
// `$schema` / `$id` URLs so AJV doesn't reject the unknown meta-schema.
// Compilation is lazy so the cost isn't paid at module import time.
// ---------------------------------------------------------------------------

let cachedValidate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (cachedValidate) return cachedValidate;
  // Clone so we don't mutate the imported schema object.
  const schema = JSON.parse(JSON.stringify(pipelineSchema)) as Record<string, unknown>;
  // AJV 6 only understands draft-07's meta-schema URL. Drop the 2020-12
  // reference + $id so validateSchema doesn't trip on them.
  delete schema.$schema;
  delete schema.$id;
  // Also strip `discriminator` (an OpenAPI 3 extension inside NodeData.oneOf)
  // which AJV 6 doesn't recognize as a keyword.
  const defs = schema.$defs as Record<string, unknown> | undefined;
  if (defs && typeof defs === 'object') {
    const nodeData = defs.NodeData as Record<string, unknown> | undefined;
    if (nodeData) delete nodeData.discriminator;
  }
  const ajv = new Ajv({
    allErrors: true,
    schemaId: '$id',
    meta: true,
    // AJV 6 has no `strict` option; `unknownFormats: 'ignore'` is the closest
    // opt-out we need for date-time (which we don't want to reject on).
    unknownFormats: 'ignore',
  });
  cachedValidate = ajv.compile(schema);
  return cachedValidate;
}

export function importPipelineJSON(json: string): PipelineDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid pipeline JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid pipeline JSON');
  }

  const validate = getValidator();
  if (!validate(parsed)) {
    const msg =
      validate.errors
        ?.map((e) => `${e.dataPath || '(root)'} ${e.message}`)
        .join('; ') ?? 'schema validation failed';
    throw new Error(`Invalid pipeline: ${msg}`);
  }

  const now = new Date().toISOString();
  const def: PipelineDefinition = {
    ...(parsed as unknown as PipelineDefinition),
    id: crypto.randomUUID(),
    updatedAt: now,
  };

  savePipeline(def);
  return def;
}
