// frontend/src/components/PresencePanel.tsx
//
// Live user list panel — shows who is connected to the current channel,
// with colored avatar circles, initials, and typing indicators.

import type { PresenceUser } from '../hooks/usePresence';

// ---------------------------------------------------------------------------
// Color helpers (deterministic from clientId)
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
  '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
  '#1DD1A1', '#F368E0', '#3742FA', '#2F3542', '#FF3838',
];

function clientIdToColor(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function clientIdToInitials(clientId: string): string {
  return clientId.substring(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PresencePanelProps {
  users: PresenceUser[];
  currentClientId: string | null;
}

export function PresencePanel({ users, currentClientId }: PresencePanelProps) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        padding: '0.75rem',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 'bold',
          marginBottom: '0.5rem',
          color: '#374151',
        }}
      >
        Users in channel ({users.length})
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
          No other users connected
        </div>
      ) : (
        <div>
          {users.map((user) => {
            const color = clientIdToColor(user.clientId);
            const initials = clientIdToInitials(user.clientId);
            const isTyping = user.metadata.isTyping === true;
            const isYou = user.clientId === currentClientId;
            const displayId =
              user.clientId.length > 12
                ? user.clientId.slice(0, 12) + '...'
                : user.clientId;

            return (
              <div
                key={user.clientId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.25rem 0',
                  fontSize: '0.75rem',
                }}
              >
                {/* Colored avatar circle */}
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.55rem',
                    fontWeight: 'bold',
                    color: '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </div>

                {/* Client ID */}
                <span style={{ color: '#374151' }}>{displayId}</span>

                {/* "You" label */}
                {isYou && (
                  <span style={{ color: '#9ca3af' }}>(you)</span>
                )}

                {/* Typing indicator */}
                {isTyping && (
                  <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                    typing...
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
