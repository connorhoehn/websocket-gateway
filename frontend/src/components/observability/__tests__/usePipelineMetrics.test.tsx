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
    asOf: '2026-04-23T00:00:00.000Z',
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
