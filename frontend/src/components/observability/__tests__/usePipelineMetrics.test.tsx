// frontend/src/components/observability/__tests__/usePipelineMetrics.test.tsx
//
// Unit coverage for usePipelineMetrics: initial fetch, 10s polling, visibility
// pause/resume, error resilience, and refresh().
//
// Framework: Vitest + @testing-library/react. Uses fake timers to drive the
// poll interval deterministically.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  IdentityProvider,
  type IdentityContextValue,
} from '../../../contexts/IdentityContext';
import {
  usePipelineMetrics,
  type PipelineMetrics,
} from '../hooks/usePipelineMetrics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function identityValue(): IdentityContextValue {
  return {
    userId: 'user-1',
    displayName: 'Test User',
    userEmail: 'test@example.com',
    idToken: 'jwt-test-token',
    onSignOut: () => {},
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <IdentityProvider value={identityValue()}>{children}</IdentityProvider>;
}

function makeMetrics(overrides: Partial<PipelineMetrics> = {}): PipelineMetrics {
  return {
    runsStarted: 10,
    runsCompleted: 8,
    runsFailed: 1,
    runsActive: 1,
    runsAwaitingApproval: 0,
    avgDurationMs: 1200,
    llmTokensIn: 100,
    llmTokensOut: 50,
    estimatedCostUsd: 0.01,
    avgFirstTokenLatencyMs: 234,
    asOf: '2026-04-23T00:00:00.000Z',
    source: 'stub',
    ...overrides,
  };
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

// Flushes microtasks so awaited promises inside the effect settle before we
// inspect state. Must be wrapped in act() to avoid React warnings.
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.spyOn(global, 'fetch');
  // Reset visibility to "visible" between tests.
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePipelineMetrics', () => {
  test('fetches metrics on mount and populates state', async () => {
    const snapshot = makeMetrics({ runsStarted: 42 });
    fetchSpy.mockResolvedValue(okResponse(snapshot));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });

    // Initial render: no metrics yet.
    expect(result.current.metrics).toBeNull();
    expect(result.current.loading).toBe(true);

    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/pipelines/metrics');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-test-token',
    );

    expect(result.current.metrics).toEqual(snapshot);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  test('polls every 10 seconds while the tab is visible', async () => {
    fetchSpy.mockResolvedValue(okResponse(makeMetrics()));

    renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });

    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test('pauses polling when document becomes hidden; resumes + refetches on visible', async () => {
    fetchSpy.mockResolvedValue(okResponse(makeMetrics()));

    renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Hide the tab and dispatch the event.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advancing time should NOT trigger any additional fetches.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Now become visible again — immediate refetch, then polling resumes.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flushMicrotasks();
    // Immediate refetch on visible.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Polling continues.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test('on error: keeps last-good metrics, surfaces error string', async () => {
    const good = makeMetrics({ runsStarted: 100 });
    fetchSpy.mockResolvedValueOnce(okResponse(good));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();
    expect(result.current.metrics).toEqual(good);

    // Next poll fails.
    fetchSpy.mockResolvedValueOnce(errResponse(503));

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();

    // Last-good metrics preserved.
    expect(result.current.metrics).toEqual(good);
    expect(result.current.error).toMatch(/HTTP 503/);
  });

  test('network error also preserves last-good snapshot', async () => {
    const good = makeMetrics({ runsStarted: 7 });
    fetchSpy.mockResolvedValueOnce(okResponse(good));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();
    expect(result.current.metrics).toEqual(good);

    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushMicrotasks();

    expect(result.current.metrics).toEqual(good);
    expect(result.current.error).toBe('ECONNREFUSED');
  });

  test('preserves null numeric fields from a bridge-sourced response (no ?? 0 coercion)', async () => {
    // Wave-2 bridge response: only runsAwaitingApproval is a number, rest are
    // explicit null. The hook MUST surface the nulls so the dashboard can
    // render "—" instead of zeros.
    fetchSpy.mockResolvedValue(
      okResponse({
        source: 'bridge',
        runsStarted: null,
        runsCompleted: null,
        runsFailed: null,
        runsActive: null,
        runsAwaitingApproval: 7,
        avgDurationMs: null,
        llmTokensIn: null,
        llmTokensOut: null,
        estimatedCostUsd: null,
        avgFirstTokenLatencyMs: null,
        asOf: '2026-04-27T00:00:00.000Z',
      }),
    );

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.metrics).not.toBeNull();
    expect(result.current.metrics!.runsStarted).toBeNull();
    expect(result.current.metrics!.runsActive).toBeNull();
    expect(result.current.metrics!.runsFailed).toBeNull();
    expect(result.current.metrics!.runsAwaitingApproval).toBe(7);
    expect(result.current.metrics!.avgFirstTokenLatencyMs).toBeNull();
    expect(result.current.metrics!.source).toBe('bridge');
    expect(result.current.source).toBe('bridge');
  });

  test('round-trips avgFirstTokenLatencyMs from a bridge-sourced response (distributed-core v0.3.7+)', async () => {
    // distributed-core v0.3.7 added `avgFirstTokenLatencyMs` to
    // PipelineModule.getMetrics(). The hook should pass it through verbatim
    // so the KPI card can render `formatMs(value)`.
    fetchSpy.mockResolvedValue(
      okResponse({
        source: 'bridge',
        runsStarted: 1,
        runsCompleted: 1,
        runsFailed: 0,
        runsActive: 0,
        runsAwaitingApproval: 0,
        avgDurationMs: 1200,
        llmTokensIn: null,
        llmTokensOut: null,
        estimatedCostUsd: null,
        avgFirstTokenLatencyMs: 234,
        asOf: '2026-04-28T00:00:00.000Z',
      }),
    );

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.metrics?.avgFirstTokenLatencyMs).toBe(234);
  });

  test('defaults avgFirstTokenLatencyMs to null when the bridge omits it (pre-v0.3.7 back-compat)', async () => {
    // Older distributed-core builds don't include the field at all. The
    // normalizer must collapse `undefined` → `null` so the KPI card renders
    // an em-dash, not "0 ms".
    fetchSpy.mockResolvedValue(
      okResponse({
        source: 'bridge',
        runsStarted: 1,
        runsCompleted: 1,
        runsFailed: 0,
        runsActive: 0,
        runsAwaitingApproval: 0,
        avgDurationMs: 1200,
        llmTokensIn: null,
        llmTokensOut: null,
        estimatedCostUsd: null,
        // avgFirstTokenLatencyMs intentionally absent
        asOf: '2026-04-28T00:00:00.000Z',
      }),
    );

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.metrics?.avgFirstTokenLatencyMs).toBeNull();
  });

  test('exposes source discriminator for stub-tagged responses', async () => {
    fetchSpy.mockResolvedValue(okResponse(makeMetrics({ source: 'stub' })));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.source).toBe('stub');
    expect(result.current.metrics?.source).toBe('stub');
  });

  test('defaults source to "stub" when backend omits the discriminator (back-compat)', async () => {
    // Legacy response shape — pre-Wave-2 backend never sent `source`.
    const legacy = {
      runsStarted: 1,
      runsCompleted: 1,
      runsFailed: 0,
      runsActive: 0,
      runsAwaitingApproval: 0,
      avgDurationMs: 100,
      llmTokensIn: 10,
      llmTokensOut: 5,
      estimatedCostUsd: 0.001,
      asOf: '2026-04-27T00:00:00.000Z',
    };
    fetchSpy.mockResolvedValue(okResponse(legacy));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();

    expect(result.current.source).toBe('stub');
    expect(result.current.metrics?.runsStarted).toBe(1);
  });

  test('on consecutive failures: applies exponential backoff (1s, 2s, 4s, 8s, 16s, capped at 30s)', async () => {
    // Every fetch fails — simulate the API being down at page-load time.
    fetchSpy.mockResolvedValue(errResponse(500));

    renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });

    // Immediate fetch on mount — counts as failure #1.
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // After failure #1: next attempt scheduled at 1s.
    // Half a second is not enough.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // …but the full 1s triggers retry #2.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // After failure #2: next attempt scheduled at 2s.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // After failure #3: next at 4s.
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // After failure #4: next at 8s.
    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    // After failure #5: next at 16s.
    await act(async () => {
      vi.advanceTimersByTime(16_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(6);

    // After failure #6: next would be 32s, but the cap clamps it to 30s.
    await act(async () => {
      vi.advanceTimersByTime(29_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(7);
  });

  test('on first success after failures: resets to base poll interval', async () => {
    // Mount with API down → two consecutive failures.
    fetchSpy.mockResolvedValueOnce(errResponse(500));
    fetchSpy.mockResolvedValueOnce(errResponse(500));

    renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });

    // Immediate fetch on mount = failure #1.
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 1s later = failure #2.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Now the API recovers — next attempt at 2s succeeds.
    fetchSpy.mockResolvedValueOnce(okResponse(makeMetrics()));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Subsequent poll uses the regular 10s interval, not the backoff curve.
    fetchSpy.mockResolvedValue(okResponse(makeMetrics()));
    await act(async () => {
      vi.advanceTimersByTime(9_999);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  test('refresh() triggers an immediate refetch independent of poll schedule', async () => {
    fetchSpy.mockResolvedValue(okResponse(makeMetrics()));

    const { result } = renderHook(() => usePipelineMetrics(), { wrapper: Wrapper });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance only 2 seconds — the normal poll would not have fired yet.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });
});
