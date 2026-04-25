// frontend/src/components/observability/__tests__/useAlertToasts.test.tsx
//
// Unit coverage for useAlertToasts: new-alert toasting, dedup on repeat,
// re-toast after resolution, and the `critical`-severity action label.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

import { useAlertToasts } from '../hooks/useAlertToasts';
import type {
  ClusterDashboard,
  ObservabilityValue,
} from '../context/ObservabilityContext';

// ---------------------------------------------------------------------------
// Mocks — swap out the real ObservabilityContext + ToastProvider for
// controllable test doubles so we can drive dashboard updates and spy on
// toast() calls directly.
// ---------------------------------------------------------------------------

let currentDashboard: ClusterDashboard | null = null;
const toastSpy = vi.fn();

vi.mock('../context/ObservabilityContext', async () => {
  // Re-export the real types; replace only the hook.
  const actual = await vi.importActual<
    typeof import('../context/ObservabilityContext')
  >('../context/ObservabilityContext');
  return {
    ...actual,
    useObservability: (): ObservabilityValue => ({
      dashboard: currentDashboard,
      loading: false,
      error: null,
      lastUpdatedAt: null,
      live: true,
      setLive: () => {},
      refreshDashboard: async () => {},
    }),
  };
});

vi.mock('../../shared/ToastProvider', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Alert = ClusterDashboard['alerts'][number];

function makeDashboard(alerts: Alert[]): ClusterDashboard {
  return {
    overview: {
      totalNodes: 1,
      healthyNodes: 1,
      totalResources: 0,
      totalConnections: 0,
      messagesPerSecond: 0,
      averageLatency: 0,
      clusterHealth: 'healthy',
    },
    regions: {},
    hotspots: { highTrafficResources: [], overloadedNodes: [] },
    trends: {
      connectionGrowth: 0,
      messageVolumeGrowth: 0,
      nodeHealthTrend: 'stable',
    },
    alerts,
  };
}

function makeAlert(
  severity: Alert['severity'],
  message: string,
  category: Alert['category'] = 'health',
): Alert {
  return { severity, message, category, timestamp: Date.now() };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

beforeEach(() => {
  toastSpy.mockReset();
  currentDashboard = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAlertToasts', () => {
  test('new alert produces a toast with the correct type + duration', () => {
    currentDashboard = makeDashboard([makeAlert('warning', 'high CPU')]);

    renderHook(() => useAlertToasts(), { wrapper: Wrapper });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [message, opts] = toastSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('high CPU');
    expect(opts.type).toBe('warning');
    expect(opts.durationMs).toBe(6000);
  });

  test('info / warning / error / critical each map to the right type+duration', () => {
    currentDashboard = makeDashboard([
      makeAlert('info', 'something informational'),
      makeAlert('warning', 'warn warn'),
      makeAlert('error', 'errored'),
      makeAlert('critical', 'cluster down'),
    ]);

    renderHook(() => useAlertToasts(), { wrapper: Wrapper });

    expect(toastSpy).toHaveBeenCalledTimes(4);
    const calls = toastSpy.mock.calls as Array<[string, Record<string, unknown>]>;

    expect(calls[0][1]).toMatchObject({ type: 'info', durationMs: 4000 });
    expect(calls[1][1]).toMatchObject({ type: 'warning', durationMs: 6000 });
    expect(calls[2][1]).toMatchObject({ type: 'error', durationMs: 8000 });
    expect(calls[3][1]).toMatchObject({ type: 'error', durationMs: 10000 });
  });

  test('repeat render with same alert does not re-toast', () => {
    currentDashboard = makeDashboard([makeAlert('warning', 'high CPU')]);

    const { rerender } = renderHook(() => useAlertToasts(), { wrapper: Wrapper });
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Simulate another poll cycle with the *same* alert still present.
    currentDashboard = makeDashboard([makeAlert('warning', 'high CPU')]);
    rerender();

    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  test('removed alert + re-added triggers a new toast', () => {
    currentDashboard = makeDashboard([makeAlert('error', 'disk full')]);

    const { rerender } = renderHook(() => useAlertToasts(), { wrapper: Wrapper });
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Alert resolves (cleared from the dashboard).
    currentDashboard = makeDashboard([]);
    rerender();
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Alert recurs — should toast again.
    currentDashboard = makeDashboard([makeAlert('error', 'disk full')]);
    rerender();
    expect(toastSpy).toHaveBeenCalledTimes(2);
  });

  test('critical severity toast has an action label', () => {
    currentDashboard = makeDashboard([makeAlert('critical', 'cluster down')]);

    renderHook(() => useAlertToasts(), { wrapper: Wrapper });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [, opts] = toastSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.actionLabel).toBe('View');
    expect(typeof opts.onAction).toBe('function');
  });

  test('non-critical toasts do not have an action label', () => {
    currentDashboard = makeDashboard([makeAlert('warning', 'hot node')]);

    renderHook(() => useAlertToasts(), { wrapper: Wrapper });

    const [, opts] = toastSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.actionLabel).toBeUndefined();
    expect(opts.onAction).toBeUndefined();
  });
});
