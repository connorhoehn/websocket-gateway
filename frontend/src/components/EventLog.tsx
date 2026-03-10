// frontend/src/components/EventLog.tsx
//
// EventLog — dev tool component that renders a timestamped, scrollable list
// of WebSocket messages sent and received. Useful for inspecting gateway
// traffic in real time during development.
//
// Auto-scrolls to the bottom when new entries are added.
// Entries are pre-capped at 200 by the parent (App.tsx).

import { useRef, useEffect } from 'react';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LogEntry {
  id: string;                                          // unique — Date.now() + Math.random()
  direction: 'sent' | 'received';
  message: GatewayMessage | Record<string, unknown>;
  timestamp: string;                                   // ISO string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  entries: LogEntry[];   // capped at 200 by App.tsx before passing
}

export function EventLog({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
        Event Log{' '}
        <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>({entries.length})</span>
      </h3>

      {entries.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No events yet.</p>
      ) : (
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                background: '#f9fafb',
                borderRadius: '4px',
                marginBottom: '0.25rem',
                padding: '0.25rem 0.5rem',
                fontFamily: 'monospace',
              }}
            >
              {/* Direction badge + timestamp */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                {entry.direction === 'sent' ? (
                  <span
                    style={{
                      background: '#dbeafe',
                      color: '#1d4ed8',
                      borderRadius: '3px',
                      padding: '0 0.35rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                  >
                    [SENT]
                  </span>
                ) : (
                  <span
                    style={{
                      background: '#dcfce7',
                      color: '#15803d',
                      borderRadius: '3px',
                      padding: '0 0.35rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                  >
                    [RECV]
                  </span>
                )}
                <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* JSON payload */}
              <pre
                style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: '80px',
                  overflowY: 'auto',
                  background: 'transparent',
                }}
              >
                {JSON.stringify(entry.message, null, 2)}
              </pre>
            </div>
          ))}

          {/* Sentinel for auto-scroll */}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
