// frontend/src/components/pipelines/__tests__/usePendingApprovals.test.tsx
//
// Coverage for `usePendingApprovalsState` and the legacy `usePendingApprovals`
// array hook. Verifies:
//   - `pipeline.approval.requested` adds an entry.
//   - `pipeline.approval.recorded` (reject) removes the entry.
//   - `pipeline.approval.recorded` (approve) honours `requiredCount` —
//     multi-approver requests stay in the list until threshold is reached.
//   - Initial fetch failure surfaces an error and `retry()` clears it.

import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import { PipelineRunsProvider } from '../context/PipelineRunsContext';
import {
  usePendingApprovals,
  usePendingApprovalsState,
} from '../hooks/usePendingApprovals';
import { savePipeline } from '../persistence/pipelineStorage';
import type { PipelineDefinition } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PIPELINE_ID = 'pipe-approvals-1';

function makeApprovalPipeline(requiredCount = 1): PipelineDefinition {
  return {
    id: PIPELINE_ID,
    name: 'Approvals demo',
    version: 1,
    status: 'draft',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'trigger', triggerType: 'manual' },
      },
      {
        id: 'approval-1',
        type: 'approval',
        position: { x: 200, y: 0 },
        data: {
          type: 'approval',
          approvers: [
            { type: 'user', value: 'sarah@example.com' },
            { type: 'role', value: 'reviewer' },
          ],
          requiredCount,
          message: 'Approve to publish',
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'trigger-1',
        sourceHandle: 'out',
        target: 'approval-1',
        targetHandle: 'in',
      },
    ],
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
    createdBy: 'user-1',
  } as PipelineDefinition;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <EventStreamProvider source="mock">
      <PipelineRunsProvider>{children}</PipelineRunsProvider>
    </EventStreamProvider>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Default: dashboard endpoint returns 404 so the hook falls back to
  // event-driven mode without polluting state.
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => '',
  } as unknown as Response);

  // Clean storage between tests to avoid leaking pipeline definitions.
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
      localStorage.removeItem(k);
    }
  }
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePendingApprovalsState', () => {
  test('adds an entry when pipeline.approval.requested fires', async () => {
    savePipeline(makeApprovalPipeline(1));

    const { result } = renderHook(
      () => ({
        state: usePendingApprovalsState(),
        stream: useEventStreamContext(),
      }),
      { wrapper },
    );

    // Wait for the initial fetch to settle (404 -> isLoading=false).
    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.approvals).toHaveLength(0);

    // Pre-seed a run.started so the PipelineRunsContext knows the runId →
    // pipelineId mapping; that's what enables the hook to hydrate the
    // approval message + requiredCount from the saved pipeline definition.
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'run-1',
        pipelineId: PIPELINE_ID,
        triggeredBy: { triggerType: 'manual', payload: {} },
        at: '2026-04-23T00:59:00.000Z',
      });
      result.current.stream.dispatch('pipeline.approval.requested', {
        runId: 'run-1',
        stepId: 'approval-1',
        approvers: [
          { type: 'user', value: 'sarah@example.com' },
          { type: 'role', value: 'reviewer' },
        ],
        at: '2026-04-23T01:00:00.000Z',
      });
    });

    expect(result.current.state.approvals).toHaveLength(1);
    const row = result.current.state.approvals[0];
    expect(row.runId).toBe('run-1');
    expect(row.stepId).toBe('approval-1');
    expect(row.approvers).toHaveLength(2);
    expect(row.requestedAt).toBe('2026-04-23T01:00:00.000Z');
    // Hydrated from the saved pipeline definition.
    expect(row.message).toBe('Approve to publish');
    expect(row.requiredCount).toBe(1);
  });

  test('removes an entry on pipeline.approval.recorded (reject) immediately', async () => {
    savePipeline(makeApprovalPipeline(2));

    const { result } = renderHook(
      () => ({
        state: usePendingApprovalsState(),
        stream: useEventStreamContext(),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    act(() => {
      result.current.stream.dispatch('pipeline.approval.requested', {
        runId: 'run-2',
        stepId: 'approval-1',
        approvers: [],
        at: '2026-04-23T02:00:00.000Z',
      });
    });
    expect(result.current.state.approvals).toHaveLength(1);

    act(() => {
      result.current.stream.dispatch('pipeline.approval.recorded', {
        runId: 'run-2',
        stepId: 'approval-1',
        userId: 'sarah@example.com',
        decision: 'reject',
        at: '2026-04-23T02:00:05.000Z',
      });
    });
    expect(result.current.state.approvals).toHaveLength(0);
  });

  test('multi-approver: stays in list until requiredCount approvals recorded', async () => {
    savePipeline(makeApprovalPipeline(2));

    const { result } = renderHook(
      () => ({
        state: usePendingApprovalsState(),
        stream: useEventStreamContext(),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'run-3',
        pipelineId: PIPELINE_ID,
        triggeredBy: { triggerType: 'manual', payload: {} },
        at: '2026-04-23T02:59:00.000Z',
      });
      result.current.stream.dispatch('pipeline.approval.requested', {
        runId: 'run-3',
        stepId: 'approval-1',
        approvers: [
          { type: 'user', value: 'sarah@example.com' },
          { type: 'user', value: 'bob@example.com' },
        ],
        at: '2026-04-23T03:00:00.000Z',
      });
    });
    expect(result.current.state.approvals).toHaveLength(1);
    expect(result.current.state.approvals[0].requiredCount).toBe(2);
    expect(result.current.state.approvals[0].recordedCount).toBe(0);

    // First approval — still pending.
    act(() => {
      result.current.stream.dispatch('pipeline.approval.recorded', {
        runId: 'run-3',
        stepId: 'approval-1',
        userId: 'sarah@example.com',
        decision: 'approve',
        at: '2026-04-23T03:00:05.000Z',
      });
    });
    expect(result.current.state.approvals).toHaveLength(1);
    expect(result.current.state.approvals[0].recordedCount).toBe(1);

    // Second approval — drops out.
    act(() => {
      result.current.stream.dispatch('pipeline.approval.recorded', {
        runId: 'run-3',
        stepId: 'approval-1',
        userId: 'bob@example.com',
        decision: 'approve',
        at: '2026-04-23T03:00:10.000Z',
      });
    });
    expect(result.current.state.approvals).toHaveLength(0);
  });

  test('does nothing when recorded fires for an unknown approval', async () => {
    const { result } = renderHook(
      () => ({
        state: usePendingApprovalsState(),
        stream: useEventStreamContext(),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    act(() => {
      result.current.stream.dispatch('pipeline.approval.recorded', {
        runId: 'unknown-run',
        stepId: 'unknown-step',
        userId: 'someone',
        decision: 'approve',
        at: '2026-04-23T04:00:00.000Z',
      });
    });

    expect(result.current.state.approvals).toHaveLength(0);
    expect(result.current.state.error).toBeNull();
  });

  test('hydrates from dashboard endpoint when it returns approvals', async () => {
    savePipeline(makeApprovalPipeline(1));

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pendingApprovals: [
          {
            runId: 'run-from-dashboard',
            pipelineId: PIPELINE_ID,
            stepId: 'approval-1',
            approvers: [{ type: 'user', value: 'sarah@example.com' }],
            requestedAt: '2026-04-23T05:00:00.000Z',
            message: 'Server-side message',
            requiredCount: 1,
            recordedCount: 0,
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response);

    const { result } = renderHook(() => usePendingApprovalsState(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.approvals).toHaveLength(1);
    expect(result.current.approvals[0].runId).toBe('run-from-dashboard');
    expect(result.current.approvals[0].message).toBe('Server-side message');
  });

  test('surfaces an error when the dashboard fetch fails non-404', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'boom',
    } as unknown as Response);

    const { result } = renderHook(() => usePendingApprovalsState(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toMatch(/500/);

    // retry() resets isLoading and triggers a fresh fetch (default 404 mock).
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });
});

describe('usePendingApprovals (legacy array hook)', () => {
  test('returns an array with .length usable as a badge count', async () => {
    const { result } = renderHook(
      () => ({
        approvals: usePendingApprovals(),
        stream: useEventStreamContext(),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Array.isArray(result.current.approvals)).toBe(true);
    });
    expect(result.current.approvals.length).toBe(0);

    act(() => {
      result.current.stream.dispatch('pipeline.approval.requested', {
        runId: 'run-legacy',
        stepId: 'approval-1',
        approvers: [],
        at: '2026-04-23T06:00:00.000Z',
      });
    });

    expect(result.current.approvals.length).toBe(1);
  });
});
