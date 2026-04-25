// frontend/src/components/pipelines/canvas/ExecutionLog.tsx
//
// Bottom collapsible strip per PIPELINES_PLAN.md §18.4.6.
//
// Collapsed (40px): status + filter + controls. Expanded (240px): scrollable
// event list. Subscribes to the EventStream wildcard channel and keeps the
// last 500 events in local state; filtering is applied client-side. Rows are
// click-to-expand with pretty-printed JSON; autoscroll sticks to bottom by
// default and detaches when the user scrolls up (shows a "Jump to latest"
// pill bottom-right).
//
// Virtualized-ready in the §19 spec sense — the row list renders via normal
// overflow scrolling for now; swap to react-window later without disturbing
// the filter / event model.
//
// Polish features (§18.4.6):
//  - `⛶` fullscreen mode — renders into a portal over the viewport.
//  - `filterByNodeId` prop — right-click a node on the canvas to focus the
//    log on a single node. The chip above the rows reports the active filter
//    with a × to clear it.
//  - Row click-to-expand pretty-prints the payload JSON.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { PipelineEventMap } from '../../../types/pipeline';
import { useEventStream } from '../context/EventStreamContext';
import { getEventGlyph } from '../../shared/eventGlyphs';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type Filter = 'all' | 'errors' | 'approvals' | 'llm' | 'lifecycle';

interface LogRow {
  id: number;
  at: number;
  eventType: string;
  payload: unknown;
}

export interface ExecutionLogProps {
  /**
   * When set, the log only shows events whose payload references this node
   * (via `payload.stepId` or `payload.nodeId`). The chip above the rows
   * surfaces the current filter with a × to clear.
   */
  filterByNodeId?: string | null;
  /** Called when the user clears the node filter from the chip. */
  onClearFilter?: () => void;
  /**
   * Optional human label for the filter chip. When omitted we fall back to
   * the raw nodeId.
   */
  filterNodeLabel?: string | null;
}

const MAX_EVENTS = 500;

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  errors: 'Errors',
  approvals: 'Approvals',
  llm: 'LLM',
  lifecycle: 'Lifecycle',
};

function matchesFilter(eventType: string, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'errors') {
    return (
      eventType === 'pipeline.step.failed' ||
      eventType === 'pipeline.run.failed'
    );
  }
  if (filter === 'approvals') return eventType.startsWith('pipeline.approval.');
  if (filter === 'llm') return eventType.startsWith('pipeline.llm.');
  if (filter === 'lifecycle') {
    return (
      eventType.startsWith('pipeline.run.') ||
      eventType === 'pipeline.step.started' ||
      eventType === 'pipeline.step.completed' ||
      eventType === 'pipeline.step.skipped' ||
      eventType === 'pipeline.step.cancelled'
    );
  }
  return true;
}

function matchesNode(row: LogRow, nodeId: string): boolean {
  const p = row.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return false;
  if (typeof p.stepId === 'string' && p.stepId === nodeId) return true;
  if (typeof p.nodeId === 'string' && p.nodeId === nodeId) return true;
  return false;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function summarizePayload(row: LogRow): string {
  const p = row.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return '';
  const parts: string[] = [];
  if (typeof p.stepId === 'string') parts.push(String(p.stepId));
  if (typeof p.runId === 'string' && parts.length === 0) parts.push(String(p.runId));
  if (typeof p.durationMs === 'number') parts.push(`${p.durationMs}ms`);
  if (typeof p.nodeType === 'string') parts.push(`type: ${p.nodeType}`);
  if (typeof p.error === 'string') parts.push(p.error);
  if (
    typeof p.tokensIn === 'number' &&
    typeof p.tokensOut === 'number'
  ) {
    parts.push(`${p.tokensIn}→${p.tokensOut} tokens`);
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const wrapStyle = (expanded: boolean): CSSProperties => ({
  flexShrink: 0,
  height: expanded ? 240 : 40,
  transition: 'height 160ms cubic-bezier(0.4, 0, 0.2, 1)',
  borderTop: '1px solid #e2e8f0',
  background: '#ffffff',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'inherit',
});

const barStyle: CSSProperties = {
  height: 40,
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const chevBtnStyle: CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#64748b',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  fontFamily: 'inherit',
};

const statusStyle: CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: '#475569',
};

const controlBtnStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  background: '#f1f5f9',
  color: '#475569',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  background: '#ffffff',
  position: 'relative',
};

const rowStyle = (open: boolean): CSSProperties => ({
  padding: '4px 12px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 12,
  color: '#0f172a',
  cursor: 'pointer',
  background: open ? '#f8fafc' : 'transparent',
});

const tsStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#64748b',
  marginRight: 8,
};

const jumpPillStyle: CSSProperties = {
  position: 'absolute',
  bottom: 10,
  right: 14,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 600,
  background: '#0f172a',
  color: '#ffffff',
  border: 'none',
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.24)',
  zIndex: 2,
};

const filterChipRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const filterChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px 3px 10px',
  background: '#eff6ff',
  color: '#1d4ed8',
  border: '1px solid #bfdbfe',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'inherit',
};

const filterChipCloseStyle: CSSProperties = {
  width: 16,
  height: 16,
  border: 'none',
  background: 'transparent',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'inherit',
  lineHeight: 1,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const fullscreenBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 999,
};

const fullscreenCardStyle: CSSProperties = {
  width: '90vw',
  height: '90vh',
  background: '#ffffff',
  borderRadius: 10,
  boxShadow: '0 30px 60px rgba(15, 23, 42, 0.35)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExecutionLog({
  filterByNodeId = null,
  onClearFilter,
  filterNodeLabel = null,
}: ExecutionLogProps = {}) {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [pinned, setPinned] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(1);

  // Wildcard subscription. Handler stays stable thanks to useEventStream's
  // ref-tracking, so the setRows closure can capture nothing dangerous.
  useEventStream<keyof PipelineEventMap>('*', (envelope) => {
    const env = envelope as { eventType: string; payload: unknown };
    const row: LogRow = {
      id: nextIdRef.current++,
      at: Date.now(),
      eventType: env.eventType,
      payload: env.payload,
    };
    setRows((prev) => {
      const next = [...prev, row];
      if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
      return next;
    });
  });

  // Autoscroll when pinned (only when the list is actually rendered).
  useEffect(() => {
    if (!expanded && !fullscreen) return;
    if (!pinned) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, expanded, fullscreen, pinned]);

  // Close fullscreen on Escape.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < 8);
  }, []);

  const jumpToLatest = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
  };

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (!matchesFilter(r.eventType, filter)) return false;
        if (filterByNodeId && !matchesNode(r, filterByNodeId)) return false;
        return true;
      }),
    [rows, filter, filterByNodeId],
  );

  const statusLabel = useMemo(() => {
    if (rows.length === 0) return 'Execution log · Ready';
    const errors = rows.filter(
      (r) =>
        r.eventType === 'pipeline.step.failed' ||
        r.eventType === 'pipeline.run.failed',
    ).length;
    const running = rows.some((r) => r.eventType === 'pipeline.step.started')
      && !rows.some((r) => r.eventType === 'pipeline.run.completed' || r.eventType === 'pipeline.run.failed');
    if (running) return `Running · ${errors} errors · ${rows.length} events`;
    return `Execution log · ${rows.length} events`;
  }, [rows]);

  const clear = () => {
    setRows([]);
    setOpenRowId(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const renderFilterChip = () => {
    if (!filterByNodeId) return null;
    const label = filterNodeLabel ?? filterByNodeId;
    return (
      <div style={filterChipRowStyle} data-testid="execution-log-filter-chip-row">
        <span style={filterChipStyle} data-testid="execution-log-filter-chip">
          <span aria-hidden="true">🎯</span>
          <span>Node: {label}</span>
          <button
            type="button"
            style={filterChipCloseStyle}
            onClick={() => onClearFilter?.()}
            aria-label="Clear node filter"
            data-testid="execution-log-filter-chip-clear"
          >
            ×
          </button>
        </span>
      </div>
    );
  };

  const renderRows = () => {
    if (visible.length === 0) {
      return (
        <div style={{ padding: 16, fontSize: 12, color: '#94a3b8' }}>
          {filterByNodeId ? 'No events for this node yet.' : 'No events yet.'}
        </div>
      );
    }
    return visible.map((row) => {
      const glyph = getEventGlyph(row.eventType);
      const isOpen = openRowId === row.id;
      return (
        <div
          key={row.id}
          style={rowStyle(isOpen)}
          data-testid={`execution-log-row-${row.id}`}
          onClick={() =>
            setOpenRowId((cur) => (cur === row.id ? null : row.id))
          }
        >
          <span style={tsStyle}>{fmtTime(row.at)}</span>
          <span
            style={{
              color: glyph.color,
              fontWeight: 700,
              marginRight: 6,
            }}
          >
            {glyph.icon}
          </span>
          <span style={{ fontWeight: 600 }}>{row.eventType}</span>
          {summarizePayload(row) ? (
            <span style={{ color: '#64748b' }}>
              {' · '}
              {summarizePayload(row)}
            </span>
          ) : null}
          {isOpen ? (
            <pre
              style={{
                marginTop: 6,
                marginBottom: 0,
                padding: 10,
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.5,
                overflowX: 'auto',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
              data-testid={`execution-log-row-json-${row.id}`}
            >
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          ) : null}
        </div>
      );
    });
  };

  const renderBar = (opts: { inFullscreen: boolean }) => (
    <div style={barStyle}>
      {!opts.inFullscreen ? (
        <button
          type="button"
          style={chevBtnStyle}
          onClick={() => setExpanded((x) => !x)}
          aria-label={expanded ? 'Collapse log' : 'Expand log'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : null}
      <div style={statusStyle}>{statusLabel}</div>

      {/* Filter dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={controlBtnStyle}
          onClick={() => setFilterOpen((x) => !x)}
        >
          {FILTER_LABEL[filter]} ▾
        </button>
        {filterOpen ? (
          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: '100%',
              marginBottom: 4,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
              zIndex: 3,
              minWidth: 140,
            }}
          >
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => {
                  setFilter(key);
                  setFilterOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: 12,
                  border: 'none',
                  background: filter === key ? '#f1f5f9' : 'transparent',
                  color: '#0f172a',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button type="button" style={controlBtnStyle} onClick={clear} title="Clear log">
        Clear
      </button>
      {opts.inFullscreen ? (
        <button
          type="button"
          style={controlBtnStyle}
          onClick={() => setFullscreen(false)}
          aria-label="Close fullscreen log"
          data-testid="execution-log-fullscreen-close"
          title="Close fullscreen (Esc)"
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          style={controlBtnStyle}
          onClick={() => setFullscreen(true)}
          aria-label="Fullscreen log"
          data-testid="execution-log-fullscreen-btn"
          title="Fullscreen log"
        >
          ⛶
        </button>
      )}
    </div>
  );

  // Fullscreen overlay — rendered via portal on document.body so it escapes
  // the ancestor stacking context (the editor's sidebars / top bar).
  const fullscreenOverlay =
    fullscreen && typeof document !== 'undefined'
      ? createPortal(
          <div
            style={fullscreenBackdropStyle}
            data-testid="exec-log-fullscreen"
            onMouseDown={(e) => {
              // Backdrop click closes; clicks on the card bubble up but we
              // only dismiss when the direct target is the backdrop itself.
              if (e.target === e.currentTarget) setFullscreen(false);
            }}
          >
            <div style={fullscreenCardStyle} onMouseDown={(e) => e.stopPropagation()}>
              {renderBar({ inFullscreen: true })}
              {renderFilterChip()}
              <div
                ref={fullscreen ? listRef : undefined}
                style={listStyle}
                onScroll={onScroll}
              >
                {renderRows()}
                {!pinned ? (
                  <button type="button" style={jumpPillStyle} onClick={jumpToLatest}>
                    Jump to latest
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div style={wrapStyle(expanded && !fullscreen)} data-testid="execution-log">
        {renderBar({ inFullscreen: false })}
        {!fullscreen && expanded ? renderFilterChip() : null}
        {expanded && !fullscreen ? (
          <div ref={listRef} style={listStyle} onScroll={onScroll}>
            {renderRows()}
            {!pinned ? (
              <button type="button" style={jumpPillStyle} onClick={jumpToLatest}>
                Jump to latest
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {fullscreenOverlay}
    </>
  );
}
