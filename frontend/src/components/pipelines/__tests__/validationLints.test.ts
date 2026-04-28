// frontend/src/components/pipelines/__tests__/validationLints.test.ts
//
// Unit tests for the advisory design-quality lints added to
// `validatePipeline`. Each lint is covered by a pair: (a) a pipeline that
// should NOT emit the warning, (b) one that should emit exactly one warning
// of the expected code, nodeId, and `severity: 'warning'`.
//
// These lints are warnings only and never affect `isValid` / `canPublish`.

import { describe, test, expect } from 'vitest';
import { validatePipeline } from '../validation/validatePipeline';
import type {
  ActionNodeData,
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  NodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TransformNodeData,
  TriggerNodeData,
  ValidationIssue,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Local helpers (intentionally mirrors validatePipeline.test.ts since that
// file's `makePipeline` is not exported).
// ---------------------------------------------------------------------------

function makePipeline(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  overrides: Partial<PipelineDefinition> = {},
): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    id: 'pipe-test',
    name: 'Test Pipeline',
    version: 1,
    status: 'draft',
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy: 'unit-test',
    ...overrides,
  };
}

function makeNode<D extends NodeData>(id: string, data: D, x = 0, y = 0): PipelineNode {
  return { id, type: data.type, position: { x, y }, data };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle = 'out',
  targetHandle = 'in',
): PipelineEdge {
  return { id, source, sourceHandle, target, targetHandle };
}

function validTrigger(id = 't1', triggerType: TriggerNodeData['triggerType'] = 'manual'): PipelineNode {
  const data: TriggerNodeData = { type: 'trigger', triggerType };
  return makeNode(id, data);
}

function validLLM(id = 'llm1', overrides: Partial<LLMNodeData> = {}): PipelineNode {
  const data: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a reviewer.',
    userPromptTemplate: 'Review: {{context.body}}',
    streaming: false,
    maxTokens: 1024,
    ...overrides,
  };
  return makeNode(id, data);
}

function validAction(id = 'a1'): PipelineNode {
  const data: ActionNodeData = { type: 'action', actionType: 'notify', config: {} };
  return makeNode(id, data);
}

function validTransform(id = 'x1'): PipelineNode {
  const data: TransformNodeData = {
    type: 'transform',
    transformType: 'template',
    expression: '{{context.body}}',
  };
  return makeNode(id, data);
}

function validCondition(id = 'c1', label?: string): PipelineNode {
  const data: ConditionNodeData = { type: 'condition', expression: '$.x > 0', label };
  return makeNode(id, data);
}

function validFork(id = 'f1', branchCount = 2): PipelineNode {
  const data: ForkNodeData = { type: 'fork', branchCount };
  return makeNode(id, data);
}

function validJoin(id = 'j1'): PipelineNode {
  const data: JoinNodeData = { type: 'join', mode: 'all', mergeStrategy: 'deep-merge' };
  return makeNode(id, data);
}

function validApproval(id = 'ap1', overrides: Partial<ApprovalNodeData> = {}): PipelineNode {
  const data: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'user', value: 'u1' }],
    requiredCount: 1,
    timeoutMs: 60_000,
    ...overrides,
  };
  return makeNode(id, data);
}

function findByCode(issues: ValidationIssue[], code: ValidationIssue['code']): ValidationIssue[] {
  return issues.filter(i => i.code === code);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validatePipeline — advisory lints', () => {
  describe('NO_ERROR_HANDLER', () => {
    test('no warning for an LLM that has an error edge wired', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1');
      const handler = validAction('h1');
      const edges = [
        makeEdge('e0', 't1', 'llm1'),
        makeEdge('e1', 'llm1', 'h1', 'error', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, llm, handler], edges));
      // The LLM itself should not be flagged — the downstream Action without an
      // error handler is a separate (valid) warning on a different nodeId.
      const llmHits = findByCode(result.warnings, 'NO_ERROR_HANDLER').filter(
        w => w.nodeId === 'llm1',
      );
      expect(llmHits).toHaveLength(0);
    });

    test('warns once per LLM with no error edge', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1');
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      const hits = findByCode(result.warnings, 'NO_ERROR_HANDLER');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('llm1');
      expect(hits[0].severity).toBe('warning');
    });

    test('exempts a fork-branch action whose success edge feeds a downstream Join', () => {
      // trigger → fork → [a1, a2] → join → sink
      // a1 and a2 are llm/action nodes downstream of a Fork AND upstream of
      // a Join — wiring their error handles would suppress MockExecutor's
      // failed-JoinArrival delivery and hang `mode: 'all'` joins. The lint
      // exempts this exact topology.
      const t = validTrigger('t1');
      const fork = validFork('f1', 2);
      const a1 = validAction('a1');
      const a2 = validAction('a2');
      const join = validJoin('j1');
      const sink = validTransform('x1');
      const edges = [
        makeEdge('e0', 't1', 'f1'),
        makeEdge('e1', 'f1', 'a1', 'branch-0'),
        makeEdge('e2', 'f1', 'a2', 'branch-1'),
        makeEdge('e3', 'a1', 'j1', 'out', 'in-0'),
        makeEdge('e4', 'a2', 'j1', 'out', 'in-1'),
        makeEdge('e5', 'j1', 'x1'),
      ];
      const result = validatePipeline(makePipeline([t, fork, a1, a2, join, sink], edges));
      const hits = findByCode(result.warnings, 'NO_ERROR_HANDLER');
      expect(hits).toHaveLength(0);
    });

    test('still warns for a fork-branch action whose success path does NOT reach a Join', () => {
      // trigger → fork → [a1 → sink, a2 → sink]
      // a1/a2 are downstream of a Fork but their success paths terminate at
      // a transform sink, not a Join. There is no fork-failure handler to
      // protect, so the missing error handler is a real defect.
      const t = validTrigger('t1');
      const fork = validFork('f1', 2);
      const a1 = validAction('a1');
      const a2 = validAction('a2');
      const sink = validTransform('x1');
      const edges = [
        makeEdge('e0', 't1', 'f1'),
        makeEdge('e1', 'f1', 'a1', 'branch-0'),
        makeEdge('e2', 'f1', 'a2', 'branch-1'),
        makeEdge('e3', 'a1', 'x1'),
        makeEdge('e4', 'a2', 'x1'),
      ];
      const result = validatePipeline(makePipeline([t, fork, a1, a2, sink], edges));
      const hits = findByCode(result.warnings, 'NO_ERROR_HANDLER');
      expect(hits.map((h) => h.nodeId).sort()).toEqual(['a1', 'a2']);
    });

    test('still warns for an action that points at a Join but has no Fork ancestor', () => {
      // trigger → [a1, a2] → join → sink (no Fork upstream)
      // Without a Fork ancestor, the runtime never invokes the fork-failure
      // path, so wiring an error edge here is the correct fix and the lint
      // should fire.
      const t = validTrigger('t1');
      const a1 = validAction('a1');
      const a2 = validAction('a2');
      const join = validJoin('j1');
      const sink = validTransform('x1');
      const edges = [
        makeEdge('e0', 't1', 'a1'),
        makeEdge('e1', 't1', 'a2'),
        makeEdge('e2', 'a1', 'j1', 'out', 'in-0'),
        makeEdge('e3', 'a2', 'j1', 'out', 'in-1'),
        makeEdge('e4', 'j1', 'x1'),
      ];
      const result = validatePipeline(makePipeline([t, a1, a2, join, sink], edges));
      const hits = findByCode(result.warnings, 'NO_ERROR_HANDLER');
      expect(hits.map((h) => h.nodeId).sort()).toEqual(['a1', 'a2']);
    });
  });

  describe('LLM_NO_MAX_TOKENS', () => {
    test('no warning when maxTokens is set', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1', { maxTokens: 2048 });
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      expect(findByCode(result.warnings, 'LLM_NO_MAX_TOKENS')).toHaveLength(0);
    });

    test('warns once when maxTokens is missing', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1', { maxTokens: undefined });
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      const hits = findByCode(result.warnings, 'LLM_NO_MAX_TOKENS');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('llm1');
      expect(hits[0].severity).toBe('warning');
    });
  });

  describe('UNGUARDED_APPROVAL_TIMEOUT', () => {
    test('no warning when timeoutMs is set', () => {
      const t = validTrigger('t1');
      const ap = validApproval('ap1', { timeoutMs: 30_000 });
      const edges = [makeEdge('e0', 't1', 'ap1')];
      const result = validatePipeline(makePipeline([t, ap], edges));
      expect(findByCode(result.warnings, 'UNGUARDED_APPROVAL_TIMEOUT')).toHaveLength(0);
    });

    test('warns once when timeoutMs is missing', () => {
      const t = validTrigger('t1');
      const ap = validApproval('ap1', { timeoutMs: undefined });
      const edges = [makeEdge('e0', 't1', 'ap1')];
      const result = validatePipeline(makePipeline([t, ap], edges));
      const hits = findByCode(result.warnings, 'UNGUARDED_APPROVAL_TIMEOUT');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('ap1');
      expect(hits[0].severity).toBe('warning');
    });
  });

  describe('LARGE_FORK', () => {
    test('no warning when branchCount <= 5', () => {
      const t = validTrigger('t1');
      const f = validFork('f1', 5);
      const edges = [makeEdge('e0', 't1', 'f1')];
      const result = validatePipeline(makePipeline([t, f], edges));
      expect(findByCode(result.warnings, 'LARGE_FORK')).toHaveLength(0);
    });

    test('warns once when branchCount > 5', () => {
      const t = validTrigger('t1');
      const f = validFork('f1', 6);
      const edges = [makeEdge('e0', 't1', 'f1')];
      const result = validatePipeline(makePipeline([t, f], edges));
      const hits = findByCode(result.warnings, 'LARGE_FORK');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('f1');
      expect(hits[0].severity).toBe('warning');
      expect(hits[0].message).toContain('6 branches');
    });
  });

  describe('DEEP_CHAIN', () => {
    test('no warning for a shallow pipeline', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(makePipeline([t, a], edges));
      expect(findByCode(result.warnings, 'DEEP_CHAIN')).toHaveLength(0);
    });

    test('warns once when depth > 12', () => {
      // Build a linear chain: trigger -> x0 -> x1 -> ... -> x12 (total depth 14).
      const trigger = validTrigger('t1');
      const nodes: PipelineNode[] = [trigger];
      const edges: PipelineEdge[] = [];
      let prevId = 't1';
      for (let i = 0; i < 13; i += 1) {
        const id = `x${i}`;
        nodes.push(validTransform(id));
        edges.push(makeEdge(`e${i}`, prevId, id));
        prevId = id;
      }
      const result = validatePipeline(makePipeline(nodes, edges));
      const hits = findByCode(result.warnings, 'DEEP_CHAIN');
      expect(hits).toHaveLength(1);
      expect(hits[0].severity).toBe('warning');
      expect(hits[0].message).toMatch(/\d+ levels/);
    });
  });

  describe('DUPLICATE_NODE_NAME', () => {
    test('no warning when all node names are unique', () => {
      const t = validTrigger('t1');
      const c1 = validCondition('c1', 'check-one');
      const c2 = validCondition('c2', 'check-two');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'c2', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c1, c2], edges));
      expect(findByCode(result.warnings, 'DUPLICATE_NODE_NAME')).toHaveLength(0);
    });

    test('warns for each node sharing a duplicate label', () => {
      const t = validTrigger('t1');
      const c1 = validCondition('c1', 'checkme');
      const c2 = validCondition('c2', 'checkme');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'c2', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c1, c2], edges));
      const hits = findByCode(result.warnings, 'DUPLICATE_NODE_NAME');
      expect(hits).toHaveLength(2);
      expect(hits.map(h => h.nodeId).sort()).toEqual(['c1', 'c2']);
      expect(hits.every(h => h.severity === 'warning')).toBe(true);
      expect(hits[0].message).toContain("'checkme'");
    });
  });

  describe('LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT', () => {
    test('no warning when temperature is low', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1', { temperature: 0.2 });
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      expect(
        findByCode(result.warnings, 'LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT'),
      ).toHaveLength(0);
    });

    test('no warning when temp is high but prompt has no templating', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1', {
        temperature: 0.95,
        userPromptTemplate: 'please review the document',
      });
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      expect(
        findByCode(result.warnings, 'LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT'),
      ).toHaveLength(0);
    });

    test('warns when temperature > 0.8 AND prompt uses {{...}} interpolation', () => {
      const t = validTrigger('t1');
      const llm = validLLM('llm1', {
        temperature: 0.95,
        userPromptTemplate: 'Review: {{context.body}}',
      });
      const edges = [makeEdge('e0', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t, llm], edges));
      const hits = findByCode(result.warnings, 'LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('llm1');
      expect(hits[0].severity).toBe('warning');
    });
  });

  describe('NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED', () => {
    test('no warning when triggerBinding event is not schedule', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(
        makePipeline([t, a], edges, {
          status: 'draft',
          triggerBinding: { event: 'manual' },
        }),
      );
      expect(
        findByCode(result.warnings, 'NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED'),
      ).toHaveLength(0);
    });

    test('no warning when scheduled pipeline is already published', () => {
      const t = validTrigger('t1', 'schedule');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(
        makePipeline([t, a], edges, {
          status: 'published',
          publishedVersion: 1,
          triggerBinding: { event: 'schedule', schedule: '0 * * * *' },
        }),
      );
      expect(
        findByCode(result.warnings, 'NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED'),
      ).toHaveLength(0);
    });

    test('warns when scheduled trigger is on a draft', () => {
      const t = validTrigger('t1', 'schedule');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(
        makePipeline([t, a], edges, {
          status: 'draft',
          triggerBinding: { event: 'schedule', schedule: '0 * * * *' },
        }),
      );
      const hits = findByCode(result.warnings, 'NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED');
      expect(hits).toHaveLength(1);
      expect(hits[0].severity).toBe('warning');
      expect(hits[0].message).toContain('Scheduled trigger');
    });
  });

  describe('UNREACHABLE_AFTER_CONDITION_FALSE', () => {
    test('no warning when both true and false branches are wired', () => {
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const a1 = validAction('a1');
      const a2 = validAction('a2');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'a1', 'true', 'in'),
        makeEdge('e2', 'c1', 'a2', 'false', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c, a1, a2], edges));
      expect(
        findByCode(result.warnings, 'UNREACHABLE_AFTER_CONDITION_FALSE'),
      ).toHaveLength(0);
    });

    test('no warning when both branches are unwired (covered by UNUSED_CONDITION_BRANCH)', () => {
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const edges = [makeEdge('e0', 't1', 'c1')];
      const result = validatePipeline(makePipeline([t, c], edges));
      expect(
        findByCode(result.warnings, 'UNREACHABLE_AFTER_CONDITION_FALSE'),
      ).toHaveLength(0);
    });

    test('warns once when only the true branch is wired', () => {
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const a = validAction('a1');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'a1', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c, a], edges));
      const hits = findByCode(result.warnings, 'UNREACHABLE_AFTER_CONDITION_FALSE');
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('c1');
      expect(hits[0].field).toBe('false');
      expect(hits[0].severity).toBe('warning');
      expect(hits[0].message).toContain("'false' handle");
    });
  });

  describe('FORK_WITHOUT_MATCHING_JOIN', () => {
    test('no warning when fork branches converge in a join', () => {
      const t = validTrigger('t1');
      const f = validFork('f1', 2);
      const x1 = validTransform('x1');
      const x2 = validTransform('x2');
      const j = validJoin('j1');
      const edges = [
        makeEdge('e0', 't1', 'f1'),
        makeEdge('e1', 'f1', 'x1', 'branch-0', 'in'),
        makeEdge('e2', 'f1', 'x2', 'branch-1', 'in'),
        makeEdge('e3', 'x1', 'j1', 'out', 'in-0'),
        makeEdge('e4', 'x2', 'j1', 'out', 'in-1'),
      ];
      const result = validatePipeline(makePipeline([t, f, x1, x2, j], edges));
      expect(findByCode(result.warnings, 'FORK_WITHOUT_MATCHING_JOIN')).toHaveLength(0);
    });

    test('warns on a fork whose branches never reach a join', () => {
      // Fork -> two branches, each terminating in an Action, no Join anywhere.
      const t = validTrigger('t1');
      const f = validFork('f1', 2);
      const a1 = validAction('a1');
      const a2 = validAction('a2');
      const edges = [
        makeEdge('e0', 't1', 'f1'),
        makeEdge('e1', 'f1', 'a1', 'branch-0', 'in'),
        makeEdge('e2', 'f1', 'a2', 'branch-1', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, f, a1, a2], edges));
      const hits = findByCode(result.warnings, 'FORK_WITHOUT_MATCHING_JOIN');
      expect(hits.some(h => h.nodeId === 'f1' && h.severity === 'warning')).toBe(true);
      expect(hits.find(h => h.nodeId === 'f1')?.message).toContain("Fork");
    });

    test('warns on a join whose inputs do not share a common fork ancestor', () => {
      // Two parallel chains from the trigger feed a Join — no Fork upstream.
      const t = validTrigger('t1');
      const x1 = validTransform('x1');
      const x2 = validTransform('x2');
      const j = validJoin('j1');
      const edges = [
        makeEdge('e0', 't1', 'x1'),
        makeEdge('e1', 't1', 'x2'),
        makeEdge('e2', 'x1', 'j1', 'out', 'in-0'),
        makeEdge('e3', 'x2', 'j1', 'out', 'in-1'),
      ];
      const result = validatePipeline(makePipeline([t, x1, x2, j], edges));
      const hits = findByCode(result.warnings, 'FORK_WITHOUT_MATCHING_JOIN');
      const joinHit = hits.find(h => h.nodeId === 'j1');
      expect(joinHit).toBeDefined();
      expect(joinHit?.severity).toBe('warning');
      expect(joinHit?.message).toContain('Join');
    });
  });
});
