// frontend/src/components/pipelines/PendingApprovalsPage.tsx
//
// Cross-pipeline pending-approvals surface (PIPELINES_PLAN.md §18.20).
// Route: `/pipelines/approvals`.
//
// Lists every run currently blocked on an approval node (driven by the
// `pipeline.approval.requested` / `pipeline.approval.recorded` event stream;
// see `usePendingApprovalsState`). Approvers can approve / reject inline with
// an optional comment, or jump to the originating pipeline's canvas.
//
// Loading: 3 skeleton cards while the dashboard endpoint is in flight.
// Error:   red banner with retry.
// Empty:   friendly empty-state once load resolves with zero approvals.

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { usePipelineRuns } from './context/PipelineRunsContext';
import {
  usePendingApprovalsState,
  type PendingApproval,
} from './hooks/usePendingApprovals';
import { loadPipeline } from './persistence/pipelineStorage';
import EmptyState from '../shared/EmptyState';
import SkeletonCard from '../shared/SkeletonCard';
import {
  colors,
  chipStyle,
  fieldStyle,
  saveBtnStyle,
} from '../../constants/styles';
import type { Approver, PipelineDefinition } from '../../types/pipeline';

// ---------------------------------------------------------------------------
// Static styles — hoisted so we don't reallocate on every render.
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: colors.surfaceInset, fontFamily: 'inherit' },
  header: { height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${colors.border}`, background: colors.surface, position: 'sticky', top: 0, zIndex: 2 },
  headerTitle: { fontSize: 18, fontWeight: 700, color: colors.textPrimary },
  body: { flex: 1, overflowY: 'auto', padding: 20 },
  card: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pipelineButton: { fontSize: 14, fontWeight: 600, color: colors.textPrimary, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' },
  runTail: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: colors.textTertiary },
  message: { fontSize: 13, color: colors.textSecondary, background: colors.surfaceInset, padding: '8px 12px', borderRadius: 6, lineHeight: 1.5 },
  approversRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  approverChipBase: { ...chipStyle('info'), display: 'inline-flex', alignItems: 'center', gap: 4 },
  textarea: { ...fieldStyle, width: '100%', padding: '8px 12px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  rejectBtn: { padding: '6px 14px', fontSize: 13, fontWeight: 600, background: colors.state.failed, color: '#fff', border: 'none', borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer' },
  approveBtn: { ...saveBtnStyle(false), padding: '6px 14px', fontSize: 13, background: colors.state.completed },
  errorBanner: { padding: '12px 16px', background: '#fef2f2', border: `1px solid ${colors.state.failed}`, color: colors.state.failed, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  retryBtn: { padding: '6px 14px', fontSize: 13, fontWeight: 500, background: '#fff', color: colors.state.failed, border: `1px solid ${colors.state.failed}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  hand: { fontSize: 18 },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  elapsed: { fontSize: 12, color: colors.textTertiary, whiteSpace: 'nowrap' },
  approverLabel: { fontSize: 11, color: colors.textTertiary, marginRight: 4 },
  approverNote: { fontSize: 11, color: colors.textTertiary, marginLeft: 4 },
  errorText: { fontSize: 13, fontWeight: 500 },
  pendingHeaderRow: { display: 'flex', alignItems: 'center', gap: 10 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable elapsed time relative to now. */
function formatElapsed(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then) || then <= 0) return '—';
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Last 6 chars of a runId — matches §18.20's runId tail convention. */
function runIdTail(id: string): string {
  return id.length <= 6 ? id : id.slice(-6);
}

/** Compact approver display: emoji + value. */
function ApproverChip({ approver, idx }: { approver: Approver; idx: number }) {
  const icon = approver.type === 'role' ? '🎖' : '👤';
  return (
    <span
      key={`${approver.type}:${approver.value}:${idx}`}
      style={styles.approverChipBase}
    >
      <span aria-hidden>{icon}</span>
      <span>{approver.value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface ApprovalCardData extends PendingApproval {
  pipelineName: string;
}

interface CardProps {
  row: ApprovalCardData;
  onSubmit: (decision: 'approve' | 'reject', comment: string) => void;
  onOpenPipeline: () => void;
}

function ApprovalCard({ row, onSubmit, onOpenPipeline }: CardProps) {
  const [comment, setComment] = useState('');

  const submit = useCallback(
    (decision: 'approve' | 'reject') => {
      onSubmit(decision, comment.trim());
      setComment('');
    },
    [comment, onSubmit],
  );

  const required = row.requiredCount ?? 1;
  const recorded = row.recordedCount ?? 0;

  return (
    <div data-testid={`approval-card-${row.runId}`} style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.rowMeta}>
          <span style={styles.hand} aria-hidden>✋</span>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={onOpenPipeline}
              data-testid={`open-pipeline-${row.pipelineId}`}
              style={styles.pipelineButton}
              title={row.pipelineName}
            >
              {row.pipelineName}
            </button>
            <div style={styles.runTail}>run #{runIdTail(row.runId)}</div>
          </div>
        </div>
        <span style={styles.elapsed}>{formatElapsed(row.requestedAt)}</span>
      </div>

      {row.message ? (
        <div data-testid={`approval-message-${row.runId}`} style={styles.message}>
          {row.message}
        </div>
      ) : null}

      <div style={styles.approversRow}>
        <span style={styles.approverLabel}>Approvers:</span>
        {row.approvers.length === 0 ? (
          <span style={styles.approverLabel}>(anyone)</span>
        ) : (
          row.approvers.map((a, i) => <ApproverChip approver={a} idx={i} key={i} />)
        )}
        {required > 1 ? (
          <span style={styles.approverNote}>({recorded}/{required} approvals)</span>
        ) : null}
      </div>

      <textarea
        data-testid={`approval-comment-${row.runId}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment…"
        rows={2}
        style={styles.textarea}
      />

      <div style={styles.actions}>
        <button data-testid={`reject-${row.runId}`} onClick={() => submit('reject')} style={styles.rejectBtn}>
          Reject
        </button>
        <button data-testid={`approve-${row.runId}`} onClick={() => submit('approve')} style={styles.approveBtn}>
          Approve
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PendingApprovalsPage() {
  const navigate = useNavigate();
  const { approvals, isLoading, error, retry } = usePendingApprovalsState();
  const { resolveApproval } = usePipelineRuns();

  // Optimistically removed (runId, stepId) keys — entries here are filtered
  // out of the rendered list. Cleared once the matching `recorded` event
  // arrives and the hook drops them naturally.
  const [optimisticRemoved, setOptimisticRemoved] = useState<Set<string>>(
    () => new Set(),
  );

  // When the hook removes an approval (because the `recorded` event arrived),
  // drop the matching optimistic-removal key so the Set doesn't grow without
  // bound. We compare against the live approvals' keys.
  useEffect(() => {
    if (optimisticRemoved.size === 0) return;
    const liveKeys = new Set(approvals.map((a) => `${a.runId}::${a.stepId}`));
    let changed = false;
    const next = new Set(optimisticRemoved);
    for (const key of optimisticRemoved) {
      if (!liveKeys.has(key)) {
        next.delete(key);
        changed = true;
      }
    }
    if (changed) setOptimisticRemoved(next);
  }, [approvals, optimisticRemoved]);

  // Pipeline-definition cache for name lookup. `loadPipeline` is a cheap
  // localStorage read; memoize so we don't re-parse the same definition for
  // every approval row in the list.
  const rows: ApprovalCardData[] = useMemo(() => {
    const defCache = new Map<string, PipelineDefinition | null>();
    const out: ApprovalCardData[] = [];
    for (const item of approvals) {
      const key = `${item.runId}::${item.stepId}`;
      if (optimisticRemoved.has(key)) continue;

      let def = defCache.get(item.pipelineId);
      if (def === undefined) {
        def = loadPipeline(item.pipelineId);
        defCache.set(item.pipelineId, def);
      }
      const pipelineName =
        def?.name ??
        (item.pipelineId
          ? `Pipeline ${item.pipelineId.slice(0, 8)}`
          : 'Unknown pipeline');
      out.push({ ...item, pipelineName });
    }
    return out;
  }, [approvals, optimisticRemoved]);

  const handleSubmit = useCallback(
    (
      runId: string,
      stepId: string,
      decision: 'approve' | 'reject',
      comment: string,
    ) => {
      // AGENT-1: ideally `eventStream.resolveApproval(runId, stepId, decision,
      // comment)` would be exposed by EventStreamContext so this page doesn't
      // need to know about PipelineRunsContext. Until then, reuse the existing
      // `usePipelineRuns().resolveApproval` plumbing.
      resolveApproval(runId, stepId, decision, comment || undefined);

      // Optimistic removal — the row disappears immediately. The eventual
      // `pipeline.approval.recorded` event will remove it from the source
      // list and the cleanup effect above will drop it from this set.
      setOptimisticRemoved((prev) => {
        const next = new Set(prev);
        next.add(`${runId}::${stepId}`);
        return next;
      });
    },
    [resolveApproval],
  );

  const count = rows.length;

  return (
    <div data-testid="pending-approvals-page" style={styles.page}>
      <div style={styles.header}>
        <div style={styles.pendingHeaderRow}>
          <div style={styles.headerTitle}>Pending approvals</div>
          <span data-testid="pending-count" style={chipStyle(count > 0 ? 'warning' : 'neutral')}>
            {count}
          </span>
        </div>
      </div>

      <div style={styles.body}>
        {error ? (
          <div data-testid="approvals-error" role="alert" style={styles.errorBanner}>
            <span style={styles.errorText}>Couldn't load pending approvals. Try again.</span>
            <button data-testid="approvals-retry" onClick={retry} style={styles.retryBtn}>Retry</button>
          </div>
        ) : null}

        {isLoading && count === 0 ? (
          <div data-testid="approvals-loading" style={styles.list}>
            <SkeletonCard height={140} />
            <SkeletonCard height={140} />
            <SkeletonCard height={140} />
          </div>
        ) : count === 0 && !error ? (
          <EmptyState
            icon="✋"
            title="No pending approvals"
            body="When a pipeline reaches an approval step, it'll show up here."
            testId="approvals-empty"
          />
        ) : (
          <div data-testid="approvals-list" style={styles.list}>
            {rows.map((row) => (
              <ApprovalCard
                key={`${row.runId}:${row.stepId}`}
                row={row}
                onOpenPipeline={() => navigate(`/pipelines/${row.pipelineId}`)}
                onSubmit={(decision, comment) =>
                  handleSubmit(row.runId, row.stepId, decision, comment)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
