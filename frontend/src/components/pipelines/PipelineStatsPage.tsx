// frontend/src/components/pipelines/PipelineStatsPage.tsx
//
// /pipelines/:pipelineId/stats — per-pipeline execution stats dashboard.
// Rolls up persisted runs from `runHistory` (localStorage, newest-first,
// capped at 50) into a lightweight KPI + charts view.
//
// Layout mirrors PipelineRunsPage (back-breadcrumb + title + last-N selector).
// Charts use the shared <LineChart/>/<BarChart/> wrappers in shared/Chart.tsx.
//
// Cost calc uses cost/llmPricing.aggregateCost with the pipeline's LLM node
// model config to produce real per-model USD totals.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router';
import { loadPipeline } from './persistence/pipelineStorage';
import { listRuns } from './persistence/runHistory';
import {
  aggregateCost,
  costByNode,
  dailyCostTrend,
  formatUsd,
  type CostBreakdown,
  type NodeCostRow,
} from './cost/llmPricing';
import EmptyState from '../shared/EmptyState';
import { BarChart, LineChart, type LineSeries } from '../shared/Chart';
import { colors } from '../../constants/styles';
import type { PipelineDefinition, PipelineRun, StepExecution } from '../../types/pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TokenTotals {
  tokensIn: number;
  tokensOut: number;
}

function sumTokens(run: PipelineRun): TokenTotals {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const step of Object.values(run.steps ?? {}) as StepExecution[]) {
    if (step.llm) {
      tokensIn += step.llm.tokensIn ?? 0;
      tokensOut += step.llm.tokensOut ?? 0;
    }
  }
  return { tokensIn, tokensOut };
}

/** Build a nodeId → model lookup for a pipeline definition. */
function buildModelMap(def: PipelineDefinition | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!def) return map;
  for (const node of def.nodes) {
    if (node.data.type === 'llm') map.set(node.id, node.data.model);
  }
  return map;
}

/** Compute a run's total USD cost using real vendor pricing. */
function runCost(run: PipelineRun, models: Map<string, string>): number {
  const steps: Array<{ model?: string; tokensIn?: number; tokensOut?: number }> = [];
  for (const step of Object.values(run.steps ?? {}) as StepExecution[]) {
    if (!step.llm) continue;
    steps.push({
      model: models.get(step.nodeId),
      tokensIn: step.llm.tokensIn,
      tokensOut: step.llm.tokensOut,
    });
  }
  return aggregateCost(steps).total.totalCostUsd;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatMoney(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * Tooltip / axis helper that delegates to {@link formatUsd} so the entire page
 * shares one USD formatting rule. Synthesizes a minimal {@link CostBreakdown}
 * from a raw amount.
 */
function formatUsdAmount(v: number): string {
  const cb: CostBreakdown = {
    inputTokens: 0,
    outputTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    totalCostUsd: v,
    model: 'aggregate',
    modelFound: true,
  };
  return formatUsd(cb);
}

function shortRunId(id: string): string {
  return id.slice(0, 8);
}

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 259_200_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Aggregation (pure — easy to unit-test via the component)
// ---------------------------------------------------------------------------

interface FailureRow {
  key: string;
  count: number;
  lastSeenAt: string;
  exampleRunId: string;
}

interface Stats {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  successRatePct: number;
  medianMs: number;
  p95Ms: number;
  tokensIn: number;
  tokensOut: number;
  tokensPerRun: number;
  totalCost: number;
  costPerRun: number;
  failureBreakdown: FailureRow[];
}

function aggregate(runs: PipelineRun[], models: Map<string, string>): Stats {
  const totalCount = runs.length;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  const durations: number[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let totalCost = 0;

  const failureMap = new Map<string, { count: number; lastSeenAt: string; exampleRunId: string }>();

  for (const r of runs) {
    if (r.status === 'completed') completedCount++;
    else if (r.status === 'failed') failedCount++;
    else if (r.status === 'cancelled') cancelledCount++;

    if (typeof r.durationMs === 'number' && r.durationMs > 0) {
      durations.push(r.durationMs);
    }

    const tokens = sumTokens(r);
    tokensIn += tokens.tokensIn;
    tokensOut += tokens.tokensOut;
    totalCost += runCost(r, models);

    if (r.error?.message) {
      // Group by first ~48 chars of the error message.
      const key = r.error.message.slice(0, 48);
      const prev = failureMap.get(key);
      if (!prev) {
        failureMap.set(key, { count: 1, lastSeenAt: r.startedAt, exampleRunId: r.id });
      } else {
        prev.count += 1;
        if (r.startedAt > prev.lastSeenAt) {
          prev.lastSeenAt = r.startedAt;
          prev.exampleRunId = r.id;
        }
      }
    }
  }

  durations.sort((a, b) => a - b);
  const medianMs = percentile(durations, 0.5);
  const p95Ms = percentile(durations, 0.95);

  const successRatePct =
    totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const failureBreakdown: FailureRow[] = [...failureMap.entries()]
    .map(([key, v]) => ({ key, count: v.count, lastSeenAt: v.lastSeenAt, exampleRunId: v.exampleRunId }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalCount,
    completedCount,
    failedCount,
    cancelledCount,
    successRatePct,
    medianMs,
    p95Ms,
    tokensIn,
    tokensOut,
    tokensPerRun: totalCount === 0 ? 0 : Math.round((tokensIn + tokensOut) / totalCount),
    totalCost,
    costPerRun: totalCount === 0 ? 0 : totalCost / totalCount,
    failureBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Success-rate color ramp (≥90 green, ≥70 amber, else red)
// ---------------------------------------------------------------------------

function successRateColor(pct: number): string {
  if (pct >= 90) return colors.state.completed;
  if (pct >= 70) return colors.state.awaiting;
  return colors.state.failed;
}

// ---------------------------------------------------------------------------
// Chart data builders
// ---------------------------------------------------------------------------

function buildRunsOverTime(runs: PipelineRun[]): LineSeries[] {
  // Oldest-first for cumulative stepping.
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const completed: Array<{ x: number; y: number }> = [];
  const failed: Array<{ x: number; y: number }> = [];
  const cancelled: Array<{ x: number; y: number }> = [];

  let cC = 0;
  let cF = 0;
  let cX = 0;

  for (const r of sorted) {
    const t = new Date(r.startedAt).getTime();
    if (r.status === 'completed') cC += 1;
    else if (r.status === 'failed') cF += 1;
    else if (r.status === 'cancelled') cX += 1;
    completed.push({ x: t, y: cC });
    failed.push({ x: t, y: cF });
    cancelled.push({ x: t, y: cX });
  }

  return [
    { label: 'Completed', data: completed, color: colors.state.completed },
    { label: 'Failed', data: failed, color: colors.state.failed },
    { label: 'Cancelled', data: cancelled, color: colors.state.idle },
  ];
}

function buildDurationSeries(runs: PipelineRun[], p50: number): LineSeries[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const points = sorted
    .filter((r) => typeof r.durationMs === 'number' && (r.durationMs as number) > 0)
    .map((r) => ({ x: new Date(r.startedAt).getTime(), y: r.durationMs as number }));

  const p50Line = points.map((p) => ({ x: p.x, y: p50 }));

  return [
    { label: 'Duration (ms)', data: points, color: colors.primary },
    { label: 'p50', data: p50Line, color: colors.textTertiary },
  ];
}

function buildTokenSeries(runs: PipelineRun[]): LineSeries[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const tin: Array<{ x: number; y: number }> = [];
  const tout: Array<{ x: number; y: number }> = [];
  for (const r of sorted) {
    const t = new Date(r.startedAt).getTime();
    const { tokensIn, tokensOut } = sumTokens(r);
    tin.push({ x: t, y: tokensIn });
    tout.push({ x: t, y: tokensOut });
  }
  return [
    { label: 'Tokens in', data: tin, color: colors.primary },
    { label: 'Tokens out', data: tout, color: colors.state.completed },
  ];
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
};

const cardLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const cardValueStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: colors.textPrimary,
  fontFamily: 'monospace',
};

const cardSubStyle: CSSProperties = {
  fontSize: 12,
  color: colors.textTertiary,
  fontFamily: 'monospace',
};

const chartCardStyle: CSSProperties = {
  ...cardStyle,
  gap: 8,
};

const chartTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.textPrimary,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type RangeSel = '10' | '50' | 'all';

export default function PipelineStatsPage() {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();

  const [def, setDef] = useState<PipelineDefinition | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [range, setRange] = useState<RangeSel>('50');

  useEffect(() => {
    if (!pipelineId) return;
    setDef(loadPipeline(pipelineId));
    setRuns(listRuns(pipelineId));
  }, [pipelineId]);

  const visibleRuns = useMemo(() => {
    if (range === 'all') return runs;
    const n = Number(range);
    return runs.slice(0, n);
  }, [runs, range]);

  const models = useMemo(() => buildModelMap(def), [def]);
  const stats = useMemo(() => aggregate(visibleRuns, models), [visibleRuns, models]);

  // Per-node cost: scoped to the visible window so it tracks the range selector.
  const nodeCostRows = useMemo<NodeCostRow[]>(
    () => costByNode(visibleRuns, def).filter((r) => r.totalCostUsd > 0 || r.stepCount > 0),
    [visibleRuns, def],
  );

  // 30-day spend trend: always uses the full persisted history (not gated on
  // the range selector) so the trend is meaningful even when "Last 10" is
  // active.
  const trendPoints = useMemo(() => dailyCostTrend(runs, def, 30), [runs, def]);
  const trendSeries: LineSeries[] = useMemo(
    () => [
      {
        label: 'Daily spend',
        data: trendPoints.map((p) => ({ x: p.ts, y: p.totalCostUsd })),
        color: colors.primary,
      },
    ],
    [trendPoints],
  );

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

  const hasRuns = visibleRuns.length > 0;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─ Top bar ────────────────────────────────────────────────────────── */}
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
          Execution stats
        </span>

        <div
          style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}
          data-testid="stats-range"
        >
          {(['10', '50', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              style={{
                padding: '4px 10px',
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
              {r === 'all' ? 'All' : `Last ${r}`}
            </button>
          ))}
        </div>
      </div>

      {/* ─ Empty state ────────────────────────────────────────────────────── */}
      {!hasRuns ? (
        <EmptyState
          icon="📊"
          title="No runs yet"
          body="No runs yet. Trigger this pipeline to see stats."
        />
      ) : (
        <>
          {/* ─ KPI row ───────────────────────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
            data-testid="stats-kpis"
          >
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Success rate</div>
              <div
                style={{ ...cardValueStyle, color: successRateColor(stats.successRatePct) }}
                data-testid="stats-success-rate"
              >
                {stats.completedCount}/{stats.totalCount} ({stats.successRatePct}%)
              </div>
              <div style={cardSubStyle}>
                {stats.failedCount} failed · {stats.cancelledCount} cancelled
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Median duration</div>
              <div style={cardValueStyle}>{formatDuration(stats.medianMs)}</div>
              <div style={cardSubStyle}>p95 · {formatDuration(stats.p95Ms)}</div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Total tokens</div>
              <div style={cardValueStyle}>
                {stats.tokensIn.toLocaleString()} → {stats.tokensOut.toLocaleString()}
              </div>
              <div style={cardSubStyle}>
                {stats.tokensPerRun.toLocaleString()} avg per run
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Total cost</div>
              <div style={cardValueStyle}>{formatMoney(stats.totalCost)}</div>
              <div style={cardSubStyle}>{formatMoney(stats.costPerRun)} avg per run</div>
            </div>
          </div>

          {/* ─ Cost charts row ───────────────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 12,
            }}
            data-testid="stats-cost-row"
          >
            <div style={chartCardStyle} data-testid="stats-cost-by-node">
              <div style={chartTitleStyle}>Cost by node</div>
              {nodeCostRows.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: colors.textTertiary,
                    padding: '8px 0',
                  }}
                >
                  No per-node cost data in this range.
                </div>
              ) : (
                <BarChart
                  data={nodeCostRows.map((r) => ({
                    label: r.label,
                    cost: Number(r.totalCostUsd.toFixed(6)),
                  }))}
                  xKey="label"
                  yKey="cost"
                  height={200}
                  color={colors.primary}
                />
              )}
            </div>

            <div style={chartCardStyle} data-testid="stats-cost-trend-30d">
              <div style={chartTitleStyle}>30-day spend trend</div>
              <LineChart
                series={trendSeries}
                height={200}
                xFormat={(v) =>
                  new Date(Number(v)).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                }
                yFormat={(v) => formatUsdAmount(v)}
              />
            </div>
          </div>

          {/* ─ Charts grid ───────────────────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 12,
            }}
          >
            <div style={chartCardStyle}>
              <div style={chartTitleStyle}>Runs over time (cumulative)</div>
              <LineChart
                series={buildRunsOverTime(visibleRuns)}
                height={180}
                xFormat={(v) => new Date(Number(v)).toLocaleDateString()}
              />
            </div>

            <div style={chartCardStyle}>
              <div style={chartTitleStyle}>Duration over time</div>
              <LineChart
                series={buildDurationSeries(visibleRuns, stats.medianMs)}
                height={180}
                xFormat={(v) => new Date(Number(v)).toLocaleDateString()}
                yFormat={(v) => formatDuration(v)}
              />
            </div>

            <div style={chartCardStyle}>
              <div style={chartTitleStyle}>Token usage over time</div>
              <LineChart
                series={buildTokenSeries(visibleRuns)}
                height={180}
                xFormat={(v) => new Date(Number(v)).toLocaleDateString()}
                yFormat={(v) => v.toLocaleString()}
              />
            </div>

            {/* ─ Failure breakdown ─────────────────────────────────────── */}
            <div style={chartCardStyle} data-testid="stats-failure-breakdown">
              <div style={chartTitleStyle}>Failure breakdown (top 5)</div>
              {stats.failureBreakdown.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textTertiary, padding: '8px 0' }}>
                  No failures in this range.
                </div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      {['Error', 'Count', 'Last seen', 'Example'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '6px 8px',
                            fontSize: 10,
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
                    {stats.failureBreakdown.map((row) => (
                      <tr key={row.key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td
                          style={{
                            padding: '6px 8px',
                            color: colors.textPrimary,
                            maxWidth: 240,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={row.key}
                        >
                          {row.key}
                        </td>
                        <td
                          style={{ padding: '6px 8px', fontFamily: 'monospace', color: colors.textPrimary }}
                        >
                          {row.count}
                        </td>
                        <td style={{ padding: '6px 8px', color: colors.textSecondary }}>
                          {relativeTime(row.lastSeenAt)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/pipelines/${pipelineId}/runs/${row.exampleRunId}`)
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              color: colors.primary,
                              cursor: 'pointer',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              padding: 0,
                            }}
                          >
                            {shortRunId(row.exampleRunId)} →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
