// frontend/src/hooks/useApiHealth.ts
//
// Polls social-api's GET /health endpoint and exposes the rollup status so
// the UI can show a "Backend services degraded" banner when dependencies
// (Dynamo/Redis/etc.) are unavailable. Distinct from the WebSocket gateway
// "Disconnected" indicator — the WS path can be healthy while REST is not.
//
// /health response shape (per social-api):
//   200 { status: 'ok',       service, checks: { [name]: { status, ... } } }
//   503 { status: 'degraded', service, checks: { [name]: { status, error } } }

import { useEffect, useRef, useState } from 'react';

export type ApiHealthStatus = 'ok' | 'degraded' | 'unknown';

export interface ApiHealthCheck {
  status: 'ok' | 'error' | string;
  latencyMs?: number;
  error?: string;
}

export interface ApiHealthSnapshot {
  status: ApiHealthStatus;
  checks: Record<string, ApiHealthCheck>;
  /** Names of failing dependencies (status !== 'ok'). Empty when healthy or unknown. */
  failing: string[];
}

const DEFAULT_POLL_MS = 30_000;

interface HealthResponse {
  status: 'ok' | 'degraded';
  service?: string;
  checks?: Record<string, ApiHealthCheck>;
}

function deriveFailing(checks: Record<string, ApiHealthCheck> | undefined): string[] {
  if (!checks) return [];
  return Object.entries(checks)
    .filter(([, v]) => v && v.status !== 'ok')
    .map(([k]) => k);
}

/**
 * Polls /health every `pollMs`. The first sample lands as soon as the network
 * round-trip completes; the hook starts in `unknown` so callers don't flash
 * "degraded" before the first response.
 */
export function useApiHealth(pollMs: number = DEFAULT_POLL_MS): ApiHealthSnapshot {
  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
  const [snapshot, setSnapshot] = useState<ApiHealthSnapshot>({
    status: 'unknown',
    checks: {},
    failing: [],
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!baseUrl) return;
    cancelledRef.current = false;

    const tick = async () => {
      try {
        // /health returns 200 when ok, 503 when degraded — both ship a JSON body.
        const res = await fetch(`${baseUrl}/health`);
        const body = (await res.json().catch(() => null)) as HealthResponse | null;
        if (cancelledRef.current) return;
        if (body && (body.status === 'ok' || body.status === 'degraded')) {
          const checks = body.checks ?? {};
          setSnapshot({ status: body.status, checks, failing: deriveFailing(checks) });
        } else {
          // Network reached the server but the body is unparseable — treat as
          // degraded so operators still see something is wrong.
          setSnapshot({ status: 'degraded', checks: {}, failing: ['unknown'] });
        }
      } catch {
        if (cancelledRef.current) return;
        // Network/CORS failure — distinct from a degraded backend, but for
        // banner purposes "we can't reach REST" is functionally the same.
        setSnapshot({ status: 'degraded', checks: {}, failing: ['network'] });
      }
    };

    void tick();
    const handle = setInterval(() => { void tick(); }, pollMs);

    return () => {
      cancelledRef.current = true;
      clearInterval(handle);
    };
  }, [baseUrl, pollMs]);

  return snapshot;
}
