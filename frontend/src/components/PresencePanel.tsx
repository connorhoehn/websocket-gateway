// frontend/src/components/PresencePanel.tsx
//
// Live user list panel — shows who is connected to the current channel,
// with colored avatar circles, initials, and typing indicators.

import type { PresenceUser } from '../hooks/usePresence';
import { identityToColor, identityToInitials } from '../utils/identity';

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
            const color = identityToColor(
              (user.metadata.email as string | undefined) ?? user.clientId
            );
            const initials = identityToInitials(
              (user.metadata.displayName as string | undefined) ?? user.clientId.slice(0, 2)
            );
            const isTyping = user.metadata.isTyping === true;
            const isYou = user.clientId === currentClientId;
            const displayLabel =
              (user.metadata.displayName as string | undefined) ??
              (user.clientId.length > 12
                ? user.clientId.slice(0, 12) + '...'
                : user.clientId);

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

                {/* Display name (or truncated clientId fallback) */}
                <span style={{ color: '#374151' }}>{displayLabel}</span>

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
