// frontend/src/components/TabbedEventLog.tsx
//
// TabbedEventLog — dev tool component that separates real-time WebSocket events
// by service type (Chat, Presence, Cursors, Reactions, System), allowing developers
// to inspect each service's traffic independently without noise from other services.
//
// Auto-scrolls to the bottom when new entries are added to the active tab.
// Entries are pre-capped at 200 by the parent (App.tsx).

import { useState, useRef, useEffect } from 'react';
import type { LogEntry } from './EventLog';

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type Tab = 'Chat' | 'Presence' | 'Cursors' | 'Reactions' | 'System';

// ---------------------------------------------------------------------------
// Helper: Filter entries by tab service type
// ---------------------------------------------------------------------------

function getTabEntries(entries: LogEntry[], tab: Tab): LogEntry[] {
  return entries.filter((entry) => {
    const type = entry.message.type;

    if (!type) {
      // Messages without a type go to System
      return tab === 'System';
    }

    switch (tab) {
      case 'Chat':
        // Chat: type starts with 'chat:' (captures 'chat:history', 'chat:message')
        return typeof type === 'string' && type.startsWith('chat:');

      case 'Presence':
        // Presence: exact match on 'presence'
        return type === 'presence';

      case 'Cursors':
        // Cursors: exact match on 'cursor' (action field distinguishes subscribed/update/remove)
        return type === 'cursor';

      case 'Reactions':
        // Reactions: type starts with 'reactions:' (captures 'reactions:reaction', 'reactions:subscribed')
        return typeof type === 'string' && type.startsWith('reactions:');

      case 'System':
        // System: error, session, or anything not matching the above four
        return (
          type === 'error' ||
          type === 'session' ||
          (typeof type === 'string' &&
            !type.startsWith('chat:') &&
            type !== 'presence' &&
            type !== 'cursor' &&
            !type.startsWith('reactions:'))
        );

      default:
        return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  entries: LogEntry[]; // capped at 200 by App.tsx before passing
}

export function TabbedEventLog({ entries }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Chat');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive in the active tab
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, activeTab]);

  const tabs: Tab[] = ['Chat', 'Presence', 'Cursors', 'Reactions', 'System'];

  // Get entries for the active tab
  const activeEntries = getTabEntries(entries, activeTab);

  return (
    <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
        Event Log{' '}
        <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>({entries.length})</span>
      </h3>

      {/* Tab buttons */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1rem',
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        {tabs.map((tab) => {
          const tabCount = getTabEntries(entries, tab).length;
          const isActive = tab === activeTab;

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: isActive ? '#3b82f6' : '#e5e7eb',
                color: isActive ? '#ffffff' : '#374151',
                fontWeight: isActive ? 600 : 400,
                border: 'none',
                borderRadius: 4,
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {tab} ({tabCount})
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeEntries.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No events yet.</p>
      ) : (
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {activeEntries.map((entry) => (
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
