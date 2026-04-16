// frontend/src/components/CollapsibleSidebar.tsx
//
// Collapsible sidebar with connection controls, channel/presence, activity feed,
// and recent documents. Replaces the static PresencePanel + DisconnectReconnect
// sidebar in AppLayout.

import { useState, useMemo } from 'react';
import type { ActivityEvent } from '../hooks/useActivityBus';
import type { DocumentInfo } from '../hooks/useDocuments';
import { identityToColor, identityToInitials } from '../utils/identity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceUser {
  clientId: string;
  metadata: Record<string, unknown>;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface CollapsibleSidebarProps {
  // Connection
  connectionState: ConnectionState;
  onDisconnect: () => void;
  onReconnect: () => void;

  // Channels / presence
  presenceUsers: PresenceUser[];
  currentClientId: string;
  currentChannel: string;

  // Activity
  activityEvents: ActivityEvent[];
  userId: string;

  // Documents
  documents: DocumentInfo[];
  onOpenDocument: (id: string) => void;

  // Docked video panel slot (rendered between Activity and Documents)
  videoSlot?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Keyframes (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = '__collapsible-sidebar-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes fadeSlideIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes mentionPulse {
      0%   { background-color: rgba(59,130,246,0.18); }
      50%  { background-color: rgba(59,130,246,0.08); }
      100% { background-color: rgba(59,130,246,0.18); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function eventIcon(eventType: string): string {
  if (eventType.includes('cursor')) return '\u25CE';     // cursor
  if (eventType.includes('chat')) return '\u2709';       // envelope
  if (eventType.includes('reaction')) return '\u2764';   // heart
  if (eventType.includes('join')) return '\u2192';        // arrow
  if (eventType.includes('leave')) return '\u2190';       // arrow
  if (eventType.includes('doc') || eventType.includes('edit')) return '\u270E'; // pencil
  if (eventType.includes('mention')) return '@';
  if (eventType.includes('presence')) return '\u25CF';    // dot
  return '\u2022'; // bullet
}

function eventDescription(event: ActivityEvent): string {
  const who = event.displayName ?? event.userId?.slice(0, 8) ?? 'Someone';
  const detail = event.detail;

  if (event.eventType.includes('chat')) {
    const text = typeof detail.text === 'string' ? detail.text : '';
    return `${who}: ${text}`;
  }
  if (event.eventType.includes('join')) return `${who} joined`;
  if (event.eventType.includes('leave')) return `${who} left`;
  if (event.eventType.includes('reaction')) {
    const emoji = typeof detail.emoji === 'string' ? detail.emoji : '';
    return `${who} reacted ${emoji}`;
  }
  if (event.eventType.includes('mention')) {
    const section = typeof detail.sectionTitle === 'string' ? detail.sectionTitle : '';
    return `${who} mentioned you${section ? ` in ${section}` : ''}`;
  }
  if (event.eventType.includes('edit') || event.eventType.includes('doc')) {
    const title = typeof detail.title === 'string' ? detail.title : '';
    return `${who} edited${title ? ` ${title}` : ''}`;
  }

  return `${who}: ${event.eventType}`;
}

function isMentionEvent(event: ActivityEvent, userId: string): boolean {
  if (event.eventType.includes('mention')) return true;
  const mentioned = event.detail.mentionedUsers;
  if (Array.isArray(mentioned) && mentioned.includes(userId)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Section styles
// ---------------------------------------------------------------------------

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: '#64748b',
  margin: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  userSelect: 'none',
  padding: '8px 0',
};

const separatorStyle: React.CSSProperties = {
  borderTop: '1px solid #e2e8f0',
  margin: 0,
};

// ---------------------------------------------------------------------------
// CollapsibleSection
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultExpanded = true,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <div
        style={sectionTitleStyle}
        onClick={() => setExpanded(v => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 10,
        }}>
          {'\u25B8'}
        </span>
        {title}
      </div>
      <div style={{
        maxHeight: expanded ? 600 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.25s ease',
      }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollapsibleSidebar({
  connectionState,
  onDisconnect,
  onReconnect,
  presenceUsers,
  currentClientId,
  currentChannel,
  activityEvents,
  userId,
  documents,
  onOpenDocument,
  videoSlot,
}: CollapsibleSidebarProps) {
  ensureKeyframes();

  const isConnected = connectionState === 'connected';
  const recentEvents = useMemo(() => activityEvents.slice(0, 5), [activityEvents]);
  const recentDocs = useMemo(() => documents.slice(0, 5), [documents]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ---- Connection controls ---- */}
      <div style={{ padding: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isConnected ? '#22c55e' : '#ef4444',
          display: 'inline-block',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: isConnected ? '#16a34a' : '#dc2626',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          {isConnected ? 'Connected' : connectionState === 'connecting' || connectionState === 'reconnecting' ? 'Connecting...' : 'Disconnected'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {isConnected ? (
            <button
              onClick={onDisconnect}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                background: '#fff',
                color: '#64748b',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onReconnect}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                border: '1px solid #3b82f6',
                borderRadius: 4,
                background: '#eff6ff',
                color: '#2563eb',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      <hr style={separatorStyle} />

      {/* ---- Channels ---- */}
      <CollapsibleSection title="Channels">
        <div style={{ paddingBottom: 8 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#0f172a',
            fontFamily: 'monospace',
            marginBottom: 6,
          }}>
            # {currentChannel}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {presenceUsers.map(user => {
              const name = (user.metadata.displayName as string | undefined) ?? user.clientId.slice(0, 8);
              const isSelf = user.clientId === currentClientId;
              const color = identityToColor(
                (user.metadata.email as string | undefined) ?? user.clientId
              );
              const initials = identityToInitials(name);

              return (
                <div
                  key={user.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 0',
                    fontSize: 13,
                    color: isSelf ? '#0f172a' : '#475569',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                  }}
                >
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    flexShrink: 0,
                  }}>
                    {initials}
                  </span>
                  <span style={{ fontWeight: isSelf ? 600 : 400 }}>
                    {name}{isSelf ? ' (you)' : ''}
                  </span>
                </div>
              );
            })}
            {presenceUsers.length === 0 && (
              <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                No users online
              </span>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <hr style={separatorStyle} />

      {/* ---- Activity ---- */}
      <CollapsibleSection title="Activity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4, position: 'relative' }}>
          {/* Fade gradient overlay at bottom */}
          {recentEvents.length > 3 && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 32,
              background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,1))',
              pointerEvents: 'none',
              zIndex: 1,
            }} />
          )}
          {recentEvents.length === 0 && (
            <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
              No recent activity
            </span>
          )}
          {recentEvents.map(event => {
            const isMention = isMentionEvent(event, userId);
            return (
              <div
                key={event.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  animation: isMention
                    ? 'mentionPulse 2s ease-in-out 3, fadeSlideIn 0.3s ease-out'
                    : 'fadeSlideIn 0.3s ease-out',
                  background: isMention ? 'rgba(59,130,246,0.10)' : 'transparent',
                }}
              >
                <span style={{ flexShrink: 0, width: 16, textAlign: 'center', color: '#94a3b8' }}>
                  {eventIcon(event.eventType)}
                </span>
                <span style={{
                  flex: 1,
                  color: '#374151',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {eventDescription(event)}
                </span>
                <span style={{
                  flexShrink: 0,
                  fontSize: 10,
                  color: '#94a3b8',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {relativeTime(event.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <hr style={separatorStyle} />

      {/* ---- Documents ---- */}
      <CollapsibleSection title="Documents">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
          {recentDocs.length === 0 && (
            <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
              No documents
            </span>
          )}
          {recentDocs.map(doc => (
            <div
              key={doc.id}
              onClick={() => onOpenDocument(doc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') onOpenDocument(doc.id); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 4px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                color: '#374151',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f1f5f9'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {doc.title}
              </span>
              <span style={{
                flexShrink: 0,
                fontSize: 10,
                color: '#94a3b8',
                fontFamily: 'monospace',
                marginLeft: 8,
              }}>
                {relativeTime(doc.updatedAt ?? doc.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ---- Docked Video (bottom) ---- */}
      {videoSlot && (
        <>
          <hr style={separatorStyle} />
          <CollapsibleSection title="Video">
            {videoSlot}
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}
