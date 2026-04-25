// frontend/src/components/pipelines/PipelineRunsPage.tsx
//
// List view for a pipeline's persisted run history. Route: /pipelines/:pipelineId/runs.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router';
import { loadPipeline } from './persistence/pipelineStorage';
import { listRuns } from './persistence/runHistory';
import { aggregateCost, formatUsd } from './cost/llmPricing';
import EmptyState from '../shared/EmptyState';
import { colors, chipStyle } from '../../constants/styles';
import type { PipelineDefinition, PipelineRun, RunStatus } from '../../types/pipeline';

type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled';

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
    case 'awaiting_approval':
      return { ...chipStyle('warning'), label: 'Awaiting approval' } as const;
    default:
      return { ...chipStyle('neutral'), label: s } as const;
  }
}

export default function PipelineRunsPage() {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [def, setDef] = useState<PipelineDefinition | null>(null);

  useEffect(() => {
    if (!pipelineId) return;
    setDef(loadPipeline(pipelineId));
    setRuns(listRuns(pipelineId));
  }, [pipelineId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return runs;
    return runs.filter((r) => r.status === filter);
  }, [runs, filter]);

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
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {(['all', 'completed', 'failed', 'cancelled'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              textTransform: 'capitalize',
              border: `1px solid ${filter === k ? colors.primary : colors.border}`,
              background: filter === k ? colors.primary : colors.surface,
              color: filter === k ? '#fff' : colors.textSecondary,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="📜"
          title={runs.length === 0 ? 'No runs yet' : 'No runs match this filter'}
          body={
            runs.length === 0
              ? 'Trigger this pipeline and completed runs will appear here.'
              : 'Switch to a different status filter.'
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
              {['Started', 'Status', 'Duration', 'Cost', 'Triggered by', 'Run ID', ''].map((h) => (
                <th
                  key={h}
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
            {filtered.map((r) => {
              const chip = statusChip(r.status);
              return (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(`/pipelines/${pipelineId}/runs/${r.id}`)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = colors.surfaceHover;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
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
