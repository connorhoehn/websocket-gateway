// frontend/src/components/pipelines/context/PipelineRunsContext.tsx
//
// Per-pipeline active + recent runs. Subscribes to `EventStreamContext`
// via the wildcard channel and folds every event into a `runs` map. In
// Phase 1 the source is a `MockExecutor` created on `triggerRun`; Phase
// 4+ the same events arrive from the gateway WS bridge and the folding
// logic here is unchanged. See PIPELINES_PLAN.md §13.1 / §14.4.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ApprovalRecord,
  PipelineEventMap,
  PipelineRun,
  StepExecution,
} from '../../../types/pipeline';
import {
  useEventStream,
  useEventStreamContext,
  type WildcardEvent,
} from './EventStreamContext';
import { MockExecutor } from '../mock/MockExecutor';
import { loadPipeline } from '../persistence/pipelineStorage';
import { appendRun, listRuns } from '../persistence/runHistory';
import { PipelineEditorContext } from './PipelineEditorContext';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RUNS_PER_PIPELINE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineRunsValue {
  runs: Record<string, PipelineRun>;
  activeRunIds: string[];
  triggerRun: (
    pipelineId: string,
    payload?: Record<string, unknown>,
  ) => Promise<string>;
  cancelRun: (runId: string) => void;
  resolveApproval: (
    runId: string,
    stepId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ) => void;
  /**
   * Retry the most recent failed run from a specific step (per §18.4.4 / §17.6).
   * Finds the newest run that contained `nodeId` AND ended in `failed` AND had
   * `nodeId` itself fail; spawns a new run with the failed run's context plus
   * the `_resumeFromStep` marker that MockExecutor uses to seed traversal at
   * `nodeId` and emit `pipeline.step.skipped` for the upstream nodes. No-op +
   * console.warn when no eligible run is found.
   */
  retryFromStep: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PipelineRunsContext = createContext<PipelineRunsValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers — immutable updates against the runs map
// ---------------------------------------------------------------------------

function ensureStep(run: PipelineRun, stepId: string): StepExecution {
  return (
    run.steps[stepId] ?? {
      nodeId: stepId,
      status: 'pending',
    }
  );
}

function withStep(
  run: PipelineRun,
  stepId: string,
  patch: Partial<StepExecution> | ((prev: StepExecution) => StepExecution),
): PipelineRun {
  const prev = ensureStep(run, stepId);
  const next =
    typeof patch === 'function'
      ? (patch as (p: StepExecution) => StepExecution)(prev)
      : { ...prev, ...patch };
  return { ...run, steps: { ...run.steps, [stepId]: next } };
}

function trimRuns(runs: Record<string, PipelineRun>): Record<string, PipelineRun> {
  const entries = Object.values(runs);
  if (entries.length <= MAX_RUNS_PER_PIPELINE) return runs;
  // Keep active runs and the newest completed runs. Oldest completed go first.
  const active = entries.filter((r) =>
    r.status === 'running' ||
    r.status === 'pending' ||
    r.status === 'awaiting_approval',
  );
  const finished = entries
    .filter(
      (r) =>
        r.status !== 'running' &&
        r.status !== 'pending' &&
        r.status !== 'awaiting_approval',
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const keepFinished = finished.slice(
    0,
    Math.max(0, MAX_RUNS_PER_PIPELINE - active.length),
  );
  const keep = [...active, ...keepFinished];
  const next: Record<string, PipelineRun> = {};
  for (const r of keep) next[r.id] = r;
  return next;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface PipelineRunsProviderProps {
  children: React.ReactNode;
}

export function PipelineRunsProvider({ children }: PipelineRunsProviderProps) {
  const eventStream = useEventStreamContext();

  // The editor provider mounts above us in the tree for /pipelines/:id —
  // but this provider is also usable standalone (e.g. observability views
  // that trigger ad-hoc runs). Read the editor context directly so a
  // missing provider is a null (not a throw).
  const editor = useContext(PipelineEditorContext);

  // Seed the in-memory runs map with historical runs for the pipeline in
  // scope so reload doesn't wipe the list view. The seed only runs once on
  // mount to avoid clobbering live state; new runs are folded via events.
  const [runs, setRuns] = useState<Record<string, PipelineRun>>(() => {
    const pipelineId = editor?.definition?.id;
    if (!pipelineId) return {};
    const seeded: Record<string, PipelineRun> = {};
    for (const r of listRuns(pipelineId)) seeded[r.id] = r;
    return seeded;
  });

  const executorsRef = useRef<Map<string, MockExecutor>>(new Map());
  // Track which runs have already been persisted so we don't re-write the
  // same terminal state every time the reducer returns a new reference.
  const persistedRef = useRef<Set<string>>(new Set());

  // Fold every event into the runs state. Using the wildcard channel keeps
  // this a single subscription rather than 15 typed ones.
  useEventStream('*', (env) => {
    const { eventType, payload } = env as WildcardEvent;
    setRuns((prev) => reduceEvent(prev, eventType, payload));
  });

  // Persist terminal runs to localStorage so history survives reload.
  useEffect(() => {
    for (const run of Object.values(runs)) {
      const isTerminal =
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled';
      if (!isTerminal) continue;
      if (persistedRef.current.has(run.id)) continue;
      persistedRef.current.add(run.id);
      try {
        appendRun(run.pipelineId, run);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[PipelineRuns] appendRun failed', err);
      }
    }
  }, [runs]);

  // Drop executor refs for runs that have terminated so we don't leak.
  useEffect(() => {
    for (const [runId, exec] of executorsRef.current) {
      const run = runs[runId];
      if (
        run &&
        (run.status === 'completed' ||
          run.status === 'failed' ||
          run.status === 'cancelled')
      ) {
        executorsRef.current.delete(runId);
        // MockExecutor has no dispose hook; dropping the reference is enough.
        void exec;
      }
    }
  }, [runs]);

  const triggerRun = useCallback(
    async (
      pipelineId: string,
      payload?: Record<string, unknown>,
    ): Promise<string> => {
      // Prefer the in-memory definition from the editor so unsaved edits
      // are reflected in the run; fall back to localStorage otherwise.
      const definition =
        (editor?.definition && editor.definition.id === pipelineId
          ? editor.definition
          : null) ?? loadPipeline(pipelineId);
      if (!definition) {
        throw new Error(`Pipeline ${pipelineId} not found`);
      }

      const executor = new MockExecutor({
        definition,
        triggerPayload: payload,
        onEvent: (type, evtPayload) => {
          eventStream.dispatch(type, evtPayload);
        },
      });
      executorsRef.current.set(executor.runId, executor);
      // Fire-and-forget; the event stream drives all state.
      void executor.run().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[PipelineRuns] executor.run() threw', err);
      });
      return executor.runId;
    },
    [editor, eventStream],
  );

  const cancelRun = useCallback((runId: string): void => {
    const exec = executorsRef.current.get(runId);
    if (exec) {
      exec.cancel();
      return;
    }
    // No local executor — in Phase 4 this forwards to the WS bridge.
    // eslint-disable-next-line no-console
    console.debug('[PipelineRuns] cancelRun — no local executor', runId);
  }, []);

  const resolveApproval = useCallback(
    (
      runId: string,
      stepId: string,
      decision: 'approve' | 'reject',
      comment?: string,
    ): void => {
      const exec = executorsRef.current.get(runId);
      if (exec) {
        // MockExecutor doesn't accept comments in Phase 1; dispatch a
        // `recorded` event tail with the comment so the UI can render it.
        exec.resolveApproval(runId, stepId, 'local-user', decision);
        if (comment) {
          setRuns((prev) => {
            const run = prev[runId];
            if (!run) return prev;
            const step = ensureStep(run, stepId);
            const approvals: ApprovalRecord[] = [
              ...(step.approvals ?? []),
            ];
            const last = approvals[approvals.length - 1];
            if (last && !last.comment) {
              approvals[approvals.length - 1] = { ...last, comment };
            }
            return {
              ...prev,
              [runId]: withStep(run, stepId, { approvals }),
            };
          });
        }
        return;
      }
      // eslint-disable-next-line no-console
      console.debug(
        '[PipelineRuns] resolveApproval — no local executor',
        runId,
        stepId,
        decision,
        comment,
      );
    },
    [],
  );

  // Snapshot the latest runs map for `retryFromStep` so the callback isn't
  // re-created on every fold-induced state change. The runs map is updated
  // by the wildcard subscription above; reading the ref keeps the public
  // callback identity stable across renders.
  const runsRef = useRef<Record<string, PipelineRun>>(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const retryFromStep = useCallback(
    (nodeId: string): void => {
      // Find the most recent run that:
      //   - actually executed `nodeId` (steps[nodeId] exists)
      //   - has step status 'failed' (the node itself failed)
      //   - has run status 'failed' (so we don't double-retry a healthy run)
      // Newest startedAt wins.
      const candidates = Object.values(runsRef.current)
        .filter((r) => r.status === 'failed')
        .filter((r) => r.steps[nodeId]?.status === 'failed')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const lastFailed = candidates[0];
      if (!lastFailed) {
        // eslint-disable-next-line no-console
        console.warn(
          '[PipelineRuns] retryFromStep — no failed run found for node',
          nodeId,
        );
        return;
      }
      const ctx = lastFailed.context ?? {};
      void triggerRun(lastFailed.pipelineId, {
        ...ctx,
        _resumeFromStep: nodeId,
      });
    },
    [triggerRun],
  );

  const activeRunIds = useMemo(
    () =>
      Object.values(runs)
        .filter(
          (r) =>
            r.status === 'running' ||
            r.status === 'pending' ||
            r.status === 'awaiting_approval',
        )
        .map((r) => r.id),
    [runs],
  );

  const value = useMemo<PipelineRunsValue>(
    () => ({
      runs,
      activeRunIds,
      triggerRun,
      cancelRun,
      resolveApproval,
      retryFromStep,
    }),
    [runs, activeRunIds, triggerRun, cancelRun, resolveApproval, retryFromStep],
  );

  return (
    <PipelineRunsContext.Provider value={value}>
      {children}
    </PipelineRunsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Event reducer — pure, so it can be unit-tested in isolation
// ---------------------------------------------------------------------------

function reduceEvent(
  state: Record<string, PipelineRun>,
  type: string,
  payload: unknown,
): Record<string, PipelineRun> {
  if (!payload || typeof payload !== 'object') return state;
  const p = payload as { runId?: string } & Record<string, unknown>;
  const runId = p.runId;
  if (typeof runId !== 'string') return state;

  switch (type) {
    case 'pipeline.run.started': {
      const ev = payload as PipelineEventMap['pipeline.run.started'];
      const run: PipelineRun = {
        id: ev.runId,
        pipelineId: ev.pipelineId,
        pipelineVersion: 0,
        status: 'running',
        triggeredBy: ev.triggeredBy,
        ownerNodeId: 'local',
        startedAt: ev.at,
        currentStepIds: [],
        steps: {},
        context: {},
      };
      return trimRuns({ ...state, [ev.runId]: run });
    }
    case 'pipeline.run.completed': {
      const ev = payload as PipelineEventMap['pipeline.run.completed'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: {
          ...run,
          status: 'completed',
          completedAt: ev.at,
          durationMs: ev.durationMs,
          currentStepIds: [],
        },
      };
    }
    case 'pipeline.run.failed': {
      const ev = payload as PipelineEventMap['pipeline.run.failed'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: {
          ...run,
          status: 'failed',
          completedAt: ev.at,
          error: ev.error,
          currentStepIds: [],
        },
      };
    }
    case 'pipeline.run.cancelled': {
      const ev = payload as PipelineEventMap['pipeline.run.cancelled'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: {
          ...run,
          status: 'cancelled',
          completedAt: ev.at,
          currentStepIds: [],
        },
      };
    }
    case 'pipeline.step.started': {
      const ev = payload as PipelineEventMap['pipeline.step.started'];
      const run = state[ev.runId];
      if (!run) return state;
      const next = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        nodeId: ev.stepId,
        status: 'running',
        startedAt: ev.at,
      }));
      return {
        ...state,
        [ev.runId]: {
          ...next,
          currentStepIds: Array.from(
            new Set([...next.currentStepIds, ev.stepId]),
          ),
        },
      };
    }
    case 'pipeline.step.completed': {
      const ev = payload as PipelineEventMap['pipeline.step.completed'];
      const run = state[ev.runId];
      if (!run) return state;
      const next = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        status: 'completed',
        completedAt: ev.at,
        durationMs: ev.durationMs,
        output: ev.output,
      }));
      return {
        ...state,
        [ev.runId]: {
          ...next,
          currentStepIds: next.currentStepIds.filter((id) => id !== ev.stepId),
        },
      };
    }
    case 'pipeline.step.failed': {
      const ev = payload as PipelineEventMap['pipeline.step.failed'];
      const run = state[ev.runId];
      if (!run) return state;
      const next = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        status: 'failed',
        completedAt: ev.at,
        error: ev.error,
      }));
      return {
        ...state,
        [ev.runId]: {
          ...next,
          currentStepIds: next.currentStepIds.filter((id) => id !== ev.stepId),
        },
      };
    }
    case 'pipeline.step.skipped': {
      const ev = payload as PipelineEventMap['pipeline.step.skipped'];
      const run = state[ev.runId];
      if (!run) return state;
      const next = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        status: 'skipped',
        completedAt: ev.at,
        error: prev.error,
      }));
      return {
        ...state,
        [ev.runId]: {
          ...next,
          currentStepIds: next.currentStepIds.filter((id) => id !== ev.stepId),
        },
      };
    }
    case 'pipeline.step.cancelled': {
      const ev = payload as PipelineEventMap['pipeline.step.cancelled'];
      const run = state[ev.runId];
      if (!run) return state;
      const next = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        // `StepStatus` has no 'cancelled' — track as failed with marker.
        status: 'failed',
        completedAt: ev.at,
        error: prev.error ?? 'cancelled',
      }));
      return {
        ...state,
        [ev.runId]: {
          ...next,
          currentStepIds: next.currentStepIds.filter((id) => id !== ev.stepId),
        },
      };
    }
    case 'pipeline.llm.prompt': {
      const ev = payload as PipelineEventMap['pipeline.llm.prompt'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: withStep(run, ev.stepId, (prev) => ({
          ...prev,
          llm: {
            prompt: ev.prompt,
            response: prev.llm?.response ?? '',
            tokensIn: prev.llm?.tokensIn ?? 0,
            tokensOut: prev.llm?.tokensOut ?? 0,
          },
        })),
      };
    }
    case 'pipeline.llm.token': {
      const ev = payload as PipelineEventMap['pipeline.llm.token'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: withStep(run, ev.stepId, (prev) => ({
          ...prev,
          llm: {
            prompt: prev.llm?.prompt ?? '',
            response: (prev.llm?.response ?? '') + ev.token,
            tokensIn: prev.llm?.tokensIn ?? 0,
            tokensOut: (prev.llm?.tokensOut ?? 0) + 1,
          },
        })),
      };
    }
    case 'pipeline.llm.response': {
      const ev = payload as PipelineEventMap['pipeline.llm.response'];
      const run = state[ev.runId];
      if (!run) return state;
      return {
        ...state,
        [ev.runId]: withStep(run, ev.stepId, (prev) => ({
          ...prev,
          llm: {
            prompt: prev.llm?.prompt ?? '',
            response: ev.response,
            tokensIn: ev.tokensIn,
            tokensOut: ev.tokensOut,
          },
        })),
      };
    }
    case 'pipeline.approval.requested': {
      const ev = payload as PipelineEventMap['pipeline.approval.requested'];
      const run = state[ev.runId];
      if (!run) return state;
      const withStepUpdate = withStep(run, ev.stepId, (prev) => ({
        ...prev,
        status: 'awaiting',
        approvals: prev.approvals ?? [],
      }));
      return {
        ...state,
        [ev.runId]: { ...withStepUpdate, status: 'awaiting_approval' },
      };
    }
    case 'pipeline.approval.recorded': {
      const ev = payload as PipelineEventMap['pipeline.approval.recorded'];
      const run = state[ev.runId];
      if (!run) return state;
      const record: ApprovalRecord = {
        userId: ev.userId,
        decision: ev.decision,
        at: ev.at,
      };
      return {
        ...state,
        [ev.runId]: withStep(run, ev.stepId, (prev) => ({
          ...prev,
          approvals: [...(prev.approvals ?? []), record],
        })),
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePipelineRuns(): PipelineRunsValue {
  const ctx = useContext(PipelineRunsContext);
  if (!ctx) {
    throw new Error(
      'usePipelineRuns must be used within a PipelineRunsProvider',
    );
  }
  return ctx;
}
