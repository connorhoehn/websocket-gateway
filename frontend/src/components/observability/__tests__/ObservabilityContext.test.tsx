// frontend/src/components/observability/__tests__/ObservabilityContext.test.tsx
//
// Coverage for ObservabilityContext live-data wiring:
//   1. 200 OK → context exposes the fetched dashboard, isLiveData=true.
//   2. 404 / network error → context falls back to the static fixture and
//      logs once. isLiveData=false.
//   3. EventStream `pipeline.run.started` updates `activeRunsCount` and adds
//      to `recentEvents`.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  ObservabilityProvider,
  useObservability,
} from '../context/ObservabilityContext';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../../pipelines/context/EventStreamContext';
import dashboardFixture from '../fixtures/dashboardFixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <EventStreamProvider>
      <ObservabilityProvider>{children}</ObservabilityProvider>
    </EventStreamProvider>
  );
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => '',
  } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.spyOn(global, 'fetch');
  // Silence the deliberate one-shot warning on fallback so test output stays
  // clean — but spy on it so we can assert it ran exactly once.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  fetchSpy.mockRestore();
  warnSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ObservabilityContext', () => {
  test('200 OK → exposes fetched dashboard, isLiveData=true', async () => {
    const live = {
      ...dashboardFixture,
      overview: {
        ...(dashboardFixture as { overview: Record<string, unknown> }).overview,
        totalNodes: 7,
        healthyNodes: 7,
        clusterHealth: 'healthy' as const,
      },
    };
    fetchSpy.mockResolvedValue(okResponse(live));

    const { result } = renderHook(() => useObservability(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/api/observability/dashboard');

    expect(result.current.dashboard?.overview.totalNodes).toBe(7);
    expect(result.current.isLiveData).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  test('404 → falls back to fixture and logs warning once', async () => {
    fetchSpy.mockResolvedValue(errResponse(404));

    const { result } = renderHook(() => useObservability(), { wrapper: Wrapper });
    await flushMicrotasks();

    // Falls back to the static fixture.
    expect(result.current.dashboard).toEqual(dashboardFixture);
    expect(result.current.isLiveData).toBe(false);
    expect(result.current.error).toMatch(/HTTP 404/);
    // Console.warn fired exactly once (the one-shot fallback log).
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Advance past one poll cycle — fixture should remain, warn should NOT
    // fire again because the fallback log is deduped.
    fetchSpy.mockResolvedValue(errResponse(404));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(result.current.dashboard).toEqual(dashboardFixture);
  });

  test('network error (rejected fetch) also falls back to fixture', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const { result } = renderHook(() => useObservability(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.dashboard).toEqual(dashboardFixture);
    expect(result.current.isLiveData).toBe(false);
    expect(result.current.error).toBe('ECONNREFUSED');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('EventStream pipeline.run.started bumps activeRunsCount and recentEvents', async () => {
    fetchSpy.mockResolvedValue(okResponse(dashboardFixture));

    // We need the EventStream dispatcher; render a hook that returns both.
    const { result } = renderHook(
      () => ({ obs: useObservability(), es: useEventStreamContext() }),
      { wrapper: Wrapper },
    );
    await flushMicrotasks();

    expect(result.current.obs.activeRunsCount).toBe(0);
    expect(result.current.obs.recentEvents).toHaveLength(0);

    act(() => {
      result.current.es.dispatch('pipeline.run.started', {
        runId: 'run-A',
        pipelineId: 'p-1',
        triggeredBy: { triggerType: 'manual', userId: 'u-1', payload: {} },
        at: new Date().toISOString(),
      });
    });

    expect(result.current.obs.activeRunsCount).toBe(1);
    expect(result.current.obs.recentEvents).toHaveLength(1);
    expect(result.current.obs.recentEvents[0].type).toBe('pipeline.run.started');

    act(() => {
      result.current.es.dispatch('pipeline.run.completed', {
        runId: 'run-A',
        durationMs: 1500,
        at: new Date().toISOString(),
      });
    });

    expect(result.current.obs.activeRunsCount).toBe(0);
    expect(result.current.obs.recentEvents).toHaveLength(2);
  });

  test('setLive(false) pauses ingestion of new EventStream events', async () => {
    fetchSpy.mockResolvedValue(okResponse(dashboardFixture));

    const { result } = renderHook(
      () => ({ obs: useObservability(), es: useEventStreamContext() }),
      { wrapper: Wrapper },
    );
    await flushMicrotasks();

    act(() => result.current.obs.setLive(false));

    act(() => {
      result.current.es.dispatch('pipeline.run.started', {
        runId: 'run-X',
        pipelineId: 'p-1',
        triggeredBy: { triggerType: 'manual', userId: 'u-1', payload: {} },
        at: new Date().toISOString(),
      });
    });

    // Paused — no new events should land.
    expect(result.current.obs.recentEvents).toHaveLength(0);
    expect(result.current.obs.activeRunsCount).toBe(0);
  });
});
