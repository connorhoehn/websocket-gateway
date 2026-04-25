// frontend/src/components/pipelines/canvas/autoArrange.ts
//
// Pure layout helper for the pipeline canvas. Computes a clean BFS-layered
// left-to-right layout for every node in the definition, keyed off depth from
// the trigger:
//
//   depth 0 = trigger
//   depth N = column N to the right
//
// Within each layer, nodes are sorted by id (deterministic) and distributed
// vertically, centered around `startY`. Nodes unreachable from the trigger
// are placed in their own column to the right of the deepest reachable node
// so the user can find and re-wire them. Wide layers (Fork/Join) simply grow
// vertically — we do not attempt to minimize edge crossings (that's a Phase 5
// polish and would require a real layered layout engine like dagre / elk).
//
// Exported as a pure function so the caller (PipelineCanvas) can pipe the
// result through the editor context's `setPositions` API exactly the same way
// drag-settle position updates flow today.
//
// Refs: PIPELINES_PLAN.md §18.4.3 (canvas) / §18.11 (editor UX polish).

import type { PipelineDefinition } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ArrangedPosition {
  id: string;
  position: { x: number; y: number };
}

export interface AutoArrangeOptions {
  /** Horizontal spacing between depth layers. Default 280. */
  layerSpacingX?: number;
  /** Vertical spacing between siblings within a layer. Default 120. */
  nodeSpacingY?: number;
  /** Origin x for depth-0. Default 40. */
  startX?: number;
  /** Vertical centerline for each layer. Default 40. */
  startY?: number;
}

const DEFAULT_LAYER_SPACING_X = 280;
const DEFAULT_NODE_SPACING_Y = 120;
const DEFAULT_START_X = 40;
const DEFAULT_START_Y = 40;

// ---------------------------------------------------------------------------
// autoArrange
// ---------------------------------------------------------------------------

/**
 * Compute new positions for every node by BFS depth from the Trigger.
 *
 * - Depth 0 = trigger (or first node if no trigger exists)
 * - Each depth layer occupies a column to the right of the previous layer
 * - Nodes within a layer are sorted by id and distributed vertically,
 *   centered around `startY` with `nodeSpacingY` between adjacent siblings
 * - Orphans (nodes unreachable from the trigger) are placed in their own
 *   column at depth `maxDepth + 1`
 * - Empty pipeline → returns []
 * - No trigger → all nodes treated as orphans, single column at `startX`
 *
 * Pure function; deterministic for a given input.
 */
export function autoArrange(
  def: PipelineDefinition,
  opts?: AutoArrangeOptions,
): ArrangedPosition[] {
  const layerSpacingX = opts?.layerSpacingX ?? DEFAULT_LAYER_SPACING_X;
  const nodeSpacingY = opts?.nodeSpacingY ?? DEFAULT_NODE_SPACING_Y;
  const startX = opts?.startX ?? DEFAULT_START_X;
  const startY = opts?.startY ?? DEFAULT_START_Y;

  if (def.nodes.length === 0) return [];

  // Build adjacency from edges. Multiple edges between the same source/target
  // collapse to a single visit by virtue of the visited-set guard below.
  const adj = new Map<string, string[]>();
  for (const node of def.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of def.edges) {
    const list = adj.get(edge.source);
    // Edges may reference ids that don't exist in nodes (corrupt data). Skip
    // them silently — autoArrange is best-effort layout, not validation.
    if (!list) continue;
    if (!adj.has(edge.target)) continue;
    list.push(edge.target);
  }

  // Find the trigger node. The pipeline model permits at most one (validation
  // surfaces MULTIPLE_TRIGGERS as an error), but we tolerate >1 by picking
  // the lowest-id one for determinism.
  const triggers = def.nodes
    .filter((n) => n.type === 'trigger')
    .map((n) => n.id)
    .sort();
  const triggerId = triggers[0];

  // BFS from trigger to assign depths. Nodes never visited (no trigger, or
  // unreachable) stay undefined and become orphans below.
  const depth = new Map<string, number>();
  if (triggerId !== undefined) {
    const queue: string[] = [triggerId];
    depth.set(triggerId, 0);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const d = depth.get(id) as number;
      const neighbors = adj.get(id) ?? [];
      for (const next of neighbors) {
        if (depth.has(next)) continue;
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
  }

  // Group reachable nodes by depth. Sort each layer by id for deterministic
  // ordering; this matters for snapshot tests and for stable visuals across
  // re-arranges.
  const layers = new Map<number, string[]>();
  let maxDepth = -1;
  for (const node of def.nodes) {
    const d = depth.get(node.id);
    if (d === undefined) continue;
    if (!layers.has(d)) layers.set(d, []);
    (layers.get(d) as string[]).push(node.id);
    if (d > maxDepth) maxDepth = d;
  }
  for (const ids of layers.values()) {
    ids.sort();
  }

  // Orphan column: one to the right of the deepest reachable layer when at
  // least one node was reached. When nothing was reached (no trigger), orphans
  // start at depth 0.
  const orphanIds = def.nodes
    .filter((n) => !depth.has(n.id))
    .map((n) => n.id)
    .sort();
  const orphanDepth = maxDepth >= 0 ? maxDepth + 1 : 0;
  if (orphanIds.length > 0) {
    layers.set(orphanDepth, orphanIds);
  }

  // Project to ArrangedPosition[]. Within a layer of size N, indices 0..N-1
  // are spread around startY: y = startY + (i - N/2) * nodeSpacingY. For odd
  // N this places the middle node exactly at startY; for even N startY falls
  // between the two middle nodes — both are visually balanced.
  const out: ArrangedPosition[] = [];
  // Iterate in ascending depth so output is stable left-to-right.
  const depthsAsc = [...layers.keys()].sort((a, b) => a - b);
  for (const d of depthsAsc) {
    const ids = layers.get(d) as string[];
    const size = ids.length;
    const x = startX + d * layerSpacingX;
    for (let i = 0; i < size; i++) {
      const y = startY + (i - size / 2) * nodeSpacingY;
      out.push({ id: ids[i], position: { x, y } });
    }
  }

  return out;
}
