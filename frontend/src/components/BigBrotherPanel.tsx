// frontend/src/components/BigBrotherPanel.tsx
//
// "Big Brother" monitoring dashboard panel — shows room stats, online users,
// and a real-time scrolling event feed for monitoring simulation runs.
// Wired as a switchable tab in AppLayout alongside existing panels.

import type { PresenceUser } from '../hooks/usePresence';
import type { RoomItem } from '../hooks/useRooms';
import type { ActivityEvent } from '../hooks/useActivityBus';

export interface BigBrotherPanelProps {
  rooms: RoomItem[];
  presenceUsers: PresenceUser[];
  activityEvents: ActivityEvent[];
  activityIsLive: boolean;
}

// ---------------------------------------------------------------------------
// Event type display mapping
// ---------------------------------------------------------------------------

function formatActivity(event: ActivityEvent): { icon: string; text: string } {
  const d = event.detail;
  switch (event.eventType) {
    // Social events
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
    // Document editor events
    case 'doc.ack':
      return { icon: '\u2705', text: `Acknowledged ${(d.itemText as string) ?? 'item'}` };
    case 'doc.reject':
      return { icon: '\u274C', text: `Rejected ${(d.itemText as string) ?? 'item'}` };
    case 'doc.add_item':
      return { icon: '\u2795', text: `Added task in ${(d.sectionTitle as string) ?? 'section'}` };
    case 'doc.add_section':
      return { icon: '\uD83D\uDCC1', text: 'Added new section' };
    case 'doc.edit_section':
      return { icon: '\u270F\uFE0F', text: 'Edited section' };
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
      return { icon: '\u2139\uFE0F', text: event.eventType };
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
  rooms,
  presenceUsers,
  activityEvents,
  activityIsLive: isLive,
}: BigBrotherPanelProps) {

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
          <div style={statNumberStyle}>{activityEvents.length}</div>
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
          {activityEvents.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
              No events yet -- run a simulation to see activity here
            </div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {activityEvents.map((event, idx) => {
                const { icon, text } = formatActivity(event);
                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingTop: 8,
                      paddingBottom: 8,
                      borderBottom: idx < activityEvents.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <span style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>{icon}</span>
                    <span style={{ flex: 1, fontSize: 14, color: '#374151' }}>
                      {event.displayName && (
                        <span style={{ fontWeight: 600, color: event.color ?? '#6366f1', marginRight: 4 }}>
                          {event.displayName}
                        </span>
                      )}
                      {text}
                    </span>
                    <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>
                      {relativeTime(event.timestamp)}
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
