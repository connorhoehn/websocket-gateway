// Minimal React Flow test harness for pipeline node visual tests.
//
// Renders a single pipeline node inside a real <ReactFlow> + <ReactFlowProvider>
// so hooks that depend on the React Flow store (e.g. useNodeConnections,
// useNodeId) resolve correctly. The harness mirrors how PipelineCanvas wires
// the provider but strips it down to the bare minimum needed for jsdom.
//
// Usage:
//   const { container } = renderNodeInFlow({
//     nodeType: 'join',
//     Component: JoinNode,
//     data: { type: 'join', mode: 'all', mergeStrategy: 'deep-merge' },
//     edges: [
//       { id: 'e1', source: 'src1', target: 'n1', targetHandle: 'in-0' },
//     ],
//   });

import { render, type RenderResult } from '@testing-library/react';
import {
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import type { ComponentType } from 'react';

export interface RenderNodeInFlowOptions {
  /** React Flow node `type` key — must match the key in `nodeTypes`. */
  nodeType: string;
  /** The node component under test. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<NodeProps<any>>;
  /** Data passed as the node's `data` prop. */
  data: Record<string, unknown>;
  /** Optional id for the rendered node (default: 'n1'). */
  id?: string;
  /** Whether the node is rendered selected (default: false). */
  selected?: boolean;
  /**
   * Edges to seed React Flow's connectionLookup. Each edge's `target` should
   * usually be the node under test so `useNodeConnections({ handleType: 'target' })`
   * sees them. Stub source nodes are auto-created for any source ids referenced.
   */
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  /** Extra nodes to include alongside the node under test (rare). */
  extraNodes?: Node[];
}

/**
 * renderNodeInFlow — mounts `Component` as a React Flow node inside a real
 * ReactFlow canvas (with ReactFlowProvider) so store-dependent hooks resolve.
 */
export function renderNodeInFlow(opts: RenderNodeInFlowOptions): RenderResult {
  const {
    nodeType,
    Component,
    data,
    id = 'n1',
    selected = false,
    edges = [],
    extraNodes = [],
  } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeTypes: NodeTypes = { [nodeType]: Component as ComponentType<NodeProps<any>> };

  // Auto-stub any source nodes referenced by edges so React Flow's
  // connectionLookup considers them valid (the JoinNode only cares about
  // `useNodeConnections` reading inbound edges, not the source node visuals).
  const referencedSources = new Set<string>();
  for (const e of edges) {
    if (e.source !== id) referencedSources.add(e.source);
  }
  const stubSources: Node[] = Array.from(referencedSources).map((srcId) => ({
    id: srcId,
    type: 'default',
    position: { x: -200, y: 0 },
    data: { label: srcId },
  }));

  const nodes: Node[] = [
    {
      id,
      type: nodeType,
      position: { x: 0, y: 0 },
      data,
      selected,
    },
    ...stubSources,
    ...extraNodes,
  ];

  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));

  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </ReactFlowProvider>,
  );
}
