// frontend/src/components/pipelines/__tests__/usePipelineActivityRelay.test.tsx
//
// Vitest coverage for the pipeline -> activity-bus relay hook. The hook fans
// out run-lifecycle events from EventStreamContext onto the supplied
// `activityPublish` callback so cross-cutting feeds (BigBrotherPanel /
// ActivityFeed / ActivityPanel) see the same entries that the pipeline
// observability surfaces get.
//
// The tests cover three guarantees:
//   1. Run-lifecycle + approval events relay with the documented detail shape.
//   2. Step-level events (and other noise) are filtered out.
//   3. When the EventStreamContext source is 'websocket', the relay is a
//      no-op — Phase 4+ the gateway bridge publishes directly.

import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import { usePipelineActivityRelay } from '../hooks/usePipelineActivityRelay';
import type { ApprovalNodeData } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mount the relay under an EventStreamProvider and expose the context so
 * tests can dispatch events to drive it.
 */
function renderRelay(opts: {
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  source?: 'mock' | 'websocket';
}) {
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <EventStreamProvider source={opts.source ?? 'mock'}>
      {children}
    </EventStreamProvider>
  );
  return renderHook(
    () => {
      usePipelineActivityRelay(opts.activityPublish);
      return useEventStreamContext();
    },
    { wrapper },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePipelineActivityRelay', () => {
  test('relays pipeline.run.started to activityPublish with runId / pipelineId / triggeredBy', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    const triggeredBy = { userId: 'u-1', triggerType: 'manual', payload: {} };
    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r-1',
        pipelineId: 'p-1',
        triggeredBy,
        at: '2026-04-23T00:00:00.000Z',
      });
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('pipeline.run.started', {
      runId: 'r-1',
      pipelineId: 'p-1',
      triggeredBy,
    });
  });

  test('relays pipeline.run.completed with runId + durationMs', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    act(() => {
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r-2',
        durationMs: 1234,
        at: 't',
      });
    });

    expect(publish).toHaveBeenCalledWith('pipeline.run.completed', {
      runId: 'r-2',
      durationMs: 1234,
    });
  });

  test('relays pipeline.run.failed with error.message flattened to detail.error', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    act(() => {
      result.current.dispatch('pipeline.run.failed', {
        runId: 'r-3',
        error: { nodeId: 'n-1', message: 'LLM provider timed out' },
        at: 't',
      });
    });

    expect(publish).toHaveBeenCalledWith('pipeline.run.failed', {
      runId: 'r-3',
      error: 'LLM provider timed out',
    });
  });

  test('relays pipeline.approval.requested with an approver count, not the full list', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    const approvers: ApprovalNodeData['approvers'] = [
      { type: 'user', value: 'u-a' },
      { type: 'user', value: 'u-b' },
      { type: 'role', value: 'editor' },
    ];
    act(() => {
      result.current.dispatch('pipeline.approval.requested', {
        runId: 'r-4',
        stepId: 's-approve',
        approvers,
        at: 't',
      });
    });

    expect(publish).toHaveBeenCalledWith('pipeline.approval.requested', {
      runId: 'r-4',
      stepId: 's-approve',
      approverCount: 3,
    });
  });

  test('does NOT relay step-level events (step.started / step.completed / llm.token)', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    act(() => {
      result.current.dispatch('pipeline.step.started', {
        runId: 'r-5',
        stepId: 's-1',
        nodeType: 'llm',
        at: 't',
      });
      result.current.dispatch('pipeline.step.completed', {
        runId: 'r-5',
        stepId: 's-1',
        durationMs: 10,
        at: 't',
      });
      result.current.dispatch('pipeline.llm.token', {
        runId: 'r-5',
        stepId: 's-1',
        token: 'hi',
        at: 't',
      });
    });

    expect(publish).not.toHaveBeenCalled();
  });

  test("short-circuits when EventStreamContext source === 'websocket' (avoids Phase-4 double-publish)", () => {
    const publish = vi.fn();
    const { result } = renderRelay({
      activityPublish: publish,
      source: 'websocket',
    });

    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r-ws',
        pipelineId: 'p-ws',
        triggeredBy: { userId: 'u', triggerType: 'manual', payload: {} },
        at: 't',
      });
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r-ws',
        durationMs: 5,
        at: 't',
      });
    });

    expect(publish).not.toHaveBeenCalled();
  });

  test('mixed event stream: only the relayed types fire activityPublish, in order', () => {
    const publish = vi.fn();
    const { result } = renderRelay({ activityPublish: publish });

    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r-mix',
        pipelineId: 'p-mix',
        triggeredBy: { userId: 'u', triggerType: 'manual', payload: {} },
        at: 't',
      });
      result.current.dispatch('pipeline.step.started', {
        runId: 'r-mix',
        stepId: 's-a',
        nodeType: 'llm',
        at: 't',
      });
      result.current.dispatch('pipeline.llm.token', {
        runId: 'r-mix',
        stepId: 's-a',
        token: 'x',
        at: 't',
      });
      result.current.dispatch('pipeline.step.completed', {
        runId: 'r-mix',
        stepId: 's-a',
        durationMs: 8,
        at: 't',
      });
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r-mix',
        durationMs: 42,
        at: 't',
      });
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toBe('pipeline.run.started');
    expect(publish.mock.calls[1][0]).toBe('pipeline.run.completed');
  });
});
