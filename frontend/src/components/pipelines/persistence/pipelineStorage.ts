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
  status: 'draft' | 'published';
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
  const notifyShortId = crypto.randomUUID();

  // ── Node data payloads (discriminated unions) ────────────────────────────
  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };

  const llmData: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Summarize this document',
    userPromptTemplate: '{{context.documentBody}}',
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

  const postCommentData: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: '{{context.steps.' + llmId + '.response}}' },
  };

  const notifyBranchData: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: { recipient: '{{context.triggeredBy.userId}}', message: 'Your document summary is ready for review.' },
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
  };

  const notifyShortData: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: { recipient: '{{context.triggeredBy.userId}}', message: 'Short summary generated.' },
  };

  // ── Node layout (positions per spec) ─────────────────────────────────────
  const nodes: PipelineNode[] = [
    { id: triggerId,     type: 'trigger',   position: { x: 40,   y: 120 }, data: triggerData },
    { id: llmId,         type: 'llm',       position: { x: 320,  y: 120 }, data: llmData },
    { id: conditionId,   type: 'condition', position: { x: 620,  y: 120 }, data: conditionData },
    { id: forkId,        type: 'fork',      position: { x: 900,  y: 40  }, data: forkData },
    { id: postCommentId, type: 'action',    position: { x: 1180, y: 0   }, data: postCommentData },
    { id: notifyBranchId,type: 'action',    position: { x: 1180, y: 80  }, data: notifyBranchData },
    { id: joinId,        type: 'join',      position: { x: 1480, y: 40  }, data: joinData },
    { id: approvalId,    type: 'approval',  position: { x: 1780, y: 40  }, data: approvalData },
    { id: updateDocId,   type: 'action',    position: { x: 2080, y: 40  }, data: updateDocData },
    { id: notifyShortId, type: 'action',    position: { x: 900,  y: 240 }, data: notifyShortData },
  ];

  // ── Edges (handle-type table §5) ─────────────────────────────────────────
  const edges: PipelineEdge[] = [
    // trigger.out → llm.in
    {
      id: crypto.randomUUID(),
      source: triggerId, sourceHandle: 'out',
      target: llmId, targetHandle: 'in',
    },
    // llm.out → condition.in
    {
      id: crypto.randomUUID(),
      source: llmId, sourceHandle: 'out',
      target: conditionId, targetHandle: 'in',
    },
    // condition.true → fork.in
    {
      id: crypto.randomUUID(),
      source: conditionId, sourceHandle: 'true',
      target: forkId, targetHandle: 'in',
    },
    // condition.false → notifyShort.in (terminal short-summary branch)
    {
      id: crypto.randomUUID(),
      source: conditionId, sourceHandle: 'false',
      target: notifyShortId, targetHandle: 'in',
    },
    // fork.branch-0 → post-comment.in
    {
      id: crypto.randomUUID(),
      source: forkId, sourceHandle: 'branch-0',
      target: postCommentId, targetHandle: 'in',
    },
    // fork.branch-1 → notify-branch.in
    {
      id: crypto.randomUUID(),
      source: forkId, sourceHandle: 'branch-1',
      target: notifyBranchId, targetHandle: 'in',
    },
    // post-comment.out → join.in-0
    {
      id: crypto.randomUUID(),
      source: postCommentId, sourceHandle: 'out',
      target: joinId, targetHandle: 'in-0',
    },
    // notify-branch.out → join.in-1
    {
      id: crypto.randomUUID(),
      source: notifyBranchId, sourceHandle: 'out',
      target: joinId, targetHandle: 'in-1',
    },
    // join.out → approval.in
    {
      id: crypto.randomUUID(),
      source: joinId, sourceHandle: 'out',
      target: approvalId, targetHandle: 'in',
    },
    // approval.approved → update-document.in
    {
      id: crypto.randomUUID(),
      source: approvalId, sourceHandle: 'approved',
      target: updateDocId, targetHandle: 'in',
    },
  ];

  const def: PipelineDefinition = {
    id: crypto.randomUUID(),
    name: 'Document Summary Pipeline (Demo)',
    description: 'A showcase pipeline demonstrating LLM summarization, branching, approval, and parallel actions.',
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
