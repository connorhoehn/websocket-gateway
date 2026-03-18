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
import { AppLayout } from '../components/AppLayout';
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

  // AUTH-09: When cognitoToken changes (silent refresh), reconnect so the
  // gateway receives the updated JWT. prevTokenRef skips the initial mount.
  const prevTokenRef = useRef(config.cognitoToken);
  useEffect(() => {
    if (prevTokenRef.current !== config.cognitoToken && connectionState === 'connected') {
      prevTokenRef.current = config.cognitoToken;
      reconnect();
    } else {
      prevTokenRef.current = config.cognitoToken;
    }
  }, [config.cognitoToken, connectionState, reconnect]);

  const { users: presenceUsers, setTyping } = usePresence({
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

  const { content, applyLocalEdit, hasConflict, dismissConflict } = useCRDT({
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
    <AppLayout
      connectionState={connectionState}
      currentChannel={currentChannel}
      onSwitchChannel={switchChannel}
      onDisconnect={disconnect}
      onReconnect={reconnect}
      userEmail={auth.email}
      onSignOut={auth.signOut}
      presenceUsers={presenceUsers}
      currentClientId={clientId}
      activeReactions={activeReactions}
      onReact={react}
      chatMessages={chatMessages}
      onChatSend={sendChat}
      onTyping={setTyping}
      cursors={cursors}
      activeMode={activeMode}
      onModeChange={switchMode}
      onFreeformMove={sendFreeformUpdate}
      onTableClick={sendTableUpdate}
      onTextChange={sendTextUpdate}
      onCanvasMove={sendCanvasUpdate}
      crdtContent={content}
      applyLocalEdit={applyLocalEdit}
      hasConflict={hasConflict}
      onDismissConflict={dismissConflict}
      logEntries={logEntries}
      errors={errors}
      lastError={lastError}
      clientId={clientId}
      sessionToken={sessionToken}
      idToken={auth.idToken}
      onMessage={onMessage}
      sendMessage={loggedSendMessage}
    />
  );
}
