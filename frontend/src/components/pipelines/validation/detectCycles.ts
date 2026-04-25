// frontend/src/components/pipelines/validation/detectCycles.ts
//
// Cycle detection for pipeline graphs. Iterative DFS with WHITE/GRAY/BLACK
// coloring — a back-edge to a GRAY node closes a cycle; return that edge's id.
// See PIPELINES_PLAN.md §16.3.

import type { PipelineEdge, PipelineNode } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Color = 0 | 1 | 2; // 0 = WHITE, 1 = GRAY, 2 = BLACK

interface AdjEntry {
  target: string;
  edgeId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the id of an edge that closes a cycle, or null if the graph is acyclic. O(V+E). */
export function detectCycles(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): string | null {
  const adjacency = new Map<string, AdjEntry[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    const list = adjacency.get(edge.source);
    if (list) {
      list.push({ target: edge.target, edgeId: edge.id });
    }
  }

  const color = new Map<string, Color>();
  for (const node of nodes) {
    color.set(node.id, 0);
  }

  // Iterative DFS. Each stack frame tracks the node and an index into its
  // adjacency list so we can post-process (BLACK) when we finish all children.
  for (const startNode of nodes) {
    if (color.get(startNode.id) !== 0) continue;

    const stack: { nodeId: string; index: number }[] = [
      { nodeId: startNode.id, index: 0 },
    ];
    color.set(startNode.id, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.nodeId) ?? [];

      if (frame.index >= neighbors.length) {
        color.set(frame.nodeId, 2);
        stack.pop();
        continue;
      }

      const next = neighbors[frame.index];
      frame.index += 1;
      const nextColor = color.get(next.target);

      if (nextColor === 1) {
        // Back-edge to a node currently on the DFS stack → cycle.
        return next.edgeId;
      }
      if (nextColor === 0) {
        color.set(next.target, 1);
        stack.push({ nodeId: next.target, index: 0 });
      }
      // nextColor === 2 (BLACK) or undefined (edge to unknown node) → skip.
    }
  }

  return null;
}
