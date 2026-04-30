// frontend/src/components/ActivityPanel.tsx
//
// Activity feed section card -- shows the user's recent social events.
// Hydrates from REST on mount, then subscribes to live WebSocket events
// and prepends them in real-time with dedup and a 50-item cap.
// Only ActivityPanel is exported.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from './shared/ToastProvider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityItem {
  eventType: string;
  timestamp: string;
  detail: Record<string, unknown>;
}

interface ActivityResponse {
  items: ActivityItem[];
  nextKey: string | null;
}

type ConnectionState = 'connected' | 'connecting' | 'disconnected';
type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface GatewayMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_API_URL = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

const MAX_ITEMS = 50;

// ---------------------------------------------------------------------------
// Event type display mapping
// ---------------------------------------------------------------------------

function formatActivity(item: ActivityItem): { icon: string; text: string } {
  const d = item.detail;
  switch (item.eventType) {
    case 'social.room.join':
      return { icon: '\uD83D\uDEAA', text: `Joined room ${(d.roomId as string)?.slice(0, 8) ?? ''}` };
    case 'social.room.leave':
      return { icon: '\uD83D\uDEAA', text: `Left room ${(d.roomId as string)?.slice(0, 8) ?? ''}` };
    case 'social.follow':
      return { icon: '\uD83D\uDC65', text: `Followed @${(d.followeeId as string)?.slice(0, 8) ?? ''}` };
    case 'social.unfollow':
      return { icon: '\uD83D\uDC65', text: `Unfollowed @${(d.followeeId as string)?.slice(0, 8) ?? ''}` };
    case 'social.like':
      return { icon: '\u2764\uFE0F', text: `Liked ${(d.contentId as string)?.slice(0, 8) ?? 'content'}` };
    case 'social.reaction':
      return { icon: (d.emoji as string) ?? '\uD83D\uDE00', text: `Reacted to ${(d.contentId as string)?.slice(0, 8) ?? 'content'}` };
    case 'social.post.created':
      return { icon: '\uD83D\uDCDD', text: `Posted in room ${(d.roomId as string)?.slice(0, 8) ?? ''}` };
    case 'social.comment.created':
      return { icon: '\uD83D\uDCAC', text: `Commented in room ${(d.roomId as string)?.slice(0, 8) ?? ''}` };
    // Pipeline run-lifecycle events (relayed via usePipelineActivityRelay)
    case 'pipeline.run.started': {
      const pid = (d.pipelineId as string) ?? '';
      return { icon: '▶', text: pid ? `Triggered pipeline ${pid}` : 'Triggered pipeline' };
    }
    case 'pipeline.run.completed':
      return {
        icon: '✓',
        text:
          typeof d.durationMs === 'number'
            ? `Pipeline run completed in ${d.durationMs}ms`
            : 'Pipeline run completed',
      };
    case 'pipeline.run.failed':
      return {
        icon: '✕',
        text: `Pipeline run failed: ${(d.error as string) ?? 'unknown error'}`,
      };
    case 'pipeline.approval.requested':
      return { icon: '✋', text: 'Approval requested' };
    default:
      return { icon: '\u2139\uFE0F', text: item.eventType };
  }
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return ts.slice(0, 10);
}

// ---------------------------------------------------------------------------
// extractUserId helper
// ---------------------------------------------------------------------------

function extractUserId(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    return (JSON.parse(atob(idToken.split('.')[1])) as { sub: string }).sub;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// useActivityFeed hook
// ---------------------------------------------------------------------------

function useActivityFeed({
  idToken,
  sendMessage,
  onMessage,
  connectionState,
}: {
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: OnMessageFn;
  connectionState: ConnectionState;
}): {
  items: ActivityItem[];
  loading: boolean;
  isLive: boolean;
  error: string | null;
  retry: () => void;
} {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  const { toast } = useToast();

  const userId = extractUserId(idToken);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);

  // 1. Hydrate from REST on mount
  useEffect(() => {
    if (!idToken || !SOCIAL_API_URL) return;
    let cancelled = false;
    // Set loading synchronously before the async fetch — this is intentional
    // to show a loading indicator immediately on mount/token change.
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setError(null); // eslint-disable-line react-hooks/set-state-in-effect
    fetch(`${SOCIAL_API_URL}/api/activity?limit=20`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: ActivityResponse) => {
        if (!cancelled && data?.items) {
          setItems(data.items);
          setError(null);
        }
      })
      .catch(err => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[activity] fetch failed:', err);
        setError(msg);
        toast("Couldn't load activity feed", { type: 'error' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idToken, reloadKey, toast]);

  // 2. Subscribe to WebSocket channel when connected
  useEffect(() => {
    if (connectionState !== 'connected' || !userId) {
      setIsLive(false); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    const channelId = `activity:${userId}`;
    sendMessageRef.current({ service: 'activity', action: 'subscribe', channelId });
    setIsLive(true);  
    return () => {
      sendMessageRef.current({ service: 'activity', action: 'unsubscribe', channelId });
      setIsLive(false);  
    };
  }, [connectionState, userId]);

  // 3. Append live events with dedup
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type !== 'activity:event') return;
      const payload = msg.payload as { eventType: string; detail: Record<string, unknown>; timestamp: string } | undefined;
      if (!payload) return;
      setItems(prev => {
        // Dedup: skip if first item already has same timestamp+eventType
        if (prev.length > 0 && prev[0].timestamp === payload.timestamp && prev[0].eventType === payload.eventType) {
          return prev;
        }
        return [
          { eventType: payload.eventType, timestamp: payload.timestamp, detail: payload.detail },
          ...prev,
        ].slice(0, MAX_ITEMS);
      });
    });
    return unregister;
  }, [onMessage]);

  return { items, loading, isLive, error, retry };
}

// ---------------------------------------------------------------------------
// ActivityPanel (exported)
// ---------------------------------------------------------------------------

const sectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '1.25rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#64748b',
  margin: '0 0 0.75rem 0',
};

interface ActivityPanelProps {
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: OnMessageFn;
  connectionState: ConnectionState;
}

export function ActivityPanel({ idToken, sendMessage, onMessage, connectionState }: ActivityPanelProps) {
  const { items, loading, isLive, error, retry } = useActivityFeed({ idToken, sendMessage, onMessage, connectionState });

  return (
    <div style={sectionCardStyle}>
      <h2 style={sectionHeaderStyle}>
        Activity
        {isLive && (
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              marginLeft: 8,
              verticalAlign: 'middle',
            }}
            title="Live"
          />
        )}
      </h2>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1rem', justifyContent: 'center', color: '#64748b' }}>
          <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: '#646cff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading...
        </div>
      ) : error && items.length === 0 ? (
        <div
          role="alert"
          style={{ padding: '1.5rem 1rem', textAlign: 'center', color: '#b91c1c', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
        >
          <span>Couldn't load activity</span>
          <span style={{ color: '#64748b', fontSize: 12 }}>{error}</span>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 4,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: '#1d4ed8',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          No activity yet
        </div>
      ) : (
        <div>
          {items.map((item, idx) => {
            const { icon, text } = formatActivity(item);
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 8,
                  paddingBottom: 8,
                  borderBottom: idx < items.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}
              >
                <span style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 14, color: '#374151' }}>{text}</span>
                <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>
                  {relativeTime(item.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
