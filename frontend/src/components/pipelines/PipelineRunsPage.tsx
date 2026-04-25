// frontend/src/components/pipelines/PipelineRunsPage.tsx
//
// List view for a pipeline's persisted run history. Route: /pipelines/:pipelineId/runs.
//
// URL query-param scheme (state survives reload + back-button):
//   q=<text>                                    case-insensitive substring match against runId/pipelineId
//   status=pending,running,completed,...        multi-select; empty/missing = all statuses
//   trigger=manual,scheduled,webhook,document   multi-select; empty/missing = all kinds
//                                                'document' matches any 'document.*' triggerType
//                                                'scheduled' matches the 'schedule' triggerType (UI alias)
//   range=24h|7d|30d|all                        default 7d
//
// Bulk actions operate on the current `selected` set (independent of the
// 2-cap Compare selection — Compare still uses two of the same checkboxes).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Navigate, useSearchParams } from 'react-router';
import { loadPipeline } from './persistence/pipelineStorage';
import { listRuns, clearRuns, appendRun } from './persistence/runHistory';
import { aggregateCost, formatUsd } from './cost/llmPricing';
import EmptyState from '../shared/EmptyState';
import { colors, chipStyle, fieldStyle } from '../../constants/styles';
import type { PipelineDefinition, PipelineRun, RunStatus } from '../../types/pipeline';

// ---------------------------------------------------------------------------
// Filter primitives (exported for tests)
// ---------------------------------------------------------------------------

// Filter chips intentionally exclude `awaiting_approval` — it's a transitional
// state surfaced separately in the pending-approvals view.
export type StatusKey = Exclude<RunStatus, 'awaiting_approval'>;
export type TriggerKindKey = 'manual' | 'scheduled' | 'webhook' | 'document';
export type DateRangeKey = '24h' | '7d' | '30d' | 'all';

export const STATUS_KEYS: readonly StatusKey[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const TRIGGER_KIND_KEYS: readonly TriggerKindKey[] = [
  'manual',
  'scheduled',
  'webhook',
  'document',
] as const;

export const DATE_RANGE_KEYS: readonly DateRangeKey[] = ['24h', '7d', '30d', 'all'] as const;

const RANGE_MS: Record<Exclude<DateRangeKey, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * Map a stored `triggeredBy.triggerType` string onto one of the user-facing
 * UI bins. `document.*` collapses to 'document'; the legacy 'schedule' string
 * surfaces as 'scheduled'. Anything unrecognized falls back to 'manual'.
 */
export function triggerTypeToKind(triggerType: string): TriggerKindKey {
  if (triggerType.startsWith('document.')) return 'document';
  if (triggerType === 'document') return 'document';
  if (triggerType === 'schedule' || triggerType === 'scheduled') return 'scheduled';
  if (triggerType === 'webhook') return 'webhook';
  return 'manual';
}

export interface RunFilterCriteria {
  query: string;
  statuses: ReadonlySet<StatusKey>;
  triggerKinds: ReadonlySet<TriggerKindKey>;
  range: DateRangeKey;
  /** ms since epoch. Defaults to Date.now() — exposed for deterministic tests. */
  now?: number;
}

/**
 * Pure filter applied to a list of runs. Empty status/trigger sets mean
 * "match all" (so the unfiltered default doesn't accidentally hide everything).
 */
export function filterRuns(runs: PipelineRun[], c: RunFilterCriteria): PipelineRun[] {
  const now = c.now ?? Date.now();
  const cutoff = c.range === 'all' ? null : now - RANGE_MS[c.range];
  const q = c.query.trim().toLowerCase();
  return runs.filter((r) => {
    if (c.statuses.size > 0 && !c.statuses.has(r.status as StatusKey)) return false;
    if (c.triggerKinds.size > 0) {
      const kind = triggerTypeToKind(r.triggeredBy.triggerType);
      if (!c.triggerKinds.has(kind)) return false;
    }
    if (cutoff != null) {
      const t = new Date(r.startedAt).getTime();
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    if (q.length > 0) {
      const idMatch = r.id.toLowerCase().includes(q);
      const pidMatch = r.pipelineId.toLowerCase().includes(q);
      if (!idMatch && !pidMatch) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// URL <-> state helpers (exported for tests)
// ---------------------------------------------------------------------------

function parseCsvSet<T extends string>(raw: string | null, allowed: readonly T[]): Set<T> {
  if (!raw) return new Set<T>();
  const allowSet = new Set<string>(allowed);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowSet.has(s)) as T[],
  );
}

export function parseFilterParams(params: URLSearchParams): {
  query: string;
  statuses: Set<StatusKey>;
  triggerKinds: Set<TriggerKindKey>;
  range: DateRangeKey;
} {
  const range = (params.get('range') ?? '7d') as DateRangeKey;
  const safeRange: DateRangeKey = (DATE_RANGE_KEYS as readonly string[]).includes(range)
    ? range
    : '7d';
  return {
    query: params.get('q') ?? '',
    statuses: parseCsvSet<StatusKey>(params.get('status'), STATUS_KEYS),
    triggerKinds: parseCsvSet<TriggerKindKey>(params.get('trigger'), TRIGGER_KIND_KEYS),
    range: safeRange,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 259_200_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function statusChip(s: RunStatus) {
  switch (s) {
    case 'completed':
      return { ...chipStyle('success'), label: 'Completed' } as const;
    case 'failed':
      return { ...chipStyle('danger'), label: 'Failed' } as const;
    case 'cancelled':
      return { ...chipStyle('neutral'), label: 'Cancelled' } as const;
    case 'running':
      return { ...chipStyle('info'), label: 'Running' } as const;
    case 'pending':
      return { ...chipStyle('neutral'), label: 'Pending' } as const;
    case 'awaiting_approval':
      return { ...chipStyle('warning'), label: 'Awaiting approval' } as const;
    default:
      return { ...chipStyle('neutral'), label: s } as const;
  }
}

const STATUS_LABEL: Record<StatusKey, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TRIGGER_LABEL: Record<TriggerKindKey, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  webhook: 'Webhook',
  document: 'Document',
};

const RANGE_LABEL: Record<DateRangeKey, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7d',
  '30d': 'Last 30d',
  all: 'All time',
};

// ---------------------------------------------------------------------------
// Chip button — keyboard accessible (Enter/Space toggle), Tab navigable.
// ---------------------------------------------------------------------------

function ChipButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.active}
      aria-label={props.ariaLabel ?? props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick();
        }
      }}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 500,
        border: `1px solid ${props.active ? colors.primary : colors.border}`,
        background: props.active ? colors.primary : colors.surface,
        color: props.active ? '#fff' : colors.textSecondary,
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {props.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelineRunsPage() {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [def, setDef] = useState<PipelineDefinition | null>(null);
  // Compare-pair (cap of 2) — kept separate from `selected` so the user can
  // bulk-act on many runs without clobbering an in-progress compare pick.
  const [comparePair, setComparePair] = useState<string[]>([]);
  // Bulk-selection set; supports shift-click range select.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClickedIdx = useRef<number | null>(null);
  // Stashed shiftKey from the most recent mousedown — onChange can't see it
  // synthetically, so we read it here when the change fires.
  const pendingShiftRef = useRef(false);

  // Decode current params on every render (cheap — small URLs).
  const { query, statuses, triggerKinds, range } = useMemo(
    () => parseFilterParams(searchParams),
    [searchParams],
  );

  // Mutators write through to the URL so back-button restores prior filters.
  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const toggleStatus = (s: StatusKey) => {
    const next = new Set(statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    updateParam('status', next.size === 0 ? null : Array.from(next).join(','));
  };

  const toggleTriggerKind = (k: TriggerKindKey) => {
    const next = new Set(triggerKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    updateParam('trigger', next.size === 0 ? null : Array.from(next).join(','));
  };

  const setRange = (r: DateRangeKey) => {
    // Default value 7d — omit from URL to keep links clean.
    updateParam('range', r === '7d' ? null : r);
  };

  const setQuery = (q: string) => {
    updateParam('q', q.length === 0 ? null : q);
  };

  const toggleComparePair = (runId: string) => {
    setComparePair((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      if (prev.length >= 2) return [prev[1], runId];
      return [...prev, runId];
    });
  };

  useEffect(() => {
    if (!pipelineId) return;
    setDef(loadPipeline(pipelineId));
    setRuns(listRuns(pipelineId));
  }, [pipelineId]);

  const filtered = useMemo(
    () => filterRuns(runs, { query, statuses, triggerKinds, range }),
    [runs, query, statuses, triggerKinds, range],
  );

  // Build nodeId -> model lookup once per definition so we can compute per-run cost.
  const modelByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    if (!def) return map;
    for (const node of def.nodes) {
      if (node.data.type === 'llm') {
        map.set(node.id, node.data.model);
      }
    }
    return map;
  }, [def]);

  const costByRunId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of filtered) {
      const steps = Object.values(r.steps)
        .filter((s) => !!s.llm)
        .map((s) => ({
          model: modelByNodeId.get(s.nodeId),
          tokensIn: s.llm?.tokensIn ?? 0,
          tokensOut: s.llm?.tokensOut ?? 0,
        }));
      out[r.id] = formatUsd(aggregateCost(steps).total);
    }
    return out;
  }, [filtered, modelByNodeId]);

  // Bulk-select helpers ------------------------------------------------------

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someSelected = !allSelected && filtered.some((r) => selected.has(r.id));

  const toggleHeaderCheckbox = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of filtered) next.delete(r.id);
      } else {
        for (const r of filtered) next.add(r.id);
      }
      return next;
    });
  };

  const handleRowCheckbox = (
    runId: string,
    rowIndex: number,
    nativeShift: boolean,
  ) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const turnOn = !next.has(runId);
      if (nativeShift && lastClickedIdx.current != null) {
        const lo = Math.min(lastClickedIdx.current, rowIndex);
        const hi = Math.max(lastClickedIdx.current, rowIndex);
        for (let i = lo; i <= hi; i++) {
          const r = filtered[i];
          if (!r) continue;
          if (turnOn) next.add(r.id);
          else next.delete(r.id);
        }
      } else if (turnOn) {
        next.add(runId);
      } else {
        next.delete(runId);
      }
      return next;
    });
    lastClickedIdx.current = rowIndex;
  };

  // Bulk actions -------------------------------------------------------------

  const bulkDelete = () => {
    if (!pipelineId) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Delete ${ids.length} run${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    // runHistory.ts has no bulk-delete primitive — emulate with clear+rewrite.
    const remaining = runs.filter((r) => !selected.has(r.id));
    clearRuns(pipelineId);
    // appendRun preserves desc order + cap; oldest-first re-insert keeps newest at top.
    for (const r of [...remaining].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      appendRun(pipelineId, r);
    }
    setRuns(listRuns(pipelineId));
    setSelected(new Set());
    setComparePair((p) => p.filter((id) => !ids.includes(id)));
    lastClickedIdx.current = null;
  };

  const bulkExport = () => {
    const picked = runs.filter((r) => selected.has(r.id));
    if (picked.length === 0) return;
    const blob = new Blob([JSON.stringify(picked, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `pipeline-runs-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!pipelineId) return <Navigate to="/pipelines" replace />;
  if (!def) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState
          icon="🔍"
          title="Pipeline not found"
          body="It may have been deleted. Go back to the pipelines list."
          actionLabel="Back to pipelines"
          onAction={() => navigate('/pipelines')}
        />
      </div>
    );
  }

  const selectionCount = selected.size;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => navigate(`/pipelines/${pipelineId}`)}
          style={{
            background: 'none',
            border: 'none',
            color: colors.primary,
            cursor: 'pointer',
            fontSize: 13,
            padding: 0,
          }}
        >
          ← {def.name}
        </button>
        <span style={{ color: colors.textTertiary }}>/</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary }}>
          Run history
        </span>
        <span style={{ fontSize: 12, color: colors.textTertiary, marginLeft: 'auto' }}>
          {runs.length} run{runs.length === 1 ? '' : 's'} persisted
        </span>
        <button
          type="button"
          onClick={() => navigate(`/pipelines/${pipelineId}/stats`)}
          data-testid="runs-stats-link"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 500,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.textSecondary,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          📊 Stats
        </button>
        <button
          type="button"
          disabled={comparePair.length !== 2}
          onClick={() => {
            if (comparePair.length !== 2) return;
            const [a, b] = comparePair;
            navigate(`/pipelines/${pipelineId}/runs/compare/${a}/${b}`);
          }}
          data-testid="run-compare-btn"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 500,
            border: `1px solid ${comparePair.length === 2 ? colors.primary : colors.border}`,
            background: comparePair.length === 2 ? colors.primary : colors.surface,
            color: comparePair.length === 2 ? '#fff' : colors.textSecondary,
            borderRadius: 4,
            cursor: comparePair.length === 2 ? 'pointer' : 'not-allowed',
            opacity: comparePair.length === 2 ? 1 : 0.7,
            fontFamily: 'inherit',
          }}
        >
          ⇄ Compare ({comparePair.length}/2)
        </button>
      </div>

      {/* Search + range selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label
          htmlFor="runs-search"
          style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500 }}
        >
          Search
        </label>
        <input
          id="runs-search"
          type="search"
          data-testid="runs-search-input"
          placeholder="run id or pipeline id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ ...fieldStyle, maxWidth: 320 }}
          aria-label="Search runs by run id or pipeline id"
        />

        <span
          id="runs-range-label"
          style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500, marginLeft: 12 }}
        >
          Range
        </span>
        <div role="radiogroup" aria-labelledby="runs-range-label" style={{ display: 'flex', gap: 6 }}>
          {DATE_RANGE_KEYS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              data-testid={`runs-range-${r}`}
              onClick={() => setRange(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setRange(r);
                }
              }}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 500,
                border: `1px solid ${range === r ? colors.primary : colors.border}`,
                background: range === r ? colors.primary : colors.surface,
                color: range === r ? '#fff' : colors.textSecondary,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          id="runs-status-label"
          style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500, marginRight: 4 }}
        >
          Status
        </span>
        <div role="group" aria-labelledby="runs-status-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_KEYS.map((s) => (
            <ChipButton
              key={s}
              active={statuses.has(s)}
              onClick={() => toggleStatus(s)}
              label={STATUS_LABEL[s]}
              testId={`runs-status-chip-${s}`}
              ariaLabel={`Filter status ${STATUS_LABEL[s]}`}
            />
          ))}
        </div>
      </div>

      {/* Trigger-kind chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          id="runs-trigger-label"
          style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500, marginRight: 4 }}
        >
          Trigger
        </span>
        <div role="group" aria-labelledby="runs-trigger-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TRIGGER_KIND_KEYS.map((k) => (
            <ChipButton
              key={k}
              active={triggerKinds.has(k)}
              onClick={() => toggleTriggerKind(k)}
              label={TRIGGER_LABEL[k]}
              testId={`runs-trigger-chip-${k}`}
              ariaLabel={`Filter trigger ${TRIGGER_LABEL[k]}`}
            />
          ))}
        </div>
      </div>

      {/* Bulk-action toolbar — visible only when something is selected */}
      {selectionCount > 0 && (
        <div
          data-testid="runs-bulk-toolbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: colors.surfaceInset,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 12, color: colors.textSecondary }}>
            {selectionCount} selected
          </span>
          <button
            type="button"
            data-testid="runs-bulk-export"
            onClick={bulkExport}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.textSecondary,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            data-testid="runs-bulk-delete"
            onClick={bulkDelete}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${colors.state.failed}`,
              background: colors.surface,
              color: colors.state.failed,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Delete
          </button>
          <button
            type="button"
            data-testid="runs-bulk-clear"
            onClick={() => setSelected(new Set())}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginLeft: 'auto',
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="📜"
          title={runs.length === 0 ? 'No runs yet' : 'No runs match these filters'}
          body={
            runs.length === 0
              ? 'Trigger this pipeline and completed runs will appear here.'
              : 'Try clearing a filter or expanding the date range.'
          }
        />
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <thead>
            <tr style={{ background: colors.surfaceInset, textAlign: 'left' }}>
              <th
                style={{
                  padding: '8px 12px',
                  width: 24,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <input
                  type="checkbox"
                  data-testid="runs-select-all"
                  aria-label="Select all visible runs"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleHeaderCheckbox}
                />
              </th>
              {['Started', 'Status', 'Duration', 'Cost', 'Triggered by', 'Run ID', ''].map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  style={{
                    padding: '8px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const chip = statusChip(r.status);
              const isSelected = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    background: isSelected ? colors.surfaceHover : undefined,
                  }}
                  onClick={() => navigate(`/pipelines/${pipelineId}/runs/${r.id}`)}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background = colors.surfaceHover;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }
                  }}
                >
                  <td
                    style={{ padding: '10px 12px', width: 24 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      data-testid={`run-select-${r.id}`}
                      checked={isSelected}
                      onMouseDown={(e) => {
                        pendingShiftRef.current = e.shiftKey;
                      }}
                      onKeyDown={(e) => {
                        // Shift+Space mimics shift-click in keyboard mode.
                        pendingShiftRef.current = e.shiftKey;
                      }}
                      onChange={() => {
                        const shift = pendingShiftRef.current;
                        pendingShiftRef.current = false;
                        handleRowCheckbox(r.id, idx, shift);
                      }}
                      aria-label={`Select run ${r.id.slice(0, 8)}`}
                    />
                    {/* secondary checkbox-style picker for Compare (no DOM
                        dup — just a tiny radio dot via a label) */}
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        marginLeft: 6,
                        fontSize: 10,
                        color: comparePair.includes(r.id) ? colors.primary : colors.textTertiary,
                        cursor: 'pointer',
                      }}
                      title="Pick for compare (max 2)"
                    >
                      <input
                        type="checkbox"
                        data-testid={`run-compare-pick-${r.id}`}
                        checked={comparePair.includes(r.id)}
                        onChange={() => toggleComparePair(r.id)}
                        aria-label={`Pick run ${r.id.slice(0, 8)} for comparison`}
                        style={{ width: 10, height: 10, marginRight: 2 }}
                      />
                      ⇄
                    </label>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: colors.textPrimary }}>
                    {relativeTime(r.startedAt)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={chip}>{chip.label}</span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', color: colors.textSecondary }}>
                    {formatDuration(r.durationMs)}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: colors.textSecondary,
                    }}
                    data-testid={`run-cost-${r.id}`}
                  >
                    {costByRunId[r.id] ?? '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: colors.textSecondary }}>
                    {r.triggeredBy.userId ?? r.triggeredBy.triggerType}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'monospace', color: colors.textTertiary }}>
                    {r.id.slice(0, 8)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: colors.primary }}>View →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
