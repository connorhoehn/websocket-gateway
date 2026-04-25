// frontend/src/components/pipelines/__tests__/validatePipeline.test.ts
//
// Unit tests for the pure `validatePipeline` function. Covers every error
// code and warning code from PIPELINES_PLAN.md §16.2.
//
// NOTE on framework: The project uses Vitest (see `frontend/vite.config.ts`
// `test` block and `frontend/package.json` — `"test": "vitest run"`). Vitest's
// `describe`/`test`/`expect` API is Jest-compatible; porting to Jest is a
// one-line import change.

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
// Helpers
// ---------------------------------------------------------------------------

/** Wraps nodes+edges into a full, otherwise-valid `PipelineDefinition` skeleton. */
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

// Valid-by-default node factories — minimum fields required to pass config checks.

function validTrigger(id = 't1'): PipelineNode {
  const data: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
  return makeNode(id, data);
}

function validLLM(id = 'llm1'): PipelineNode {
  const data: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a reviewer.',
    userPromptTemplate: 'Review: {{context.body}}',
    streaming: false,
  };
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

function validCondition(id = 'c1'): PipelineNode {
  const data: ConditionNodeData = { type: 'condition', expression: '$.score > 0.5' };
  return makeNode(id, data);
}

function validAction(id = 'a1'): PipelineNode {
  const data: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {},
  };
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

function validApproval(id = 'ap1'): PipelineNode {
  const data: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'user', value: 'u1' }],
    requiredCount: 1,
  };
  return makeNode(id, data);
}

/** Find the first issue with a given code, or undefined. */
function findIssue(
  issues: ValidationIssue[],
  code: ValidationIssue['code'],
): ValidationIssue | undefined {
  return issues.find(i => i.code === code);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validatePipeline', () => {
  // -------------------------------------------------------------------------
  // Trigger errors
  // -------------------------------------------------------------------------

  describe('trigger errors', () => {
    test('NO_TRIGGER when no trigger node exists', () => {
      const llm = validLLM('llm1');
      const result = validatePipeline(makePipeline([llm], []));
      const issue = findIssue(result.errors, 'NO_TRIGGER');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('error');
      expect(result.isValid).toBe(false);
      expect(result.canPublish).toBe(false);
    });

    test('MULTIPLE_TRIGGERS when two triggers exist (one issue per extra trigger)', () => {
      const t1 = validTrigger('t1');
      const t2 = validTrigger('t2');
      const llm = validLLM('llm1');
      // Edge from t1 so llm isn't an orphan error concern (it's a warning anyway)
      const edges = [makeEdge('e1', 't1', 'llm1')];
      const result = validatePipeline(makePipeline([t1, t2, llm], edges));
      const multiple = result.errors.filter(i => i.code === 'MULTIPLE_TRIGGERS');
      // One issue per trigger when count > 1 (checked in validatePipeline.ts)
      expect(multiple.length).toBe(2);
      expect(multiple.map(i => i.nodeId).sort()).toEqual(['t1', 't2']);
      expect(result.isValid).toBe(false);
      expect(result.canPublish).toBe(false);
    });

    test('valid with exactly one trigger', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      const edges = [makeEdge('e1', 't1', 'a1')];
      const result = validatePipeline(makePipeline([t, a], edges));
      expect(findIssue(result.errors, 'NO_TRIGGER')).toBeUndefined();
      expect(findIssue(result.errors, 'MULTIPLE_TRIGGERS')).toBeUndefined();
      expect(result.isValid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // CYCLE_DETECTED
  // -------------------------------------------------------------------------

  describe('CYCLE_DETECTED', () => {
    test('flags a simple 2-node cycle (A -> B -> A)', () => {
      // Use Condition + Action so both can have outgoing + incoming edges.
      const t = validTrigger('t1');
      const a = validCondition('a');
      const b = validAction('b');
      const edges = [
        makeEdge('e0', 't1', 'a'),
        makeEdge('e1', 'a', 'b', 'true', 'in'),
        // Back-edge b -> a closes the cycle. Action -> Condition.in is a valid handle.
        makeEdge('e2', 'b', 'a', 'out', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, a, b], edges));
      const issue = findIssue(result.errors, 'CYCLE_DETECTED');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('error');
      expect(result.isValid).toBe(false);
    });

    test('flags a 3-node cycle (A -> B -> C -> A)', () => {
      const t = validTrigger('t1');
      const a = validCondition('a');
      const b = validTransform('b');
      const c = validAction('c');
      const edges = [
        makeEdge('e0', 't1', 'a'),
        makeEdge('e1', 'a', 'b', 'true', 'in'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'a'),
      ];
      const result = validatePipeline(makePipeline([t, a, b, c], edges));
      expect(findIssue(result.errors, 'CYCLE_DETECTED')).toBeDefined();
    });

    test('does not flag a DAG', () => {
      const t = validTrigger('t1');
      const b = validTransform('b');
      const c = validAction('c');
      const edges = [makeEdge('e0', 't1', 'b'), makeEdge('e1', 'b', 'c')];
      const result = validatePipeline(makePipeline([t, b, c], edges));
      expect(findIssue(result.errors, 'CYCLE_DETECTED')).toBeUndefined();
    });

    test('returns the specific back-edge id in the issue', () => {
      const t = validTrigger('t1');
      const a = validCondition('a');
      const b = validAction('b');
      const edges = [
        makeEdge('e0', 't1', 'a'),
        makeEdge('e1', 'a', 'b', 'true', 'in'),
        makeEdge('BACK_EDGE_ID', 'b', 'a', 'out', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, a, b], edges));
      const issue = findIssue(result.errors, 'CYCLE_DETECTED');
      expect(issue?.edgeId).toBe('BACK_EDGE_ID');
    });
  });

  // -------------------------------------------------------------------------
  // INVALID_HANDLE
  // -------------------------------------------------------------------------

  describe('INVALID_HANDLE', () => {
    test('flags a condition.true -> trigger edge', () => {
      // Trigger cannot be a target (no input handles).
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('bad', 'c1', 't1', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c], edges));
      const issue = findIssue(result.errors, 'INVALID_HANDLE');
      expect(issue).toBeDefined();
      expect(issue?.edgeId).toBe('bad');
      expect(result.isValid).toBe(false);
    });

    test('flags an edge to a non-existent node', () => {
      const t = validTrigger('t1');
      const edges = [makeEdge('ghost', 't1', 'missing')];
      const result = validatePipeline(makePipeline([t], edges));
      const issue = findIssue(result.errors, 'INVALID_HANDLE');
      expect(issue).toBeDefined();
      expect(issue?.edgeId).toBe('ghost');
    });

    test('valid with condition.true -> llm.in', () => {
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const l = validLLM('l1');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'l1', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c, l], edges));
      expect(findIssue(result.errors, 'INVALID_HANDLE')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // MISSING_CONFIG
  // -------------------------------------------------------------------------

  describe('MISSING_CONFIG', () => {
    test('LLM without systemPrompt is MISSING_CONFIG', () => {
      const t = validTrigger('t1');
      const llm = validLLM('l1');
      (llm.data as LLMNodeData).systemPrompt = '';
      const result = validatePipeline(
        makePipeline([t, llm], [makeEdge('e0', 't1', 'l1')]),
      );
      const issues = result.errors.filter(
        i => i.code === 'MISSING_CONFIG' && i.nodeId === 'l1' && i.field === 'systemPrompt',
      );
      expect(issues.length).toBe(1);
      expect(result.isValid).toBe(false);
    });

    test('Transform without expression is MISSING_CONFIG', () => {
      const t = validTrigger('t1');
      const x = validTransform('x1');
      (x.data as TransformNodeData).expression = '';
      const result = validatePipeline(
        makePipeline([t, x], [makeEdge('e0', 't1', 'x1')]),
      );
      const issue = result.errors.find(
        i => i.code === 'MISSING_CONFIG' && i.nodeId === 'x1' && i.field === 'expression',
      );
      expect(issue).toBeDefined();
      expect(result.isValid).toBe(false);
    });

    test('Action without actionType is MISSING_CONFIG', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      // Force actionType to empty — cast because the type enforces it.
      (a.data as ActionNodeData & { actionType: unknown }).actionType = '' as never;
      const result = validatePipeline(
        makePipeline([t, a], [makeEdge('e0', 't1', 'a1')]),
      );
      const issue = result.errors.find(
        i => i.code === 'MISSING_CONFIG' && i.nodeId === 'a1' && i.field === 'actionType',
      );
      expect(issue).toBeDefined();
      expect(result.isValid).toBe(false);
    });

    test('Fork with branchCount < 2 is MISSING_CONFIG', () => {
      const t = validTrigger('t1');
      const f = validFork('f1', 1);
      const result = validatePipeline(
        makePipeline([t, f], [makeEdge('e0', 't1', 'f1')]),
      );
      const issue = result.errors.find(
        i => i.code === 'MISSING_CONFIG' && i.nodeId === 'f1' && i.field === 'branchCount',
      );
      expect(issue).toBeDefined();
      expect(result.isValid).toBe(false);
    });

    test('Join with mode=n_of_m missing n is MISSING_CONFIG', () => {
      const t = validTrigger('t1');
      const x1 = validTransform('x1');
      const x2 = validTransform('x2');
      const j = validJoin('j1');
      (j.data as JoinNodeData).mode = 'n_of_m';
      // n intentionally left undefined
      const edges = [
        makeEdge('e0', 't1', 'x1'),
        makeEdge('e1', 't1', 'x2'),
        makeEdge('e2', 'x1', 'j1', 'out', 'in-0'),
        makeEdge('e3', 'x2', 'j1', 'out', 'in-1'),
      ];
      const result = validatePipeline(makePipeline([t, x1, x2, j], edges));
      const issue = result.errors.find(
        i => i.code === 'MISSING_CONFIG' && i.nodeId === 'j1' && i.field === 'n',
      );
      expect(issue).toBeDefined();
      expect(result.isValid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // APPROVAL_NO_APPROVERS
  // -------------------------------------------------------------------------

  describe('APPROVAL_NO_APPROVERS', () => {
    test('flags empty approvers array', () => {
      const t = validTrigger('t1');
      const ap = validApproval('ap1');
      (ap.data as ApprovalNodeData).approvers = [];
      const result = validatePipeline(
        makePipeline([t, ap], [makeEdge('e0', 't1', 'ap1')]),
      );
      const issue = findIssue(result.errors, 'APPROVAL_NO_APPROVERS');
      expect(issue).toBeDefined();
      expect(issue?.nodeId).toBe('ap1');
      expect(issue?.field).toBe('approvers');
      expect(result.isValid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // JOIN_INSUFFICIENT_INPUTS
  // -------------------------------------------------------------------------

  describe('JOIN_INSUFFICIENT_INPUTS', () => {
    test('Join with 0 or 1 incoming edges is flagged', () => {
      // 0 incoming
      const t0 = validTrigger('t1');
      const j0 = validJoin('j0');
      const r0 = validatePipeline(makePipeline([t0, j0], []));
      expect(findIssue(r0.errors, 'JOIN_INSUFFICIENT_INPUTS')).toBeDefined();

      // 1 incoming
      const t1 = validTrigger('t1');
      const x1 = validTransform('x1');
      const j1 = validJoin('j1');
      const edges = [
        makeEdge('e0', 't1', 'x1'),
        makeEdge('e1', 'x1', 'j1', 'out', 'in-0'),
      ];
      const r1 = validatePipeline(makePipeline([t1, x1, j1], edges));
      const issue = findIssue(r1.errors, 'JOIN_INSUFFICIENT_INPUTS');
      expect(issue).toBeDefined();
      expect(issue?.nodeId).toBe('j1');
    });

    test('Join with 2+ incoming edges is valid', () => {
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
      expect(findIssue(result.errors, 'JOIN_INSUFFICIENT_INPUTS')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

  describe('warnings', () => {
    test('ORPHAN_NODE for disconnected node', () => {
      const t = validTrigger('t1');
      const connected = validAction('a1');
      const orphan = validAction('a2');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(makePipeline([t, connected, orphan], edges));
      const orphans = result.warnings.filter(w => w.code === 'ORPHAN_NODE');
      expect(orphans.length).toBeGreaterThanOrEqual(1);
      expect(orphans.some(w => w.nodeId === 'a2')).toBe(true);
      expect(result.isValid).toBe(true); // warnings don't break isValid
    });

    test('DEAD_END for a node with no outgoing edges', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(makePipeline([t, a], edges));
      const deadEnds = result.warnings.filter(w => w.code === 'DEAD_END');
      expect(deadEnds.some(w => w.nodeId === 'a1')).toBe(true);
    });

    test('UNUSED_FORK_BRANCH for Fork with missing branch output', () => {
      const t = validTrigger('t1');
      const f = validFork('f1', 3);
      const a = validAction('a1');
      const edges = [
        makeEdge('e0', 't1', 'f1'),
        // Only wire branch-0, leaving branch-1 and branch-2 unused.
        makeEdge('e1', 'f1', 'a1', 'branch-0', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, f, a], edges));
      const unused = result.warnings.filter(w => w.code === 'UNUSED_FORK_BRANCH');
      expect(unused.length).toBe(2);
      expect(unused.every(w => w.nodeId === 'f1')).toBe(true);
      expect(unused.map(w => w.field).sort()).toEqual(['branch-1', 'branch-2']);
    });

    test('UNUSED_CONDITION_BRANCH for Condition missing true or false', () => {
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const a = validAction('a1');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'a1', 'true', 'in'),
        // `false` branch is unused
      ];
      const result = validatePipeline(makePipeline([t, c, a], edges));
      const unused = result.warnings.filter(w => w.code === 'UNUSED_CONDITION_BRANCH');
      expect(unused.length).toBe(1);
      expect(unused[0].nodeId).toBe('c1');
      expect(unused[0].field).toBe('false');
    });
  });

  // -------------------------------------------------------------------------
  // isValid / canPublish
  // -------------------------------------------------------------------------

  describe('isValid / canPublish', () => {
    test('isValid=true + canPublish=true when no errors', () => {
      const t = validTrigger('t1');
      const a = validAction('a1');
      const edges = [makeEdge('e0', 't1', 'a1')];
      const result = validatePipeline(makePipeline([t, a], edges));
      expect(result.errors.length).toBe(0);
      expect(result.isValid).toBe(true);
      expect(result.canPublish).toBe(true);
    });

    test('isValid=false + canPublish=false when any error', () => {
      // Pipeline with no trigger → NO_TRIGGER error
      const a = validAction('a1');
      const result = validatePipeline(makePipeline([a], []));
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.isValid).toBe(false);
      expect(result.canPublish).toBe(false);
    });

    test('warnings do not block canPublish', () => {
      // Pipeline with exactly one warning (unused condition branch) and no errors.
      const t = validTrigger('t1');
      const c = validCondition('c1');
      const a = validAction('a1');
      const edges = [
        makeEdge('e0', 't1', 'c1'),
        makeEdge('e1', 'c1', 'a1', 'true', 'in'),
      ];
      const result = validatePipeline(makePipeline([t, c, a], edges));
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
      expect(result.canPublish).toBe(true);
      expect(result.isValid).toBe(true);
    });
  });
});
