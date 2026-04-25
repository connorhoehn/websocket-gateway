// frontend/src/components/observability/EventsPage.tsx
//
// Three-pane /observability/events route (PIPELINES_PLAN.md §18.8):
//   left:   filter rail (240px, collapsible)
//   center: live event list (Phase 1 = plain scroll; Phase 2 virtualized)
//   right:  detail pane (320px) with pretty JSON + copy/download
//
// Phase 1 subscribes to `useEventStream('*', handler)` so any dispatch from
// the mock executor (or sibling tests) appears here. A local cap of 500 keeps
// memory bounded — oldest trimmed first. Live/Paused toggle freezes prepends.
//
// The page mounts its own <EventStreamProvider> as a safety net so it renders
// even when no parent provider is installed; real app routes should provide
// their own upstream so all dashboards share the same stream.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  EventStreamProvider,
  useEventStream,
} from '../pipelines/context/EventStreamContext';
import type { WildcardEvent } from '../pipelines/context/EventStreamContext';
import EventTimeline, { type EventItem } from './components/EventTimeline';
import EventDetailPane from './components/EventDetailPane';
import { colors, fieldStyle, cancelBtnStyle } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 500;

type EventGroup = 'All' | 'Errors' | 'LLM' | 'Approvals' | 'Lifecycle';
type TimeRange = '15m' | '1h' | '6h' | '24h' | 'custom';

const EVENT_GROUPS: EventGroup[] = ['All', 'Errors', 'LLM', 'Approvals', 'Lifecycle'];
const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '15m', label: 'Last 15m' },
  { value: '1h', label: 'Last 1h' },
  { value: '6h', label: 'Last 6h' },
  { value: '24h', label: 'Last 24h' },
  { value: 'custom', label: 'Custom' },
];
const DEFAULT_NODE_OPTIONS = ['node-0', 'node-1', 'node-2'];
const SEVERITIES: Array<'info' | 'warning' | 'error' | 'success'> = [
  'info', 'warning', 'error', 'success',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityFor(eventType: string): EventItem['severity'] {
  if (eventType.includes('failed') || eventType.includes('error')) return 'error';
  if (eventType.includes('completed')) return 'success';
  if (eventType.includes('warn') || eventType.includes('awaiting')) return 'warning';
  return 'info';
}

function groupFor(eventType: string): EventGroup {
  if (eventType.includes('failed') || eventType.includes('error')) return 'Errors';
  if (eventType.startsWith('llm.') || eventType.includes('.llm.')) return 'LLM';
  if (eventType.includes('approval')) return 'Approvals';
  if (eventType.includes('run.') || eventType.includes('pipeline.')) return 'Lifecycle';
  return 'Lifecycle';
}

function summarize(eventType: string, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof p.runId === 'string') parts.push(`run ${p.runId}`);
    if (typeof p.pipelineId === 'string') parts.push(`pipeline ${p.pipelineId}`);
    if (typeof p.nodeId === 'string') parts.push(`node ${p.nodeId}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return eventType;
}

function formatTimestamp(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ---------------------------------------------------------------------------
// Inner page (assumes an EventStream context is available)
// ---------------------------------------------------------------------------

interface FilterState {
  groups: Set<EventGroup>;
  runIds: string;
  pipelineIds: string;
  nodes: Set<string>;
  severities: Set<NonNullable<EventItem['severity']>>;
  timeRange: TimeRange;
}

const INITIAL_FILTERS: FilterState = {
  groups: new Set(['All']),
  runIds: '',
  pipelineIds: '',
  nodes: new Set(DEFAULT_NODE_OPTIONS),
  severities: new Set(SEVERITIES),
  timeRange: '1h',
};

function EventsPageInner() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const seq = useRef(0);

  const handleWildcard = useCallback((payload: WildcardEvent | unknown) => {
    if (pausedRef.current) return;
    const env = payload as WildcardEvent;
    const type = env?.eventType ?? 'unknown';
    const inner = env?.payload ?? env;
    seq.current += 1;
    const item: EventItem = {
      id: `ev-${Date.now()}-${seq.current}`,
      timestamp: formatTimestamp(),
      type,
      summary: summarize(type, inner),
      severity: severityFor(type),
      payload: inner,
    };
    setEvents((prev) => {
      const next = [...prev, item];
      if (next.length > MAX_EVENTS) {
        return next.slice(next.length - MAX_EVENTS);
      }
      return next;
    });
  }, []);

  useEventStream('*', handleWildcard);

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  const visibleEvents = useMemo(() => {
    const runIds = filters.runIds
      .split(',').map((s) => s.trim()).filter(Boolean);
    const pipelineIds = filters.pipelineIds
      .split(',').map((s) => s.trim()).filter(Boolean);
    const allGroups = filters.groups.has('All');

    return events.filter((ev) => {
      // Group filter
      if (!allGroups) {
        const g = groupFor(ev.type);
        if (!filters.groups.has(g)) return false;
      }
      // Severity filter
      if (ev.severity && !filters.severities.has(ev.severity)) return false;
      // Run id filter
      if (runIds.length > 0) {
        const payloadRun = (ev.payload as { runId?: string } | null)?.runId;
        if (!payloadRun || !runIds.some((r) => payloadRun.includes(r))) return false;
      }
      // Pipeline id filter
      if (pipelineIds.length > 0) {
        const p = (ev.payload as { pipelineId?: string } | null)?.pipelineId;
        if (!p || !pipelineIds.some((x) => p.includes(x))) return false;
      }
      // Node filter
      const nodeId = (ev.payload as { nodeId?: string } | null)?.nodeId;
      if (nodeId && !filters.nodes.has(nodeId)) return false;

      return true;
    });
  }, [events, filters]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((e) => e.id === selectedId) ?? null,
    [visibleEvents, selectedId],
  );

  // -----------------------------------------------------------------------
  // Filter toggles
  // -----------------------------------------------------------------------

  const toggleGroup = (g: EventGroup) => {
    setFilters((f) => {
      const next = new Set(f.groups);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return { ...f, groups: next };
    });
  };
  const toggleNode = (id: string) => {
    setFilters((f) => {
      const next = new Set(f.nodes);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, nodes: next };
    });
  };
  const toggleSeverity = (s: NonNullable<EventItem['severity']>) => {
    setFilters((f) => {
      const next = new Set(f.severities);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...f, severities: next };
    });
  };
  const clearFilters = () => setFilters(INITIAL_FILTERS);

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  const pageStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column',
    height: '100%', minHeight: 0,
    fontFamily: 'inherit', fontSize: 13, color: colors.textPrimary,
    background: colors.surface,
  };

  const topBarStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 16px',
    borderBottom: `1px solid ${colors.border}`,
    background: colors.surfacePanel,
  };

  const bodyStyle: CSSProperties = {
    display: 'flex', flex: 1, minHeight: 0,
  };

  const railStyle: CSSProperties = {
    width: railCollapsed ? 36 : 240,
    flexShrink: 0,
    borderRight: `1px solid ${colors.border}`,
    background: colors.surfacePanel,
    overflowY: 'auto',
    transition: 'width 150ms ease',
  };

  const centerStyle: CSSProperties = {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
  };

  const detailStyle: CSSProperties = {
    width: 320, flexShrink: 0,
    borderLeft: `1px solid ${colors.border}`,
    background: colors.surface,
  };

  const sectionStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 6,
    padding: '12px 14px',
    borderBottom: `1px solid ${colors.border}`,
  };

  const sectionLabel: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
    color: colors.textSecondary, textTransform: 'uppercase',
  };

  return (
    <div data-testid="events-page" style={pageStyle}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <button
          onClick={() => setPaused((p) => !p)}
          data-testid="events-live-toggle"
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600,
            background: paused ? colors.surfaceHover : colors.state.completed,
            color: paused ? colors.textSecondary : '#fff',
            border: `1px solid ${paused ? colors.border : colors.state.completed}`,
            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {paused ? '■ Paused' : '● Live'}
        </button>

        <select
          data-testid="events-time-range"
          aria-label="Time range"
          value={filters.timeRange}
          onChange={(e) =>
            setFilters((f) => ({ ...f, timeRange: e.target.value as TimeRange }))
          }
          style={{ ...fieldStyle, flex: 0, minWidth: 120 }}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: colors.textTertiary }}>
          {visibleEvents.length} / {events.length} event{events.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={bodyStyle}>
        {/* Filter rail */}
        <aside data-testid="events-filter-rail" style={railStyle}>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {!railCollapsed && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: colors.textSecondary }}>
                FILTERS
              </div>
            )}
            <button
              onClick={() => setRailCollapsed((c) => !c)}
              aria-label={railCollapsed ? 'Expand filters' : 'Collapse filters'}
              style={{
                border: 'none', background: 'transparent',
                color: colors.textTertiary, cursor: 'pointer',
                fontSize: 12, padding: 2, fontFamily: 'inherit',
              }}
            >
              {railCollapsed ? '›' : '‹'}
            </button>
          </div>

          {!railCollapsed && (
            <>
              <div style={sectionStyle}>
                <div style={sectionLabel}>Event type</div>
                {EVENT_GROUPS.map((g) => (
                  <label
                    key={g}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.groups.has(g)}
                      onChange={() => toggleGroup(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Runs</div>
                <input
                  data-testid="events-filter-runs"
                  type="text"
                  placeholder="runId (comma-separated)"
                  value={filters.runIds}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, runIds: e.target.value }))
                  }
                  style={fieldStyle}
                />
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Pipelines</div>
                <input
                  data-testid="events-filter-pipelines"
                  type="text"
                  placeholder="pipelineId (comma-separated)"
                  value={filters.pipelineIds}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, pipelineIds: e.target.value }))
                  }
                  style={fieldStyle}
                />
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Nodes</div>
                {DEFAULT_NODE_OPTIONS.map((id) => (
                  <label
                    key={id}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.nodes.has(id)}
                      onChange={() => toggleNode(id)}
                    />
                    {id}
                  </label>
                ))}
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Severity</div>
                {SEVERITIES.map((s) => (
                  <label
                    key={s}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.severities.has(s)}
                      onChange={() => toggleSeverity(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>

              <div style={{ padding: '12px 14px' }}>
                <button
                  data-testid="events-clear-filters"
                  onClick={clearFilters}
                  style={cancelBtnStyle}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </aside>

        {/* Center list */}
        <section style={centerStyle}>
          <EventTimeline
            events={visibleEvents}
            selectedId={selectedId}
            onSelect={setSelectedId}
            live={!paused}
          />
        </section>

        {/* Detail pane */}
        <aside style={detailStyle}>
          <EventDetailPane event={selectedEvent} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported page — wrapped in a local EventStreamProvider so the page renders
// standalone (the hook throws without one). When the app installs a shared
// upstream provider in Phase 2+, this wrapper can be lifted out.
// ---------------------------------------------------------------------------

export default function EventsPage() {
  return (
    <EventStreamProvider>
      <EventsPageInner />
    </EventStreamProvider>
  );
}
