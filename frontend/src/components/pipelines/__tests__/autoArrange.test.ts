// frontend/src/components/pipelines/__tests__/autoArrange.test.ts
//
// Unit tests for the pure `autoArrange` BFS-layered layout helper.
// Verifies:
//   - linear chains spread across columns
//   - forks stack siblings vertically within a layer
//   - orphans get their own column at the far right
//   - empty + no-trigger edge cases
//   - deterministic output for identical input

import { describe, test, expect } from 'vitest';
import { autoArrange } from '../canvas/autoArrange';
import type {
  ActionNodeData,
  ConditionNodeData,
  ForkNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeDef(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): PipelineDefinition {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
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
  };
}

function trigger(id: string): PipelineNode {
  const data: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
  return { id, type: 'trigger', position: { x: 0, y: 0 }, data };
}

function condition(id: string): PipelineNode {
  const data: ConditionNodeData = { type: 'condition', expression: 'x > 0' };
  return { id, type: 'condition', position: { x: 0, y: 0 }, data };
}

function action(id: string): PipelineNode {
  const data: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {},
  };
  return { id, type: 'action', position: { x: 0, y: 0 }, data };
}

function fork(id: string, branchCount = 2): PipelineNode {
  const data: ForkNodeData = { type: 'fork', branchCount };
  return { id, type: 'fork', position: { x: 0, y: 0 }, data };
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle = 'out',
  targetHandle = 'in',
): PipelineEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

// Helper — index by node id for ergonomic assertions.
function byId(positions: ReturnType<typeof autoArrange>) {
  const map: Record<string, { x: number; y: number }> = {};
  for (const p of positions) map[p.id] = p.position;
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoArrange', () => {
  test('3-node linear chain → 3 columns', () => {
    const def = makeDef(
      [trigger('t'), condition('c'), action('a')],
      [edge('e1', 't', 'c'), edge('e2', 'c', 'a')],
    );
    const out = autoArrange(def);
    expect(out).toHaveLength(3);
    const m = byId(out);
    // Same y for single-node layers (size=1 → i=0, (0 - 0.5) * spacing).
    expect(m.t.x).toBe(40);
    expect(m.c.x).toBe(40 + 280);
    expect(m.a.x).toBe(40 + 280 * 2);
    // Single-node layers all sit at the same y → vertical-line layout.
    expect(m.t.y).toBe(m.c.y);
    expect(m.c.y).toBe(m.a.y);
  });

  test('fork (1 → 2) → trigger col 0, fork col 1, two siblings col 2 stacked vertically', () => {
    const def = makeDef(
      [trigger('t'), fork('f'), action('a1'), action('a2')],
      [
        edge('e1', 't', 'f'),
        edge('e2', 'f', 'a1', 'branch-0'),
        edge('e3', 'f', 'a2', 'branch-1'),
      ],
    );
    const out = autoArrange(def);
    expect(out).toHaveLength(4);
    const m = byId(out);
    expect(m.t.x).toBe(40);
    expect(m.f.x).toBe(40 + 280);
    // Both leaves at depth 2, same column.
    expect(m.a1.x).toBe(40 + 280 * 2);
    expect(m.a2.x).toBe(40 + 280 * 2);
    // Sibling layer of size 2 → ids sorted (a1 before a2), spread around startY.
    // y = startY + (i - size/2) * spacingY → -80, +40 with defaults.
    expect(m.a1.y).toBeLessThan(m.a2.y);
    expect(m.a2.y - m.a1.y).toBe(120);
  });

  test('orphan node not reachable from trigger → placed in orphan column at the far right', () => {
    const def = makeDef(
      [trigger('t'), condition('c'), action('orphan')],
      [edge('e1', 't', 'c')],
    );
    const out = autoArrange(def);
    expect(out).toHaveLength(3);
    const m = byId(out);
    // Reachable: t at depth 0, c at depth 1. Orphan goes to depth 2.
    expect(m.t.x).toBe(40);
    expect(m.c.x).toBe(40 + 280);
    expect(m.orphan.x).toBe(40 + 280 * 2);
  });

  test('empty pipeline → returns []', () => {
    const def = makeDef([], []);
    expect(autoArrange(def)).toEqual([]);
  });

  test('no trigger → all treated as orphans, single column', () => {
    const def = makeDef(
      [condition('c1'), condition('c2'), action('a')],
      [edge('e1', 'c1', 'c2')],
    );
    const out = autoArrange(def);
    expect(out).toHaveLength(3);
    const m = byId(out);
    // All in the orphan column at startX (depth 0 since nothing reachable).
    expect(m.c1.x).toBe(40);
    expect(m.c2.x).toBe(40);
    expect(m.a.x).toBe(40);
    // Sorted by id (a, c1, c2) → distinct y values, evenly spaced.
    const ys = [m.a.y, m.c1.y, m.c2.y];
    const sorted = [...ys].sort((p, q) => p - q);
    expect(ys).toEqual(sorted);
    expect(sorted[1] - sorted[0]).toBe(120);
    expect(sorted[2] - sorted[1]).toBe(120);
  });

  test('determinism: same input twice → same output', () => {
    const def = makeDef(
      [trigger('t'), fork('f'), action('a2'), action('a1')], // intentionally unsorted
      [
        edge('e1', 't', 'f'),
        edge('e2', 'f', 'a1', 'branch-0'),
        edge('e3', 'f', 'a2', 'branch-1'),
      ],
    );
    const a = autoArrange(def);
    const b = autoArrange(def);
    expect(a).toEqual(b);
  });

  test('respects custom spacing options', () => {
    const def = makeDef(
      [trigger('t'), action('a')],
      [edge('e1', 't', 'a')],
    );
    const out = autoArrange(def, {
      layerSpacingX: 100,
      nodeSpacingY: 50,
      startX: 0,
      startY: 0,
    });
    const m = byId(out);
    expect(m.t.x).toBe(0);
    expect(m.a.x).toBe(100);
  });

  test('every node in the definition gets exactly one position', () => {
    const def = makeDef(
      [
        trigger('t'),
        condition('c'),
        action('a1'),
        action('a2'),
        action('orphan1'),
        action('orphan2'),
      ],
      [edge('e1', 't', 'c'), edge('e2', 'c', 'a1'), edge('e3', 'c', 'a2')],
    );
    const out = autoArrange(def);
    expect(out).toHaveLength(def.nodes.length);
    const ids = new Set(out.map((p) => p.id));
    for (const n of def.nodes) expect(ids.has(n.id)).toBe(true);
  });
});
