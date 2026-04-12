// frontend/src/components/doc-editor/ActivityFeed.tsx
//
// Live activity feed showing who did what in the document editor.
// Consumes ActivityEvent[] from useActivityBus and renders doc/social events.

import { useState } from 'react';
import type { Participant } from '../../types/document';
import type { ActivityEvent } from '../../hooks/useActivityBus';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  events: ActivityEvent[];
  participants: Participant[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  background: '#f1f5f9',
  borderBottom: '1px solid #e2e8f0',
  fontSize: 13,
  fontWeight: 600,
  color: '#334155',
  cursor: 'pointer',
  userSelect: 'none',
};

const listStyle: React.CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
  padding: '4px 0',
};

const entryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '6px 12px',
  fontSize: 12,
  lineHeight: 1.5,
  borderBottom: '1px solid #f1f5f9',
};

const avatarStyle = (color: string): React.CSSProperties => ({
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: color,
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 700,
  flexShrink: 0,
  marginTop: 1,
});

const timeStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#94a3b8',
  whiteSpace: 'nowrap',
  marginLeft: 'auto',
  paddingLeft: 8,
  flexShrink: 0,
};

const presenceBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderBottom: '1px solid #e2e8f0',
  fontSize: 11,
  color: '#64748b',
  flexWrap: 'wrap',
};

const presenceDotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: '2px 8px 2px 4px',
  fontSize: 11,
  fontWeight: 500,
  color: '#334155',
});

const dotStyle = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map event types to display icons */
function eventIcon(eventType: string): string {
  if (eventType === 'doc.ack') return '\u2705';
  if (eventType === 'doc.reject') return '\u274C';
  if (eventType === 'doc.add_item') return '\u2795';
  if (eventType === 'doc.add_section') return '\u2795';
  if (eventType === 'doc.edit_section') return '\u270F\uFE0F';
  if (eventType === 'doc.remove_item') return '\u2796';
  if (eventType === 'doc.comment') return '\u{1F4AC}';
  if (eventType.endsWith('.join')) return '\u{1F7E2}';
  if (eventType.endsWith('.leave')) return '\u{1F534}';
  if (eventType.startsWith('social.')) return '\u{1F4AC}';
  return '\u2022';
}

/** Map event type + detail to human-readable description */
function eventDescription(eventType: string, detail: Record<string, unknown>): string {
  switch (eventType) {
    case 'doc.ack':
      return `acknowledged "${(detail.itemText as string) || 'item'}"`;
    case 'doc.reject':
      return `rejected "${(detail.itemText as string) || 'item'}"`;
    case 'doc.add_item':
      return `added task in "${(detail.sectionTitle as string) || 'section'}"`;
    case 'doc.add_section':
      return 'added new section';
    case 'doc.edit_section':
      return `edited "${(detail.sectionTitle as string) || 'section'}"`;
    case 'doc.remove_item':
      return `removed "${(detail.itemText as string) || 'item'}"`;
    case 'doc.comment':
      return `commented: "${(detail.text as string) || '...'}"`;
    default:
      // For social.* or unknown events, use detail.description if available
      if (detail.description) return String(detail.description);
      return eventType;
  }
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function modeLabel(mode: Participant['mode']): string {
  switch (mode) {
    case 'editor': return 'editing';
    case 'reviewer': return 'reviewing';
    case 'reader': return 'reading';
    default: return 'online';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActivityFeed({ events, participants }: ActivityFeedProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={containerStyle}>
      <div style={headerStyle} onClick={() => setCollapsed(v => !v)}>
        <span>Activity {events.length > 0 && `(${events.length})`}</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Active participants bar */}
          {participants.length > 0 && (
            <div style={presenceBarStyle}>
              <span style={{ fontWeight: 600 }}>Active:</span>
              {participants.map(p => (
                <span key={p.clientId} style={presenceDotStyle(p.color)}>
                  <span style={dotStyle(p.color)} />
                  {p.displayName} ({modeLabel(p.mode)})
                </span>
              ))}
            </div>
          )}

          {/* Feed entries */}
          <div style={listStyle}>
            {events.length === 0 ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                No activity yet. Actions like acknowledging tasks will appear here.
              </div>
            ) : (
              events.map(event => (
                <div key={event.id} style={entryStyle}>
                  <div style={avatarStyle(event.color || '#94a3b8')}>
                    {getInitials(event.displayName || 'Unknown')}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: '#334155' }}>{event.displayName || 'Unknown'}</span>
                    {' '}
                    <span style={{ color: '#64748b' }}>
                      {eventIcon(event.eventType)} {eventDescription(event.eventType, event.detail)}
                    </span>
                  </div>
                  <span style={timeStyle}>{formatTime(event.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
