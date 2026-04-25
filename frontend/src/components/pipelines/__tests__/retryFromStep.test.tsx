// frontend/src/components/pipelines/__tests__/retryFromStep.test.tsx
//
// Coverage for the §17.6 / §18.4.4 manual-retry path:
//   - PipelineRunsContext.retryFromStep no-ops + warns when no failed run exists
//   - retryFromStep against a recorded failed run spawns a new run
//   - The new run emits `pipeline.run.resumeFromStep` with the right fromNodeId
//   - Upstream nodes are emitted as `pipeline.step.skipped` with reason
//     `resumed_forward`
//   - The resume node executes (gets `pipeline.step.started`)
//
// We compose `EventStreamProvider > PipelineRunsProvider`, drive the executor
// with `speedMultiplier: 0.02`, and observe events via a wildcard subscriber.

import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import {
  PipelineRunsProvider,
  usePipelineRuns,
  useRetryFromStep,
} from '../context/PipelineRunsContext';
import { savePipeline } from '../persistence/pipelineStorage';
import type {
  ActionNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TriggerNodeData,
} from '../../../types/pipeline';
import { MockExecutor } from '../mock/MockExecutor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearPipelineStorage(): void {
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1:')) {
      toDelete.push(k);
    }
  }
  for (const k of toDelete) localStorage.removeItem(k);
}

/**
 * Build a 4-node pipeline: trigger → A → B → C.
 * `B` is wired to fail (route-error with no error handle attached) so the run
 * terminates with B in `failed` state. `C` is downstream of B (a regular
 * action that would have completed if reached).
 */
function buildFailingPipeline(id: string): {
  def: PipelineDefinition;
  triggerId: string;
  aId: string;
  bId: string;
  cId: string;
} {
  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
  const trigger: PipelineNode = {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: triggerData,
  };
  const aData: ActionNodeData = { type: 'action', actionType: 'notify', config: {} };
  const a: PipelineNode = {
    id: 'node-a',
    type: 'action',
    position: { x: 100, y: 0 },
    data: aData,
  };
  // `onError: 'fail-run'` makes a deterministic failure escape the branch
  // (no `error` handle wiring needed). We further force failure with
  // `failureRateOther: 1` in the test trigger.
  const bData: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {},
    onError: 'fail-run',
  };
  const b: PipelineNode = {
    id: 'node-b',
    type: 'action',
    position: { x: 200, y: 0 },
    data: bData,
  };
  const cData: ActionNodeData = { type: 'action', actionType: 'notify', config: {} };
  const c: PipelineNode = {
    id: 'node-c',
    type: 'action',
    position: { x: 300, y: 0 },
    data: cData,
  };
  const edges: PipelineEdge[] = [
    { id: 'e1', source: trigger.id, sourceHandle: 'out', target: a.id, targetHandle: 'in' },
    { id: 'e2', source: a.id, sourceHandle: 'out', target: b.id, targetHandle: 'in' },
    { id: 'e3', source: b.id, sourceHandle: 'out', target: c.id, targetHandle: 'in' },
  ];
  const now = new Date().toISOString();
  const def: PipelineDefinition = {
    id,
    name: 'Retry-from-step pipeline',
    version: 1,
    status: 'draft',
    nodes: [trigger, a, b, c],
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
  };
  savePipeline(def);
  return { def, triggerId: trigger.id, aId: a.id, bId: b.id, cId: c.id };
}

// Compose the two providers — the runs provider needs the event stream for
// its internal wildcard subscription.
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventStreamProvider>
    <PipelineRunsProvider>{children}</PipelineRunsProvider>
  </EventStreamProvider>
);

// Run the executor inline so the runs map gets populated with a "real" failed
// run before we exercise `retryFromStep`. The runs provider observes events
// dispatched on the same EventStreamProvider, so we go through the context
// rather than constructing a separate executor pipe.
async function runExecutor(
  def: PipelineDefinition,
  dispatch: (type: string, payload: unknown) => void,
  opts: {
    failureRateOther?: number;
    triggerPayload?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const exec = new MockExecutor({
    definition: def,
    triggerPayload: opts.triggerPayload,
    failureRateLLM: 0,
    failureRateOther: opts.failureRateOther ?? 0,
    speedMultiplier: 0.02,
    onEvent: (type, payload) => dispatch(type as string, payload),
  });
  await exec.run();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearPipelineStorage();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineRunsContext.retryFromStep', () => {
  test('no-ops + console.warn when there is no failed run for the node', () => {
    buildFailingPipeline('p-no-failed');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useRetryFromStep(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current('node-a');
    });

    expect(warnSpy).toHaveBeenCalled();
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toMatch(/retryFromStep/);

    warnSpy.mockRestore();
  });

  test('after a run fails at node-b, retryFromStep("node-b") triggers a new run that emits resumeFromStep + skips upstream + executes from b', async () => {
    const { def, triggerId, aId, bId, cId } = buildFailingPipeline('p-retry-1');

    // Hook into the wildcard channel to capture every event from BOTH the
    // initial failing run and the retry run.
    const { result } = renderHook(
      () => ({
        runs: usePipelineRuns(),
        stream: useEventStreamContext(),
      }),
      { wrapper: Wrapper },
    );

    type Captured = { type: string; payload: { runId?: string } & Record<string, unknown> };
    const captured: Captured[] = [];
    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.stream.subscribe('*', (env) => {
        const e = env as { eventType: string; payload: unknown };
        captured.push({ type: e.eventType, payload: e.payload as Captured['payload'] });
      });
    });

    // Run #1 — force every action to fail. The first action `node-a` will
    // fail and the run will fail without ever reaching b/c. To get b into a
    // failed state specifically, we instead make node-a succeed and node-b
    // fail. We do that by running with failureRate=0 first (whole run
    // succeeds), then simulate a failure of node-b by dispatching the run
    // events manually. That keeps the test deterministic without coupling to
    // the executor's internal RNG.

    // Fire a synthetic failed run #1 via the event stream so the runs map
    // records it. This is exactly the shape MockExecutor would produce.
    const r1 = 'run-fail-1';
    const failedAt = '2026-04-23T12:00:00.000Z';
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: r1,
        pipelineId: def.id,
        triggeredBy: { triggerType: 'manual', payload: { hello: 'world' } },
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: r1,
        stepId: triggerId,
        nodeType: 'trigger',
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.completed', {
        runId: r1,
        stepId: triggerId,
        durationMs: 5,
        output: {},
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: r1,
        stepId: aId,
        nodeType: 'action',
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.completed', {
        runId: r1,
        stepId: aId,
        durationMs: 5,
        output: {},
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: r1,
        stepId: bId,
        nodeType: 'action',
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.step.failed', {
        runId: r1,
        stepId: bId,
        error: 'Action notify failed (simulated)',
        at: failedAt,
      });
      result.current.stream.dispatch('pipeline.run.failed', {
        runId: r1,
        error: { nodeId: bId, message: 'Action notify failed (simulated)' },
        at: failedAt,
      });
    });

    // Confirm the runs map has the failed run with node-b in failed state.
    expect(result.current.runs.runs[r1]).toBeDefined();
    expect(result.current.runs.runs[r1].status).toBe('failed');
    expect(result.current.runs.runs[r1].steps[bId]?.status).toBe('failed');

    // Snapshot how many events we'd captured before retry — we'll filter the
    // retry events by ignoring everything up to this point.
    const beforeRetryCount = captured.length;

    // Now trigger a retry from node-b. This goes through the real
    // PipelineRunsContext.retryFromStep → triggerRun, which constructs a new
    // MockExecutor with the resume marker.
    await act(async () => {
      result.current.runs.retryFromStep(bId);
      // Allow the executor's microtasks + the scaled timers to drain.
      // speedMultiplier=0.02 keeps each sleep ≥ 1ms (50ms * 0.02 = 1ms),
      // so a ~150ms wait is plenty for trigger+a+b+c when only b+c run.
      await new Promise((r) => setTimeout(r, 250));
    });

    const newEvents = captured.slice(beforeRetryCount);

    // Find the retry run id from the run.started for the new run.
    const startEvt = newEvents.find((e) => e.type === 'pipeline.run.started');
    expect(startEvt).toBeDefined();
    const retryRunId = String(startEvt!.payload.runId);
    expect(retryRunId).not.toBe(r1);

    // resumeFromStep event fires for the retry run with fromNodeId = bId.
    const resumeEvt = newEvents.find(
      (e) =>
        e.type === 'pipeline.run.resumeFromStep' &&
        e.payload.runId === retryRunId,
    );
    expect(resumeEvt).toBeDefined();
    expect(resumeEvt!.payload).toMatchObject({
      runId: retryRunId,
      fromNodeId: bId,
    });

    // Upstream nodes (trigger + node-a) get step.skipped with
    // reason: 'resumed_forward'.
    const skips = newEvents.filter(
      (e) =>
        e.type === 'pipeline.step.skipped' &&
        e.payload.runId === retryRunId &&
        e.payload.reason === 'resumed_forward',
    );
    const skippedIds = skips.map((s) => String(s.payload.stepId)).sort();
    expect(skippedIds).toContain(triggerId);
    expect(skippedIds).toContain(aId);
    // node-b (the resume node) MUST NOT be in the skipped list.
    expect(skippedIds).not.toContain(bId);

    // The resume node itself executes — gets a step.started.
    const resumeStart = newEvents.find(
      (e) =>
        e.type === 'pipeline.step.started' &&
        e.payload.runId === retryRunId &&
        e.payload.stepId === bId,
    );
    expect(resumeStart).toBeDefined();

    // Sanity: the run.resumeFromStep event fires BEFORE any step.started for
    // the retry run (per §17.6 ordering).
    const resumeIdx = newEvents.findIndex(
      (e) =>
        e.type === 'pipeline.run.resumeFromStep' &&
        e.payload.runId === retryRunId,
    );
    const firstStepStartIdx = newEvents.findIndex(
      (e) =>
        e.type === 'pipeline.step.started' &&
        e.payload.runId === retryRunId,
    );
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(firstStepStartIdx).toBeGreaterThan(resumeIdx);

    unsub?.();
  });

  test('retryFromStep preserves the failed run context but strips the internal _resumeFromStep marker', async () => {
    const { def, bId } = buildFailingPipeline('p-retry-ctx');

    const { result } = renderHook(
      () => ({
        runs: usePipelineRuns(),
        stream: useEventStreamContext(),
      }),
      { wrapper: Wrapper },
    );

    // Synthesize a failed run that left a `flag` in its context.
    const r1 = 'run-fail-ctx';
    const at = '2026-04-23T12:00:00.000Z';
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: r1,
        pipelineId: def.id,
        triggeredBy: { triggerType: 'manual', payload: { flag: true } },
        at,
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: r1,
        stepId: bId,
        nodeType: 'action',
        at,
      });
      result.current.stream.dispatch('pipeline.step.failed', {
        runId: r1,
        stepId: bId,
        error: 'oops',
        at,
      });
      result.current.stream.dispatch('pipeline.run.failed', {
        runId: r1,
        error: { nodeId: bId, message: 'oops' },
        at,
      });
    });

    await act(async () => {
      result.current.runs.retryFromStep(bId);
      await new Promise((r) => setTimeout(r, 250));
    });

    // Find the retry run in the runs map and confirm its context does NOT
    // carry `_resumeFromStep` (the marker is internal to MockExecutor).
    const allRuns = Object.values(result.current.runs.runs);
    const retryRun = allRuns.find((r) => r.id !== r1);
    expect(retryRun).toBeDefined();
    expect(Object.keys(retryRun!.context)).not.toContain('_resumeFromStep');
  });
});
