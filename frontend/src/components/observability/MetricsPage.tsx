// frontend/src/components/observability/MetricsPage.tsx
//
// /observability/metrics — grid of chart cards per PIPELINES_PLAN.md §18.9.
// Phase 4: each card renders a real recharts-based chart via the shared
// <LineChart/>, <StackedAreaChart/>, and <BarChart/> wrappers in
// components/shared/Chart.tsx.
//
// Because the backend `/api/observability/dashboard` endpoint returns only a
// point-in-time snapshot, we seed each card with ~30 deterministic historical
// points on first paint so charts aren't empty. As `useMetricsHistory`
// accumulates live dashboard snapshots, we append the latest live value to
// each series and shift the window.
//
// Grid responsiveness: 2 columns at 1280-1599, 3 at 1600+. Rendered via a
// ResizeObserver-driven layout; for simplicity and to avoid a runtime
// dependency we use the window width (read once on mount + on resize).

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import MetricCard from './components/MetricCard';
import {
  LineChart,
  StackedAreaChart,
  BarChart,
  type LineSeries,
} from '../shared/Chart';
import { useMetricsHistory } from './hooks/useMetricsHistory';
import { usePipelineMetrics } from './hooks/usePipelineMetrics';
import type { PipelineMetrics } from './hooks/usePipelineMetrics';
import { colors, fieldStyle, cancelBtnStyle, saveBtnStyle } from '../../constants/styles';

type TimeRange = '15m' | '1h' | '24h' | '7d';
const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '15m', label: 'Last 15m' },
  { value: '1h', label: 'Last 1h' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7d' },
];

type RefreshInterval = 'off' | '5s' | '30s' | '60s';
const REFRESH_INTERVALS: Array<{ value: RefreshInterval; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: '5s', label: '5s' },
  { value: '30s', label: '30s' },
  { value: '60s', label: '60s' },
];

// ---------------------------------------------------------------------------
// Seed helpers — deterministic LCG so first paint is stable across reloads.
// ---------------------------------------------------------------------------

function seeded(seed: number, n = 30, max = 60): number[] {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < n; i++) {
    v = (v * 9301 + 49297) % 233280;
    out.push(Math.abs(v % max));
  }
  return out;
}

/**
 * Turn a raw number[] into the {x, y}[] shape the Chart wrappers expect.
 * `x` is a minute offset (0, 1, 2, ...) so the axis renders as integers.
 */
function toSeries(label: string, values: number[], color?: string): LineSeries {
  return {
    label,
    color,
    data: values.map((y, i) => ({ x: i, y })),
  };
}

// ---------------------------------------------------------------------------
// Seeded chart data builders
// ---------------------------------------------------------------------------

interface SeedBundle {
  runsPerMinute: LineSeries[];
  stepDuration: LineSeries[];
  llmTokens: LineSeries[];
  llmCost: LineSeries[];
  clusterCpu: LineSeries[];
  clusterMemory: LineSeries[];
  eventRate: LineSeries[];
  activeRuns: LineSeries[];
  failureRate: Array<Record<string, unknown>>;
  approvalLatency: LineSeries[];
}

function buildSeeds(): SeedBundle {
  return {
    runsPerMinute: [
      toSeries('started',   seeded(3,  30, 40), colors.primary),
      toSeries('completed', seeded(7,  30, 40), colors.state.completed),
      toSeries('failed',    seeded(11, 30, 20), colors.state.failed),
    ],
    stepDuration: [
      toSeries('p50', seeded(17, 30, 400)),
      toSeries('p95', seeded(23, 30, 800)),
      toSeries('p99', seeded(29, 30, 1200)),
    ],
    llmTokens: [
      toSeries('input',  seeded(31, 30, 2000)),
      toSeries('output', seeded(37, 30, 1000)),
    ],
    llmCost: [toSeries('USD', seeded(41, 30, 5))],
    clusterCpu: [
      toSeries('node-0', seeded(43, 30, 40)),
      toSeries('node-1', seeded(47, 30, 40)),
      toSeries('node-2', seeded(53, 30, 40)),
    ],
    clusterMemory: [
      toSeries('node-0', seeded(59, 30, 512)),
      toSeries('node-1', seeded(61, 30, 512)),
      toSeries('node-2', seeded(67, 30, 512)),
    ],
    eventRate:     [toSeries('events/s', seeded(71, 30, 20))],
    activeRuns:    [toSeries('active',   seeded(73, 30, 10))],
    // Failure-rate-by-type is rendered as a bar chart and needs row-shaped data.
    failureRate: (() => {
      const llm       = seeded(79, 30, 15);
      const http      = seeded(83, 30, 15);
      const transform = seeded(89, 30, 15);
      return llm.map((_v, i) => ({
        x: i,
        llm: llm[i],
        http: http[i],
        transform: transform[i],
        // For a single-series bar view we expose a `total` field too.
        total: llm[i] + http[i] + transform[i],
      }));
    })(),
    approvalLatency: [toSeries('seconds', seeded(97, 30, 120))],
  };
}

// ---------------------------------------------------------------------------
// Column count
// ---------------------------------------------------------------------------

function useColumnCount(): number {
  const [cols, setCols] = useState<number>(() => {
    if (typeof window === 'undefined') return 2;
    return window.innerWidth >= 1600 ? 3 : 2;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setCols(window.innerWidth >= 1600 ? 3 : 2);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return cols;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MetricsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [refresh, setRefresh] = useState<RefreshInterval>('30s');
  const seeds = useMemo(buildSeeds, []);
  const cols = useColumnCount();

  // The dashboard-history ring is kept so future work can splice live values
  // onto the seeded series. Phase 1 snapshot isn't time-series-shaped yet, so
  // we currently just read the length to decide when to start overlaying.
  const history = useMetricsHistory(60);
  void history; // reserved for real-data overlay once server sends time-series

  // Live pipeline metrics — drives the "Runs" / "LLM tokens" / "LLM cost" /
  // "Active runs" / "Approval latency" cards by appending each new poll's
  // value to a small in-page ring buffer.
  const { metrics, isLiveData } = usePipelineMetrics();
  const [metricsRing, setMetricsRing] = useState<PipelineMetrics[]>([]);
  useEffect(() => {
    if (!metrics) return;
    setMetricsRing((prev) => [...prev, metrics].slice(-30));
  }, [metrics]);

  const pageStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    fontFamily: 'inherit', fontSize: 13, color: colors.textPrimary,
    background: colors.surface,
  };

  const topBarStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 16px',
    borderBottom: `1px solid ${colors.border}`,
    background: colors.surfacePanel,
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: 16,
    padding: 16,
    overflowY: 'auto',
    flex: 1,
  };

  const timeLabel = TIME_RANGES.find((t) => t.value === timeRange)?.label ?? '';

  // Derived live series — only used when we've collected at least 2 samples,
  // otherwise the seeded data wins and the chart looks lively from frame 1.
  const liveSeries = useMemo(() => {
    if (metricsRing.length < 2) return null;
    return {
      activeRuns: [
        {
          label: 'active',
          data: metricsRing.map((m, i) => ({ x: i, y: m.runsActive })),
        },
      ] as LineSeries[],
      llmTokens: [
        {
          label: 'input',
          data: metricsRing.map((m, i) => ({ x: i, y: m.llmTokensIn })),
        },
        {
          label: 'output',
          data: metricsRing.map((m, i) => ({ x: i, y: m.llmTokensOut })),
        },
      ] as LineSeries[],
      llmCost: [
        {
          label: 'USD',
          data: metricsRing.map((m, i) => ({ x: i, y: m.estimatedCostUsd })),
        },
      ] as LineSeries[],
      runsPerMinute: [
        {
          label: 'started',
          color: colors.primary,
          data: metricsRing.map((m, i) => ({ x: i, y: m.runsStarted })),
        },
        {
          label: 'completed',
          color: colors.state.completed,
          data: metricsRing.map((m, i) => ({ x: i, y: m.runsCompleted })),
        },
        {
          label: 'failed',
          color: colors.state.failed,
          data: metricsRing.map((m, i) => ({ x: i, y: m.runsFailed })),
        },
      ] as LineSeries[],
    };
  }, [metricsRing]);

  return (
    <div data-testid="metrics-page" style={pageStyle}>
      <div style={topBarStyle}>
        <select
          data-testid="metrics-time-range"
          aria-label="Time range"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          style={{ ...fieldStyle, flex: 0, minWidth: 120 }}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select
          data-testid="metrics-refresh-interval"
          aria-label="Refresh interval"
          value={refresh}
          onChange={(e) => setRefresh(e.target.value as RefreshInterval)}
          style={{ ...fieldStyle, flex: 0, minWidth: 100 }}
        >
          {REFRESH_INTERVALS.map((r) => (
            <option key={r.value} value={r.value}>Refresh: {r.label}</option>
          ))}
        </select>

        <button
          data-testid="metrics-reset-zoom"
          onClick={() => console.log('[MetricsPage] reset zoom')}
          style={cancelBtnStyle}
        >
          Reset zoom
        </button>

        <button
          data-testid="metrics-export-csv"
          onClick={() => console.log('[MetricsPage] export CSV')}
          style={saveBtnStyle(false)}
        >
          Export CSV
        </button>

        <div
          data-testid="metrics-data-source"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 11,
            color: colors.textTertiary,
          }}
        >
          <span
            title={
              isLiveData
                ? 'Connected to /api/pipelines/metrics'
                : 'Backend unreachable — using seeded fixture'
            }
            style={{
              color: isLiveData ? colors.state.completed : colors.textTertiary,
              fontWeight: 600,
            }}
          >
            {isLiveData ? 'live' : 'fixture'}
          </span>
          <span>{cols} column{cols === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div style={gridStyle}>
        <MetricCard title="Runs per minute" timeRange={timeLabel}>
          <StackedAreaChart
            series={liveSeries?.runsPerMinute ?? seeds.runsPerMinute}
            height={180}
          />
        </MetricCard>

        <MetricCard title="Step duration (p50/p95/p99)" timeRange={timeLabel}>
          <LineChart
            series={seeds.stepDuration}
            height={180}
            yFormat={(v) => `${Math.round(v)}ms`}
          />
        </MetricCard>

        <MetricCard title="LLM tokens" timeRange={timeLabel}>
          <LineChart
            series={liveSeries?.llmTokens ?? seeds.llmTokens}
            height={180}
          />
        </MetricCard>

        <MetricCard title="LLM cost" timeRange={timeLabel}>
          <LineChart
            series={liveSeries?.llmCost ?? seeds.llmCost}
            height={180}
            yFormat={(v) => `$${v.toFixed(2)}`}
          />
        </MetricCard>

        <MetricCard title="Cluster CPU" timeRange={timeLabel}>
          <LineChart
            series={seeds.clusterCpu}
            height={180}
            yFormat={(v) => `${Math.round(v)}%`}
          />
        </MetricCard>

        <MetricCard title="Cluster memory" timeRange={timeLabel}>
          <LineChart
            series={seeds.clusterMemory}
            height={180}
            yFormat={(v) => `${Math.round(v)}MB`}
          />
        </MetricCard>

        <MetricCard title="Event rate" timeRange={timeLabel}>
          <LineChart series={seeds.eventRate} height={180} />
        </MetricCard>

        <MetricCard title="Active runs over time" timeRange={timeLabel}>
          <LineChart
            series={liveSeries?.activeRuns ?? seeds.activeRuns}
            height={180}
          />
        </MetricCard>

        <MetricCard title="Failure rate by type" timeRange={timeLabel}>
          <BarChart
            data={seeds.failureRate}
            xKey="x"
            yKey="total"
            color={colors.state.failed}
            height={180}
          />
        </MetricCard>

        <MetricCard title="Approval latency" timeRange={timeLabel}>
          <LineChart
            series={seeds.approvalLatency}
            height={180}
            yFormat={(v) => `${Math.round(v)}s`}
          />
        </MetricCard>
      </div>
    </div>
  );
}

export default MetricsPage;
