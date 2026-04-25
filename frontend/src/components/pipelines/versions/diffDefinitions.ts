// frontend/src/components/pipelines/versions/diffDefinitions.ts
//
// Pure computation layer for `VersionDiffModal`. Given a current draft and
// (optionally) a last-published snapshot, computes:
//   - added / removed / modified nodes (matched by id)
//   - edge counts added / removed (matched by id)
//   - metadata deltas (name, icon, tags)
//
// A node counts as "modified" when its `data` field differs in any way from
// the published copy (deep equality, JSON.stringify). Position-only changes
// also count as modified but flag `positionChanged: true` so the UI can show
// a "moved" badge rather than a substantive content change.

import type {
  PipelineDefinition,
  PipelineNode,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeDiffRow {
  node: PipelineNode;
  /** True when the node's `data` field changed. */
  dataChanged: boolean;
  /** True when only `position` changed (and nothing else). */
  positionChanged: boolean;
}

export interface DefinitionDiff {
  addedNodes: NodeDiffRow[];
  removedNodes: NodeDiffRow[];
  modifiedNodes: NodeDiffRow[];
  addedEdges: number;
  removedEdges: number;
  nameChanged: boolean;
  previousName?: string;
  iconChanged: boolean;
  previousIcon?: string;
  tagsChanged: boolean;
  tagsAdded: string[];
  tagsRemoved: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v as Record<string, unknown>).sort();
      const sorted: Record<string, unknown> = {};
      for (const k of keys) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

function nodesById(nodes: PipelineNode[]): Map<string, PipelineNode> {
  const m = new Map<string, PipelineNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

function edgeIds(def: PipelineDefinition): Set<string> {
  return new Set(def.edges.map((e) => e.id));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function diffDefinitions(
  current: PipelineDefinition,
  published: PipelineDefinition | null,
): DefinitionDiff {
  if (!published) {
    return {
      addedNodes: current.nodes.map((node) => ({
        node,
        dataChanged: true,
        positionChanged: false,
      })),
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: current.edges.length,
      removedEdges: 0,
      nameChanged: false,
      iconChanged: false,
      tagsChanged: false,
      tagsAdded: [],
      tagsRemoved: [],
    };
  }

  const curById = nodesById(current.nodes);
  const pubById = nodesById(published.nodes);

  const addedNodes: NodeDiffRow[] = [];
  const removedNodes: NodeDiffRow[] = [];
  const modifiedNodes: NodeDiffRow[] = [];

  for (const [id, node] of curById) {
    const prev = pubById.get(id);
    if (!prev) {
      addedNodes.push({ node, dataChanged: true, positionChanged: false });
      continue;
    }
    const dataChanged = stableStringify(node.data) !== stableStringify(prev.data);
    const positionChanged =
      node.position.x !== prev.position.x ||
      node.position.y !== prev.position.y;
    if (dataChanged || positionChanged) {
      modifiedNodes.push({ node, dataChanged, positionChanged });
    }
  }

  for (const [id, node] of pubById) {
    if (!curById.has(id)) {
      removedNodes.push({ node, dataChanged: true, positionChanged: false });
    }
  }

  const curEdges = edgeIds(current);
  const pubEdges = edgeIds(published);
  let addedEdges = 0;
  let removedEdges = 0;
  for (const id of curEdges) if (!pubEdges.has(id)) addedEdges++;
  for (const id of pubEdges) if (!curEdges.has(id)) removedEdges++;

  const nameChanged = current.name !== published.name;
  const iconChanged = (current.icon ?? '') !== (published.icon ?? '');

  const curTags = new Set(current.tags ?? []);
  const pubTags = new Set(published.tags ?? []);
  const tagsAdded: string[] = [];
  const tagsRemoved: string[] = [];
  for (const t of curTags) if (!pubTags.has(t)) tagsAdded.push(t);
  for (const t of pubTags) if (!curTags.has(t)) tagsRemoved.push(t);
  const tagsChanged = tagsAdded.length > 0 || tagsRemoved.length > 0;

  return {
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedEdges,
    removedEdges,
    nameChanged,
    previousName: nameChanged ? published.name : undefined,
    iconChanged,
    previousIcon: iconChanged ? published.icon : undefined,
    tagsChanged,
    tagsAdded,
    tagsRemoved,
  };
}
