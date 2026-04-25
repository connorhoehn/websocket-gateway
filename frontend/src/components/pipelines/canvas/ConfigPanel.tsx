// frontend/src/components/pipelines/canvas/ConfigPanel.tsx
//
// Right slide-over config panel per PIPELINES_PLAN.md §18.4.5 / §19.6.
//
// Opens when a node is selected; closes on Esc, click-outside, or the header
// close button. Body dispatches to per-type *Config components for the Config
// tab; Runs / Docs tabs are simple placeholders for now.
//
// Multi-selection path: if >1 node is selected (passed via `selectedIds`
// prop, typically fed by React Flow selection inside the canvas), the panel
// renders a compact bulk-action pane instead of a single-node config form.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { NodeData, NodeType, PipelineNode } from '../../../types/pipeline';
import { colors } from '../../../constants/styles';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';
import { usePipelineEditor } from '../context/PipelineEditorContext';
import TriggerConfig from '../nodes/trigger/TriggerConfig';
import LLMConfig from '../nodes/llm/LLMConfig';
import TransformConfig from '../nodes/transform/TransformConfig';
import ConditionConfig from '../nodes/condition/ConditionConfig';
import ActionConfig from '../nodes/action/ActionConfig';
import ForkConfig from '../nodes/fork/ForkConfig';
import JoinConfig from '../nodes/join/JoinConfig';
import ApprovalConfig from '../nodes/approval/ApprovalConfig';
import docsContent from '../nodes/docsContent';

// ---------------------------------------------------------------------------
// Per-type icon + display name (matches NodePalette).
// ---------------------------------------------------------------------------

const TYPE_META: Record<NodeType, { icon: string; name: string; docs: string }> = {
  trigger: {
    icon: '⚡',
    name: 'Trigger',
    docs: 'The entry point of the pipeline. Configure how the pipeline is started — manually, on a document event, on a schedule, or via webhook.',
  },
  llm: {
    icon: '🧠',
    name: 'LLM',
    docs: 'Calls an LLM model with a system + user prompt. Supports variable substitution from pipeline context (e.g. {{context.document.body}}).',
  },
  transform: {
    icon: '🔧',
    name: 'Transform',
    docs: 'Reshape or extract data from pipeline context using JSONPath, template strings, or sandboxed JavaScript.',
  },
  condition: {
    icon: '🔀',
    name: 'Condition',
    docs: 'Branch the pipeline on a boolean expression. The `true` output runs on match, the `false` output otherwise.',
  },
  action: {
    icon: '🎯',
    name: 'Action',
    docs: 'Produce a side effect — update a document, post a comment, notify a user, hit a webhook, or invoke an MCP tool.',
  },
  fork: {
    icon: '🍴',
    name: 'Fork',
    docs: 'Split execution into N parallel branches. Use with a Join to wait for all branches to complete.',
  },
  join: {
    icon: '🔗',
    name: 'Join',
    docs: 'Wait for multiple parallel branches to complete and merge their outputs. Supports all / any / n-of-m modes.',
  },
  approval: {
    icon: '✅',
    name: 'Approval',
    docs: 'Pause the pipeline and wait for a human to approve or reject. Supports n-of-m approvers and timeout fallbacks.',
  },
};

type Tab = 'config' | 'runs' | 'docs';

export interface ConfigPanelProps {
  /**
   * React Flow's current selected node IDs. If omitted or of length ≤ 1 the
   * panel falls back to `selectedNodeId` from the editor context.
   */
  selectedIds?: string[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelWidth = 320;

const wrapStyle = (open: boolean, reduceMotion: boolean): CSSProperties => ({
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: panelWidth,
  background: '#ffffff',
  borderLeft: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  transform: open ? 'translateX(0)' : `translateX(${panelWidth + 24}px)`,
  // §18.12 reduced-motion: panel appears/disappears instantly instead of
  // using the 200ms slide-over animation.
  transition: reduceMotion
    ? 'none'
    : open
      ? 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)'
      : 'transform 160ms cubic-bezier(0.4, 0, 0.2, 1)',
  zIndex: 20,
  pointerEvents: open ? 'auto' : 'none',
});

const headerStyle: CSSProperties = {
  height: 44,
  padding: '0 12px 0 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const tabsRowStyle: CSSProperties = {
  height: 36,
  display: 'flex',
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const tabStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  border: 'none',
  background: 'transparent',
  fontSize: 12,
  fontWeight: 600,
  color: active ? '#0f172a' : '#64748b',
  borderBottom: active ? '2px solid #646cff' : '2px solid transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};

const footerStyle: CSSProperties = {
  height: 40,
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  borderTop: '1px solid #e2e8f0',
  flexShrink: 0,
};

const deleteBtnStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: '#dc2626',
  border: '1px solid transparent',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const duplicateBtnStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: '#f1f5f9',
  color: '#0f172a',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const closeBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: '#64748b',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 4,
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Dispatch to per-type Config. Each *Config expects `{ data, onChange }`.
// Typed as a loose component to tolerate sibling-agent stubs that may not
// yet declare the full props shape.
// ---------------------------------------------------------------------------

type AnyConfig = (props: {
  data: NodeData;
  onChange: (patch: Partial<NodeData>) => void;
}) => ReactElement;

const CONFIGS: Record<NodeType, AnyConfig> = {
  trigger: TriggerConfig as unknown as AnyConfig,
  llm: LLMConfig as unknown as AnyConfig,
  transform: TransformConfig as unknown as AnyConfig,
  condition: ConditionConfig as unknown as AnyConfig,
  action: ActionConfig as unknown as AnyConfig,
  fork: ForkConfig as unknown as AnyConfig,
  join: JoinConfig as unknown as AnyConfig,
  approval: ApprovalConfig as unknown as AnyConfig,
};

function renderConfig(
  node: PipelineNode,
  onChange: (patch: Partial<NodeData>) => void,
): ReactElement {
  const Config = CONFIGS[node.type];
  return <Config data={node.data} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfigPanel({ selectedIds }: ConfigPanelProps) {
  const {
    definition,
    selectedNodeId,
    setSelectedNodeId,
    updateNodeData,
    removeNode,
    duplicateNodes,
  } = usePipelineEditor();

  const [tab, setTab] = useState<Tab>('config');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  // Effective selection: multi-select wins when passed; else single from ctx.
  const effectiveIds = useMemo(() => {
    if (selectedIds && selectedIds.length > 1) return selectedIds;
    if (selectedNodeId) return [selectedNodeId];
    return [];
  }, [selectedIds, selectedNodeId]);

  const isMulti = effectiveIds.length > 1;
  const open = effectiveIds.length > 0;

  const selectedNode = useMemo<PipelineNode | null>(() => {
    if (isMulti || effectiveIds.length === 0 || !definition) return null;
    return definition.nodes.find((n) => n.id === effectiveIds[0]) ?? null;
  }, [definition, effectiveIds, isMulti]);

  const close = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // Reset tab to 'config' when selection changes to a different node.
  useEffect(() => {
    setTab('config');
  }, [effectiveIds.join(',')]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Click-outside to close (panel click = inside; anything else outside).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = panelRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      // Let the canvas's own onPaneClick handle clearing selection — but if
      // the user clicks chrome outside the panel (top bar, palette, etc.)
      // we still close. The canvas will separately fire onPaneClick which
      // also calls setSelectedNodeId(null), so this is idempotent.
      if (!(e.target instanceof Element)) return;
      // Heuristic: don't close if the click lands inside a palette draggable.
      if (e.target.closest('[data-node-type]')) return;
      close();
    };
    // `mousedown` so we fire before the canvas's own click handling.
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  // If nothing selected, render the collapsed frame (still in the DOM so the
  // CSS transition can animate).
  const meta = selectedNode ? TYPE_META[selectedNode.type] : null;

  const handleDelete = () => {
    if (isMulti) {
      for (const id of effectiveIds) removeNode(id);
    } else if (selectedNode) {
      removeNode(selectedNode.id);
    }
  };

  const handleDuplicate = () => {
    if (effectiveIds.length === 0) return;
    duplicateNodes(effectiveIds);
  };

  const onChange = (patch: Partial<NodeData>) => {
    if (!selectedNode) return;
    updateNodeData(selectedNode.id, patch);
  };

  return (
    <div ref={panelRef} style={wrapStyle(open, reduceMotion)} data-testid="config-panel">
      {isMulti ? (
        // ---------------------------------------------------------------
        // Multi-select pane
        // ---------------------------------------------------------------
        <>
          <div style={headerStyle}>
            <span style={{ fontSize: 16 }} aria-hidden>⧉</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
              {effectiveIds.length} nodes selected
            </div>
            <button type="button" onClick={close} style={closeBtnStyle} aria-label="Close">
              ×
            </button>
          </div>
          <div style={{ ...bodyStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Bulk actions apply to every selected node. Individual node
              configuration is only shown for single selections.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleDelete} style={{ ...deleteBtnStyle, border: '1px solid #fecaca' }}>
                Delete all
              </button>
              <button type="button" onClick={handleDuplicate} style={duplicateBtnStyle}>
                Duplicate all
              </button>
            </div>
          </div>
        </>
      ) : selectedNode && meta ? (
        // ---------------------------------------------------------------
        // Single-node pane
        // ---------------------------------------------------------------
        <>
          <div style={headerStyle}>
            <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{meta.icon}</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
              {meta.name}
            </div>
            <button type="button" onClick={close} style={closeBtnStyle} aria-label="Close">
              ×
            </button>
          </div>
          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Node configuration tabs"
            style={tabsRowStyle}
            onKeyDown={(e) => {
              // Roving tabindex: ←/→ move focus between tabs, Home/End jump
              // to first/last, space/enter activate the focused tab.
              const order: Tab[] = ['config', 'runs', 'docs'];
              const idx = order.indexOf(tab);
              let next: Tab | null = null;
              if (e.key === 'ArrowRight') next = order[(idx + 1) % order.length];
              else if (e.key === 'ArrowLeft') next = order[(idx - 1 + order.length) % order.length];
              else if (e.key === 'Home') next = order[0];
              else if (e.key === 'End') next = order[order.length - 1];
              if (next) {
                e.preventDefault();
                setTab(next);
                const btn = tabsRef.current?.querySelector<HTMLButtonElement>(
                  `[data-tab="${next}"]`,
                );
                btn?.focus();
              }
            }}
          >
            {(['config', 'runs', 'docs'] as Tab[]).map((key) => {
              const active = tab === key;
              const label = key === 'config' ? 'Config' : key === 'runs' ? 'Runs' : 'Docs';
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  data-tab={key}
                  style={tabStyle(active)}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={bodyStyle}>
            {tab === 'config' && renderConfig(selectedNode, onChange)}
            {tab === 'runs' && (
              <div style={{ padding: 24, fontSize: 12, color: '#64748b' }}>
                No runs yet.
              </div>
            )}
            {tab === 'docs' && (
              <div
                className="pipeline-docs-pane"
                style={{
                  padding: 16,
                  fontSize: 13,
                  color: colors.textPrimary,
                  lineHeight: 1.4,
                }}
              >
                {/* Scoped prose styles — we use inline <style> instead of CSS
                    modules to keep this file self-contained (see §19.5). */}
                <style>{`
                  .pipeline-docs-pane h4 {
                    font-size: 14px;
                    font-weight: 600;
                    color: ${colors.textPrimary};
                    margin: 16px 0 8px;
                    padding-bottom: 4px;
                    border-bottom: 1px solid ${colors.border};
                  }
                  .pipeline-docs-pane h4:first-child {
                    margin-top: 0;
                  }
                  .pipeline-docs-pane p {
                    margin: 0 0 8px;
                  }
                  .pipeline-docs-pane ul {
                    margin: 0 0 8px;
                    padding-left: 18px;
                  }
                  .pipeline-docs-pane li {
                    margin-bottom: 4px;
                  }
                  .pipeline-docs-pane code {
                    font-size: 12px;
                    color: ${colors.textSecondary};
                    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                  }
                `}</style>
                {docsContent[selectedNode.type] ?? (
                  <p style={{ color: colors.textSecondary }}>
                    No docs available for this node type.
                  </p>
                )}
              </div>
            )}
          </div>
          <div style={footerStyle}>
            <button type="button" onClick={handleDelete} style={deleteBtnStyle}>
              🗑 Delete node
            </button>
            <button type="button" onClick={handleDuplicate} style={duplicateBtnStyle}>
              ⧉ Duplicate
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
