// frontend/src/app/App.tsx
import { useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePresence } from '../hooks/usePresence';
import { useCursors } from '../hooks/useCursors';
import { getGatewayConfig } from '../config/gateway';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorDisplay } from '../components/ErrorDisplay';
import { ChannelSelector } from '../components/ChannelSelector';
import { PresencePanel } from '../components/PresencePanel';
import { CursorCanvas } from '../components/CursorCanvas';
import { TableCursorGrid } from '../components/TableCursorGrid';
import { TextCursorEditor } from '../components/TextCursorEditor';
import type { TextSelectionData } from '../hooks/useCursors';
import type { GatewayMessage } from '../types/gateway';

export function App() {
  // getGatewayConfig() throws a descriptive error if .env is not set up.
  // Wrap in try/catch to show setup instructions instead of a white screen.
  let config;
  try {
    config = getGatewayConfig();
  } catch (err) {
    return (
      <div style={{ fontFamily: 'monospace', padding: '2rem', color: '#dc2626' }}>
        <h2>Setup Required</h2>
        <pre style={{ background: '#fef2f2', padding: '1rem', borderRadius: '4px' }}>
          {err instanceof Error ? err.message : String(err)}
        </pre>
        <p>Copy <code>frontend/.env.example</code> to <code>frontend/.env</code> and fill in your values.</p>
      </div>
    );
  }

  return <GatewayDemo config={config} />;
}

function GatewayDemo({ config }: { config: ReturnType<typeof getGatewayConfig> }) {
  const [messages, setMessages] = useState<GatewayMessage[]>([]);

  // Feature hook message handler registry.
  // Each feature hook registers/unregisters its own handler via the onMessage
  // prop passed below. All registered handlers are called for every incoming
  // message, then the raw message is appended to the dev log.
  const featureHandlers = useRef<Array<(msg: GatewayMessage) => void>>([]);

  const {
    connectionState,
    lastError,
    currentChannel,
    clientId,
    sessionToken,
    switchChannel,
    sendMessage,
  } = useWebSocket({
    config,
    onMessage: (msg) => {
      featureHandlers.current.forEach((h) => h(msg));
      setMessages((prev) => [msg, ...prev].slice(0, 50));
    },
  });

  // Stable onMessage registrar passed to feature hooks.
  // Push handler on register; filter it out on unregister.
  const onMessage = (handler: (msg: GatewayMessage) => void) => {
    featureHandlers.current.push(handler);
    return () => {
      featureHandlers.current = featureHandlers.current.filter((h) => h !== handler);
    };
  };

  const { users: presenceUsers } = usePresence({
    sendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  const { cursors, sendFreeformUpdate, sendTableUpdate, sendTextUpdate } = useCursors({
    sendMessage,
    onMessage,
    currentChannel,
    connectionState,
    clientId,
  });

  return (
    <div style={{ fontFamily: 'monospace', padding: '1.5rem', maxWidth: '800px' }}>
      <h1 style={{ marginBottom: '1rem' }}>WebSocket Gateway Dev Client</h1>

      {/* Connection status row */}
      <div style={{ marginBottom: '0.75rem' }}>
        <ConnectionStatus state={connectionState} />
      </div>

      {/* Error display */}
      <ErrorDisplay error={lastError} />

      {/* Channel selector */}
      <div style={{ margin: '1rem 0' }}>
        <ChannelSelector currentChannel={currentChannel} onSwitch={switchChannel} />
      </div>

      {/* Debug info */}
      <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '1rem' }}>
        <div>clientId: {clientId ?? '—'}</div>
        <div>sessionToken: {sessionToken ? sessionToken.slice(0, 8) + '…' : '—'}</div>
      </div>

      {/* Presence panel */}
      <div style={{ margin: '1rem 0' }}>
        <PresencePanel users={presenceUsers} currentClientId={clientId} />
      </div>

      {/* Freeform Cursors */}
      <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.875rem' }}>Freeform Cursors</h3>
      <CursorCanvas cursors={cursors} onMouseMove={sendFreeformUpdate} />

      {/* Table Cursors */}
      <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.875rem' }}>Table Cursors</h3>
      <TableCursorGrid
        cursors={cursors}
        onCellClick={sendTableUpdate}
      />

      {/* Text Cursors */}
      <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.875rem' }}>Text Cursors</h3>
      <TextCursorEditor
        cursors={cursors}
        onPositionChange={(position: number, selectionData: TextSelectionData | null, hasSelection: boolean) =>
          sendTextUpdate(position, selectionData, hasSelection)
        }
      />

      {/* Live message log */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Recent Messages</h3>
        {messages.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No messages yet.</p>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {messages.map((msg, i) => (
              <pre
                key={i}
                style={{
                  background: '#f9fafb',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  marginBottom: '0.25rem',
                  fontSize: '0.75rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(msg, null, 2)}
              </pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
