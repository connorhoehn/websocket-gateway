// frontend/src/components/ActivityPanel.tsx
//
// Activity feed section card — shows the user's recent social events.
// All sub-components co-located as unexported internals.
// Only ActivityPanel is exported.

import { useState, useEffect } from 'react';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_API_URL = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? 'http://localhost:3001';

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
// useActivityLog hook
// ---------------------------------------------------------------------------

function useActivityLog(idToken: string | null): { items: ActivityItem[]; loading: boolean } {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!idToken) return;
    setLoading(true);
    fetch(`${SOCIAL_API_URL}/api/activity?limit=20`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(r => r.json())
      .then((data: ActivityResponse) => setItems(data.items))
      .catch(err => console.error('[activity] fetch failed:', err))
      .finally(() => setLoading(false));
  }, [idToken]);

  return { items, loading };
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

export function ActivityPanel({ idToken }: { idToken: string | null }) {
  const { items, loading } = useActivityLog(idToken);

  return (
    <div style={sectionCardStyle}>
      <h2 style={sectionHeaderStyle}>Activity</h2>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          Loading activity...
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
