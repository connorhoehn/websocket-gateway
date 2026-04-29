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

import type { NodeType, PipelineDefinition, PipelineNode } from '../../../types/pipeline';
import { usePipelineEditor } from '../context/PipelineEditorContext';
import { isValidHandleConnection } from '../validation/handleCompatibility';
import { nodeTypes as registeredNodeTypes } from '../nodes';
import { colors } from '../../../constants/styles';
import AnimatedEdge from './edges/AnimatedEdge';
import QuickInsertPopover from './QuickInsertPopover';
import { autoArrange } from './autoArrange';
import { PALETTE_ITEMS } from './NodePalette';
import { useDevEditorBridge } from '../dev/useDevEditorBridge';

// ---------------------------------------------------------------------------
// Keyboard helpers (lifted from `useReplayKeyboard.ts` so the canvas honours
// the same bail-on-input rule the replay scrubber uses).
// ---------------------------------------------------------------------------

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Compute a topological-ish ordering of node ids for keyboard navigation.
 * Tab cycles through nodes in this order. Falls back to insertion order when
 * the graph has cycles or unreachable components (orphans appended at end,
 * sorted by id for determinism — same convention as `autoArrange`).
 *
 * Exported so unit tests can verify the order without spinning up React Flow.
 */
export function topologicalNodeOrder(def: PipelineDefinition): string[] {
  if (def.nodes.length === 0) return [];

  // Build adjacency + indegree.
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of def.nodes) {
    adj.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of def.edges) {
    if (!adj.has(e.source) || !indegree.has(e.target)) continue;
    (adj.get(e.source) as string[]).push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  // Kahn's algorithm. Process zero-indegree nodes in id-sorted order so the
  // result is deterministic across renders.
  const result: string[] = [];
  const ready: string[] = def.nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort();
  while (ready.length > 0) {
    const id = ready.shift() as string;
    result.push(id);
    const neighbors = (adj.get(id) ?? []).slice().sort();
    for (const next of neighbors) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) ready.push(next);
    }
  }
  // Cycle members never reach indegree 0 — append them in id-sorted order so
  // they're still reachable via Tab.
  if (result.length < def.nodes.length) {
    const seen = new Set(result);
    const stragglers = def.nodes
      .filter((n) => !seen.has(n.id))
      .map((n) => n.id)
      .sort();
    result.push(...stragglers);
  }
  return result;
}

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
    selectedNodeId,
    setSelectedNodeId,
    updateNodeData,
  } = usePipelineEditor();

  const { screenToFlowPosition, fitView } = useReactFlow();

  // Dev-only: expose `window.__pipelineEditor.{insertNode, connect, ...}` so
  // E2E tests can drive the canvas without HTML5 drag-and-drop (which
  // Chromium DevTools Protocol can't fire dataTransfer events for reliably).
  // Stripped from production builds via the import.meta.env.DEV gate inside
  // the hook itself.
  useDevEditorBridge({
    addNode,
    addEdge: addDefEdge,
    updateNodeData,
    getDefinition: () => definition,
  });

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
  // Also wires the 1-8 palette shortcut (matches the visible kbd badges
  // on each NodePalette item; PALETTE_ITEMS owns the order).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') {
        setShowMiniMap((x) => !x);
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        setShowControls((x) => !x);
        return;
      }
      // 1-8 palette shortcut — insert at canvas center.
      if (/^[1-8]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const entry = PALETTE_ITEMS[idx];
        if (!entry) return;
        // Single-instance types (today: only `trigger`) are skipped when
        // already placed.
        if (
          entry.type === 'trigger' &&
          definition?.nodes.some((n) => n.type === 'trigger')
        ) {
          return;
        }
        // Insert at the visible canvas center, then settle a few px to the
        // right of any existing node at the same position so consecutive
        // shortcuts don't pile up.
        const container = containerRef.current;
        const rect = container?.getBoundingClientRect();
        const center = rect
          ? screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            })
          : { x: 0, y: 0 };
        // Stagger by 24px down/right for each existing node within ~16px of
        // the center so back-to-back inserts don't visually overlap.
        let { x, y } = center;
        if (definition) {
          for (const n of definition.nodes) {
            if (Math.abs(n.position.x - x) < 16 && Math.abs(n.position.y - y) < 16) {
              x += 24;
              y += 24;
            }
          }
        }
        addNode(entry.type, { x, y });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode, definition, screenToFlowPosition]);

  // ── Canvas keyboard navigation (a11y) ─────────────────────────────────
  //
  // Active only when focus is inside the canvas container so the global
  // PipelineEditorPage shortcuts (⌘S, ⌘Enter, etc.) keep working from the
  // top bar. Bail rule mirrors the replay scrubber's `isEditableTarget` —
  // we never swallow keys destined for an input/textarea/contenteditable.
  //
  // Shortcut table (kept in sync with PIPELINES_PLAN.md §18.13):
  //   Tab            cycle focus to next node (in topological order)
  //   Shift+Tab      cycle focus to previous node
  //   Enter / Space  select the focused node (same as click)
  //   Delete / Bksp  remove the selected node (with the existing remove flow)
  //   Shift+Arrows   nudge the selected node by 8px
  //   Escape         clear selection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusNodeById = (id: string) => {
      // React Flow wraps each rendered node in a `.react-flow__node` element
      // with `data-id`. Walk into the wrapper and focus its inner BaseNode
      // (`role="button"` + `data-pipeline-node`). When the inner card isn't
      // there yet (jsdom render edge), fall back to focusing the wrapper.
      const wrapper = container.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id)}"]`,
      );
      if (!wrapper) return false;
      const inner = wrapper.querySelector<HTMLElement>('[data-pipeline-node="true"]');
      (inner ?? wrapper).focus();
      return true;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // Only act when focus is inside the canvas (or there's no focused element
      // and the user pressed a node-targeting key — Tab still gets a chance to
      // land on the first node).
      const active = document.activeElement as HTMLElement | null;
      const focusInCanvas = !!active && container.contains(active);

      // ── Tab cycling ────────────────────────────────────────────────
      if (e.key === 'Tab') {
        if (!focusInCanvas) return;
        if (!definition || definition.nodes.length === 0) return;
        const order = topologicalNodeOrder(definition);
        if (order.length === 0) return;
        // Identify the currently focused node by its data-id (set by React
        // Flow on the wrapper). The BaseNode card sits inside that wrapper.
        const currentWrapper = active?.closest<HTMLElement>('.react-flow__node');
        const currentId = currentWrapper?.getAttribute('data-id') ?? null;
        const currentIdx = currentId !== null ? order.indexOf(currentId) : -1;
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx = currentIdx === -1
          ? (e.shiftKey ? order.length - 1 : 0)
          : (currentIdx + delta + order.length) % order.length;
        const nextId = order[nextIdx];
        if (focusNodeById(nextId)) {
          e.preventDefault();
        }
        return;
      }

      // The remaining shortcuts only fire when the canvas already has focus.
      if (!focusInCanvas) return;

      // Don't fight ⌘/Ctrl/Alt combos — those belong to the page-level
      // shortcut handler in PipelineEditorPage.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ── Enter / Space — select the focused node ────────────────────
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        const wrapper = active?.closest<HTMLElement>('.react-flow__node');
        const id = wrapper?.getAttribute('data-id');
        if (id) {
          e.preventDefault();
          setSelectedNodeId(id);
        }
        return;
      }

      // ── Delete / Backspace — remove the selected node ──────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedNodeId) return;
        e.preventDefault();
        removeNode(selectedNodeId);
        return;
      }

      // ── Escape — clear selection ───────────────────────────────────
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedNodeId(null);
        return;
      }

      // ── Arrow keys — Shift nudges by 8px, plain arrows are swallowed
      // so React Flow's built-in arrow-key node-move (a11y default) doesn't
      // double-fire alongside our handler.
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.shiftKey) return;
        if (!selectedNodeId) return;
        const NUDGE = 8;
        const dx =
          e.key === 'ArrowLeft' ? -NUDGE : e.key === 'ArrowRight' ? NUDGE : 0;
        const dy =
          e.key === 'ArrowUp' ? -NUDGE : e.key === 'ArrowDown' ? NUDGE : 0;
        setNodes((curr) => {
          const next = curr.map((n) =>
            n.id === selectedNodeId
              ? {
                  ...n,
                  position: {
                    x: n.position.x + dx,
                    y: n.position.y + dy,
                  },
                }
              : n,
          );
          const moved = next.find((n) => n.id === selectedNodeId);
          if (moved) {
            setPositions([{ id: moved.id, position: moved.position }]);
          }
          return next;
        });
      }
    };

    container.addEventListener('keydown', onKey);
    return () => container.removeEventListener('keydown', onKey);
  }, [definition, selectedNodeId, setSelectedNodeId, removeNode, setNodes, setPositions]);

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

  // Auto-arrange button sits immediately to the left of the fit-view control,
  // sharing the same 32×32 card treatment so the two read as a control group.
  const autoArrangeBtnStyle = useMemo<CSSProperties>(
    () => ({
      ...fitViewBtnStyle,
      right: 12 + 32 + 6,
    }),
    [fitViewBtnStyle],
  );

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.15, duration: 500 });
  }, [fitView]);

  // Auto-arrange: rebuild the canvas layout into BFS-layered columns from the
  // trigger, then animate the viewport to fit so the new layout is visible.
  // Both Shift+A and the toolbar button funnel through this single handler.
  const handleAutoArrange = useCallback(() => {
    if (!definition) return;
    const positions = autoArrange(definition);
    if (positions.length === 0) return;
    setPositions(positions);
    // fitView reads the latest node geometry from React Flow's internal store;
    // the setNodes effect that mirrors the definition runs synchronously after
    // setPositions commits, so we can call fitView on the next tick. Using
    // requestAnimationFrame keeps it framework-agnostic and test-friendly.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => fitView({ padding: 0.15, duration: 500 }));
    } else {
      fitView({ padding: 0.15, duration: 500 });
    }
  }, [definition, setPositions, fitView]);

  // Listen for Shift+A on the window — same skip rule as the [M]/[C] toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // Shift+A only — bare 'a' must not steal focus from other handlers.
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        // Don't fire when other modifiers are pressed (Cmd+Shift+A etc).
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        handleAutoArrange();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleAutoArrange]);

  // TODO Phase 2: alignment guides — when a node drags, render 1px blue lines
  // where its top/middle/bottom or left/center/right align with other nodes.
  // React Flow has no native support; needs a custom overlay that subscribes
  // to node positions during drag. Deferred past Phase 1.

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      role="application"
      aria-label="Pipeline editor canvas"
      tabIndex={0}
      data-testid="pipeline-canvas"
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
        onClick={handleAutoArrange}
        style={autoArrangeBtnStyle}
        title="Auto-arrange (Shift+A)"
        aria-label="Auto-arrange"
        data-testid="auto-arrange-btn"
      >
        {/* Stack-of-rows pictogram — three left-aligned bars suggesting an
            ordered, layered layout. Pure stroke so it picks up currentColor. */}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 4h8M2 8h12M2 12h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
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
