// social-api/src/routes/pipelineMetrics.ts
//
// Two routers in one file (kept colocated for owner-bookkeeping reasons):
//
//   1. `pipelineMetricsRouter` — GET /api/pipelines/metrics
//      Returns runtime metrics for the pipeline subsystem. Phase 4 will
//      replace `getPipelineMetricsStub()` with `await pipelineModule.getMetrics()`
//      once the embedded distributed-core cluster is wired.
//
//   2. `observabilityRouter` — mounted at /api/observability:
//        GET /api/observability/dashboard → cluster dashboard snapshot
//        GET /api/observability/metrics   → Prom-style metrics summary
//      Both endpoints stub-fill synthetic data when no live cluster is wired
//      so the frontend dashboards can light up against social-api.
//
// Both stubs are deterministic-ish (bucketed by minute/hour) so the dashboard
// shows lifelike change without flickering wildly between polls.

import { Router } from 'express';

// ---------------------------------------------------------------------------
// Pipeline metrics
// ---------------------------------------------------------------------------

export interface PipelineMetrics {
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  runsActive: number;
  runsAwaitingApproval: number;
  avgDurationMs: number;
  llmTokensIn: number;
  llmTokensOut: number;
  estimatedCostUsd: number;
  asOf: string; // ISO timestamp
}

export function getPipelineMetricsStub(): PipelineMetrics {
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const hourBucket = Math.floor(now / 3_600_000);

  const runsStarted = 147 + (minuteBucket % 20);
  const runsFailed = 3 + (hourBucket % 5);
  const runsActive = 4 + (minuteBucket % 7);
  const runsAwaitingApproval = 2 + (minuteBucket % 4);
  const runsCompleted = Math.max(
    0,
    runsStarted - runsFailed - runsActive - runsAwaitingApproval,
  );

  const avgDurationMs = 8_200 + (minuteBucket % 30) * 100;
  const llmTokensIn = 125_000 + (minuteBucket % 50) * 500;
  const llmTokensOut = 42_000 + (minuteBucket % 40) * 200;
  const estimatedCostUsd =
    Math.round(((llmTokensIn / 1_000_000) * 3 + (llmTokensOut / 1_000_000) * 15) * 100) / 100;

  return {
    runsStarted,
    runsCompleted,
    runsFailed,
    runsActive,
    runsAwaitingApproval,
    avgDurationMs,
    llmTokensIn,
    llmTokensOut,
    estimatedCostUsd,
    asOf: new Date(now).toISOString(),
  };
}

export const pipelineMetricsRouter = Router();

pipelineMetricsRouter.get('/', (_req, res) => {
  res.json(getPipelineMetricsStub());
});

// ---------------------------------------------------------------------------
// Observability — dashboard + cluster metrics
// ---------------------------------------------------------------------------

export interface ClusterNodeSnapshot {
  nodeId: string;
  status: 'healthy' | 'degraded' | 'down';
  role: 'leader' | 'follower' | 'worker';
  pipelinesActive: number;
  cpuPct: number;
  memPct: number;
  uptimeSec: number;
}

export interface ClusterAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  at: string;
}

export interface ObservabilityDashboard {
  cluster: {
    healthy: number;
    degraded: number;
    down: number;
    leaderId: string;
  };
  nodes: ClusterNodeSnapshot[];
  alerts: ClusterAlert[];
  pipelines: {
    active: number;
    awaitingApproval: number;
    completed24h: number;
    failed24h: number;
  };
  asOf: string;
}

export interface ObservabilityMetricsSummary {
  // Prometheus-ish summary. Names match what the dashboard charts plot.
  runsPerMinute: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRatePct: number;
  llmTokensPerMinute: number;
  approvalsPendingTotal: number;
  asOf: string;
}

/**
 * Synthesize a "3 healthy nodes, 0 alerts" dashboard. Used when no live
 * distributed-core cluster is wired. Phase 4 swaps the body for a call into
 * the embedded `ClusterController.getDashboard()`.
 */
export function getObservabilityDashboardStub(): ObservabilityDashboard {
  const now = Date.now();
  const m = getPipelineMetricsStub();
  const nodes: ClusterNodeSnapshot[] = [
    {
      nodeId: 'node-a',
      status: 'healthy',
      role: 'leader',
      pipelinesActive: Math.ceil(m.runsActive / 3),
      cpuPct: 22 + (Math.floor(now / 60_000) % 8),
      memPct: 41 + (Math.floor(now / 90_000) % 5),
      uptimeSec: Math.floor(now / 1000) % 86_400,
    },
    {
      nodeId: 'node-b',
      status: 'healthy',
      role: 'follower',
      pipelinesActive: Math.floor(m.runsActive / 3),
      cpuPct: 18 + (Math.floor(now / 60_000) % 6),
      memPct: 37 + (Math.floor(now / 90_000) % 4),
      uptimeSec: Math.floor(now / 1000) % 86_400,
    },
    {
      nodeId: 'node-c',
      status: 'healthy',
      role: 'worker',
      pipelinesActive: m.runsActive - Math.ceil(m.runsActive / 3) - Math.floor(m.runsActive / 3),
      cpuPct: 31 + (Math.floor(now / 60_000) % 9),
      memPct: 44 + (Math.floor(now / 90_000) % 6),
      uptimeSec: Math.floor(now / 1000) % 86_400,
    },
  ];
  return {
    cluster: { healthy: 3, degraded: 0, down: 0, leaderId: 'node-a' },
    nodes,
    alerts: [],
    pipelines: {
      active: m.runsActive,
      awaitingApproval: m.runsAwaitingApproval,
      completed24h: m.runsCompleted,
      failed24h: m.runsFailed,
    },
    asOf: new Date(now).toISOString(),
  };
}

export function getObservabilityMetricsStub(): ObservabilityMetricsSummary {
  const m = getPipelineMetricsStub();
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const runsPerMinute = 8 + (minuteBucket % 6);
  const p50LatencyMs = Math.round(m.avgDurationMs * 0.7);
  const p95LatencyMs = Math.round(m.avgDurationMs * 1.6);
  const p99LatencyMs = Math.round(m.avgDurationMs * 2.4);
  const totalRuns = m.runsStarted || 1;
  const errorRatePct = Math.round((m.runsFailed / totalRuns) * 1000) / 10;
  const llmTokensPerMinute = Math.round((m.llmTokensIn + m.llmTokensOut) / 60);
  return {
    runsPerMinute,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    errorRatePct,
    llmTokensPerMinute,
    approvalsPendingTotal: m.runsAwaitingApproval,
    asOf: new Date(now).toISOString(),
  };
}

export const observabilityRouter = Router();

observabilityRouter.get('/dashboard', (_req, res) => {
  res.json(getObservabilityDashboardStub());
});

observabilityRouter.get('/metrics', (_req, res) => {
  res.json(getObservabilityMetricsStub());
});
