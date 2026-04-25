// frontend/src/components/pipelines/__tests__/sourceDiagnosticBanner.test.tsx
//
// Coverage for the editor source-diagnostic banner. Exercises:
//   1. Renders null when VITE_PIPELINE_SOURCE is unset / 'mock'.
//   2. Renders nothing for the first 10s even when source=websocket.
//   3. Reveals the banner after 10s with no events received.
//   4. Stays hidden if an event arrives within the 10s window.
//   5. Dismissal sticks (sessionStorage) and survives a re-mount.
//   6. Polled health response updates the banner copy
//      (e.g. "LLM key missing — set ANTHROPIC_API_KEY").
//
// We rely on Vitest's fake timers + sessionStorage stubs and stub the
// `import.meta.env.VITE_PIPELINE_SOURCE` access via `vi.stubEnv`.

import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import SourceDiagnosticBanner from '../diagnostics/SourceDiagnosticBanner';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import { IdentityProvider } from '../../../contexts/IdentityContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'ws_pipelines_v1_source_diagnostic_dismissed';

interface HarnessHandle {
  dispatchAny: () => void;
}

/**
 * Render the banner inside the providers it needs (Identity + EventStream).
 * The harness exposes a `dispatchAny` that the test can call to pretend a
 * pipeline event arrived on the wire.
 */
function renderBanner(): HarnessHandle {
  const handle: HarnessHandle = { dispatchAny: () => {} };

  const Probe: React.FC = () => {
    const ctx = useEventStreamContext();
    handle.dispatchAny = () => {
      ctx.dispatch('pipeline.run.started', {
        runId: 'r-test',
        pipelineId: 'p-test',
        triggeredBy: { userId: 'u', triggerType: 'manual', payload: {} },
        at: '2026-04-23T00:00:00.000Z',
      });
    };
    return null;
  };

  render(
    <IdentityProvider
      value={{
        userId: 'u-1',
        displayName: 'Test User',
        userEmail: 'test@example.com',
        idToken: 'id-token-123',
        onSignOut: () => {},
      }}
    >
      <EventStreamProvider>
        <Probe />
        <SourceDiagnosticBanner />
      </EventStreamProvider>
    </IdentityProvider>,
  );
  return handle;
}

// ---------------------------------------------------------------------------
// Lifecycle — restore env / storage / fetch around each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // `shouldAdvanceTime: true` lets RTL's `findBy*` polling and microtask
  // queues progress in real wall-clock time even while we drive the 10s
  // threshold + 30s health-poll cadence with `vi.advanceTimersByTime`.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Default to websocket source — tests that need 'mock' override.
  vi.stubEnv('VITE_PIPELINE_SOURCE', 'websocket');
  vi.stubEnv('VITE_SOCIAL_API_URL', '');
  window.sessionStorage.removeItem(DISMISS_KEY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.sessionStorage.removeItem(DISMISS_KEY);
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceDiagnosticBanner', () => {
  test('renders null when VITE_PIPELINE_SOURCE is unset', () => {
    vi.stubEnv('VITE_PIPELINE_SOURCE', '');
    renderBanner();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
  });

  test("renders null when VITE_PIPELINE_SOURCE='mock'", () => {
    vi.stubEnv('VITE_PIPELINE_SOURCE', 'mock');
    renderBanner();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
  });

  test('stays hidden during the first 10 seconds even on websocket source', () => {
    renderBanner();
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
  });

  test('reveals the banner after 10s with no events received', async () => {
    // Suppress the health poll fetch — return generic message path.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 500 }));

    renderBanner();
    act(() => {
      vi.advanceTimersByTime(10_500);
    });

    const banner = await screen.findByTestId('source-diagnostic-banner');
    expect(banner.textContent).toContain('WebSocket source enabled');
    expect(banner.textContent).toContain('/api/pipelines/health');

    fetchSpy.mockRestore();
  });

  test('stays hidden if an event arrives within the 10s window', () => {
    const handle = renderBanner();
    act(() => {
      vi.advanceTimersByTime(5_000);
      handle.dispatchAny();
      vi.advanceTimersByTime(6_000);
    });
    // 11s elapsed total, but an event arrived at t=5s — banner should stay
    // hidden because lastEventAtRef was set before the threshold timer fired.
    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
  });

  test('dismissal persists in sessionStorage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 500 }),
    );

    renderBanner();
    act(() => {
      vi.advanceTimersByTime(10_500);
    });
    const banner = await screen.findByTestId('source-diagnostic-banner');
    expect(banner).toBeInTheDocument();

    const dismissBtn = screen.getByTestId('source-diagnostic-banner-dismiss');
    act(() => {
      dismissBtn.click();
    });

    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
    expect(window.sessionStorage.getItem(DISMISS_KEY)).toBe('true');

    // Re-mount: the banner should stay hidden because sessionStorage says so.
    cleanup();
    renderBanner();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByTestId('source-diagnostic-banner')).toBeNull();
  });

  test("updates message to 'LLM key missing' when health reports llmClientConfigured=false", async () => {
    const healthBody = {
      status: 'unwired',
      embeddedClusterReady: false,
      llmClientConfigured: false,
      pipelineModuleConnected: false,
      lastEventAt: null,
      tokenRate: null,
      asOf: new Date().toISOString(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(healthBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderBanner();
    act(() => {
      vi.advanceTimersByTime(10_500);
    });

    // First the generic message renders; once the health poll resolves, the
    // copy should swap to the LLM-specific message.
    await screen.findByTestId('source-diagnostic-banner');

    await waitFor(() => {
      const banner = screen.getByTestId('source-diagnostic-banner');
      expect(banner.textContent).toContain('LLM key missing');
      expect(banner.textContent).toContain('ANTHROPIC_API_KEY');
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('/api/pipelines/health');
    const headers = (init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.Authorization).toBe('Bearer id-token-123');

    fetchSpy.mockRestore();
  });
});
