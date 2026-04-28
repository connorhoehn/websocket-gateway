// frontend/src/components/observability/hooks/usePipelineMetrics.ts
//
// Polls GET /api/pipelines/metrics from social-api every 10s while the tab is
// visible (pauses on `document.hidden`). On error, keeps the last-good snapshot
// and surfaces the error string; if no good snapshot exists yet, synthesizes a
// fixture-derived value so the UI still has numbers to render.
//
// Phase 4: backend now returns a discriminated union tagged by `source`:
//
//   - 'bridge' — distributed-core PipelineModule.getMetrics() supplied data.
//                Numeric fields the bridge does not yet expose are returned
//                as `null` (never fabricated). Callers must render "—" for
//                null fields.
//   - 'stub'   — no bridge wired; values are synthetic. Callers should show
//                a "demo data" pill so operators don't mistake the dashboard
//                for live state.
//   - 'error'  — bridge was wired but threw. Hook keeps last-good snapshot
//                and exposes `source: 'error'` so callers can badge it.
//
// The hook preserves `null` numeric fields verbatim (no `?? 0` coercion) and
// surfaces `source` on the returned value so consumers can branch on it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityContext } from '../../../contexts/IdentityContext';

const SOCIAL_API_URL =
  import.meta.env.VITE_SOCIAL_API_URL || 'http://localhost:3001';
const POLL_INTERVAL_MS = 10_000;

// Exponential backoff curve used after a failed fetch, so a downed API
// doesn't get hammered with ~25 identical errors in 2s on page load. The
// counter resets to 0 on the first successful fetch, returning the hook to
// the regular `POLL_INTERVAL_MS` cadence.
const BACKOFF_BASE_MS = 1_000; // first retry after 1s
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 30_000; // 1s → 2s → 4s → 8s → 16s → 30s (capped)

function backoffDelayMs(consecutiveFailures: number): number {
  // failures=1 → 1s, =2 → 2s, =3 → 4s, =4 → 8s, =5 → 16s, =6+ → 30s.
  const exp = Math.max(0, consecutiveFailures - 1);
  return Math.min(
    BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, exp),
    BACKOFF_CAP_MS,
  );
}

export type PipelineMetricsSource = 'bridge' | 'stub' | 'error';

/**
 * Snapshot returned by `GET /api/pipelines/metrics`. Numeric fields are
 * nullable because the bridge-sourced response leaves unsupported fields as
 * `null` until distributed-core grows the surface — UI must render "—" for
 * those, NOT zeros.
 */
export interface PipelineMetrics {
  runsStarted: number | null;
  runsCompleted: number | null;
  runsFailed: number | null;
  runsActive: number | null;
  runsAwaitingApproval: number | null;
  avgDurationMs: number | null;
  llmTokensIn: number | null;
  llmTokensOut: number | null;
  estimatedCostUsd: number | null;
  /**
   * Average first-token latency (ms) across LLM steps. Sourced from
   * distributed-core v0.3.7+ via `PipelineModule.getMetrics()`. Older bridge
   * builds (and the stub fixture) leave this `null`; the UI must render an
   * em-dash, never zero.
   */
  avgFirstTokenLatencyMs: number | null;
  asOf: string; // ISO timestamp
  /** Discriminator describing where the values came from. */
  source: PipelineMetricsSource;
}

export interface UsePipelineMetricsResult {
  metrics: PipelineMetrics | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
  /** True once at least one successful fetch has populated `metrics`. */
  isLiveData: boolean;
  /**
   * Discriminator from the most recent snapshot, or `null` before the first
   * fetch resolves. Mirrors `metrics?.source` for convenient destructuring.
   */
  source: PipelineMetricsSource | null;
}

// Fixture used when the backend is unreachable AND we have no last-good
// snapshot yet. Mirrors the shape returned by `getPipelineMetricsStub()` so
// downstream code never has to branch on null. Tagged `source: 'error'` so
// consumers know this is a synthesized "nothing to show" placeholder.
function fallbackMetrics(): PipelineMetrics {
  return {
    runsStarted: null,
    runsCompleted: null,
    runsFailed: null,
    runsActive: null,
    runsAwaitingApproval: null,
    avgDurationMs: null,
    llmTokensIn: null,
    llmTokensOut: null,
    estimatedCostUsd: null,
    avgFirstTokenLatencyMs: null,
    asOf: new Date().toISOString(),
    source: 'error',
  };
}

/**
 * Coerce a raw JSON response into our nullable-numeric `PipelineMetrics`
 * shape without lying about missing fields. Anything that isn't `number` is
 * normalized to `null` so consumers can render "—" deterministically.
 *
 * The backend sends three response shapes (see
 * `social-api/src/routes/pipelineMetrics.ts:111-124`):
 *   - `{ source: 'stub',  ...numbers }` — all numeric fields present.
 *   - `{ source: 'bridge', ...partials }` — only fields the bridge exposes
 *      are numeric; the rest are explicit `null`.
 *   - `{ source: 'error', error }` — only reached on HTTP 500; we don't
 *      hit this branch in the success path.
 */
function normalize(raw: unknown): PipelineMetrics {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const sourceRaw = obj.source;
  const source: PipelineMetricsSource =
    sourceRaw === 'bridge' || sourceRaw === 'stub' || sourceRaw === 'error'
      ? sourceRaw
      : // Backwards-compat: legacy responses without a discriminator are
        // assumed to be stub-shaped (full numbers), since the previous
        // backend always synthesized values.
        'stub';
  return {
    runsStarted: numOrNull(obj.runsStarted),
    runsCompleted: numOrNull(obj.runsCompleted),
    runsFailed: numOrNull(obj.runsFailed),
    runsActive: numOrNull(obj.runsActive),
    runsAwaitingApproval: numOrNull(obj.runsAwaitingApproval),
    avgDurationMs: numOrNull(obj.avgDurationMs),
    llmTokensIn: numOrNull(obj.llmTokensIn),
    llmTokensOut: numOrNull(obj.llmTokensOut),
    estimatedCostUsd: numOrNull(obj.estimatedCostUsd),
    // distributed-core v0.3.7+ surfaces this via the bridge. Older responses
    // omit it entirely → numOrNull collapses `undefined` to `null`, preserving
    // back-compat with the pre-v0.3.7 backend.
    avgFirstTokenLatencyMs: numOrNull(obj.avgFirstTokenLatencyMs),
    asOf: typeof obj.asOf === 'string' ? obj.asOf : new Date().toISOString(),
    source,
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
  // Running count of consecutive failed fetches. Drives `backoffDelayMs`.
  // Reset to 0 on every successful fetch.
  const failureCountRef = useRef<number>(0);

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

      const data = normalize(await res.json());

      if (!mountedRef.current || controller.signal.aborted) return;

      setMetrics(data);
      setLastUpdatedAt(new Date().toISOString());
      setError(null);
      setIsLiveData(true);
      fallbackLoggedRef.current = false;
      // Reset backoff counter so the next poll runs at the normal cadence.
      failureCountRef.current = 0;
    } catch (err) {
      // Ignore AbortError — it's expected on unmount / re-poll.
      if ((err as Error).name === 'AbortError') return;
      if (!mountedRef.current) return;
      // Silent failure: preserve last good metrics, expose error message.
      setError((err as Error).message || 'Failed to fetch pipeline metrics');
      setIsLiveData(false);
      // Bump the consecutive-failure counter so the polling loop schedules
      // the next attempt with exponential backoff (1s → 2s → … → 30s cap).
      failureCountRef.current += 1;
      // If we never got a good snapshot, paint the fallback so downstream
      // KPIs render "—" instead of crashing on null. Mark `source: 'error'`
      // so the UI shows an error badge.
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

    // Recursive setTimeout chain (vs setInterval) so each tick can choose its
    // own delay. On the happy path this is a constant `POLL_INTERVAL_MS`; on
    // failure we apply `backoffDelayMs(failureCountRef.current)` so a downed
    // API doesn't get hammered with retries.
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const stopPolling = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleNext = () => {
      if (!mountedRef.current || document.hidden) return;
      const delay =
        failureCountRef.current > 0
          ? backoffDelayMs(failureCountRef.current)
          : POLL_INTERVAL_MS;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        void fetchOnce().finally(() => {
          scheduleNext();
        });
      }, delay);
    };

    const startPolling = () => {
      if (timeoutId !== null) return;
      scheduleNext();
    };

    // Fetch immediately on mount, then begin the polling chain.
    void fetchOnce().finally(() => {
      if (!document.hidden) startPolling();
    });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Refresh immediately on becoming visible, then resume polling.
        stopPolling();
        void fetchOnce().finally(() => {
          if (!document.hidden) startPolling();
        });
      }
    };

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
    source: metrics?.source ?? null,
  };
}

export default usePipelineMetrics;
