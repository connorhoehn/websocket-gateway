// frontend/src/components/pipelines/PipelineRunReplayPage.tsx
//
// Route: /pipelines/:pipelineId/runs/:runId — historical run replay per
// PIPELINES_PLAN.md §18.5.
//
// Same overall frame as the editor, but:
//   - Palette is hidden (read-only mode) — canvas takes its space.
//   - Canvas is passed a readOnly flag (sibling agent may not wire it yet —
//     see TODO below).
//   - Top bar shows breadcrumb + "Run from <date> by <user>" + Re-run + ⋯.
//   - Bottom is a scrubber strip placeholder (Phase 1 stubs, wired in Phase 5).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import {
  PipelineEditorProvider,
  usePipelineEditor,
} from './context/PipelineEditorContext';
import {
  PipelineRunsProvider,
  usePipelineRuns,
} from './context/PipelineRunsContext';
import { EventStreamProvider } from './context/EventStreamContext';
import PipelineCanvas from './canvas/PipelineCanvas';
import ConfigPanel from './canvas/ConfigPanel';
import { loadPipeline, duplicatePipeline } from './persistence/pipelineStorage';
import { useReplayDriver } from './replay/useReplayDriver';
import { useReplayKeyboard } from './replay/useReplayKeyboard';
import Scrubber from './replay/Scrubber';
import { useRunCost } from './cost/useRunCost';
import { formatUsd } from './cost/llmPricing';
import { colors } from '../../constants/styles';
import type { PipelineRun, RunStatus } from '../../types/pipeline';

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

function downloadJSON(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function statusChipVariant(
  status: RunStatus,
): { label: string; bg: string; fg: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', bg: '#f0fdf4', fg: '#16a34a' };
    case 'failed':
      return { label: 'Failed', bg: '#fef2f2', fg: '#dc2626' };
    case 'cancelled':
      return { label: 'Cancelled', bg: '#f1f5f9', fg: '#475569' };
    case 'awaiting_approval':
      return { label: 'Awaiting approval', bg: '#fffbeb', fg: '#d97706' };
    case 'running':
      return { label: 'Running', bg: '#eff6ff', fg: '#2563eb' };
    case 'pending':
      return { label: 'Pending', bg: '#f1f5f9', fg: '#475569' };
    default:
      return { label: status, bg: '#f1f5f9', fg: '#475569' };
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: colors.surfaceInset,
  fontFamily: 'inherit',
  color: colors.textPrimary,
};

const topBarStyle: CSSProperties = {
  height: 44,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 12px',
  borderBottom: `1px solid ${colors.border}`,
  background: colors.surface,
  position: 'relative',
  zIndex: 5,
};

const workspaceStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  position: 'relative',
};

const canvasAreaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
};

const iconBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  background: 'transparent',
  color: colors.textSecondary,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  fontFamily: 'inherit',
};

const chipStyle = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'inherit',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  background: bg,
  color: fg,
});

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 6,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
  minWidth: 200,
  zIndex: 20,
  overflow: 'hidden',
};

const menuBtnStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 14px',
  fontSize: 13,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: colors.textPrimary,
};

const rerunBtnStyle: CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: colors.primary,
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

// Scrubber styles live in `replay/Scrubber.tsx` — extracted to keep this page
// under the 700-line guideline in PIPELINES_PLAN.md §18.5.

// ---------------------------------------------------------------------------
// Outer page — route param validation + providers
// ---------------------------------------------------------------------------

export default function PipelineRunReplayPage() {
  const { pipelineId, runId } = useParams<{
    pipelineId: string;
    runId: string;
  }>();

  const exists = useMemo(() => {
    if (!pipelineId) return false;
    return loadPipeline(pipelineId) !== null;
  }, [pipelineId]);

  if (!pipelineId || !runId || !exists) {
    return <Navigate to="/pipelines" replace />;
  }

  return (
    <EventStreamProvider>
      <PipelineEditorProvider pipelineId={pipelineId}>
        <PipelineRunsProvider>
          <ReplayFrame pipelineId={pipelineId} runId={runId} />
        </PipelineRunsProvider>
      </PipelineEditorProvider>
    </EventStreamProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner frame — consumes editor + runs context
// ---------------------------------------------------------------------------

interface ReplayFrameProps {
  pipelineId: string;
  runId: string;
}

function ReplayFrame({ pipelineId, runId }: ReplayFrameProps) {
  const navigate = useNavigate();
  const editor = usePipelineEditor();
  const runs = usePipelineRuns();
  const { definition, selectedNodeId } = editor;

  const run: PipelineRun | undefined = runs.runs[runId];

  // ── Replay driver ────────────────────────────────────────────────────
  // The Phase-1 scrubber drives the canvas by deriving a best-effort wire-
  // event timeline from the persisted `PipelineRun` snapshot (see
  // `replay/deriveEvents.ts`) and dispatching it through EventStreamContext
  // — the same pipe the live executor uses. Phase 5 will swap the source
  // to a true WAL replay from distributed-core's EventBus, keeping the same
  // scrubber UI.
  const replay = useReplayDriver(run ?? null);

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  // The driver is a no-op when `run` is missing (totalEvents === 0), so the
  // hook safely short-circuits in the fallback view.
  useReplayKeyboard(replay, run !== undefined);

  // ── Cost estimate ────────────────────────────────────────────────────
  const runCost = useRunCost(run ?? null);

  // ── Overflow menu ────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  // ── Re-run ───────────────────────────────────────────────────────────
  const handleReRun = useCallback(async () => {
    if (!run) {
      // No known run — still allow a fresh run with an empty payload.
      try {
        const newRunId = await runs.triggerRun(pipelineId);
        navigate(`/pipelines/${pipelineId}/runs/${newRunId}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PipelineRunReplay] re-run failed', err);
      }
      return;
    }
    try {
      const newRunId = await runs.triggerRun(
        pipelineId,
        run.triggeredBy.payload,
      );
      navigate(`/pipelines/${pipelineId}/runs/${newRunId}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PipelineRunReplay] re-run failed', err);
    }
  }, [run, runs, pipelineId, navigate]);

  // ── Menu handlers ────────────────────────────────────────────────────
  const handleCopyRunId = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard?.writeText(runId);
    } catch {
      // ignore — clipboard may not be available
    }
  };

  const handleExportRun = () => {
    setMenuOpen(false);
    if (!run) return;
    const json = JSON.stringify(run, null, 2);
    downloadJSON(`run-${runId}.json`, json);
  };

  const handleOpenAsNewDraft = () => {
    setMenuOpen(false);
    if (!definition) return;
    const clone = duplicatePipeline(
      definition.id,
      `${definition.name} (from run)`,
    );
    if (clone) navigate(`/pipelines/${clone.id}`);
  };

  // ── Missing-run fallback ─────────────────────────────────────────────
  if (!run) {
    return (
      <div style={pageStyle} data-testid="pipeline-replay-missing">
        <div style={topBarStyle}>
          <button
            type="button"
            onClick={() => navigate(`/pipelines/${pipelineId}`)}
            style={iconBtnStyle}
            aria-label="Back to pipeline"
            title="Back to pipeline"
          >
            ←
          </button>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.textPrimary,
            }}
          >
            {definition?.name ?? 'Pipeline'}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 14, color: colors.textSecondary }}>
            Run not available — it may have been trimmed from history.
          </div>
          <button
            type="button"
            onClick={() => navigate(`/pipelines/${pipelineId}`)}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: colors.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 7,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Back to pipeline
          </button>
        </div>
      </div>
    );
  }

  const statusChip = statusChipVariant(run.status);
  const triggeredByLabel = run.triggeredBy.userId ?? run.triggeredBy.triggerType;
  const costLabel = formatUsd(runCost);

  return (
    <div style={pageStyle} data-testid="pipeline-replay">
      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div style={topBarStyle}>
        <button
          type="button"
          onClick={() => navigate(`/pipelines/${pipelineId}`)}
          style={iconBtnStyle}
          aria-label="Back to pipeline"
          title="Back to pipeline"
        >
          ←
        </button>

        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: colors.textPrimary,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={definition?.name ?? pipelineId}
        >
          {definition?.name ?? pipelineId}
        </div>

        <span style={{ color: colors.textTertiary, fontSize: 12 }}>·</span>

        <div
          style={{
            fontSize: 12,
            color: colors.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid="replay-subtitle"
        >
          Run from {formatDate(run.startedAt)} by {triggeredByLabel}
        </div>

        <span
          style={{ color: colors.textTertiary, fontSize: 12 }}
          data-testid="replay-cost"
        >
          · {costLabel}
        </span>

        <span style={chipStyle(statusChip.bg, statusChip.fg)}>
          {statusChip.label}
        </span>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={handleReRun}
          style={rerunBtnStyle}
          data-testid="rerun-button"
          title="Re-run with the original trigger payload"
        >
          ↻ Re-run
        </button>

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((x) => !x)}
            aria-label="More actions"
            style={iconBtnStyle}
            data-testid="replay-overflow-btn"
          >
            ⋯
          </button>
          {menuOpen ? (
            <div style={popoverStyle}>
              <button style={menuBtnStyle} onClick={handleCopyRunId}>
                Copy runId
              </button>
              <button style={menuBtnStyle} onClick={handleExportRun}>
                Export run JSON
              </button>
              <button style={menuBtnStyle} onClick={handleOpenAsNewDraft}>
                Open as new draft
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Workspace (canvas + config panel, no palette) ────────── */}
      <div style={workspaceStyle}>
        <div style={canvasAreaStyle}>
          {/*
            The scrubber below drives the canvas by replaying events from the
            persisted run history. Derivation happens in
            `replay/deriveEvents.ts` and is a Phase-1 stand-in — Phase 5 will
            migrate to real WAL replay from distributed-core's EventBus so
            token cadence, approval ordering, and any ResourceRouter events
            land verbatim instead of being synthesized.
          */}
          <PipelineCanvas />
        </div>
        {selectedNodeId !== null ? <ConfigPanel /> : null}
      </div>

      {/* ── Scrubber strip (Phase 1 wired) ───────────────────────── */}
      <Scrubber replay={replay} />
    </div>
  );
}
