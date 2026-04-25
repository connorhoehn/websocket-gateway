// frontend/src/components/pipelines/canvas/PipelineCanvas.tsx
//
// React Flow wrapper per PIPELINES_PLAN.md §18.4.3. Bridges React Flow's
// internal nodes/edges state to the PipelineEditorContext definition:
//
//   definition (source of truth) ──sync──▶  useNodesState / useEdgesState
//                   ▲                            │
//                   │                            │  onNodesChange / onEdgesChange
//                   └──── addNode / setPositions / addEdge / removeNode ◀──
//
// Drag-from-palette drops use the `application/reactflow` mime key (JSON
// `{ nodeType }`) that NodePalette sets.
//
// Connection validation delegates to isValidHandleConnection from
// validation/handleCompatibility so only type-compatible handles can be wired.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  NodeTypes,
  OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { NodeType, PipelineNode } from '../../../types/pipeline';
import { usePipelineEditor } from '../context/PipelineEditorContext';
import { isValidHandleConnection } from '../validation/handleCompatibility';
import { nodeTypes as registeredNodeTypes } from '../nodes';
import { colors } from '../../../constants/styles';
import AnimatedEdge from './edges/AnimatedEdge';
import QuickInsertPopover from './QuickInsertPopover';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CanvasNodeData extends Record<string, unknown> {
  // Mirrors PipelineNode.data; React Flow's Node<T> requires T to be a plain
  // object. We store the full NodeData discriminated union.
  nodeType: NodeType;
}

const edgeTypes = { animated: AnimatedEdge };

// ---------------------------------------------------------------------------
// Scoped CSS for React Flow's built-in Controls. We inject this as a <style>
// tag inside the component rather than a global stylesheet so it:
//   (a) lives alongside the canvas and is removed when the canvas unmounts,
//   (b) keeps overrides narrowly scoped to `.react-flow__controls` selectors,
//       which only exist inside this tree, and
//   (c) avoids adding a new CSS file to import in main.tsx — React Flow's
//       controls aren't stylable via props alone, so this is the lightest
//       intervention that still respects the app's visual language.
// ---------------------------------------------------------------------------
const controlsStyleOverrides = `
  .react-flow__controls button {
    background: transparent;
    border-bottom: 1px solid ${colors.border};
    color: ${colors.textSecondary};
  }
  .react-flow__controls button:hover {
    background: ${colors.surfaceHover};
    color: ${colors.textPrimary};
  }
  .react-flow__controls button:last-child {
    border-bottom: none;
  }
  .react-flow__controls-interactive.active {
    color: ${colors.primary};
  }
`;

// Fallback catch-all if `nodes/index.ts` hasn't populated yet — keeps the
// canvas renderable under a sibling agent's in-flight work. The registry is
// intentionally typed loosely; cast to React Flow's expected shape at the
// use site rather than leaking through our component surface.
const resolvedNodeTypes = registeredNodeTypes as unknown as NodeTypes;

// ---------------------------------------------------------------------------
// Mapping helpers between our definition and React Flow's internal shape
// ---------------------------------------------------------------------------

function toRFNode(n: PipelineNode): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data, nodeType: n.type } as CanvasNodeData,
  };
}

function toRFEdge(e: {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}): Edge {
  const labelFor =
    e.sourceHandle === 'true' ||
    e.sourceHandle === 'false' ||
    e.sourceHandle === 'approved' ||
    e.sourceHandle === 'rejected' ||
    e.sourceHandle === 'error' ||
    /^branch-\d+$/.test(e.sourceHandle)
      ? e.sourceHandle
      : undefined;
  return {
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    type: 'animated',
    data: { state: 'default', label: labelFor },
  };
}

// ---------------------------------------------------------------------------
// Inner component (wrapped in ReactFlowProvider so useReactFlow works)
// ---------------------------------------------------------------------------

interface NodeContextMenuState {
  nodeId: string;
  // Viewport coordinates where the menu anchors.
  x: number;
  y: number;
}

interface CanvasInnerProps {
  onFilterLog?: (nodeId: string) => void;
}

function CanvasInner({ onFilterLog }: CanvasInnerProps) {
  const {
    definition,
    addNode,
    setPositions,
    addEdge: addDefEdge,
    removeEdge: removeDefEdge,
    removeNode,
    setSelectedNodeId,
  } = usePipelineEditor();

  const { screenToFlowPosition, fitView } = useReactFlow();

  // Seed initial nodes/edges from definition; subsequent changes go through
  // onNodesChange/onEdgesChange and sync back to the definition in an effect.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Quick-insert popover state (per §18.4.3 / §18.11). `anchor` is the screen
  // coord where the popover paints; `flowPosition` is the React-Flow-space
  // coord where the new node will land if the user commits a selection.
  const [quickInsert, setQuickInsert] = useState<{
    anchor: { x: number; y: number };
    flowPosition: { x: number; y: number };
  } | null>(null);

  // Node right-click menu per §18.4.6 — triggers log filter / copy id.
  // Anchor is a viewport coord captured from the context event.
  const [nodeMenu, setNodeMenu] = useState<NodeContextMenuState | null>(null);

  const handleNodeContextMenu = useCallback(
    (e: MouseEvent, node: Node) => {
      e.preventDefault();
      setNodeMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
    },
    [],
  );

  // Dismiss the context menu on outside-click or Escape.
  useEffect(() => {
    if (!nodeMenu) return;
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="canvas-node-context-menu"]')) return;
      setNodeMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodeMenu(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [nodeMenu]);

  const handleFilterLogFromMenu = useCallback(() => {
    if (!nodeMenu) return;
    onFilterLog?.(nodeMenu.nodeId);
    setNodeMenu(null);
  }, [nodeMenu, onFilterLog]);

  const handleCopyNodeId = useCallback(() => {
    if (!nodeMenu) return;
    const id = nodeMenu.nodeId;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(id).catch(() => {
        // Clipboard may be unavailable (jsdom, permissions) — silently ignore.
      });
    }
    setNodeMenu(null);
  }, [nodeMenu]);

  // Sync definition → React Flow state on load / upstream mutation. We only
  // overwrite fully when the id-set changes or positions drift; React Flow's
  // internal drag state is left alone within a gesture to prevent jank.
  useEffect(() => {
    if (!definition) {
      setNodes([]);
      setEdges([]);
      return;
    }
    setNodes((current) => {
      // Preserve React Flow ephemeral flags (dragging, selected) while
      // rebuilding the core data each time the definition mutates.
      const byId = new Map(current.map((n) => [n.id, n]));
      return definition.nodes.map((n) => {
        const prev = byId.get(n.id);
        const next = toRFNode(n);
        return prev ? { ...prev, ...next, selected: prev.selected } : next;
      });
    });
    setEdges(() => definition.edges.map(toRFEdge));
  }, [definition, setNodes, setEdges]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // Persist position changes back to the definition only when the drag
      // settles (`dragging === false`).
      const settled: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'position' && c.position && c.dragging === false) {
          settled.push({ id: c.id, position: c.position });
        } else if (c.type === 'remove') {
          removed.push(c.id);
        }
      }
      if (settled.length) setPositions(settled);
      for (const id of removed) removeNode(id);
    },
    [onNodesChange, setPositions, removeNode],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      for (const c of changes) {
        if (c.type === 'remove') removeDefEdge(c.id);
      }
    },
    [onEdgesChange, removeDefEdge],
  );

  const handleConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!definition) return;
      if (!params.source || !params.target) return;
      const sourceNode = definition.nodes.find((n) => n.id === params.source);
      const targetNode = definition.nodes.find((n) => n.id === params.target);
      if (!sourceNode || !targetNode) return;
      const sourceHandle = params.sourceHandle ?? 'out';
      const targetHandle = params.targetHandle ?? 'in';
      if (
        !isValidHandleConnection(
          sourceNode.type,
          sourceHandle,
          targetNode.type,
          targetHandle,
        )
      ) {
        return;
      }
      addDefEdge({
        source: params.source,
        sourceHandle,
        target: params.target,
        targetHandle,
      });
    },
    [definition, addDefEdge],
  );

  const isValidConnection = useCallback(
    (params: Edge | Connection): boolean => {
      if (!definition) return false;
      if (!params.source || !params.target) return false;
      const sourceNode = definition.nodes.find((n) => n.id === params.source);
      const targetNode = definition.nodes.find((n) => n.id === params.target);
      if (!sourceNode || !targetNode) return false;
      return isValidHandleConnection(
        sourceNode.type,
        params.sourceHandle ?? 'out',
        targetNode.type,
        params.targetHandle ?? 'in',
      );
    },
    [definition],
  );

  const handleNodeClick = useCallback(
    (_: MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // Double-click on the pane → open quick-insert at the cursor. React Flow
  // fires `onPaneContextMenu` / `onPaneMouseMove` but exposes no named
  // `onPaneDoubleClick`, so we listen on the container and gate on the event
  // target being the pane (not a node / handle / edge). The standard React
  // Flow DOM classnames let us do this check without any extra instrumentation.
  const handlePaneDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Only trigger on the blank pane — the viewport / background own the
      // dblclick in that case. A node/handle/edge dblclick should pass through.
      const isPane =
        target.classList.contains('react-flow__pane') ||
        target.classList.contains('react-flow__renderer') ||
        target.classList.contains('react-flow__viewport') ||
        target.classList.contains('react-flow');
      if (!isPane) return;
      e.preventDefault();
      const flowPosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setQuickInsert({
        anchor: { x: e.clientX, y: e.clientY },
        flowPosition,
      });
    },
    [screenToFlowPosition],
  );

  const handleQuickInsertClose = useCallback(() => setQuickInsert(null), []);

  const handleQuickInsertInsert = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      addNode(type, position);
    },
    [addNode],
  );

  // Types that should be hidden in the quick-insert popover because at most
  // one instance is permitted (currently just Trigger per §18.4.2).
  const quickInsertDisabledTypes = useMemo<NodeType[]>(() => {
    if (!definition) return [];
    return definition.nodes.some((n) => n.type === 'trigger') ? ['trigger'] : [];
  }, [definition]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/reactflow');
      if (!raw) return;
      let parsed: { nodeType?: string } | null = null;
      try {
        parsed = JSON.parse(raw) as { nodeType?: string };
      } catch {
        return;
      }
      const nodeType = parsed?.nodeType as NodeType | undefined;
      if (!nodeType) return;
      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      addNode(nodeType, position);
    },
    [addNode, screenToFlowPosition],
  );

  // Toggle MiniMap / Controls via the [M] and [C] keys per §18.4.3.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in inputs.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'm' || e.key === 'M') setShowMiniMap((x) => !x);
      if (e.key === 'c' || e.key === 'C') setShowControls((x) => !x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const containerStyle = useMemo<CSSProperties>(
    () => ({
      flex: 1,
      minWidth: 0,
      minHeight: 520,
      position: 'relative',
      background: colors.surfaceInset,
    }),
    [],
  );

  // MiniMap node coloring — map each node's runtime `_state` (stamped by the
  // execution layer) to the shared state palette. Unknown / unstamped nodes
  // fall back to a muted tertiary gray so the mini-map still shows structure.
  const miniMapNodeColor = useCallback((node: Node): string => {
    const state = (node.data as { _state?: string } | undefined)?._state;
    switch (state) {
      case 'running':
      case 'pending':
        return colors.state.running;
      case 'completed':
        return colors.state.completed;
      case 'failed':
        return colors.state.failed;
      case 'awaiting':
        return colors.state.awaiting;
      default:
        return colors.textTertiary;
    }
  }, []);

  const miniMapStyle = useMemo<CSSProperties>(
    () => ({
      width: 180,
      height: 120,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
    }),
    [],
  );

  const controlsStyle = useMemo<CSSProperties>(
    () => ({
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }),
    [],
  );

  const fitViewBtnStyle = useMemo<CSSProperties>(
    () => ({
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 5,
      width: 32,
      height: 32,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      color: colors.textSecondary,
      cursor: 'pointer',
      padding: 0,
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1,
    }),
    [],
  );

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.15, duration: 500 });
  }, [fitView]);

  // TODO Phase 2: alignment guides — when a node drags, render 1px blue lines
  // where its top/middle/bottom or left/center/right align with other nodes.
  // React Flow has no native support; needs a custom overlay that subscribes
  // to node positions during drag. Deferred past Phase 1.

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDoubleClick={handlePaneDoubleClick}
    >
      <style>{controlsStyleOverrides}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={resolvedNodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={handlePaneClick}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={colors.border}
          bgColor={colors.surfaceInset}
        />
        {showControls ? (
          <Controls
            position="bottom-left"
            showZoom
            showFitView
            showInteractive
            style={controlsStyle}
          />
        ) : null}
        {showMiniMap ? (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            style={miniMapStyle}
            maskColor="rgba(15, 23, 42, 0.04)"
            nodeColor={miniMapNodeColor}
            nodeStrokeColor={colors.border}
          />
        ) : null}
      </ReactFlow>
      {quickInsert ? (
        <QuickInsertPopover
          anchor={quickInsert.anchor}
          flowPosition={quickInsert.flowPosition}
          disabledTypes={quickInsertDisabledTypes}
          onClose={handleQuickInsertClose}
          onInsert={handleQuickInsertInsert}
        />
      ) : null}
      <button
        type="button"
        onClick={handleFitView}
        style={fitViewBtnStyle}
        title="Fit view"
        aria-label="Fit view"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {nodeMenu ? (
        <div
          data-testid="canvas-node-context-menu"
          role="menu"
          style={{
            position: 'fixed',
            top: nodeMenu.y,
            left: nodeMenu.x,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.16)',
            minWidth: 220,
            zIndex: 50,
            padding: 4,
            fontFamily: 'inherit',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleFilterLogFromMenu}
            data-testid="ctx-filter-log"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 13,
              cursor: 'pointer',
              borderRadius: 4,
              fontFamily: 'inherit',
            }}
          >
            🎯 Filter log to this node
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleCopyNodeId}
            data-testid="ctx-copy-id"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 13,
              cursor: 'pointer',
              borderRadius: 4,
              fontFamily: 'inherit',
            }}
          >
            📋 Copy node id
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component — wraps in ReactFlowProvider so useReactFlow works inside
// ---------------------------------------------------------------------------

export interface PipelineCanvasProps {
  /**
   * Optional handler invoked from the node right-click menu's "Filter log to
   * this node" item — wired by `PipelineEditorPage` to focus the execution
   * log on a single node (§18.4.6).
   */
  onFilterLog?: (nodeId: string) => void;
}

export default function PipelineCanvas({ onFilterLog }: PipelineCanvasProps = {}) {
  return (
    <ReactFlowProvider>
      <CanvasInner onFilterLog={onFilterLog} />
    </ReactFlowProvider>
  );
}
