// frontend/src/components/pipelines/__tests__/diffDefinitions.test.ts
//
// Unit tests for the pure `diffDefinitions` function used by VersionDiffModal.

import { describe, test, expect } from 'vitest';
import { diffDefinitions } from '../versions/diffDefinitions';
import type {
  ConditionNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TriggerNodeData,
} from '../../../types/pipeline';

function makeDef(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  overrides: Partial<PipelineDefinition> = {},
): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    id: 'p',
    name: 'test',
    version: 1,
    status: 'draft',
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy: 'u',
    ...overrides,
  };
}

function trigger(id: string, triggerType: TriggerNodeData['triggerType'] = 'manual'): PipelineNode {
  const data: TriggerNodeData = { type: 'trigger', triggerType };
  return { id, type: 'trigger', position: { x: 0, y: 0 }, data };
}

function condition(id: string, label = 'q', expression = 'x > 0'): PipelineNode {
  const data: ConditionNodeData = { type: 'condition', expression, label };
  return { id, type: 'condition', position: { x: 100, y: 100 }, data };
}

describe('diffDefinitions', () => {
  test('returns empty published path when snapshot is null', () => {
    const current = makeDef([trigger('t')], []);
    const d = diffDefinitions(current, null);
    expect(d.addedNodes).toHaveLength(1);
    expect(d.removedNodes).toHaveLength(0);
    expect(d.modifiedNodes).toHaveLength(0);
  });

  test('detects added and removed nodes by id', () => {
    const current = makeDef([trigger('t'), condition('c')], []);
    const published = makeDef([trigger('t'), condition('old')], []);
    const d = diffDefinitions(current, published);
    expect(d.addedNodes.map((r) => r.node.id)).toEqual(['c']);
    expect(d.removedNodes.map((r) => r.node.id)).toEqual(['old']);
    expect(d.modifiedNodes).toHaveLength(0);
  });

  test('flags modified nodes when data changes but not position-only as "moved"', () => {
    const cur = makeDef(
      [trigger('t', 'schedule'), condition('c', 'new-label')],
      [],
    );
    const pub = makeDef([trigger('t', 'manual'), condition('c', 'old-label')], []);
    const d = diffDefinitions(cur, pub);
    expect(d.modifiedNodes).toHaveLength(2);
    expect(d.modifiedNodes.every((r) => r.dataChanged)).toBe(true);
    expect(d.modifiedNodes.every((r) => !r.positionChanged)).toBe(true);
  });

  test('position-only change shows as modified with moved badge flag', () => {
    const curCond = condition('c');
    curCond.position = { x: 200, y: 200 };
    const cur = makeDef([trigger('t'), curCond], []);
    const pub = makeDef([trigger('t'), condition('c')], []);
    const d = diffDefinitions(cur, pub);
    expect(d.modifiedNodes).toHaveLength(1);
    expect(d.modifiedNodes[0].positionChanged).toBe(true);
    expect(d.modifiedNodes[0].dataChanged).toBe(false);
  });

  test('counts edge adds and removes by edge id', () => {
    const cur = makeDef(
      [trigger('t'), condition('c')],
      [
        { id: 'e1', source: 't', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
        { id: 'e2', source: 't', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
      ],
    );
    const pub = makeDef(
      [trigger('t'), condition('c')],
      [
        { id: 'e1', source: 't', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
        { id: 'oldEdge', source: 't', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
      ],
    );
    const d = diffDefinitions(cur, pub);
    expect(d.addedEdges).toBe(1);
    expect(d.removedEdges).toBe(1);
  });

  test('surfaces metadata deltas (name, icon, tags)', () => {
    const cur = makeDef([trigger('t')], [], {
      name: 'New Name',
      icon: '🎉',
      tags: ['alpha', 'beta'],
    });
    const pub = makeDef([trigger('t')], [], {
      name: 'Old Name',
      icon: '🔀',
      tags: ['alpha', 'gamma'],
    });
    const d = diffDefinitions(cur, pub);
    expect(d.nameChanged).toBe(true);
    expect(d.previousName).toBe('Old Name');
    expect(d.iconChanged).toBe(true);
    expect(d.previousIcon).toBe('🔀');
    expect(d.tagsChanged).toBe(true);
    expect(d.tagsAdded).toContain('beta');
    expect(d.tagsRemoved).toContain('gamma');
  });
});
