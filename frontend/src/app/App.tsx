// frontend/src/app/App.tsx
import { useRef, useState, useCallback, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePresence } from '../hooks/usePresence';
import { useCursors } from '../hooks/useCursors';
import { useCRDT } from '../hooks/useCRDT';
import { useChat } from '../hooks/useChat';
import { useReactions } from '../hooks/useReactions';
import { getGatewayConfig } from '../config/gateway';
import { LoginForm } from '../components/LoginForm';
import { SignupForm } from '../components/SignupForm';
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
import { DisconnectReconnect } from '../components/DisconnectReconnect';
import type { LogEntry } from '../components/EventLog';
import type { TextSelectionData } from '../hooks/useCursors';
import type { GatewayMessage, GatewayError } from '../types/gateway';
import type { UseAuthReturn } from '../hooks/useAuth';

// ---------------------------------------------------------------------------
// Identity helper
// ---------------------------------------------------------------------------

/**
 * Decodes the Cognito ID token to extract a human-readable display name.
 * Falls back to the email prefix, then 'anonymous' if nothing is available.
 */
function decodeDisplayName(idToken: string | null, email: string | null): string {
  if (idToken) {
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1])) as Record<string, unknown>;
      if (typeof payload.given_name === 'string' && payload.given_name) {
        return payload.given_name;
      }
    } catch { /* ignore decode errors */ }
  }
  if (email) return email.split('@')[0];
  return 'anonymous';
}

export function App() {
  const auth = useAuth();
  const [showSignup, setShowSignup] = useState(false);

  // Loading: session restore in progress
  if (auth.status === 'loading') {
    return (
      <div style={{ fontFamily: 'monospace', padding: '2rem', color: '#6b7280' }}>
        Restoring session...
      </div>
    );
  }

  // Unauthenticated: show login or signup form
  if (auth.status === 'unauthenticated') {
    return showSignup ? (
      <SignupForm
        status={auth.status}
        error={auth.error}
        onSignUp={auth.signUp}
        onSwitchToLogin={() => setShowSignup(false)}
      />
    ) : (
      <LoginForm
        status={auth.status}
        error={auth.error}
        onSignIn={auth.signIn}
        onSwitchToSignup={() => setShowSignup(true)}
      />
    );
  }

  // Authenticated: load gateway config and render demo
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

  // Override cognitoToken with the live idToken from Cognito auth.
  // auth.idToken is guaranteed non-null here (status === 'authenticated').
  const authenticatedConfig = { ...config, cognitoToken: auth.idToken! };

  return <GatewayDemo config={authenticatedConfig} auth={auth} />;
}

function GatewayDemo({
  config,
  auth,
}: {
  config: ReturnType<typeof getGatewayConfig>;
  auth: UseAuthReturn;
}) {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [errors, setErrors] = useState<GatewayError[]>([]);

  // Derive a human-readable display name from the Cognito ID token.
  // config.cognitoToken is auth.idToken (guaranteed non-null for authenticated users).
  const displayName = decodeDisplayName(config.cognitoToken ?? null, auth.email);

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
    disconnect,
    reconnect,
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
    displayName,
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
    displayName,
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
    displayName,
  });

  const { activeReactions, react } = useReactions({
    sendMessage: loggedSendMessage,
    onMessage,
    currentChannel,
    connectionState,
  });

  return (
    <div style={{ fontFamily: 'monospace', padding: '1.5rem', maxWidth: '800px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>WebSocket Gateway Dev Client</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem', fontFamily: 'monospace' }}>
          <span style={{ color: '#6b7280' }}>{auth.email}</span>
          <button
            onClick={auth.signOut}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '4px',
                     padding: '0.25rem 0.75rem', cursor: 'pointer', color: '#374151' }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Reactions overlay — fixed position, sits above everything */}
      <ReactionsOverlay reactions={activeReactions} />

      {/* Connection status row */}
      <div style={{ marginBottom: '0.75rem' }}>
        <ConnectionStatus state={connectionState} />
      </div>

      {/* Disconnect / Reconnect control */}
      <div style={{ margin: '0.5rem 0' }}>
        <DisconnectReconnect
          connectionState={connectionState}
          onDisconnect={disconnect}
          onReconnect={reconnect}
        />
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
