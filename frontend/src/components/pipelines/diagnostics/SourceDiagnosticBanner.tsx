// frontend/src/components/pipelines/diagnostics/SourceDiagnosticBanner.tsx
//
// Diagnostic banner shown in the pipeline editor when:
//   1. `VITE_PIPELINE_SOURCE=websocket` is set, AND
//   2. No pipeline events have flowed for >10s after page load.
//
// Without this banner, users staring at an inactive editor with the WS source
// flag set get no feedback that the backend bridge isn't actually wired (Phase
// 4 will install the bridge; Phase 1 leaves the flag dormant).
//
// Behavior:
//   - Reads `import.meta.env.VITE_PIPELINE_SOURCE`. If unset or `'mock'`,
//     renders null — the banner is strictly a websocket-mode diagnostic.
//   - Subscribes via `useEventStream('*', handler)` to count events. Any event
//     resets the "no events seen" condition.
//   - 10s after mount: if no events have arrived, the banner reveals itself.
//   - Polls `/api/pipelines/health` every 30s while shown so the message can
//     reflect a missing LLM key, etc. (auth: idToken from useIdentityContext).
//   - Dismissable; the dismissal sticks for the session via sessionStorage.
//
// Style: amber `chipStyle('warning')` palette extended into a padded row,
// inserted between the editor top bar and the tags row by PipelineEditorPage.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { useEventStream } from '../context/EventStreamContext';
import { useIdentityContext } from '../../../contexts/IdentityContext';
import { chipStyle, colors } from '../../../constants/styles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NO_EVENT_THRESHOLD_MS = 10_000;
const HEALTH_POLL_MS = 30_000;
const DISMISS_KEY = 'ws_pipelines_v1_source_diagnostic_dismissed';

// ---------------------------------------------------------------------------
// Types — mirrors social-api/src/routes/pipelineHealth.ts PipelineHealth.
// Kept local so the frontend doesn't need a cross-repo type import; the shape
// is small and stable, and the types-sync doc covers it.
// ---------------------------------------------------------------------------

interface PipelineHealth {
  status: 'ok' | 'degraded' | 'unwired';
  embeddedClusterReady: boolean;
  llmClientConfigured: boolean;
  pipelineModuleConnected: boolean;
  lastEventAt: string | null;
  tokenRate: { perSec1s: number; perSec10s: number; perSec60s: number } | null;
  asOf: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPipelineSourceEnv(): string | undefined {
  return (import.meta.env as Record<string, string | undefined>).VITE_PIPELINE_SOURCE;
}

function getSocialApiBaseUrl(): string {
  return (import.meta.env as Record<string, string | undefined>).VITE_SOCIAL_API_URL ?? '';
}

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    // sessionStorage may be unavailable (private mode, quota): ignore.
  }
}

/**
 * Build the user-facing message based on the latest health snapshot. Falls
 * back to a generic "bridge not wired" line when health is null (poll hasn't
 * landed, network failed, etc.).
 */
function messageFor(health: PipelineHealth | null): string {
  if (!health) {
    return 'WebSocket source enabled but no pipeline events received. Backend bridge may not be wired (Phase 4) or is starting up. Check /api/pipelines/health.';
  }
  if (!health.llmClientConfigured) {
    return 'LLM key missing — set ANTHROPIC_API_KEY (or PIPELINE_LLM_PROVIDER=bedrock with AWS creds) on the social-api process.';
  }
  if (!health.embeddedClusterReady) {
    return 'WebSocket source enabled but the embedded distributed-core cluster is not ready (Phase 4 wiring pending).';
  }
  if (!health.pipelineModuleConnected) {
    return 'WebSocket source enabled but the pipelineModule bridge is not connected — cancel/approval handlers are not installed.';
  }
  // status === 'ok' but still no events — keep banner visible but soften.
  return 'WebSocket source enabled and backend reports healthy, but no events have reached this client yet.';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rowStyle: CSSProperties = {
  ...chipStyle('warning'),
  // Promote the chip to a full-width banner row.
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 16px',
  borderRadius: 0,
  borderTop: `1px solid ${colors.border}`,
  borderBottom: `1px solid ${colors.border}`,
  whiteSpace: 'normal',
  fontSize: 12,
  lineHeight: 1.45,
  width: '100%',
};

const messageStyle: CSSProperties = {
  flex: 1,
  fontWeight: 500,
};

const dismissBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '2px 6px',
  fontFamily: 'inherit',
  flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SourceDiagnosticBanner(): ReactElement | null {
  const sourceEnv = getPipelineSourceEnv();
  const isWebSocketSource = sourceEnv === 'websocket';

  // Hooks must run unconditionally — keep all hook calls above the early
  // return below so React's hook order stays stable across renders.
  const { idToken } = useIdentityContext();

  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
  const [elapsed, setElapsed] = useState<boolean>(false);
  const [health, setHealth] = useState<PipelineHealth | null>(null);

  const lastEventAtRef = useRef<number | null>(null);

  // Reset the "no events seen" sentinel every time an event arrives. We
  // intentionally do not re-render here — the timer + health-poll drive
  // visibility, and reads of lastEventAtRef are best-effort.
  useEventStream('*', () => {
    lastEventAtRef.current = Date.now();
    // If an event arrives after the threshold timer has fired, hide the banner
    // again so a transient outage that resolves on its own clears the warning.
    if (elapsed) setElapsed(false);
  });

  // 10s threshold timer. If any event arrives before it fires, lastEventAtRef
  // is non-null and we skip flipping `elapsed` true.
  useEffect(() => {
    if (!isWebSocketSource || dismissed) return;
    const timer = window.setTimeout(() => {
      if (lastEventAtRef.current === null) {
        setElapsed(true);
      }
    }, NO_EVENT_THRESHOLD_MS);
    return () => window.clearTimeout(timer);
  }, [isWebSocketSource, dismissed]);

  const shouldShow = isWebSocketSource && !dismissed && elapsed;

  // Poll /api/pipelines/health every 30s while the banner is shown so the
  // message text can update from generic to specific (e.g. "LLM key missing").
  useEffect(() => {
    if (!shouldShow) return;
    let cancelled = false;
    const baseUrl = getSocialApiBaseUrl();
    const url = `${baseUrl}/api/pipelines/health`;

    const fetchHealth = async (): Promise<void> => {
      try {
        const headers: Record<string, string> = {};
        if (idToken) headers.Authorization = `Bearer ${idToken}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const body = (await res.json()) as PipelineHealth;
        if (!cancelled) setHealth(body);
      } catch {
        // Network/JSON errors are non-fatal — the banner falls back to the
        // generic message via `messageFor(null)`.
      }
    };

    void fetchHealth();
    const id = window.setInterval(() => {
      void fetchHealth();
    }, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [shouldShow, idToken]);

  const handleDismiss = useCallback(() => {
    persistDismissed();
    setDismissed(true);
  }, []);

  const message = useMemo(() => messageFor(health), [health]);

  if (!shouldShow) return null;

  return (
    <div role="status" data-testid="source-diagnostic-banner" style={rowStyle}>
      <span aria-hidden="true">⚠</span>
      <span style={messageStyle}>{message}</span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss diagnostic banner"
        title="Dismiss"
        style={dismissBtnStyle}
        data-testid="source-diagnostic-banner-dismiss"
      >
        ×
      </button>
    </div>
  );
}
