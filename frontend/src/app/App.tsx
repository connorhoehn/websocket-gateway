// frontend/src/app/App.tsx
import { useRef, useState, useCallback, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePresence } from '../hooks/usePresence';
import { useCursors } from '../hooks/useCursors';
import { useCRDT } from '../hooks/useCRDT';
import { useChat } from '../hooks/useChat';
import { useReactions } from '../hooks/useReactions';
import { getGatewayConfig } from '../config/gateway';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorDisplay } from '../components/ErrorDisplay';
import { ChannelSelector } from '../components/ChannelSelector';
import { PresencePanel } from '../components/PresencePanel';
import { CursorCanvas } from '../components/CursorCanvas';
import { TableCursorGrid } from '../components/TableCursorGrid';
import { TextCursorEditor } from '../components/TextCursorEditor';
import { CanvasCursorBoard } from '../components/CanvasCursorBoard';
import { CursorModeSelector } from '../components/CursorModeSelector';
import { SharedTextEditor } from '../components/SharedTextEditor';
import { ReactionsOverlay } from '../components/ReactionsOverlay';
import { ReactionButtons } from '../components/ReactionButtons';
import { EventLog } from '../components/EventLog';
import { ErrorPanel } from '../components/ErrorPanel';
import type { LogEntry } from '../components/EventLog';
import type { TextSelectionData } from '../hooks/useCursors';
import type { GatewayMessage, GatewayError } from '../types/gateway';

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
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [errors, setErrors] = useState<GatewayError[]>([]);

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

      // Log received message to EventLog
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        direction: 'received',
        message: msg,
        timestamp: new Date().toISOString(),
      };
      setLogEntries((prev) => [...prev, entry].slice(-200));

      // Accumulate errors from error messages
      if (msg.type === 'error' && msg.error) {
        const err = msg.error as GatewayError;
        setErrors((prev) => [err, ...prev]);
      }
    },
  });

  // Track lastError from useWebSocket in the errors state
  useEffect(() => {
    if (lastError) {
      setErrors((prev) => [lastError, ...prev]);
    }
  }, [lastError]);

  // Logged send wrapper: logs outbound messages to EventLog before forwarding
  const loggedSendMessage = useCallback((msg: Record<string, unknown>) => {
    sendMessage(msg);
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      direction: 'sent',
      message: msg,
      timestamp: new Date().toISOString(),
    };
    setLogEntries((prev) => [...prev, entry].slice(-200));
  }, [sendMessage]);

  // Stable onMessage registrar passed to feature hooks.
  // Push handler on register; filter it out on unregister.
  const onMessage = (handler: (msg: GatewayMessage) => void) => {
    featureHandlers.current.push(handler);
    return () => {
      featureHandlers.current = featureHandlers.current.filter((h) => h !== handler);
    };
  };

  const { users: presenceUsers } = usePresence({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  const {
    cursors,
    activeMode,
    sendFreeformUpdate,
    sendTableUpdate,
    sendTextUpdate,
    sendCanvasUpdate,
    switchMode,
  } = useCursors({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
    clientId,
  });

  const { content, applyLocalEdit } = useCRDT({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  const { messages: chatMessages, send: sendChat } = useChat({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  const { activeReactions, react } = useReactions({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  // Suppress unused variable warnings for chatMessages/sendChat
  void chatMessages;
  void sendChat;

  return (
    <div style={{ fontFamily: 'monospace', padding: '1.5rem', maxWidth: '800px' }}>
      <h1 style={{ marginBottom: '1rem' }}>WebSocket Gateway Dev Client</h1>

      {/* Reactions overlay — fixed position, sits above everything */}
      <ReactionsOverlay reactions={activeReactions} />

      {/* Connection status row */}
      <div style={{ marginBottom: '0.75rem' }}>
        <ConnectionStatus state={connectionState} />
      </div>

      {/* Error display (single last error — legacy quick-view) */}
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

      {/* Cursor section — mode selector + active panel */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem' }}>Cursors</h3>
        <CursorModeSelector activeMode={activeMode} onModeChange={switchMode} />

        {activeMode === 'freeform' && (
          <CursorCanvas cursors={cursors} onMouseMove={sendFreeformUpdate} />
        )}
        {activeMode === 'table' && (
          <TableCursorGrid cursors={cursors} onCellClick={sendTableUpdate} />
        )}
        {activeMode === 'text' && (
          <TextCursorEditor
            cursors={cursors}
            onPositionChange={(position: number, selectionData: TextSelectionData | null, hasSelection: boolean) =>
              sendTextUpdate(position, selectionData, hasSelection)
            }
          />
        )}
        {activeMode === 'canvas' && (
          <CanvasCursorBoard cursors={cursors} onMouseMove={sendCanvasUpdate} />
        )}
      </div>

      {/* CRDT shared document */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
        <SharedTextEditor
          content={content}
          applyLocalEdit={applyLocalEdit}
          disabled={connectionState !== 'connected'}
        />
      </div>

      {/* Reactions */}
      <div style={{ margin: '1rem 0' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Reactions</h3>
        <ReactionButtons onReact={react} disabled={connectionState !== 'connected'} />
      </div>

      {/* Dev Tools */}
      <ErrorPanel errors={errors} />
      <EventLog entries={logEntries} />
    </div>
  );
}
