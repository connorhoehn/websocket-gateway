// frontend/src/components/observability/hooks/usePipelineMetrics.ts
//
// Polls GET /api/pipelines/metrics from social-api every 10s while the tab is
// visible (pauses on `document.hidden`). On error, keeps the last-good snapshot
// and surfaces the error string; if no good snapshot exists yet, synthesizes a
// fixture-derived value so the UI still has numbers to render.
//
// Phase 4: the backend will replace its synthesized stub with distributed-core's
// `PipelineModule.getMetrics()`; the response shape is deliberately aligned, so
// this hook does not need to change.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityContext } from '../../../contexts/IdentityContext';

const SOCIAL_API_URL =
  import.meta.env.VITE_SOCIAL_API_URL || 'http://localhost:3001';
const POLL_INTERVAL_MS = 10_000;

export interface PipelineMetrics {
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  runsActive: number;
  runsAwaitingApproval: number;
  avgDurationMs: number;
  llmTokensIn: number;
  llmTokensOut: number;
  estimatedCostUsd: number;
  asOf: string; // ISO timestamp
}

export interface UsePipelineMetricsResult {
  metrics: PipelineMetrics | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
  /** True once at least one successful fetch has populated `metrics`. */
  isLiveData: boolean;
}

// Fixture used when the backend is unreachable AND we have no last-good
// snapshot yet. Mirrors the shape returned by `getPipelineMetricsStub()` so
// downstream code never has to branch on null.
function fallbackMetrics(): PipelineMetrics {
  return {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    runsActive: 0,
    runsAwaitingApproval: 0,
    avgDurationMs: 0,
    llmTokensIn: 0,
    llmTokensOut: 0,
    estimatedCostUsd: 0,
    asOf: new Date().toISOString(),
  };
}

export function usePipelineMetrics(): UsePipelineMetricsResult {
  const { idToken } = useIdentityContext();

  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isLiveData, setIsLiveData] = useState<boolean>(false);

  // Keep a ref to the current AbortController so we can cancel in-flight
  // fetches on unmount / token change.
  const abortRef = useRef<AbortController | null>(null);
  // Track mounted state so we don't setState after unmount.
  const mountedRef = useRef<boolean>(true);
  // One-shot console warning — don't spam on every poll cycle.
  const fallbackLoggedRef = useRef<boolean>(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    // Cancel any previous in-flight fetch.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch(`${SOCIAL_API_URL}/api/pipelines/metrics`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as PipelineMetrics;

      if (!mountedRef.current || controller.signal.aborted) return;

      setMetrics(data);
      setLastUpdatedAt(new Date().toISOString());
      setError(null);
      setIsLiveData(true);
      fallbackLoggedRef.current = false;
    } catch (err) {
      // Ignore AbortError — it's expected on unmount / re-poll.
      if ((err as Error).name === 'AbortError') return;
      if (!mountedRef.current) return;
      // Silent failure: preserve last good metrics, expose error message.
      setError((err as Error).message || 'Failed to fetch pipeline metrics');
      setIsLiveData(false);
      // If we never got a good snapshot, paint the fixture so downstream
      // KPIs render zeros instead of `null` placeholders.
      setMetrics((prev) => prev ?? fallbackMetrics());
      if (!fallbackLoggedRef.current) {
        // eslint-disable-next-line no-console
        console.warn(
          '[usePipelineMetrics] /api/pipelines/metrics unreachable — using fallback',
          err,
        );
        fallbackLoggedRef.current = true;
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [idToken]);

  useEffect(() => {
    mountedRef.current = true;

    // Fetch immediately on mount.
    void fetchOnce();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void fetchOnce();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Refresh immediately on becoming visible, then resume polling.
        void fetchOnce();
        startPolling();
      }
    };

    // Start polling if tab is currently visible.
    if (!document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [fetchOnce]);

  return {
    metrics,
    loading,
    error,
    lastUpdatedAt,
    refresh: fetchOnce,
    isLiveData,
  };
}

export default usePipelineMetrics;
