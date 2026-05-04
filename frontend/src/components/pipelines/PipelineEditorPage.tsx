// frontend/src/components/pipelines/PipelineEditorPage.tsx
//
// Route: /pipelines/:pipelineId — the visual editor per PIPELINES_PLAN.md §18.4.
//
// Layout:
//   top bar (44px)
//   ├── palette 220px │ canvas │ config panel 320px (when node selected)
//   └── execution log (bottom, collapsible)
//
// The page is wrapped in EventStream → PipelineRuns → PipelineEditor providers
// so child components read state from context. The inner `EditorFrame`
// actually composes the editor surface and owns the run lifecycle (currentRunId,
// keyboard shortcuts, confirm modals, popovers).

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
import {
  EventStreamProvider,
  useEventStream,
} from './context/EventStreamContext';
import { getPipelineSource } from './hooks/usePipelineSource';
import type { WildcardEvent } from './context/EventStreamContext';
import PipelineCanvas from './canvas/PipelineCanvas';
import NodePalette from './canvas/NodePalette';
import ConfigPanel from './canvas/ConfigPanel';
import ExecutionLog from './canvas/ExecutionLog';
import { validatePipeline } from './validation/validatePipeline';
import {
  deletePipeline,
  duplicatePipeline,
  exportPipelineJSON,
  loadPipeline,
} from './persistence/pipelineStorage';
import { clearRuns } from './persistence/runHistory';
import { toMermaid } from './export/toMermaid';
import VersionDiffModal from './versions/VersionDiffModal';
import Modal from '../shared/Modal';
import IconPicker from '../shared/IconPicker';
import TagEditor from '../shared/TagEditor';
import { useToast } from '../shared/ToastProvider';
import SimulatorPanel from './dev/SimulatorPanel';
import SourceDiagnosticBanner from './diagnostics/SourceDiagnosticBanner';
import { colors } from '../../constants/styles';
import type {
  NodeType,
  PipelineDefinition,
  PipelineEventMap,
  ValidationIssue,
} from '../../types/pipeline';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pipeline'
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

// Human-readable name for a node — prefer `data.label` (Condition) when set,
// otherwise capitalize the node type. Falls back to the nodeId if the node
// can't be located in the current definition.
function lookupStepName(
  definition: PipelineDefinition | null,
  nodeId: string | undefined,
): string {
  if (!nodeId) return 'step';
  const node = definition?.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  if (node.data.type === 'condition' && node.data.label) return node.data.label;
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  // The AppLayout body scrolls; we use a min-height (not height: 100%) so the
  // editor always has room for the canvas while still fitting inside the
  // surrounding chrome. 200px approximates the AppLayout header + primary
  // tabs + sub-nav + outer padding above this page.
  minHeight: 'calc(100vh - 200px)',
  background: colors.surfaceInset,
  fontFamily: 'inherit',
  color: colors.textPrimary,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  overflow: 'hidden',
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
  // Sticky so the run/save controls remain visible if the workspace grows
  // taller than the viewport (e.g. during scroll on a tall canvas).
  position: 'sticky',
  top: 0,
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
  // Explicit min-height — without it, the flex container can collapse to 0px
  // when the page's height is undefined, leaving React Flow with nothing to
  // render (nodes invisible after import).
  minHeight: 600,
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

const nameButtonStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 14,
  fontWeight: 700,
  color: colors.textPrimary,
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  cursor: 'text',
  fontFamily: 'inherit',
  maxWidth: 280,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

const nameInputStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 14,
  fontWeight: 700,
  color: colors.textPrimary,
  background: colors.surface,
  border: `1px solid ${colors.borderField}`,
  borderRadius: 6,
  fontFamily: 'inherit',
  outline: 'none',
  width: 260,
};

const chipBase: CSSProperties = {
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
};

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  marginTop: 6,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
  padding: 0,
  minWidth: 260,
  maxWidth: 360,
  maxHeight: 320,
  overflowY: 'auto',
  zIndex: 20,
};

const runBtnStyle = (disabled: boolean, running: boolean): CSSProperties => ({
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: running ? '#dc2626' : colors.primary,
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontFamily: 'inherit',
  flexShrink: 0,
});

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

// ---------------------------------------------------------------------------
// Outer page — providers + sanity check
// ---------------------------------------------------------------------------

export default function PipelineEditorPage() {
  const { pipelineId } = useParams<{ pipelineId: string }>();

  // Validate existence eagerly so we can redirect when the URL is stale.
  const exists = useMemo(() => {
    if (!pipelineId) return false;
    return loadPipeline(pipelineId) !== null;
  }, [pipelineId]);

  if (!pipelineId || !exists) {
    return <Navigate to="/pipelines" replace />;
  }

  return (
    <EventStreamProvider source={getPipelineSource()}>
      <PipelineEditorProvider pipelineId={pipelineId}>
        <PipelineRunsProvider>
          <EditorFrame pipelineId={pipelineId} />
        </PipelineRunsProvider>
      </PipelineEditorProvider>
    </EventStreamProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner frame — consumes editor + runs context
// ---------------------------------------------------------------------------

interface EditorFrameProps {
  pipelineId: string;
}

function EditorFrame({ pipelineId }: EditorFrameProps) {
  const navigate = useNavigate();
  const editor = usePipelineEditor();
  const runs = usePipelineRuns();
  const { toast } = useToast();

  const {
    definition,
    dirty,
    selectedNodeId,
    setSelectedNodeId,
    save,
    publish,
    revert,
    undo,
    redo,
    rename,
    setIcon,
    setTags,
  } = editor;

  // ── Run-lifecycle toasts ──────────────────────────────────────────────
  // Only surface toasts for runs that belong to this pipeline. The runs map
  // is the source of truth for runId → pipelineId; we capture it in a ref so
  // stable useCallback handlers can look it up without re-subscribing.
  const runsRef = useRef(runs.runs);
  useEffect(() => {
    runsRef.current = runs.runs;
  }, [runs.runs]);

  const definitionRef = useRef(definition);
  useEffect(() => {
    definitionRef.current = definition;
  }, [definition]);

  const belongsToPipeline = useCallback(
    (runId: string | undefined): boolean => {
      if (!runId) return false;
      return runsRef.current[runId]?.pipelineId === pipelineId;
    },
    [pipelineId],
  );

  const handleRunStarted = useCallback(
    (
      payload:
        | PipelineEventMap['pipeline.run.started']
        | WildcardEvent,
    ) => {
      if ('eventType' in payload) return;
      // The started event carries pipelineId directly — prefer that so we
      // can show the toast even before the runs map has been updated.
      if (payload.pipelineId !== pipelineId) return;
      toast('Run started', { type: 'info' });
    },
    [pipelineId, toast],
  );

  const handleRunCompleted = useCallback(
    (
      payload:
        | PipelineEventMap['pipeline.run.completed']
        | WildcardEvent,
    ) => {
      if ('eventType' in payload) return;
      if (!belongsToPipeline(payload.runId)) return;
      const seconds = Math.round(payload.durationMs / 100) / 10;
      toast(`Run completed in ${seconds}s`, { type: 'success' });
    },
    [belongsToPipeline, toast],
  );

  const handleRunFailed = useCallback(
    (
      payload:
        | PipelineEventMap['pipeline.run.failed']
        | WildcardEvent,
    ) => {
      if ('eventType' in payload) return;
      if (!belongsToPipeline(payload.runId)) return;
      const failedNodeId = payload.error.nodeId;
      const stepName = lookupStepName(definitionRef.current, failedNodeId);
      toast(`Run failed at ${stepName}`, {
        type: 'error',
        durationMs: 8000,
        actionLabel: 'View',
        onAction: () => setSelectedNodeId(failedNodeId),
      });
    },
    [belongsToPipeline, setSelectedNodeId, toast],
  );

  const handleRunCancelled = useCallback(
    (
      payload:
        | PipelineEventMap['pipeline.run.cancelled']
        | WildcardEvent,
    ) => {
      if ('eventType' in payload) return;
      if (!belongsToPipeline(payload.runId)) return;
      toast('Run cancelled', { type: 'warning' });
    },
    [belongsToPipeline, toast],
  );

  const handleApprovalRequested = useCallback(
    (
      payload:
        | PipelineEventMap['pipeline.approval.requested']
        | WildcardEvent,
    ) => {
      if ('eventType' in payload) return;
      if (!belongsToPipeline(payload.runId)) return;
      const stepId = payload.stepId;
      const stepName = lookupStepName(definitionRef.current, stepId);
      toast(`Approval requested on "${stepName}"`, {
        type: 'warning',
        durationMs: 6000,
        actionLabel: 'Resolve',
        onAction: () => setSelectedNodeId(stepId),
      });
    },
    [belongsToPipeline, setSelectedNodeId, toast],
  );

  useEventStream('pipeline.run.started', handleRunStarted);
  useEventStream('pipeline.run.completed', handleRunCompleted);
  useEventStream('pipeline.run.failed', handleRunFailed);
  useEventStream('pipeline.run.cancelled', handleRunCancelled);
  useEventStream('pipeline.approval.requested', handleApprovalRequested);

  // Which run the editor should visually "follow" — most recent active,
  // falling back to the most recent completed.
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Transient saving indicator — flips on any dirty→clean transition.
  const [savingFlash, setSavingFlash] = useState(false);
  const savingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDirtyRef = useRef(dirty);
  useEffect(() => {
    if (prevDirtyRef.current && !dirty) {
      setSavingFlash(true);
      if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
      savingTimerRef.current = setTimeout(() => setSavingFlash(false), 450);
    }
    prevDirtyRef.current = dirty;
    return () => {
      if (savingTimerRef.current) {
        clearTimeout(savingTimerRef.current);
        savingTimerRef.current = null;
      }
    };
  }, [dirty]);

  // Execution-log node filter — set by PipelineCanvas's right-click menu, the
  // chip above the log clears it. See §18.4.6.
  const [logFilterNodeId, setLogFilterNodeId] = useState<string | null>(null);
  const clearLogFilter = useCallback(() => setLogFilterNodeId(null), []);

  // Inline name editor.
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (nameEditing) {
      setNameDraft(definition?.name ?? '');
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [nameEditing, definition?.name]);

  const commitName = () => {
    const next = nameDraft.trim();
    if (!definition) {
      setNameEditing(false);
      return;
    }
    if (next && next !== definition.name) {
      rename(next);
    }
    setNameEditing(false);
  };

  // Validation memo.
  const validation = useMemo(
    () => (definition ? validatePipeline(definition) : null),
    [definition],
  );

  // Keep the canvas re-mounted when pipelineId changes (defensive).
  const triggerAlreadyPlaced = useMemo(() => {
    if (!definition) return false;
    return definition.nodes.some((n) => n.type === 'trigger');
  }, [definition]);

  const disabledTypes: NodeType[] = triggerAlreadyPlaced ? ['trigger'] : [];

  // ── Current run tracking ──────────────────────────────────────────────
  useEffect(() => {
    // Prefer an active run if there is one; else keep last completed.
    if (runs.activeRunIds.length > 0) {
      const lastActive = runs.activeRunIds[runs.activeRunIds.length - 1];
      if (lastActive !== currentRunId) setCurrentRunId(lastActive);
      return;
    }
    if (!currentRunId) {
      const all = Object.values(runs.runs).sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
      if (all.length > 0) setCurrentRunId(all[0].id);
    }
  }, [runs.activeRunIds, runs.runs, currentRunId]);

  const currentRun = currentRunId ? runs.runs[currentRunId] : undefined;
  const isRunActive =
    !!currentRun &&
    (currentRun.status === 'running' ||
      currentRun.status === 'pending' ||
      currentRun.status === 'awaiting_approval');

  // ── Run controls ──────────────────────────────────────────────────────
  const isPublished = definition?.status === 'published';
  const hasErrors = (validation?.errors.length ?? 0) > 0;
  const runDisabled = !isRunActive && (!isPublished || hasErrors);

  const runTitle = isRunActive
    ? 'Cancel the active run'
    : !isPublished
      ? 'Publish the pipeline to enable runs'
      : hasErrors
        ? 'Fix validation errors to enable runs'
        : 'Start a new run';

  const handleRunClick = useCallback(async () => {
    if (isRunActive && currentRunId) {
      runs.cancelRun(currentRunId);
      return;
    }
    if (runDisabled) return;
    try {
      const runId = await runs.triggerRun(pipelineId);
      setCurrentRunId(runId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PipelineEditor] triggerRun failed', err);
    }
  }, [isRunActive, currentRunId, runDisabled, runs, pipelineId]);

  // ── Overflow menu + popovers ─────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearRunsConfirmOpen, setClearRunsConfirmOpen] = useState(false);
  const [versionDiffOpen, setVersionDiffOpen] = useState(false);
  // Dev-only simulator panel (Vite dev mode). Gated on `import.meta.env.DEV`
  // so the state declaration is harmless in production — SimulatorPanel itself
  // is a no-op when !DEV.
  const [simPanelOpen, setSimPanelOpen] = useState(false);
  // Tag row visibility — hidden by default per UX feedback. Persisted in
  // localStorage so the choice survives reloads; SSR-safe via the typeof guard.
  const [showTags, setShowTags] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('ws_pipelines_v1_show_tags') === 'true';
    } catch {
      return false;
    }
  });
  const toggleShowTags = useCallback(() => {
    setShowTags((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          'ws_pipelines_v1_show_tags',
          next ? 'true' : 'false',
        );
      } catch {
        // localStorage may be unavailable (private mode, quota): ignore.
      }
      return next;
    });
  }, []);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const validationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !validationOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(t)) {
        setMenuOpen(false);
      }
      if (
        validationOpen &&
        validationRef.current &&
        !validationRef.current.contains(t)
      ) {
        setValidationOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen, validationOpen]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when the user is typing in an input/textarea/contentEditable.
      if (isEditableTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        toast('Saved', { type: 'success', durationMs: 1200 });
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void handleRunClick();
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        if (isRunActive && currentRunId) runs.cancelRun(currentRunId);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    save,
    toast,
    handleRunClick,
    isRunActive,
    currentRunId,
    runs,
    undo,
    redo,
    setSelectedNodeId,
  ]);

  // ── Overflow-menu handlers ────────────────────────────────────────────
  const handleDuplicate = () => {
    if (!definition) return;
    const clone = duplicatePipeline(definition.id);
    setMenuOpen(false);
    if (clone) navigate(`/pipelines/${clone.id}`);
  };

  const handleExport = () => {
    if (!definition) return;
    const json = exportPipelineJSON(definition.id);
    if (!json) return;
    downloadJSON(`${slugify(definition.name)}.pipeline.json`, json);
    setMenuOpen(false);
  };

  const handleCopyMermaid = async () => {
    if (!definition) return;
    setMenuOpen(false);
    const mermaid = toMermaid(definition);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mermaid);
        toast('Mermaid diagram copied', { type: 'success' });
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[PipelineEditor] clipboard write failed', err);
      toast('Could not copy Mermaid diagram', { type: 'error' });
    }
  };

  const handleViewVersions = () => {
    setMenuOpen(false);
    setVersionDiffOpen(true);
  };

  const publishedSnapshotDef = useMemo<PipelineDefinition | null>(() => {
    if (!definition?.publishedSnapshot) return null;
    // The snapshot type is `Omit<PipelineDefinition, 'publishedSnapshot'>` —
    // structurally assignable where the modal needs a readable PipelineDefinition.
    return definition.publishedSnapshot as PipelineDefinition;
  }, [definition]);

  const handlePublishConfirm = () => {
    setPublishConfirmOpen(false);
    if (hasErrors) return;
    publish();
    toast('Pipeline published', { type: 'success' });
  };

  const handleDeleteConfirm = () => {
    if (!definition) return;
    deletePipeline(definition.id);
    setDeleteConfirmOpen(false);
    navigate('/pipelines');
  };

  const handleClearRunsConfirm = () => {
    clearRuns(pipelineId);
    setClearRunsConfirmOpen(false);
    toast('Run history cleared', { type: 'success' });
  };

  // ── Save-status chip ──────────────────────────────────────────────────
  const saveChip: { label: string; variant: 'success' | 'info' | 'neutral' } =
    dirty
      ? { label: 'Saving…', variant: 'info' }
      : savingFlash
        ? { label: '✓ Saved', variant: 'success' }
        : { label: '✓ Saved', variant: 'neutral' };

  // ── Version badge ─────────────────────────────────────────────────────
  const versionBadge = definition
    ? definition.status === 'published'
      ? {
          label: `v${definition.version} · Published`,
          variant: 'success' as const,
        }
      : typeof definition.publishedVersion === 'number'
        ? {
            label: `v${definition.version} · Draft (pub v${definition.publishedVersion})`,
            variant: 'warning' as const,
          }
        : {
            label: `v${definition.version} · Draft`,
            variant: 'neutral' as const,
          }
    : { label: 'Loading…', variant: 'neutral' as const };

  // ── Validation indicator ──────────────────────────────────────────────
  const validationIndicator = validation
    ? validation.errors.length > 0
      ? {
          label: `✗ ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'}`,
          variant: 'danger' as const,
        }
      : validation.warnings.length > 0
        ? {
            label: `⚠ ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}`,
            variant: 'warning' as const,
          }
        : { label: '✓ Valid', variant: 'success' as const }
    : { label: '…', variant: 'neutral' as const };

  const chipVariantStyle = (
    variant: 'success' | 'info' | 'neutral' | 'warning' | 'danger',
  ): CSSProperties => {
    const palette: Record<
      'success' | 'info' | 'neutral' | 'warning' | 'danger',
      { bg: string; fg: string }
    > = {
      neutral: { bg: '#f1f5f9', fg: '#475569' },
      success: { bg: '#f0fdf4', fg: '#16a34a' },
      warning: { bg: '#fffbeb', fg: '#d97706' },
      danger: { bg: '#fef2f2', fg: '#dc2626' },
      info: { bg: '#eff6ff', fg: '#2563eb' },
    };
    const p = palette[variant];
    return { ...chipBase, background: p.bg, color: p.fg };
  };

  // ── Validation popover — jump to node ────────────────────────────────
  const allIssues: ValidationIssue[] = validation
    ? [...validation.errors, ...validation.warnings]
    : [];

  const jumpToNode = (nodeId?: string) => {
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    setValidationOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!definition) {
    return (
      <div style={pageStyle}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.textTertiary,
            fontSize: 13,
          }}
        >
          Loading pipeline…
        </div>
      </div>
    );
  }

  // Filter runs to the current run so ExecutionLog focuses on it.
  // Note: ExecutionLog itself subscribes to the wildcard event stream; it
  // does not need runs as a prop. The `currentRunId` lives here for the
  // Run/Cancel button. Events emitted by the MockExecutor carry runId in
  // their payloads so the existing log already handles this implicitly.

  const runBtnLabel = isRunActive
    ? '⏹ Cancel'
    : currentRun && currentRun.status !== 'running'
      ? '↻ Re-run'
      : '▶ Run';

  return (
    <div style={pageStyle} data-testid="pipeline-editor">
      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div style={topBarStyle}>
        <button
          type="button"
          onClick={() => navigate('/pipelines')}
          style={iconBtnStyle}
          aria-label="Back to pipelines"
          title="Back to pipelines"
        >
          ←
        </button>

        <IconPicker
          value={definition.icon ?? '🔀'}
          onChange={setIcon}
        />

        {nameEditing ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setNameDraft(definition.name);
                setNameEditing(false);
              }
            }}
            style={nameInputStyle}
            data-testid="pipeline-name-input"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNameEditing(true)}
            style={nameButtonStyle}
            title={definition.name}
            data-testid="pipeline-name"
          >
            {definition.name}
          </button>
        )}

        <span
          style={chipVariantStyle(saveChip.variant)}
          data-testid="save-status"
        >
          {saveChip.label}
        </span>

        <span
          style={chipVariantStyle(versionBadge.variant)}
          data-testid="version-badge"
        >
          {versionBadge.label}
        </span>

        <div style={{ position: 'relative' }} ref={validationRef}>
          <button
            type="button"
            onClick={() => setValidationOpen((x) => !x)}
            style={{
              ...chipVariantStyle(validationIndicator.variant),
              cursor: 'pointer',
              border: 'none',
            }}
            data-testid="validation-indicator"
          >
            {validationIndicator.label}
          </button>
          {validationOpen && allIssues.length > 0 ? (
            <div style={popoverStyle}>
              {allIssues.map((issue, idx) => (
                <button
                  key={`${issue.code}-${idx}`}
                  type="button"
                  onClick={() => jumpToNode(issue.nodeId)}
                  style={{
                    ...menuBtnStyle,
                    borderBottom:
                      idx === allIssues.length - 1
                        ? 'none'
                        : `1px solid ${colors.border}`,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    lineHeight: 1.4,
                    cursor: issue.nodeId ? 'pointer' : 'default',
                  }}
                >
                  <span
                    style={{
                      color:
                        issue.severity === 'error'
                          ? '#dc2626'
                          : '#d97706',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {issue.severity === 'error' ? '✗' : '⚠'}
                  </span>
                  <span style={{ flex: 1, fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{issue.code}</div>
                    <div style={{ color: colors.textSecondary }}>
                      {issue.message}
                    </div>
                    {issue.nodeId ? (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: colors.primary,
                        }}
                      >
                        Jump to node →
                      </div>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={handleRunClick}
          disabled={runDisabled}
          title={runTitle}
          style={runBtnStyle(runDisabled, isRunActive)}
          data-testid="run-button"
        >
          {runBtnLabel}
        </button>

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((x) => !x)}
            aria-label="More actions"
            style={iconBtnStyle}
            data-testid="overflow-menu-btn"
          >
            ⋯
          </button>
          {menuOpen ? (
            <div style={{ ...popoverStyle, right: 0, minWidth: 200 }}>
              <button style={menuBtnStyle} onClick={handleDuplicate}>
                Duplicate
              </button>
              <button style={menuBtnStyle} onClick={handleExport}>
                Export JSON
              </button>
              <button
                style={menuBtnStyle}
                onClick={handleCopyMermaid}
                data-testid="copy-mermaid-btn"
              >
                Copy Mermaid
              </button>
              <button
                style={menuBtnStyle}
                onClick={() => {
                  setMenuOpen(false);
                  setPublishConfirmOpen(true);
                }}
              >
                Publish…
              </button>
              <button
                style={menuBtnStyle}
                onClick={handleViewVersions}
                data-testid="view-versions-btn"
              >
                View changes since publish
              </button>
              <button
                style={menuBtnStyle}
                onClick={() => {
                  setMenuOpen(false);
                  revert();
                }}
                disabled={typeof definition.publishedVersion !== 'number'}
              >
                Revert to published
              </button>
              <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
              <button
                style={menuBtnStyle}
                onClick={() => {
                  setMenuOpen(false);
                  toggleShowTags();
                }}
                data-testid="toggle-tags-row"
              >
                {showTags ? 'Hide tags' : 'Show tags'}
              </button>
              <button
                style={menuBtnStyle}
                onClick={() => {
                  setMenuOpen(false);
                  navigate(`/pipelines/${pipelineId}/runs`);
                }}
              >
                View run history
              </button>
              <button
                style={{ ...menuBtnStyle, color: '#dc2626' }}
                onClick={() => {
                  setMenuOpen(false);
                  setClearRunsConfirmOpen(true);
                }}
              >
                Clear run history
              </button>
              {import.meta.env.DEV ? (
                <>
                  <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                  <button
                    style={menuBtnStyle}
                    data-testid="sim-panel-open"
                    title="Dev-only event simulator"
                    onClick={() => {
                      setMenuOpen(false);
                      setSimPanelOpen(true);
                    }}
                  >
                    🧪 Event simulator…
                  </button>
                </>
              ) : null}
              <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
              <button
                style={{ ...menuBtnStyle, color: '#dc2626' }}
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Source-diagnostic banner ─────────────────────────────────
          Shows only when VITE_PIPELINE_SOURCE=websocket AND no events
          have flowed for 10s after mount. Self-renders null otherwise so
          this slot is invisible on the default mock path. */}
      <SourceDiagnosticBanner />

      {/* ── Tags row (compact metadata strip) — hidden by default ── */}
      {showTags ? (
        <div
          data-testid="tags-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderBottom: '1px solid #e2e8f0',
            background: '#fafbfc',
            minHeight: 34,
            flexShrink: 0,
            position: 'sticky',
            top: 44,
            zIndex: 4,
          }}
        >
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>TAGS</span>
          <TagEditor
            value={definition.tags ?? []}
            onChange={setTags}
            placeholder="add tag…"
          />
        </div>
      ) : null}

      {/* ── Workspace (palette + canvas + config panel) ──────────── */}
      <div style={workspaceStyle}>
        <NodePalette disabledTypes={disabledTypes} />
        <div style={canvasAreaStyle}>
          <PipelineCanvas onFilterLog={setLogFilterNodeId} />
        </div>
        {selectedNodeId !== null ? <ConfigPanel /> : null}
      </div>

      {/* ── Execution log (bottom strip) ─────────────────────────── */}
      <ExecutionLog
        filterByNodeId={logFilterNodeId}
        filterNodeLabel={
          logFilterNodeId
            ? lookupStepName(definition, logFilterNodeId)
            : null
        }
        onClearFilter={clearLogFilter}
      />

      {/* ── Publish confirm modal ────────────────────────────────── */}
      <Modal
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        title="Publish pipeline?"
        maxWidth={420}
        footer={
          <>
            <button
              onClick={() => setPublishConfirmOpen(false)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: 'none',
                border: 'none',
                color: colors.textSecondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handlePublishConfirm}
              disabled={hasErrors}
              style={{
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: hasErrors ? colors.textDisabled : colors.primary,
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                cursor: hasErrors ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Publish
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          Publishing will make <strong>"{definition.name}"</strong> available
          for runs and set the published version to
          <strong> v{definition.version + 1}</strong>.
          {hasErrors ? (
            <>
              <br />
              <br />
              <span style={{ color: '#dc2626' }}>
                Pipeline has {validation?.errors.length ?? 0} validation error
                {validation?.errors.length === 1 ? '' : 's'}. Fix them before
                publishing.
              </span>
            </>
          ) : null}
        </p>
      </Modal>

      {/* ── Delete confirm modal ─────────────────────────────────── */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete pipeline?"
        maxWidth={400}
        footer={
          <>
            <button
              onClick={() => setDeleteConfirmOpen(false)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: 'none',
                border: 'none',
                color: colors.textSecondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              style={{
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          <strong>"{definition.name}"</strong> will be permanently removed. Run
          history for this pipeline will also be lost.
        </p>
      </Modal>

      {/* ── Clear run history confirm modal ──────────────────────── */}
      <Modal
        open={clearRunsConfirmOpen}
        onClose={() => setClearRunsConfirmOpen(false)}
        title="Clear run history?"
        maxWidth={400}
        footer={
          <>
            <button
              onClick={() => setClearRunsConfirmOpen(false)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: 'none',
                border: 'none',
                color: colors.textSecondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleClearRunsConfirm}
              style={{
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Clear history
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          All stored run history for <strong>"{definition.name}"</strong> will
          be permanently removed. This cannot be undone.
        </p>
      </Modal>

      {/* ── Version diff modal ───────────────────────────────────── */}
      <VersionDiffModal
        open={versionDiffOpen}
        onClose={() => setVersionDiffOpen(false)}
        currentDef={definition}
        publishedDef={publishedSnapshotDef}
        onJumpToNode={setSelectedNodeId}
      />

      {/* ── Dev-only simulator panel (Vite dev builds only) ──────── */}
      <SimulatorPanel
        open={simPanelOpen}
        onClose={() => setSimPanelOpen(false)}
      />
    </div>
  );
}

