import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dashboardFixture from '../fixtures/dashboardFixture';
import {
  useEventStreamContext,
  type WildcardEvent,
} from '../../pipelines/context/EventStreamContext';

// ---------------------------------------------------------------------------
// Types
//
// Source: shape mirrors the `ClusterDashboard` interface defined in
// distributed-core (see PIPELINES_PLAN.md §18.6). We inline the shape here to
// avoid coupling the frontend to distributed-core types until Phase 4 wires
// in the real /api/observability/dashboard endpoint.
// ---------------------------------------------------------------------------

export interface ClusterDashboard {
  overview: {
    totalNodes: number;
    healthyNodes: number;
    totalResources: number;
    totalConnections: number;
    messagesPerSecond: number;
    averageLatency: number;
    clusterHealth: 'healthy' | 'warning' | 'critical';
  };
  regions: Record<
    string,
    {
      nodes: number;
      resources: number;
      connections: number;
      health: number;
      latency: number;
    }
  >;
  hotspots: {
    highTrafficResources: Array<{
      resourceId: string;
      connections: number;
      messageRate: number;
      node: string;
    }>;
    overloadedNodes: Array<{
      nodeId: string;
      cpuUsage: number;
      memoryUsage: number;
      resourceCount: number;
    }>;
  };
  trends: {
    connectionGrowth: number;
    messageVolumeGrowth: number;
    nodeHealthTrend: 'improving' | 'stable' | 'degrading';
  };
  alerts: Array<{
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    timestamp: number;
    category: 'performance' | 'capacity' | 'health' | 'security';
  }>;
}

export interface RecentEvent {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  payload?: unknown;
}

export interface ObservabilityValue {
  dashboard: ClusterDashboard | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  live: boolean;
  setLive: (live: boolean) => void;
  refreshDashboard: () => Promise<void>;
  /** Live recent events (capped) — populated from the EventStream. */
  recentEvents: RecentEvent[];
  /** Active runs count derived from event stream. */
  activeRunsCount: number;
  /** True when the backend dashboard fetch has succeeded at least once. */
  isLiveData: boolean;
}

const defaultValue: ObservabilityValue = {
  dashboard: null,
  loading: false,
  error: null,
  lastUpdatedAt: null,
  live: true,
  setLive: () => {},
  refreshDashboard: async () => {},
  recentEvents: [],
  activeRunsCount: 0,
  isLiveData: false,
};

const ObservabilityContext = createContext<ObservabilityValue>(defaultValue);

interface Props {
  children: ReactNode;
  pollIntervalMs?: number;
}

const SOCIAL_API_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_SOCIAL_API_URL?: string } }).env
      ?.VITE_SOCIAL_API_URL) ||
  'http://localhost:3001';

const RECENT_EVENT_CAP = 50;

// ---------------------------------------------------------------------------
// Severity / summary helpers (kept tiny — full versions live in EventsPage).
// ---------------------------------------------------------------------------

function severityFor(eventType: string): RecentEvent['severity'] {
  if (eventType.includes('failed') || eventType.includes('error')) return 'error';
  if (eventType.includes('completed')) return 'success';
  if (eventType.includes('warn') || eventType.includes('awaiting')) return 'warning';
  return 'info';
}

function summarize(eventType: string, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.runId === 'string') return `${eventType} · ${p.runId}`;
  }
  return eventType;
}

function formatTimestamp(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function ObservabilityProvider({
  children,
  pollIntervalMs = 10000,
}: Props) {
  const [dashboard, setDashboard] = useState<ClusterDashboard | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [live, setLive] = useState<boolean>(true);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [isLiveData, setIsLiveData] = useState<boolean>(false);

  // Track active runs derived from `pipeline.run.started/completed/failed/cancelled`.
  const activeRunIdsRef = useRef<Set<string>>(new Set());
  const [activeRunsCount, setActiveRunsCount] = useState<number>(0);

  // Stable fixture baseline so re-renders don't keep rebuilding it.
  const baselineRef = useRef<ClusterDashboard>(dashboardFixture as ClusterDashboard);
  // One-shot log when we fall back so we don't spam the console on every poll.
  const fallbackLoggedRef = useRef<boolean>(false);

  // Subscribe to the shared EventStream — wildcard so we see every dispatched
  // event without coupling to specific names. Phase 4: same signature works
  // unchanged when the source flips from mock to WebSocket.
  const eventStream = useEventStreamContext();
  const liveRef = useRef(live);
  liveRef.current = live;

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SOCIAL_API_URL}/api/observability/dashboard`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as ClusterDashboard;
      setDashboard(data);
      setLastUpdatedAt(new Date().toISOString());
      setIsLiveData(true);
      // Reset the one-shot log so a future failure logs again.
      fallbackLoggedRef.current = false;
    } catch (err) {
      // Graceful fallback: render the static fixture so the UI stays useful
      // while the backend is unreachable. Log exactly once per failure run.
      if (!fallbackLoggedRef.current) {
        // eslint-disable-next-line no-console
        console.warn(
          '[ObservabilityContext] /api/observability/dashboard unreachable — using fixture',
          err,
        );
        fallbackLoggedRef.current = true;
      }
      setDashboard((prev) => prev ?? baselineRef.current);
      setLastUpdatedAt((prev) => prev ?? new Date().toISOString());
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      setIsLiveData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDashboard = useCallback(async (): Promise<void> => {
    await fetchDashboard();
  }, [fetchDashboard]);

  // Initial load: try the real endpoint; fixture is wired in as fallback inside
  // `fetchDashboard`. Don't paint the fixture before the first attempt — the
  // catch path handles that.
  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Polling loop — runs only while `live` is true.
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => {
      void fetchDashboard();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [live, pollIntervalMs, fetchDashboard]);

  // Subscribe to all pipeline events for live derived metrics + recent feed.
  useEffect(() => {
    // subscribeToAll is the Phase-4 WS subscription gate; we still call it so
    // the gateway knows we want the channel even though the wildcard listener
    // below is what actually routes events in Phase 1.
    const unsubAll = eventStream.subscribeToAll();

    const unsubWildcard = eventStream.subscribe('*', (payload) => {
      if (!liveRef.current) return;
      const env = payload as WildcardEvent;
      const type = env?.eventType ?? 'unknown';
      const inner = env?.payload ?? env;

      // Update active-runs derived count.
      const runId = (inner as { runId?: string } | null)?.runId;
      if (runId) {
        const set = activeRunIdsRef.current;
        if (type === 'pipeline.run.started') {
          set.add(runId);
        } else if (
          type === 'pipeline.run.completed' ||
          type === 'pipeline.run.failed' ||
          type === 'pipeline.run.cancelled'
        ) {
          set.delete(runId);
        }
        setActiveRunsCount(set.size);
      }

      // Append to the recent-events ring buffer.
      const ev: RecentEvent = {
        id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: formatTimestamp(),
        type,
        summary: summarize(type, inner),
        severity: severityFor(type),
        payload: inner,
      };
      setRecentEvents((prev) => {
        const next = [ev, ...prev];
        return next.length > RECENT_EVENT_CAP ? next.slice(0, RECENT_EVENT_CAP) : next;
      });
    });

    return () => {
      unsubAll();
      unsubWildcard();
    };
  }, [eventStream]);

  const value = useMemo<ObservabilityValue>(
    () => ({
      dashboard,
      loading,
      error,
      lastUpdatedAt,
      live,
      setLive,
      refreshDashboard,
      recentEvents,
      activeRunsCount,
      isLiveData,
    }),
    [
      dashboard,
      loading,
      error,
      lastUpdatedAt,
      live,
      refreshDashboard,
      recentEvents,
      activeRunsCount,
      isLiveData,
    ],
  );

  return (
    <ObservabilityContext.Provider value={value}>
      {children}
    </ObservabilityContext.Provider>
  );
}

export function useObservability(): ObservabilityValue {
  return useContext(ObservabilityContext);
}

export default ObservabilityContext;
