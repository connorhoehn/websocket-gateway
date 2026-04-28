// frontend/src/components/observability/DashboardPage.tsx
//
// Single-page scrollable observability dashboard (§18.6).
//
// Layout (top to bottom):
//   1. Header: title + Live/Paused toggle
//   2. KPI row (Runs today / Active now / Pending approvals / Failed 24h)
//   3. Cluster health card with node grid
//   4. Active runs table
//   5. Recent events list (EventRow)
//   6. Alerts panel
//
// Phase 1: fixture-driven. A TODO marker flags Phase 4 polling hookup.

import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import dashboardFixture from './fixtures/dashboardFixture';
import { useDashboard } from './hooks/useDashboard';
import { usePipelineMetrics } from './hooks/usePipelineMetrics';
import type { PipelineMetricsSource } from './hooks/usePipelineMetrics';
import { useObservability } from './context/ObservabilityContext';
import type { RecentEvent } from './context/ObservabilityContext';
import KPICard from './components/KPICard';
import NodeGrid from './components/NodeGrid';
import type { NodeSummary } from './components/NodeGridTile';
import ActiveRunsTable, { type ActiveRunRow } from './components/ActiveRunsTable';
import AlertsPanel, { type Alert } from './components/AlertsPanel';
import EventRow from '../shared/EventRow';
import { colors } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EM_DASH = '\u2014';

/**
 * Format a millisecond value for the KPI card. Returns the em-dash for
 * `null`/non-finite inputs (FE1 fix pattern) so the UI never shows a stale
 * "0 ms" when the bridge hasn't supplied the field yet.
 *
 * Examples:
 *   formatMs(null)   → "—"
 *   formatMs(0)      → "0 ms"
 *   formatMs(234)    → "234 ms"
 *   formatMs(1234)   → "1.2s"
 *   formatMs(12345)  → "12.3s"
 */
export function formatMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Phase-1 synthesized data (from the dashboardFixture scaffolding)
// ---------------------------------------------------------------------------

function buildPhase1Nodes(overview: { totalNodes: number; healthyNodes: number }): NodeSummary[] {
  // Phase 1 fixture has no per-node telemetry. Generate simple healthy tiles
  // so the cluster-health card renders per §18.6.
  const n = Math.max(0, overview.totalNodes ?? 0);
  const history = (seed: number) =>
    Array.from({ length: 12 }, (_, i) =>
      Math.max(0, Math.round(10 + Math.sin(seed + i / 2) * 4 + i * 0.3)),
    );
  return Array.from({ length: n }, (_, i) => ({
    id: `node-${i}`,
    status: 'healthy' as const,
    role: 'worker',
    cpu: 10 + i * 4,
    memoryMb: 280 + i * 60,
    connections: 12 + i * 3,
    activeRuns: 0,
    cpuHistory: history(i),
  }));
}

const PHASE1_ACTIVE_RUNS: ActiveRunRow[] = [];

// ---------------------------------------------------------------------------
// Sub-components (kept local — not reused elsewhere)
// ---------------------------------------------------------------------------

const cardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 16,
  fontFamily: 'inherit',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: colors.textPrimary,
  marginBottom: 8,
  fontFamily: 'inherit',
};

/**
 * Tiny pill that surfaces where pipeline metrics came from on this poll.
 * Rendering rules (Wave 2 / AUDIT-06):
 *   - 'bridge' → no pill (intended steady state, avoid chrome).
 *   - 'stub'   → amber "demo data" pill so operators don't mistake
 *                synthesized numbers for live state.
 *   - 'error'  → red "metrics error" badge.
 *   - null     → no pill until the first poll resolves.
 */
function MetricsSourcePill({ source }: { source: PipelineMetricsSource | null }) {
  if (source === null || source === 'bridge') return null;

  const isError = source === 'error';
  const background = isError ? '#fef2f2' : '#fffbeb';
  const color = isError ? colors.state.failed : colors.state.awaiting;
  const label = isError ? 'metrics error' : 'demo data';
  const title = isError
    ? '/api/pipelines/metrics returned an error — values are placeholders'
    : 'No pipeline bridge wired — metrics are synthesized fixture data';

  return (
    <span
      data-testid="pipeline-metrics-source-pill"
      data-source={source}
      title={title}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background,
        color,
      }}
    >
      {label}
    </span>
  );
}

function LiveToggle({
  live,
  onChange,
}: {
  live: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      data-testid="live-toggle"
      onClick={() => onChange(!live)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        background: live ? colors.surface : colors.surfaceInset,
        border: `1px solid ${live ? colors.primary : colors.border}`,
        borderRadius: 6,
        color: live ? colors.primary : colors.textSecondary,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: live ? colors.state.completed : colors.textTertiary,
        }}
      />
      {live ? 'Live' : 'Paused'}
    </button>
  );
}

function ClusterHealthCard({
  nodes,
  healthyCount,
  totalCount,
  onSelect,
}: {
  nodes: NodeSummary[];
  healthyCount: number;
  totalCount: number;
  onSelect: (id: string) => void;
}) {
  const allHealthy = healthyCount === totalCount;
  const chipBg = allHealthy ? '#f0fdf4' : '#fffbeb';
  const chipColor = allHealthy ? colors.state.completed : colors.state.awaiting;

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div style={sectionTitleStyle}>Cluster health</div>
        <span
          data-testid="cluster-health-chip"
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: chipBg,
            color: chipColor,
          }}
        >
          {healthyCount}/{totalCount} {allHealthy ? '✓' : '!'}
        </span>
      </div>
      <NodeGrid nodes={nodes} onSelect={onSelect} />
    </div>
  );
}

function RecentEventsCard({
  events,
  onViewAll,
}: {
  events: RecentEvent[];
  onViewAll: () => void;
}) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div style={sectionTitleStyle}>Recent events (last 20)</div>
        <button
          data-testid="recent-events-view-all"
          onClick={onViewAll}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.primary,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ▸ view all
        </button>
      </div>
      {events.length === 0 ? (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: colors.textTertiary,
            fontSize: 13,
          }}
        >
          No recent events
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {events.slice(0, 20).map((e) => (
            <EventRow
              key={e.id}
              timestamp={e.timestamp}
              type={e.type}
              summary={e.summary}
              severity={e.severity}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const activeRunsRef = useRef<HTMLDivElement>(null);

  const { live, setLive, recentEvents, activeRunsCount, isLiveData } =
    useObservability();
  const liveDashboard = useDashboard();
  // First-paint fallback: before the provider's initial-load effect has run,
  // render the static fixture so the UI is never blank.
  const dashboard = liveDashboard ?? dashboardFixture;

  // Pipeline metrics poller — drives the KPI row.
  // Phase 4 wires distributed-core's PipelineModule.getMetrics(); the bridge
  // currently exposes only a subset of fields, so most numerics arrive as
  // `null` and must render as "—" rather than zero.
  const { metrics: pipelineMetrics, source: metricsSource } = usePipelineMetrics();

  const overview = dashboard?.overview ?? {};
  const nodes = useMemo(() => buildPhase1Nodes(overview), [overview]);

  // KPI values: pass through nulls so KPICard can render the em-dash.
  // `activeRunsCount` from the EventStream takes precedence when non-zero —
  // it's the most up-to-date "active now" since it updates on every dispatch.
  // When the EventStream count is 0 AND the bridge value is null, we fall
  // back to the empty active-runs table count (also 0) — these are real
  // zeroes, not "unknown" zeroes, so they're rendered as numbers.
  const runsToday: number | string = pipelineMetrics?.runsStarted ?? EM_DASH;
  const runsSparkline = [0, 0, 0, 0, 0, 0, 0, 0];
  const activeNow: number | string =
    activeRunsCount > 0
      ? activeRunsCount
      : pipelineMetrics?.runsActive ?? EM_DASH;
  const pendingApprovals: number | string =
    pipelineMetrics?.runsAwaitingApproval ?? EM_DASH;
  const failed24h: number | string = pipelineMetrics?.runsFailed ?? EM_DASH;
  // First-token latency arrives from distributed-core v0.3.7+ via the bridge;
  // older builds and the stub fixture leave it null → render em-dash, never
  // "0 ms".
  const avgFirstTokenLatencyMs = pipelineMetrics?.avgFirstTokenLatencyMs ?? null;
  const avgFirstTokenLatency: string = formatMs(avgFirstTokenLatencyMs);

  const alerts: Alert[] = Array.isArray(dashboard?.alerts) ? dashboard.alerts : [];

  const handleScrollToActive = () => {
    activeRunsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleGoToPipelines = () => {
    // Phase 4 will have a dedicated pending-approvals panel; placeholder for now.
    navigate('/pipelines');
  };

  const handleGoToFailedEvents = () => {
    navigate('/observability/events?filter=errors');
  };

  const handleSelectNode = (id: string) => {
    navigate(`/observability/nodes?selected=${encodeURIComponent(id)}`);
  };

  const handleViewAllEvents = () => {
    navigate('/observability/events');
  };

  return (
    <div
      data-testid="observability-dashboard"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        color: colors.textPrimary,
        background: colors.surfacePanel,
        minHeight: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: colors.textPrimary,
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          Dashboard
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            data-testid="dashboard-data-source"
            title={
              isLiveData
                ? 'Connected to /api/observability/dashboard'
                : 'Backend unreachable — using fixture data'
            }
            style={{
              fontSize: 11,
              color: isLiveData ? colors.state.completed : colors.textTertiary,
              fontWeight: 600,
            }}
          >
            {isLiveData ? 'live data' : 'fixture'}
          </span>
          <MetricsSourcePill source={metricsSource} />
          <LiveToggle live={live} onChange={setLive} />
        </div>
      </div>

      {/* KPI row — responsive auto-fit grid (minmax 170px). 5 cards may wrap
          to 4+1 or 5+0 depending on viewport; both layouts are intentional.
          Deltas suppressed when the underlying KPI is null/em-dash so we
          don't render a stale "▲ 12%" next to "—". */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 16,
        }}
      >
        <KPICard
          title="Runs today"
          value={runsToday}
          delta={typeof runsToday === 'number' ? { value: 12, direction: 'up' } : undefined}
          sparklineData={runsSparkline}
        />
        <KPICard
          title="Active now"
          value={activeNow}
          onClick={handleScrollToActive}
        />
        <KPICard
          title="Pending approvals"
          value={pendingApprovals}
          onClick={handleGoToPipelines}
        />
        <KPICard
          title="Failed (24h)"
          value={failed24h}
          delta={typeof failed24h === 'number' ? { value: 4, direction: 'down' } : undefined}
          onClick={handleGoToFailedEvents}
        />
        <KPICard
          title="Avg first-token latency"
          value={avgFirstTokenLatency}
        />
      </div>

      {/* Cluster health */}
      <ClusterHealthCard
        nodes={nodes}
        healthyCount={overview.healthyNodes ?? 0}
        totalCount={overview.totalNodes ?? 0}
        onSelect={handleSelectNode}
      />

      {/* Active runs */}
      <div ref={activeRunsRef}>
        <div style={sectionTitleStyle}>
          Active runs ({PHASE1_ACTIVE_RUNS.length})
        </div>
        <ActiveRunsTable
          runs={PHASE1_ACTIVE_RUNS}
          onRowClick={(run) =>
            navigate(`/pipelines/${run.pipelineId}/runs/${run.runId}`)
          }
        />
      </div>

      {/* Recent events */}
      <RecentEventsCard
        events={recentEvents}
        onViewAll={handleViewAllEvents}
      />

      {/* Alerts */}
      <div>
        <div style={sectionTitleStyle}>Alerts ({alerts.length})</div>
        <AlertsPanel alerts={alerts} />
      </div>
    </div>
  );
}
