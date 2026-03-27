// frontend/src/components/BigBrotherPanel.tsx
//
// "Big Brother" monitoring dashboard panel — shows room stats, online users,
// and a real-time scrolling event feed for monitoring simulation runs.
// Wired as a switchable tab in AppLayout alongside existing panels.

import { useState, useEffect, useRef } from 'react';
import type { PresenceUser } from '../hooks/usePresence';
import type { RoomItem } from '../hooks/useRooms';

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

export interface BigBrotherPanelProps {
  idToken: string | null;
  rooms: RoomItem[];
  presenceUsers: PresenceUser[];
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: OnMessageFn;
  connectionState: ConnectionState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_API_URL = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? 'http://localhost:3001';

const MAX_ITEMS = 100;

// ---------------------------------------------------------------------------
// Event type display mapping (copied from ActivityPanel.tsx)
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
// useActivityFeed hook (inline, copied from ActivityPanel.tsx pattern)
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
}): { items: ActivityItem[]; loading: boolean; isLive: boolean } {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  const userId = extractUserId(idToken);

  // 1. Hydrate from REST on mount
  useEffect(() => {
    if (!idToken) return;
    setLoading(true);
    fetch(`${SOCIAL_API_URL}/api/activity?limit=30`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(r => r.json())
      .then((data: ActivityResponse) => setItems(data.items))
      .catch(err => console.error('[big-brother] fetch failed:', err))
      .finally(() => setLoading(false));
  }, [idToken]);

  // 2. Subscribe to WebSocket channel when connected
  useEffect(() => {
    if (connectionState !== 'connected' || !userId) {
      setIsLive(false);
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

  return { items, loading, isLive };
}

// ---------------------------------------------------------------------------
// Styles
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

const statBoxStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '8px 16px',
  textAlign: 'center',
  flex: 1,
};

const statNumberStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: '#0f172a',
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  textTransform: 'uppercase',
};

const typeBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  padding: '1px 6px',
  borderRadius: 4,
  background: '#f1f5f9',
  color: '#64748b',
  textTransform: 'uppercase',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BigBrotherPanel({
  idToken,
  rooms,
  presenceUsers,
  sendMessage,
  onMessage,
  connectionState,
}: BigBrotherPanelProps) {
  const { items, loading, isLive } = useActivityFeed({
    idToken,
    sendMessage,
    onMessage,
    connectionState,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Top stats bar */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={statBoxStyle}>
          <div style={statNumberStyle}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#22c55e',
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            />
            {presenceUsers.length}
          </div>
          <div style={statLabelStyle}>Online</div>
        </div>
        <div style={statBoxStyle}>
          <div style={statNumberStyle}>{rooms.length}</div>
          <div style={statLabelStyle}>Rooms</div>
        </div>
        <div style={statBoxStyle}>
          <div style={statNumberStyle}>{items.length}</div>
          <div style={statLabelStyle}>Events</div>
        </div>
      </div>

      {/* Split panel layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Left column -- Room Stats */}
        <div style={sectionCardStyle}>
          <h2 style={sectionHeaderStyle}>
            Rooms
            <span style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 600,
              background: '#e2e8f0',
              color: '#475569',
              borderRadius: 10,
              padding: '1px 8px',
              verticalAlign: 'middle',
            }}>
              {rooms.length}
            </span>
          </h2>
          {rooms.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
              No rooms yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rooms.map(room => (
                <div
                  key={room.roomId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <div>
                    <span style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>
                      {room.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={typeBadgeStyle}>{room.type}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {room.createdAt?.slice(0, 10)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column -- Live Event Feed */}
        <div style={sectionCardStyle}>
          <h2 style={sectionHeaderStyle}>
            Live Events
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
          ) : items.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
              No events yet -- run a simulation to see activity here
            </div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
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
      </div>
    </div>
  );
}
