// frontend/src/components/pipelines/PipelineRunComparePage.tsx
//
// Side-by-side run comparison view. Route:
//   /pipelines/:pipelineId/runs/compare/:runIdA/:runIdB
//
// Useful for "what changed between this run and that run" debugging — different
// LLM responses, different durations, different paths through Conditions.
//
// Reads both runs from the localStorage runHistory and the definition (for
// node display names) from pipelineStorage. The page is read-only.

import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import type { CSSProperties } from 'react';

import { loadPipeline } from './persistence/pipelineStorage';
import { getRun } from './persistence/runHistory';
import { aggregateCost, formatUsd } from './cost/llmPricing';
import EmptyState from '../shared/EmptyState';
import { colors, chipStyle } from '../../constants/styles';
import type {
  PipelineDefinition,
  PipelineRun,
  RunStatus,
  StepExecution,
} from '../../types/pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatDelta(ms?: number): string {
  if (ms == null) return '—';
  const sign = ms > 0 ? '+' : ms < 0 ? '' : '';
  return `${sign}${formatDuration(Math.abs(ms))}`.replace(/^(\+|-)?/, ms === 0 ? '' : (ms > 0 ? '+' : '-'));
}

function statusVariant(s: StepExecution['status']):
  | 'success' | 'danger' | 'neutral' | 'info' | 'warning' {
  switch (s) {
    case 'completed': return 'success';
    case 'failed':    return 'danger';
    case 'cancelled': return 'neutral';
    case 'skipped':   return 'neutral';
    case 'running':   return 'info';
    case 'awaiting':  return 'warning';
    default:          return 'neutral';
  }
}

function runStatusVariant(s: RunStatus):
  | 'success' | 'danger' | 'neutral' | 'info' | 'warning' {
  switch (s) {
    case 'completed':         return 'success';
    case 'failed':            return 'danger';
    case 'cancelled':         return 'neutral';
    case 'awaiting_approval': return 'warning';
    case 'running':           return 'info';
    case 'pending':           return 'neutral';
    default:                  return 'neutral';
  }
}

function lookupNodeName(
  def: PipelineDefinition | null,
  nodeId: string,
): string {
  if (!def) return nodeId;
  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  if (node.data.type === 'condition' && node.data.label) return node.data.label;
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

function modelByNodeIdMap(def: PipelineDefinition | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!def) return map;
  for (const node of def.nodes) {
    if (node.data.type === 'llm') map.set(node.id, node.data.model);
  }
  return map;
}

function runCostLabel(
  run: PipelineRun,
  modelMap: Map<string, string>,
): string {
  const steps = Object.values(run.steps)
    .filter((s) => !!s.llm)
    .map((s) => ({
      model: modelMap.get(s.nodeId),
      tokensIn: s.llm?.tokensIn ?? 0,
      tokensOut: s.llm?.tokensOut ?? 0,
    }));
  return formatUsd(aggregateCost(steps).total);
}

// ---------------------------------------------------------------------------
// Word-level diff (LCS over whitespace-split tokens)
// ---------------------------------------------------------------------------

type DiffPart = { type: 'eq' | 'add' | 'del'; text: string };

/**
 * Tiny LCS-based word diff. Splits both inputs on whitespace (preserving the
 * separators so re-joining reads naturally), then walks the LCS table to emit
 * a `(equal | added | removed)` token stream.
 */
export function wordDiff(a: string, b: string): DiffPart[] {
  // Split keeping whitespace tokens so re-joining reproduces original spacing.
  const tokenize = (s: string): string[] => s.split(/(\s+)/).filter((t) => t.length > 0);
  const A = tokenize(a);
  const B = tokenize(b);

  // Build LCS length table.
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack into a parts list, coalescing adjacent same-type tokens.
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      push('eq', A[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', A[i]);
      i++;
    } else {
      push('add', B[j]);
      j++;
    }
  }
  while (i < m) { push('del', A[i++]); }
  while (j < n) { push('add', B[j++]); }
  return parts;
}

// ---------------------------------------------------------------------------
// Step row construction
// ---------------------------------------------------------------------------

interface CompareRow {
  nodeId: string;
  name: string;
  a: StepExecution | undefined;
  b: StepExecution | undefined;
  /** ms delta (B - A); undefined if either side missing duration. */
  durationDelta: number | undefined;
  /** Both steps run AND statuses differ. */
  statusDiffers: boolean;
  /** Both completed successfully but durationDelta is large (>50%). */
  durationLarge: boolean;
  /** Condition step where the routed branch differs between runs. */
  branchDiffers: boolean;
  /** True if either side has llm data. */
  isLlm: boolean;
  /** True if either side is a condition node. */
  isCondition: boolean;
  /** "true" / "false" routed branch, derived from output.result for condition nodes. */
  branchA?: string;
  branchB?: string;
}

function isConditionNode(def: PipelineDefinition | null, nodeId: string): boolean {
  if (!def) return false;
  const node = def.nodes.find((n) => n.id === nodeId);
  return !!node && node.data.type === 'condition';
}

function conditionBranch(step: StepExecution | undefined): string | undefined {
  if (!step) return undefined;
  const out = step.output as { result?: unknown } | undefined;
  if (out && typeof out === 'object' && 'result' in out) {
    return out.result ? 'true' : 'false';
  }
  return undefined;
}

function buildRows(
  runA: PipelineRun,
  runB: PipelineRun,
  def: PipelineDefinition | null,
): CompareRow[] {
  // Preserve a stable order: nodes from definition first (in their listed
  // order), then any nodeIds that exist in either run but not the definition.
  const seen = new Set<string>();
  const ordered: string[] = [];
  if (def) {
    for (const n of def.nodes) {
      if (runA.steps[n.id] || runB.steps[n.id]) {
        ordered.push(n.id);
        seen.add(n.id);
      }
    }
  }
  for (const id of [...Object.keys(runA.steps), ...Object.keys(runB.steps)]) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered.map<CompareRow>((nodeId) => {
    const a = runA.steps[nodeId];
    const b = runB.steps[nodeId];
    const aDur = a?.durationMs;
    const bDur = b?.durationMs;
    const durationDelta = aDur != null && bDur != null ? bDur - aDur : undefined;
    const statusDiffers = !!a && !!b && a.status !== b.status;

    let durationLarge = false;
    if (aDur != null && bDur != null && aDur > 0) {
      const ratio = Math.abs(bDur - aDur) / aDur;
      durationLarge = ratio > 0.5;
    }

    const isCondition = isConditionNode(def, nodeId);
    const branchA = isCondition ? conditionBranch(a) : undefined;
    const branchB = isCondition ? conditionBranch(b) : undefined;
    const branchDiffers = isCondition
      && branchA !== undefined
      && branchB !== undefined
      && branchA !== branchB;

    return {
      nodeId,
      name: lookupNodeName(def, nodeId),
      a, b,
      durationDelta,
      statusDiffers,
      durationLarge,
      branchDiffers,
      isLlm: !!(a?.llm || b?.llm),
      isCondition,
      branchA, branchB,
    };
  });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  fontFamily: 'inherit',
  color: colors.textPrimary,
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const summaryColsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const summaryCardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
};

const summaryLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: colors.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  overflow: 'hidden',
};

const thStyle: CSSProperties = {
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: `1px solid ${colors.border}`,
  textAlign: 'left',
  background: colors.surfaceInset,
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'top',
};

// Highlight palette for diff rows (faint pastel backgrounds).
const HIGHLIGHT = {
  status:   '#fef2f2', // red-ish (status differs)
  duration: '#fffbeb', // amber-ish (slow/fast)
  branch:   '#eff6ff', // blue-ish (different branch routed)
} as const;

function rowHighlight(row: CompareRow): CSSProperties | undefined {
  if (row.statusDiffers) return { background: HIGHLIGHT.status };
  if (row.branchDiffers) return { background: HIGHLIGHT.branch };
  if (row.durationLarge) return { background: HIGHLIGHT.duration };
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM diff cell (collapsible)
// ---------------------------------------------------------------------------

function LlmDiff({ a, b }: { a: string; b: string }) {
  const parts = useMemo(() => wordDiff(a, b), [a, b]);

  const containerStyle: CSSProperties = {
    background: colors.surfaceInset,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  return (
    <div style={containerStyle} data-testid="llm-word-diff">
      {parts.map((p, i) => {
        if (p.type === 'eq') return <span key={i}>{p.text}</span>;
        if (p.type === 'add') {
          return (
            <span
              key={i}
              data-diff="add"
              style={{ background: '#dcfce7', color: '#166534' }}
            >
              {p.text}
            </span>
          );
        }
        return (
          <span
            key={i}
            data-diff="del"
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              textDecoration: 'line-through',
            }}
          >
            {p.text}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelineRunComparePage() {
  const { pipelineId, runIdA, runIdB } = useParams<{
    pipelineId: string;
    runIdA: string;
    runIdB: string;
  }>();
  const navigate = useNavigate();

  const def = useMemo(
    () => (pipelineId ? loadPipeline(pipelineId) : null),
    [pipelineId],
  );
  const runA = useMemo(
    () => (pipelineId && runIdA ? getRun(pipelineId, runIdA) : null),
    [pipelineId, runIdA],
  );
  const runB = useMemo(
    () => (pipelineId && runIdB ? getRun(pipelineId, runIdB) : null),
    [pipelineId, runIdB],
  );

  const modelMap = useMemo(() => modelByNodeIdMap(def), [def]);

  const rows = useMemo(() => {
    if (!runA || !runB) return [] as CompareRow[];
    return buildRows(runA, runB, def);
  }, [runA, runB, def]);

  if (!pipelineId || !runIdA || !runIdB) {
    return <Navigate to="/pipelines" replace />;
  }

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

  if (!runA || !runB) {
    return (
      <div style={{ padding: 32 }} data-testid="run-compare-missing">
        <EmptyState
          icon="🔍"
          title="Run not found"
          body="One or both runs are unavailable — they may have been trimmed from history."
          actionLabel="Back to runs"
          onAction={() => navigate(`/pipelines/${pipelineId}/runs`)}
        />
      </div>
    );
  }

  const totalDelta = (runB.durationMs ?? 0) - (runA.durationMs ?? 0);
  const costA = runCostLabel(runA, modelMap);
  const costB = runCostLabel(runB, modelMap);

  return (
    <div style={pageStyle} data-testid="run-compare">
      {/* ── Breadcrumb ──────────────────────────────────────────────── */}
      <div style={headerRowStyle}>
        <button
          type="button"
          onClick={() => navigate(`/pipelines/${pipelineId}/runs`)}
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
          Compare runs
        </span>
        <span
          style={{ fontSize: 12, color: colors.textTertiary, marginLeft: 'auto' }}
          data-testid="run-compare-cost-delta"
        >
          {costA} → {costB}
        </span>
      </div>

      {/* ── Run A / Run B summary cards ────────────────────────────── */}
      <div style={summaryColsStyle}>
        <RunSummary
          label="Run A"
          run={runA}
          cost={costA}
          testIdPrefix="run-a"
        />
        <RunSummary
          label="Run B"
          run={runB}
          cost={costB}
          testIdPrefix="run-b"
        />
      </div>

      {/* ── Total delta strip ──────────────────────────────────────── */}
      <div
        style={{
          ...summaryCardStyle,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          padding: '10px 14px',
        }}
        data-testid="run-compare-delta"
      >
        <span style={summaryLabelStyle}>Δ duration</span>
        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {formatDelta(totalDelta)}
        </span>
        <span style={{ flex: 1 }} />
        <span style={summaryLabelStyle}>{rows.length} step{rows.length === 1 ? '' : 's'} compared</span>
      </div>

      {/* ── Step diff table ────────────────────────────────────────── */}
      <table style={tableStyle} data-testid="run-compare-table">
        <thead>
          <tr>
            <th style={thStyle}>Step</th>
            <th style={thStyle}>Run A</th>
            <th style={thStyle}>Run B</th>
            <th style={thStyle}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CompareTableRow key={row.nodeId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RunSummary({
  label,
  run,
  cost,
  testIdPrefix,
}: {
  label: string;
  run: PipelineRun;
  cost: string;
  testIdPrefix: string;
}) {
  const variant = runStatusVariant(run.status);
  return (
    <div style={summaryCardStyle} data-testid={`${testIdPrefix}-summary`}>
      <span style={summaryLabelStyle}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ fontFamily: 'monospace', fontSize: 12, color: colors.textTertiary }}
        >
          {run.id.slice(0, 8)}
        </span>
        <span style={{ color: colors.textTertiary }}>·</span>
        <span style={{ color: colors.textSecondary }}>{formatDate(run.startedAt)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={chipStyle(variant)}>{run.status}</span>
        <span style={{ color: colors.textTertiary }}>·</span>
        <span style={{ fontFamily: 'monospace' }}>{formatDuration(run.durationMs)}</span>
        <span style={{ color: colors.textTertiary }}>·</span>
        <span style={{ fontFamily: 'monospace' }} data-testid={`${testIdPrefix}-cost`}>
          {cost}
        </span>
      </div>
    </div>
  );
}

function CompareTableRow({ row }: { row: CompareRow }) {
  const aLlm = row.a?.llm;
  const bLlm = row.b?.llm;
  const tokenDelta =
    aLlm && bLlm ? (bLlm.tokensIn + bLlm.tokensOut) - (aLlm.tokensIn + aLlm.tokensOut) : undefined;

  const highlight = rowHighlight(row);
  const baseTd: CSSProperties = { ...tdStyle, ...(highlight ?? {}) };

  return (
    <>
      <tr data-testid={`run-compare-row-${row.nodeId}`} style={highlight}>
        <td style={baseTd}>
          <div style={{ fontWeight: 600, color: colors.textPrimary }}>{row.name}</div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: colors.textTertiary,
            }}
          >
            {row.nodeId}
          </div>
        </td>
        <td style={baseTd}>
          <StepCell step={row.a} branch={row.branchA} isCondition={row.isCondition} />
        </td>
        <td style={baseTd}>
          <StepCell step={row.b} branch={row.branchB} isCondition={row.isCondition} />
        </td>
        <td
          style={{ ...baseTd, fontFamily: 'monospace' }}
          data-testid={`run-compare-delta-${row.nodeId}`}
        >
          {row.branchDiffers ? (
            <span style={{ color: '#2563eb', fontWeight: 600 }}>different branch!</span>
          ) : row.statusDiffers ? (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>status differs</span>
          ) : row.durationDelta != null ? (
            <span style={{ color: row.durationLarge ? '#d97706' : colors.textSecondary }}>
              {formatDelta(row.durationDelta)}
            </span>
          ) : (
            <span style={{ color: colors.textTertiary }}>—</span>
          )}
          {tokenDelta != null && tokenDelta !== 0 ? (
            <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
              {tokenDelta > 0 ? '+' : ''}
              {tokenDelta}tok
            </div>
          ) : null}
        </td>
      </tr>

      {row.isLlm && (aLlm || bLlm) ? (
        <tr>
          <td style={{ ...tdStyle, padding: 0 }} colSpan={4}>
            <details style={{ padding: '10px 14px', background: colors.surfaceInset }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: colors.textSecondary,
                }}
                data-testid={`run-compare-llm-toggle-${row.nodeId}`}
              >
                LLM response diff
              </summary>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                <div>
                  <div style={summaryLabelStyle}>Run A</div>
                  <pre
                    data-testid={`run-compare-llm-a-${row.nodeId}`}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: 10,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      margin: 0,
                    }}
                  >
                    {aLlm?.response ?? '(no response)'}
                  </pre>
                </div>
                <div>
                  <div style={summaryLabelStyle}>Run B</div>
                  <pre
                    data-testid={`run-compare-llm-b-${row.nodeId}`}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: 10,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      margin: 0,
                    }}
                  >
                    {bLlm?.response ?? '(no response)'}
                  </pre>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={summaryLabelStyle}>Word-level diff</div>
                <div style={{ marginTop: 6 }}>
                  <LlmDiff
                    a={aLlm?.response ?? ''}
                    b={bLlm?.response ?? ''}
                  />
                </div>
              </div>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StepCell({
  step,
  branch,
  isCondition,
}: {
  step: StepExecution | undefined;
  branch: string | undefined;
  isCondition: boolean;
}) {
  if (!step) {
    return <span style={{ color: colors.textTertiary }}>(not run)</span>;
  }
  const variant = statusVariant(step.status);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={chipStyle(variant)}>{step.status}</span>
        <span style={{ fontFamily: 'monospace', color: colors.textSecondary }}>
          {formatDuration(step.durationMs)}
        </span>
        {isCondition && branch ? (
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: colors.textTertiary,
            }}
          >
            ({branch === 'true' ? 'T' : 'F'})
          </span>
        ) : null}
      </div>
      {step.llm ? (
        <div
          style={{
            fontSize: 11,
            color: colors.textTertiary,
            fontFamily: 'monospace',
          }}
        >
          {step.llm.tokensIn}→{step.llm.tokensOut}tok
        </div>
      ) : null}
      {step.error ? (
        <div style={{ fontSize: 11, color: '#dc2626' }} title={step.error}>
          {step.error.length > 60 ? `${step.error.slice(0, 60)}…` : step.error}
        </div>
      ) : null}
    </div>
  );
}
