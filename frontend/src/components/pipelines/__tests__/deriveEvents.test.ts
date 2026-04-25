// frontend/src/components/pipelines/__tests__/deriveEvents.test.ts
//
// Covers the Phase-1 replay event-timeline derivation — given a persisted
// `PipelineRun`, `deriveEventsFromRun` produces a `PipelineWireEvent[]` with
// the correct ordering, seq monotonicity, and per-step phase emission (step
// → llm.prompt → tokens → llm.response → approval.requested → approval.
// recorded → terminal → run terminal). useReplayDriver's async timer path is
// deliberately not tested here — see module header in `useReplayDriver.ts`.

import { describe, test, expect } from 'vitest';

import { deriveEventsFromRun } from '../replay/deriveEvents';
import type { PipelineRun } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(): PipelineRun {
  return {
    id: 'run-1',
    pipelineId: 'pipe-1',
    pipelineVersion: 1,
    status: 'completed',
    triggeredBy: {
      triggerType: 'manual',
      userId: 'user-1',
      payload: {},
    },
    ownerNodeId: 'node-owner',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:10.000Z',
    durationMs: 10_000,
    currentStepIds: [],
    context: {},
    steps: {
      // Plain action step
      'step-action': {
        nodeId: 'step-action',
        status: 'completed',
        startedAt: '2026-01-01T00:00:01.000Z',
        completedAt: '2026-01-01T00:00:02.000Z',
        durationMs: 1000,
        output: { ok: true },
      },
      // LLM step with a short response → 3 synthesized tokens
      'step-llm': {
        nodeId: 'step-llm',
        status: 'completed',
        startedAt: '2026-01-01T00:00:03.000Z',
        completedAt: '2026-01-01T00:00:06.000Z',
        durationMs: 3000,
        llm: {
          prompt: 'Summarize this.',
          response: 'hello world now',
          tokensIn: 10,
          tokensOut: 3,
        },
      },
      // Approval step with 1 approver record
      'step-approval': {
        nodeId: 'step-approval',
        status: 'completed',
        startedAt: '2026-01-01T00:00:07.000Z',
        completedAt: '2026-01-01T00:00:09.000Z',
        durationMs: 2000,
        approvals: [
          {
            userId: 'user-approver',
            decision: 'approve',
            at: '2026-01-01T00:00:08.500Z',
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveEventsFromRun', () => {
  test('produces the expected ordered event sequence', () => {
    const run = makeRun();
    const events = deriveEventsFromRun(run);

    // Expected timeline (in order):
    //   pipeline.run.started
    //   pipeline.step.started         (step-action)
    //   pipeline.step.completed       (step-action)
    //   pipeline.step.started         (step-llm)
    //   pipeline.llm.prompt           (step-llm)
    //   pipeline.llm.token x 3        (step-llm)
    //   pipeline.llm.response         (step-llm)
    //   pipeline.step.completed       (step-llm)
    //   pipeline.step.started         (step-approval)
    //   pipeline.approval.requested   (step-approval)
    //   pipeline.approval.recorded x1 (step-approval)
    //   pipeline.step.completed       (step-approval)
    //   pipeline.run.completed
    //
    // → 15 events.
    expect(events).toHaveLength(15);

    const types = events.map((e) => e.eventType);
    expect(types).toEqual([
      'pipeline.run.started',
      'pipeline.step.started',
      'pipeline.step.completed',
      'pipeline.step.started',
      'pipeline.llm.prompt',
      'pipeline.llm.token',
      'pipeline.llm.token',
      'pipeline.llm.token',
      'pipeline.llm.response',
      'pipeline.step.completed',
      'pipeline.step.started',
      'pipeline.approval.requested',
      'pipeline.approval.recorded',
      'pipeline.step.completed',
      'pipeline.run.completed',
    ]);
  });

  test('assigns monotonically increasing seq numbers from 0', () => {
    const events = deriveEventsFromRun(makeRun());
    events.forEach((e, i) => {
      expect(e.seq).toBe(i);
    });
  });

  test('stamps every envelope with sourceNodeId "replay"', () => {
    const events = deriveEventsFromRun(makeRun());
    for (const e of events) {
      expect(e.sourceNodeId).toBe('replay');
    }
  });

  test('emittedAt values are non-decreasing', () => {
    const events = deriveEventsFromRun(makeRun());
    for (let i = 1; i < events.length; i++) {
      expect(events[i].emittedAt).toBeGreaterThanOrEqual(events[i - 1].emittedAt);
    }
  });

  test('emits run.started with the original runId, pipelineId, and trigger', () => {
    const run = makeRun();
    const events = deriveEventsFromRun(run);
    const first = events[0];
    expect(first.eventType).toBe('pipeline.run.started');
    const payload = first.payload as {
      runId: string;
      pipelineId: string;
      triggeredBy: { triggerType: string };
    };
    expect(payload.runId).toBe('run-1');
    expect(payload.pipelineId).toBe('pipe-1');
    expect(payload.triggeredBy.triggerType).toBe('manual');
  });

  test('synthesizes one token per whitespace-delimited chunk of the response', () => {
    const events = deriveEventsFromRun(makeRun());
    const tokens = events.filter((e) => e.eventType === 'pipeline.llm.token');
    // 'hello world now' → 3 tokens
    expect(tokens).toHaveLength(3);
    const values = tokens.map((e) => (e.payload as { token: string }).token.trim());
    expect(values).toEqual(['hello', 'world', 'now']);
  });

  test('records approval events with userId + decision from the ApprovalRecord', () => {
    const events = deriveEventsFromRun(makeRun());
    const recorded = events.find((e) => e.eventType === 'pipeline.approval.recorded');
    expect(recorded).toBeDefined();
    const payload = recorded!.payload as { userId: string; decision: string };
    expect(payload.userId).toBe('user-approver');
    expect(payload.decision).toBe('approve');
  });

  test('emits pipeline.run.failed when the run ended in failure', () => {
    const run = makeRun();
    run.status = 'failed';
    run.error = { nodeId: 'step-action', message: 'boom' };
    const events = deriveEventsFromRun(run);
    const last = events[events.length - 1];
    expect(last.eventType).toBe('pipeline.run.failed');
  });

  test('returns just the run.started event when the steps map is empty', () => {
    const run = makeRun();
    run.steps = {};
    const events = deriveEventsFromRun(run);
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('pipeline.run.started');
    expect(events[1].eventType).toBe('pipeline.run.completed');
  });
});
