// frontend/src/components/pipelines/__tests__/pipelineFlow.integration.test.ts
//
// End-to-end Phase-1 pipeline integration test: exercises create → edit →
// validate → publish → execute through the real MockExecutor, plus the
// storage lifecycle round trip. Complements the narrow unit suites
// (pipelineStorage.test.ts, validatePipeline.test.ts) and the ordering-focused
// pipelineExecutor.contract.test.ts by wiring them through one pipeline at a
// time and asserting the combined behaviour.
//
// Framework: Vitest (jest-compatible API). See `frontend/vite.config.ts`.

import { describe, test, expect, beforeEach } from 'vitest';
import {
  createDemoPipeline,
  createPipeline,
  deletePipeline,
  duplicatePipeline,
  exportPipelineJSON,
  importPipelineJSON,
  listPipelines,
  loadPipeline,
  publishPipeline,
  savePipeline,
} from '../persistence/pipelineStorage';
import { validatePipeline } from '../validation/validatePipeline';
import { MockExecutor, type MockExecutorOptions } from '../mock/MockExecutor';
import type {
  ActionNodeData,
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  NodeData,
  NodeType,
  PipelineDefinition,
  PipelineEdge,
  PipelineEventMap,
  PipelineNode,
  PipelineRun,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Shared types / helpers
// ---------------------------------------------------------------------------

type EventTuple = [keyof PipelineEventMap, unknown];

let idSeq = 0;
function seqId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

/**
 * Build a full `PipelineDefinition` from lightweight node / edge descriptors.
 * Each node descriptor supplies a `type` plus optional `id`, `position`,
 * and a `Partial<NodeData>` — the helper fills in sensible type-specific
 * defaults so trivial callers stay terse.
 */
function buildPipeline(
  nodeDescs: Array<{
    type: NodeType;
    id?: string;
    position?: { x: number; y: number };
    data?: Partial<NodeData>;
  }>,
  edgeDescs: Array<{
    source: string;
    sourceHandle?: string;
    target: string;
    targetHandle?: string;
    id?: string;
  }>,
  overrides: Partial<PipelineDefinition> = {},
): PipelineDefinition {
  const nodes: PipelineNode[] = nodeDescs.map((desc, i) => {
    const id = desc.id ?? seqId(`${desc.type}`);
    const position = desc.position ?? { x: 40 + i * 200, y: 120 };
    const data = buildNodeData(desc.type, desc.data ?? {});
    return { id, type: desc.type, position, data };
  });
  const edges: PipelineEdge[] = edgeDescs.map((desc) => ({
    id: desc.id ?? seqId('e'),
    source: desc.source,
    sourceHandle: desc.sourceHandle ?? 'out',
    target: desc.target,
    targetHandle: desc.targetHandle ?? 'in',
  }));
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? seqId('pipe'),
    name: overrides.name ?? 'Integration test pipeline',
    version: overrides.version ?? 1,
    status: overrides.status ?? 'draft',
    publishedVersion: overrides.publishedVersion,
    triggerBinding: overrides.triggerBinding,
    nodes: overrides.nodes ?? nodes,
    edges: overrides.edges ?? edges,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    createdBy: overrides.createdBy ?? 'integration-test',
    description: overrides.description,
  };
}

function buildNodeData(type: NodeType, partial: Partial<NodeData>): NodeData {
  switch (type) {
    case 'trigger': {
      const base: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
      return { ...base, ...(partial as Partial<TriggerNodeData>) };
    }
    case 'llm': {
      const base: LLMNodeData = {
        type: 'llm',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'You are a helpful reviewer.',
        userPromptTemplate: 'Please review: {{context.body}}',
        streaming: true,
      };
      return { ...base, ...(partial as Partial<LLMNodeData>) };
    }
    case 'transform': {
      const base: TransformNodeData = {
        type: 'transform',
        transformType: 'template',
        expression: '{{context.body}}',
      };
      return { ...base, ...(partial as Partial<TransformNodeData>) };
    }
    case 'condition': {
      const base: ConditionNodeData = {
        type: 'condition',
        expression: 'context.kind === "x"',
      };
      return { ...base, ...(partial as Partial<ConditionNodeData>) };
    }
    case 'action': {
      const base: ActionNodeData = {
        type: 'action',
        actionType: 'notify',
        config: {},
      };
      return { ...base, ...(partial as Partial<ActionNodeData>) };
    }
    case 'fork': {
      const base: ForkNodeData = { type: 'fork', branchCount: 2 };
      return { ...base, ...(partial as Partial<ForkNodeData>) };
    }
    case 'join': {
      const base: JoinNodeData = {
        type: 'join',
        mode: 'all',
        mergeStrategy: 'deep-merge',
      };
      return { ...base, ...(partial as Partial<JoinNodeData>) };
    }
    case 'approval': {
      const base: ApprovalNodeData = {
        type: 'approval',
        approvers: [{ type: 'user', value: 'alice' }],
        requiredCount: 1,
      };
      return { ...base, ...(partial as Partial<ApprovalNodeData>) };
    }
  }
}

/**
 * Construct a `MockExecutor`, run it, and return the final `PipelineRun`
 * alongside a chronologically-ordered `[type, payload]` tuple array. Defaults
 * keep tests fast & deterministic: 0% failure rates, 0.02x speed.
 */
async function runAndCollect(
  def: PipelineDefinition,
  opts: Partial<MockExecutorOptions> = {},
): Promise<{ run: PipelineRun; events: EventTuple[]; executor: MockExecutor }> {
  const events: EventTuple[] = [];
  const executor = new MockExecutor({
    definition: def,
    triggerPayload: opts.triggerPayload,
    failureRateLLM: opts.failureRateLLM ?? 0,
    failureRateOther: opts.failureRateOther ?? 0,
    speedMultiplier: opts.speedMultiplier ?? 0.02,
    onEvent: (type, payload) => {
      events.push([type, payload]);
    },
  });
  const run = await executor.run();
  return { run, events, executor };
}

function typesOf(events: EventTuple[]): Array<keyof PipelineEventMap> {
  return events.map(([t]) => t);
}

function firstPayload<K extends keyof PipelineEventMap>(
  events: EventTuple[],
  type: K,
  stepId?: string,
): PipelineEventMap[K] | undefined {
  for (const [t, p] of events) {
    if (t !== type) continue;
    if (stepId !== undefined) {
      const payload = p as { stepId?: string };
      if (payload.stepId !== stepId) continue;
    }
    return p as PipelineEventMap[K];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Pipeline Phase-1 integration', () => {
  beforeEach(() => {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith('ws_pipelines_v1')) localStorage.removeItem(k);
    });
    idSeq = 0;
  });

  // -------------------------------------------------------------------------
  describe('Create → edit → validate → publish flow', () => {
    test('createPipeline produces a draft with one Trigger node', () => {
      const def = createPipeline({ name: 'Test', createdBy: 'u1' });
      expect(def.status).toBe('draft');
      expect(def.nodes.length).toBe(1);
      expect(def.nodes[0].type).toBe('trigger');
      // savePipeline inside createPipeline bumps version from 0 → 1.
      expect(def.version).toBe(1);
      // Trigger defaults to 'manual'.
      expect((def.nodes[0].data as TriggerNodeData).triggerType).toBe('manual');
    });

    test('savePipeline bumps version and updates index', () => {
      const def = createPipeline({ name: 'SaveBump', createdBy: 'u1' });
      const originalVersion = def.version;
      const originalUpdatedAt = def.updatedAt;

      // Mutate + save → version bumps, updatedAt changes, index stays single entry.
      def.name = 'SaveBump (renamed)';
      savePipeline(def);

      expect(def.version).toBe(originalVersion + 1);
      expect(def.updatedAt >= originalUpdatedAt).toBe(true);

      const entries = listPipelines().filter((e) => e.id === def.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('SaveBump (renamed)');
      expect(entries[0].status).toBe('draft');
    });

    test('a minimal trigger-only pipeline has canPublish=true', () => {
      const def = createPipeline({ name: 'T', createdBy: 'u' });
      const result = validatePipeline(def);
      // No config errors on a bare Trigger (it's valid to publish an empty
      // placeholder — dead-end warning only).
      expect(result.canPublish).toBe(true);
      expect(result.errors).toEqual([]);
      // Should still surface the DEAD_END warning since trigger has no outgoing.
      const hasDeadEnd = result.warnings.some((w) => w.code === 'DEAD_END');
      expect(hasDeadEnd).toBe(true);
    });

    test('publishPipeline flips status to published and sets publishedVersion', () => {
      const def = createPipeline({ name: 'Pub', createdBy: 'u' });
      expect(def.status).toBe('draft');
      const versionAtCreate = def.version;

      const published = publishPipeline(def.id);
      expect(published).not.toBeNull();
      expect(published!.status).toBe('published');
      // publishPipeline predicts savePipeline's version bump so publishedVersion
      // matches the stored version.
      expect(published!.publishedVersion).toBe(versionAtCreate + 1);
      expect(published!.version).toBe(versionAtCreate + 1);

      // Index reflects the published status.
      const entry = listPipelines().find((e) => e.id === def.id);
      expect(entry?.status).toBe('published');
    });

    test('a pipeline with an LLM missing systemPrompt has canPublish=false', () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'llm',
            id: 'l1',
            data: {
              // Deliberately blank systemPrompt to trigger MISSING_CONFIG.
              systemPrompt: '',
            } as Partial<LLMNodeData>,
          },
        ],
        [{ source: 't1', target: 'l1' }],
      );

      const result = validatePipeline(def);
      expect(result.canPublish).toBe(false);
      expect(result.isValid).toBe(false);

      const missingSystem = result.errors.find(
        (e) => e.code === 'MISSING_CONFIG' && e.field === 'systemPrompt' && e.nodeId === 'l1',
      );
      expect(missingSystem).toBeTruthy();
    });

    test('validation catches NO_TRIGGER when no trigger node exists', () => {
      // buildPipeline lets us omit the trigger entirely to simulate the error.
      const def = buildPipeline(
        [{ type: 'action', id: 'a1' }],
        [],
      );
      const result = validatePipeline(def);
      expect(result.canPublish).toBe(false);
      expect(result.errors.some((e) => e.code === 'NO_TRIGGER')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('Execution flow with MockExecutor', () => {
    test('a trigger → transform pipeline completes and emits expected events', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          { type: 'transform', id: 'x1' },
        ],
        [{ source: 't1', target: 'x1' }],
      );

      const { run, events } = await runAndCollect(def);

      expect(run.status).toBe('completed');
      const typeList = typesOf(events);
      expect(typeList).toContain('pipeline.run.started');
      expect(typeList).toContain('pipeline.step.completed');
      expect(typeList).toContain('pipeline.run.completed');

      // Both nodes should have completed exactly once.
      const completedSteps = events
        .filter(([t]) => t === 'pipeline.step.completed')
        .map(([, p]) => (p as { stepId: string }).stepId);
      expect(completedSteps).toContain('t1');
      expect(completedSteps).toContain('x1');

      // run.started payload references the pipeline id.
      const started = firstPayload(events, 'pipeline.run.started');
      expect(started?.pipelineId).toBe(def.id);
    });

    test('trigger → llm pipeline emits prompt → tokens → response', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'llm',
            id: 'l1',
            data: { systemPrompt: 'brief' } as Partial<LLMNodeData>, // 'brief' → short fixture
          },
        ],
        [{ source: 't1', target: 'l1' }],
      );

      const { run, events } = await runAndCollect(def);

      expect(run.status).toBe('completed');

      const promptIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.llm.prompt' && (p as { stepId: string }).stepId === 'l1',
      );
      const responseIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.llm.response' && (p as { stepId: string }).stepId === 'l1',
      );

      expect(promptIdx).toBeGreaterThanOrEqual(0);
      expect(responseIdx).toBeGreaterThan(promptIdx);

      // At least one token event must arrive between prompt and response.
      const tokenIdxs = events
        .map(([t, p], i) => ({ t, p, i }))
        .filter(
          ({ t, p }) =>
            t === 'pipeline.llm.token' && (p as { stepId: string }).stepId === 'l1',
        )
        .map(({ i }) => i);
      expect(tokenIdxs.length).toBeGreaterThan(0);
      for (const i of tokenIdxs) {
        expect(i).toBeGreaterThan(promptIdx);
        expect(i).toBeLessThan(responseIdx);
      }

      // Response payload carries tokensIn / tokensOut.
      const respPayload = firstPayload(events, 'pipeline.llm.response', 'l1');
      expect(respPayload?.tokensIn).toBeGreaterThan(0);
      expect(respPayload?.tokensOut).toBeGreaterThan(0);
    });

    test('trigger → condition → (action | action) with condition=true takes the true branch', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'condition',
            id: 'c1',
            data: { expression: 'context.kind === "x"' } as Partial<ConditionNodeData>,
          },
          { type: 'action', id: 'yes' },
          { type: 'action', id: 'no' },
        ],
        [
          { source: 't1', target: 'c1' },
          { source: 'c1', sourceHandle: 'true', target: 'yes' },
          { source: 'c1', sourceHandle: 'false', target: 'no' },
        ],
      );

      const { run, events } = await runAndCollect(def, {
        triggerPayload: { kind: 'x' },
      });

      expect(run.status).toBe('completed');

      const startedIds = events
        .filter(([t]) => t === 'pipeline.step.started')
        .map(([, p]) => (p as { stepId: string }).stepId);
      expect(startedIds).toContain('yes');
      expect(startedIds).not.toContain('no');
    });

    test('trigger → condition with condition=false takes the false branch', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'condition',
            id: 'c1',
            data: { expression: 'context.kind === "x"' } as Partial<ConditionNodeData>,
          },
          { type: 'action', id: 'yes' },
          { type: 'action', id: 'no' },
        ],
        [
          { source: 't1', target: 'c1' },
          { source: 'c1', sourceHandle: 'true', target: 'yes' },
          { source: 'c1', sourceHandle: 'false', target: 'no' },
        ],
      );

      const { run, events } = await runAndCollect(def, {
        triggerPayload: { kind: 'not-x' },
      });

      expect(run.status).toBe('completed');
      const startedIds = events
        .filter(([t]) => t === 'pipeline.step.started')
        .map(([, p]) => (p as { stepId: string }).stepId);
      expect(startedIds).toContain('no');
      expect(startedIds).not.toContain('yes');
    });

    test('trigger → fork → (action, action) → join-all completes', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'fork',
            id: 'f1',
            data: { branchCount: 2 } as Partial<ForkNodeData>,
          },
          { type: 'action', id: 'b1' },
          { type: 'action', id: 'b2' },
          {
            type: 'join',
            id: 'j1',
            data: { mode: 'all', mergeStrategy: 'deep-merge' } as Partial<JoinNodeData>,
          },
        ],
        [
          { source: 't1', target: 'f1' },
          { source: 'f1', sourceHandle: 'branch-0', target: 'b1' },
          { source: 'f1', sourceHandle: 'branch-1', target: 'b2' },
          { source: 'b1', target: 'j1', targetHandle: 'in-0' },
          { source: 'b2', target: 'j1', targetHandle: 'in-1' },
        ],
      );

      const { run, events } = await runAndCollect(def);

      expect(run.status).toBe('completed');

      // Both branches should have started and completed.
      const startedIds = events
        .filter(([t]) => t === 'pipeline.step.started')
        .map(([, p]) => (p as { stepId: string }).stepId);
      expect(startedIds).toContain('b1');
      expect(startedIds).toContain('b2');

      // Join fires after both branch completions.
      const b1CompletedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.step.completed' && (p as { stepId: string }).stepId === 'b1',
      );
      const b2CompletedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.step.completed' && (p as { stepId: string }).stepId === 'b2',
      );
      const firedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.join.fired' && (p as { stepId: string }).stepId === 'j1',
      );
      expect(b1CompletedIdx).toBeGreaterThanOrEqual(0);
      expect(b2CompletedIdx).toBeGreaterThanOrEqual(0);
      expect(firedIdx).toBeGreaterThan(b1CompletedIdx);
      expect(firedIdx).toBeGreaterThan(b2CompletedIdx);

      // `waiting` emissions must include one whose `received === required`.
      const waitings = events
        .filter(([t, p]) => t === 'pipeline.join.waiting' && (p as { stepId: string }).stepId === 'j1')
        .map(([, p]) => p as PipelineEventMap['pipeline.join.waiting']);
      expect(waitings.length).toBeGreaterThanOrEqual(2);
      expect(waitings[waitings.length - 1].required).toBe(2);
      expect(waitings[waitings.length - 1].received).toBe(2);
    });

    test('trigger → approval blocks until resolveApproval; then continues', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'approval',
            id: 'ap1',
            data: {
              approvers: [{ type: 'user', value: 'alice' }],
              requiredCount: 1,
            } as Partial<ApprovalNodeData>,
          },
          { type: 'action', id: 'done' },
        ],
        [
          { source: 't1', target: 'ap1' },
          { source: 'ap1', sourceHandle: 'approved', target: 'done' },
        ],
      );

      const events: EventTuple[] = [];
      const executor = new MockExecutor({
        definition: def,
        failureRateLLM: 0,
        failureRateOther: 0,
        speedMultiplier: 0.02,
        onEvent: (type, payload) => {
          events.push([type, payload]);
          // As soon as approval.requested lands, resolve it.
          if (type === 'pipeline.approval.requested') {
            setTimeout(() => {
              executor.resolveApproval(executor.runId, 'ap1', 'alice', 'approve');
            }, 5);
          }
        },
      });

      const run = await executor.run();

      expect(run.status).toBe('completed');

      // Requested fires before recorded, which fires before done's step.started.
      const requestedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.approval.requested' &&
          (p as { stepId: string }).stepId === 'ap1',
      );
      const recordedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.approval.recorded' &&
          (p as { stepId: string }).stepId === 'ap1',
      );
      const doneStartedIdx = events.findIndex(
        ([t, p]) =>
          t === 'pipeline.step.started' &&
          (p as { stepId: string }).stepId === 'done',
      );
      expect(requestedIdx).toBeGreaterThanOrEqual(0);
      expect(recordedIdx).toBeGreaterThan(requestedIdx);
      expect(doneStartedIdx).toBeGreaterThan(recordedIdx);

      // The recorded payload should carry the approving user + decision.
      const recordedPayload = events[recordedIdx][1] as PipelineEventMap['pipeline.approval.recorded'];
      expect(recordedPayload.userId).toBe('alice');
      expect(recordedPayload.decision).toBe('approve');
    });

    test('cancel during LLM streaming emits step.cancelled and run.cancelled', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          { type: 'llm', id: 'l1' },
          { type: 'action', id: 'tail' },
        ],
        [
          { source: 't1', target: 'l1' },
          { source: 'l1', target: 'tail' },
        ],
      );

      const events: EventTuple[] = [];
      // Use realtime speed so the LLM is still streaming when we cancel.
      const executor = new MockExecutor({
        definition: def,
        failureRateLLM: 0,
        failureRateOther: 0,
        speedMultiplier: 1,
        onEvent: (type, payload) => {
          events.push([type, payload]);
          // Cancel as soon as we see the LLM start, but give the stream a
          // few ms to emit at least one token so we exercise mid-stream cancel.
          if (
            type === 'pipeline.step.started' &&
            (payload as { stepId: string }).stepId === 'l1'
          ) {
            setTimeout(() => executor.cancel(), 60);
          }
        },
      });

      const run = await executor.run();

      expect(run.status).toBe('cancelled');

      const typeList = typesOf(events);
      expect(typeList).toContain('pipeline.run.cancelled');
      expect(typeList).toContain('pipeline.step.cancelled');

      // Tail should have been skipped because it never ran.
      const tailSkipped = events.find(
        ([t, p]) =>
          t === 'pipeline.step.skipped' && (p as { stepId: string }).stepId === 'tail',
      );
      expect(tailSkipped).toBeTruthy();
      const payload = tailSkipped![1] as PipelineEventMap['pipeline.step.skipped'];
      expect(payload.reason).toBe('run_cancelled');

      // run.cancelled must be terminal — nothing after.
      const cancelledIdx = events.findIndex(([t]) => t === 'pipeline.run.cancelled');
      expect(cancelledIdx).toBe(events.length - 1);
    }, 15000);

    test('action failure with no error handler fails the whole run', async () => {
      const def = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          {
            type: 'action',
            id: 'a1',
            data: { onError: 'fail-run' } as Partial<ActionNodeData>,
          },
        ],
        [{ source: 't1', target: 'a1' }],
      );

      const { run, events } = await runAndCollect(def, { failureRateOther: 1 });

      expect(run.status).toBe('failed');
      const failedIdx = events.findIndex(([t]) => t === 'pipeline.run.failed');
      expect(failedIdx).toBeGreaterThanOrEqual(0);
      // run.failed is terminal.
      expect(failedIdx).toBe(events.length - 1);
      // The failing node emitted step.failed referencing it.
      const stepFailed = firstPayload(events, 'pipeline.step.failed', 'a1');
      expect(stepFailed).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('Demo pipeline (if createDemoPipeline exists)', () => {
    const demoAvailable = typeof createDemoPipeline === 'function';

    test.runIf(demoAvailable)('demo pipeline exists and validates', () => {
      const def = createDemoPipeline('demo-user');
      expect(def.status).toBe('published');
      expect(def.nodes.length).toBeGreaterThan(3);
      // The seed function itself constructs a graph that's supposed to be
      // publishable — any validation error here is a seed-data bug.
      const result = validatePipeline(def);
      expect(result.errors).toEqual([]);
    });

    test.runIf(demoAvailable)('demo pipeline is saved under its id and listed', () => {
      const def = createDemoPipeline('demo-user');
      const loaded = loadPipeline(def.id);
      expect(loaded).not.toBeNull();
      const entry = listPipelines().find((e) => e.id === def.id);
      expect(entry).toBeTruthy();
      expect(entry?.status).toBe('published');
      // The showcase icon is attached via the index layer.
      expect(entry?.icon).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('Storage lifecycle', () => {
    test('create → list → load → delete round trip', () => {
      expect(listPipelines()).toEqual([]);

      const def = createPipeline({ name: 'Lifecycle', createdBy: 'u' });

      const listed = listPipelines();
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(def.id);

      const loaded = loadPipeline(def.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(def.id);
      expect(loaded?.name).toBe('Lifecycle');

      deletePipeline(def.id);
      expect(loadPipeline(def.id)).toBeNull();
      expect(listPipelines()).toEqual([]);
    });

    test('duplicatePipeline regenerates ids and resets to draft', () => {
      const src = createPipeline({ name: 'Original', createdBy: 'u' });
      publishPipeline(src.id);

      const dup = duplicatePipeline(src.id);
      expect(dup).not.toBeNull();
      expect(dup!.id).not.toBe(src.id);
      expect(dup!.status).toBe('draft');
      expect(dup!.publishedVersion).toBeUndefined();
      expect(dup!.name).toBe('Original (copy)');

      // Both the source and the duplicate are listed.
      const ids = listPipelines().map((e) => e.id).sort();
      expect(ids).toEqual([src.id, dup!.id].sort());

      // Node IDs were remapped — no overlap with source.
      const srcIds = new Set(src.nodes.map((n) => n.id));
      for (const n of dup!.nodes) {
        expect(srcIds.has(n.id)).toBe(false);
      }
    });

    test('export + import round-trip preserves shape', () => {
      // Build a 3-node pipeline with a single edge so we can check both
      // node and edge preservation through the round trip.
      const built = buildPipeline(
        [
          { type: 'trigger', id: 't1' },
          { type: 'transform', id: 'x1' },
          { type: 'action', id: 'a1' },
        ],
        [
          { source: 't1', target: 'x1' },
          { source: 'x1', target: 'a1' },
        ],
        { name: 'Export me', createdBy: 'u' },
      );
      savePipeline(built);

      const json = exportPipelineJSON(built.id);
      expect(json).not.toBeNull();

      const imported = importPipelineJSON(json!);
      // Import assigns a fresh id but preserves structure.
      expect(imported.id).not.toBe(built.id);
      expect(imported.name).toBe('Export me');
      expect(imported.nodes.map((n) => n.type)).toEqual([
        'trigger',
        'transform',
        'action',
      ]);
      expect(imported.edges).toHaveLength(2);

      // And the imported one is discoverable via listPipelines.
      const ids = listPipelines().map((e) => e.id);
      expect(ids).toContain(imported.id);
    });
  });
});
