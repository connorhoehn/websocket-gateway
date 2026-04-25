// frontend/src/components/pipelines/__tests__/useWebhookTriggers.test.tsx
//
// Coverage for `useWebhookTriggers`:
//   - A `pipeline.webhook.triggered` event whose `webhookPath` matches a
//     published pipeline's triggerBinding fires `triggerRun(pipelineId, …)`.
//   - A non-matching webhookPath is ignored.
//   - Two webhook events with the same path within the dedupe window only
//     fire one run.
//   - Draft pipelines (status !== 'published') are not triggered.
//
// Framework: Vitest + @testing-library/react. Pattern mirrors
// usePendingApprovals.test.tsx — wrap in EventStreamProvider +
// PipelineRunsProvider, dispatch events via `useEventStreamContext`.

import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import { PipelineRunsProvider } from '../context/PipelineRunsContext';
import { useWebhookTriggers } from '../hooks/useWebhookTriggers';
import { savePipeline, publishPipeline } from '../persistence/pipelineStorage';
import type { PipelineDefinition } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Spy on triggerRun via the PipelineRunsContext. The test asserts on whether
// `pipeline.run.started` was emitted (the Mock executor inside
// PipelineRunsProvider emits this synchronously when triggerRun is called).
// We use that as a proxy for "was triggerRun invoked for this pipeline".
// ---------------------------------------------------------------------------

function makeWebhookPipeline(id: string, webhookPath: string): PipelineDefinition {
  return {
    id,
    name: `webhook-${id}`,
    version: 1,
    status: 'draft',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'trigger', triggerType: 'webhook', webhookPath },
      },
    ],
    edges: [],
    triggerBinding: { event: 'webhook', webhookPath },
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
    createdBy: 'user-1',
  } as PipelineDefinition;
}

function persistPublished(def: PipelineDefinition): void {
  savePipeline(def);
  publishPipeline(def.id);
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
  // Avoid unrelated network calls in PipelineRunsProvider initialization.
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => '',
    headers: { get: () => null } as unknown as Headers,
  } as unknown as Response);

  // Clean storage so pipelines from one test don't leak to the next.
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
// Helper — record run-started events emitted by the MockExecutor that
// PipelineRunsProvider spawns when triggerRun is called.
// ---------------------------------------------------------------------------

interface RunStarted {
  pipelineId: string;
  payload: Record<string, unknown>;
}

function useTestHarness() {
  const stream = useEventStreamContext();
  // Mounted hook under test.
  useWebhookTriggers();
  return stream;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWebhookTriggers', () => {
  test('matching webhookPath fires triggerRun for the bound pipeline', async () => {
    persistPublished(makeWebhookPipeline('pipe-A', 'weekly-digest'));

    const runStarted: RunStarted[] = [];

    const { result } = renderHook(() => useTestHarness(), { wrapper });

    // Subscribe to run.started so we can detect when the hook fires a run.
    act(() => {
      result.current.subscribe('pipeline.run.started', (raw) => {
        const e = raw as { pipelineId?: string; triggeredBy?: { payload?: Record<string, unknown> } };
        if (e.pipelineId) {
          runStarted.push({
            pipelineId: e.pipelineId,
            payload: e.triggeredBy?.payload ?? {},
          });
        }
      });
    });

    act(() => {
      result.current.dispatch('pipeline.webhook.triggered', {
        webhookPath: 'weekly-digest',
        body: { x: 1 },
        headers: { 'x-source': 'cron' },
        at: '2026-04-23T00:00:00.000Z',
      });
    });

    await waitFor(() => {
      expect(runStarted.find((r) => r.pipelineId === 'pipe-A')).toBeTruthy();
    });
  });

  test('non-matching webhookPath is ignored', async () => {
    persistPublished(makeWebhookPipeline('pipe-A', 'weekly-digest'));

    const runStarted: RunStarted[] = [];
    const { result } = renderHook(() => useTestHarness(), { wrapper });

    act(() => {
      result.current.subscribe('pipeline.run.started', (raw) => {
        const e = raw as { pipelineId?: string };
        if (e.pipelineId) runStarted.push({ pipelineId: e.pipelineId, payload: {} });
      });
    });

    act(() => {
      result.current.dispatch('pipeline.webhook.triggered', {
        webhookPath: 'something-else',
        body: {},
        headers: {},
        at: '2026-04-23T00:00:01.000Z',
      });
    });

    // Give any async run-spawn a tick to flush — should still be empty.
    await new Promise((r) => setTimeout(r, 30));
    expect(runStarted).toHaveLength(0);
  });

  test('debounces duplicate webhookPath events within the dedupe window', async () => {
    persistPublished(makeWebhookPipeline('pipe-A', 'dup-path'));

    const runStarted: RunStarted[] = [];
    const { result } = renderHook(() => useTestHarness(), { wrapper });

    act(() => {
      result.current.subscribe('pipeline.run.started', (raw) => {
        const e = raw as { pipelineId?: string };
        if (e.pipelineId === 'pipe-A') {
          runStarted.push({ pipelineId: e.pipelineId, payload: {} });
        }
      });
    });

    // Two identical events back-to-back — only the first should fire.
    act(() => {
      result.current.dispatch('pipeline.webhook.triggered', {
        webhookPath: 'dup-path',
        body: {},
        headers: {},
        at: '2026-04-23T00:00:00.000Z',
      });
      result.current.dispatch('pipeline.webhook.triggered', {
        webhookPath: 'dup-path',
        body: {},
        headers: {},
        at: '2026-04-23T00:00:00.100Z',
      });
    });

    // Wait long enough for both potential runs to flush.
    await waitFor(() => {
      expect(runStarted.length).toBeGreaterThanOrEqual(1);
    });
    // The second fire is suppressed by the 500ms dedupe window.
    expect(runStarted.length).toBe(1);
  });

  test('draft (unpublished) pipelines are not triggered', async () => {
    // Save without publishing — status stays 'draft'.
    savePipeline(makeWebhookPipeline('pipe-draft', 'draft-path'));

    const runStarted: RunStarted[] = [];
    const { result } = renderHook(() => useTestHarness(), { wrapper });

    act(() => {
      result.current.subscribe('pipeline.run.started', (raw) => {
        const e = raw as { pipelineId?: string };
        if (e.pipelineId === 'pipe-draft') {
          runStarted.push({ pipelineId: e.pipelineId, payload: {} });
        }
      });
    });

    act(() => {
      result.current.dispatch('pipeline.webhook.triggered', {
        webhookPath: 'draft-path',
        body: {},
        headers: {},
        at: '2026-04-23T00:00:00.000Z',
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(runStarted).toHaveLength(0);
  });
});
