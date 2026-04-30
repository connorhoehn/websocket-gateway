// frontend/src/app/App.tsx
import { useRef, useState, useCallback, useEffect, lazy } from 'react';
import { Routes, Route, Navigate, useParams, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { DockVideoContext } from '../components/AppLayout';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePresence } from '../hooks/usePresence';
import { useCursors } from '../hooks/useCursors';
import { useCRDT } from '../hooks/useCRDT';
import { useChat } from '../hooks/useChat';
import { useReactions } from '../hooks/useReactions';
import { useActivityBus } from '../hooks/useActivityBus';
import { getGatewayConfig } from '../config/gateway';
import { LoginForm } from '../components/LoginForm';
import { SignupForm } from '../components/SignupForm';
import { AppLayout } from '../components/AppLayout';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import { IdentityProvider } from '../contexts/IdentityContext';
import { PresenceProvider } from '../contexts/PresenceContext';
import { ToastProvider } from '../components/shared/ToastProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useDocuments } from '../hooks/useDocuments';
import { useRooms } from '../hooks/useRooms';
import type { RoomItem } from '../hooks/useRooms';
import type { LogEntry } from '../components/EventLog';
import type { ConnectionState, GatewayMessage, GatewayError } from '../types/gateway';
import type { UseAuthReturn } from '../hooks/useAuth';

// Register custom (user-defined) field types from localStorage into the renderer registry.
// Must run after the built-in renderer barrel so base types are already registered.
import '../renderers';
import { registerCustomFieldTypes } from '../hooks/useCustomFieldTypes';
registerCustomFieldTypes();

// Dev-only: expose a pipeline demo data seeder on `window.__pipelineDemo` so
// developers can populate sample pipelines + run history from the browser
// console without leaving the app. Stripped from production builds via the
// `import.meta.env.DEV` gate (Vite sets this to `false` for `npm run build`).
if (import.meta.env.DEV) {
  void import('../components/pipelines/persistence/seedDemoData').then((mod) => {
    type DemoApi = {
      seed: typeof mod.seedDemoData;
      clear: typeof mod.clearDemoData;
    };
    (window as unknown as { __pipelineDemo?: DemoApi }).__pipelineDemo = {
      seed: mod.seedDemoData,
      clear: mod.clearDemoData,
    };
    // eslint-disable-next-line no-console
    console.info(
      '[pipelineDemo] window.__pipelineDemo.seed() / .clear() available',
    );
  });
}

// Lazy-loaded views
const PanelsView = lazy(() => import('../components/PanelsView'));
const SocialTabContent = lazy(() => import('../components/SocialTabContent'));
const BigBrotherPanel = lazy(() => import('../components/BigBrotherPanel').then(m => ({ default: m.BigBrotherPanel })));
const DocumentEditorPage = lazy(() => import('../components/doc-editor/DocumentEditorPage'));
const DocumentListPage = lazy(() => import('../components/doc-editor/DocumentListPage'));
const DocumentTypesPage = lazy(() => import('../components/doc-types/DocumentTypesPage').then(m => ({ default: m.DocumentTypesPage })));
const FieldTypesPage = lazy(() => import('../components/field-types/FieldTypesPage'));
const PipelinesPage = lazy(() => import('../components/pipelines/PipelinesPage'));
const PipelineEditorPage = lazy(() => import('../components/pipelines/PipelineEditorPage'));
const PipelineRunReplayPage = lazy(() => import('../components/pipelines/PipelineRunReplayPage'));
const PipelineRunComparePage = lazy(() => import('../components/pipelines/PipelineRunComparePage'));
const PipelineRunsPage = lazy(() => import('../components/pipelines/PipelineRunsPage'));
const PipelineStatsPage = lazy(() => import('../components/pipelines/PipelineStatsPage'));
const PendingApprovalsPage = lazy(() => import('../components/pipelines/PendingApprovalsPage'));
const ObservabilityLayout = lazy(() => import('../components/observability/ObservabilityLayout'));
const DashboardPage = lazy(() => import('../components/observability/DashboardPage'));
const NodesPage = lazy(() => import('../components/observability/NodesPage'));
const EventsPage = lazy(() => import('../components/observability/EventsPage'));
const MetricsPage = lazy(() => import('../components/observability/MetricsPage'));

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
        const last = typeof payload.family_name === 'string' ? ` ${payload.family_name}` : '';
        return `${payload.given_name}${last}`;
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

  const wsReturn = useWebSocket({
    config,
    onMessage: (msg) => {
      featureHandlers.current.forEach((h) => {
        try { h(msg); } catch (err) { console.error('[message-bus] Handler error:', err); }
      });

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
  } = wsReturn;

  // Track lastError from useWebSocket in the errors state.
  // Use a state variable (not a ref) to detect changes during render, avoiding
  // both react-hooks/set-state-in-effect and react-hooks/refs violations.
  const [prevLastError, setPrevLastError] = useState<GatewayError | null>(null);
  if (lastError && lastError !== prevLastError) {
    setPrevLastError(lastError);
    setErrors((prev) => [lastError, ...prev]);
  }

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
  const onMessage = useCallback((handler: (msg: GatewayMessage) => void) => {
    featureHandlers.current.push(handler);
    return () => {
      featureHandlers.current = featureHandlers.current.filter((h) => h !== handler);
    };
  }, []);

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
    localCursor,
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

  const activityBus = useActivityBus({
    sendMessage: loggedSendMessage,
    onMessage,
    connectionState,
    userId: clientId ?? 'anonymous',
    displayName,
  });

  // Shared props for AppLayout (the layout route)
  const layoutProps = {
    currentChannel,
    onSwitchChannel: switchChannel,
    onDisconnect: disconnect,
    onReconnect: reconnect,
    activeReactions,
    logEntries,
    errors,
    lastError,
    activityEvents: activityBus.events,
    activityPublish: activityBus.publish,
    activityIsLive: activityBus.isLive,
  };

  return (
    <WebSocketProvider value={{
      connectionState,
      sendMessage: loggedSendMessage,
      onMessage,
      ws: wsReturn,
      clientId,
      sessionToken,
    }}>
      <IdentityProvider value={{
        userId: clientId ?? 'anonymous',
        displayName,
        userEmail: auth.email,
        idToken: auth.idToken,
        onSignOut: auth.signOut,
      }}>
        <PresenceProvider value={{
          presenceUsers,
          currentClientId: clientId,
          setTyping,
        }}>
          <ToastProvider>
          <Routes>
            <Route element={<AppLayout {...layoutProps} />}>
              <Route path="/previews" element={
                <ErrorBoundary name="PanelsView">
                  <PanelsView
                    connectionState={connectionState}
                    onReact={react}
                    chatMessages={chatMessages}
                    onChatSend={sendChat}
                    cursors={cursors}
                    localCursor={localCursor}
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
                    onTyping={setTyping}
                    typingUsers={presenceUsers
                      .filter(u => u.metadata.isTyping === true && u.clientId !== clientId)
                      .map(u => (u.metadata.displayName as string | undefined) ?? u.clientId.slice(0, 8))}
                    idToken={auth.idToken}
                    sendMessage={loggedSendMessage}
                    onMessage={onMessage}
                  />
                </ErrorBoundary>
              } />
              <Route path="/social" element={
                <ErrorBoundary name="SocialPanels">
                  <SocialRoute
                    userId={clientId ?? 'anonymous'}
                    displayName={displayName}
                    userEmail={auth.email}
                    connectionState={connectionState}
                    idToken={auth.idToken}
                    activityEvents={activityBus.events}
                    onMessage={onMessage}
                    sendMessage={loggedSendMessage}
                    onSwitchChannel={switchChannel}
                  />
                </ErrorBoundary>
              } />
              <Route path="/dashboard" element={
                <BigBrotherPanel
                  rooms={[]}
                  presenceUsers={presenceUsers}
                  activityEvents={activityBus.events}
                  activityIsLive={activityBus.isLive}
                />
              } />
              <Route path="/documents" element={
                <DocumentListRoute
                  sendMessage={loggedSendMessage}
                  onMessage={onMessage}
                  connectionState={connectionState}
                />
              } />
              <Route path="/documents/:documentId" element={
                <ErrorBoundary name="DocumentEditor">
                  <DocumentEditorRoute
                    ws={wsReturn}
                    userId={clientId ?? 'anonymous'}
                    displayName={displayName}
                    onMessage={onMessage}
                    activityPublish={activityBus.publish}
                    activityEvents={activityBus.events}
                  />
                </ErrorBoundary>
              } />
              <Route path="/document-types" element={
                <ErrorBoundary name="DocumentTypes">
                  <DocumentTypesPage idToken={auth.idToken} />
                </ErrorBoundary>
              } />
              <Route path="/field-types" element={
                <ErrorBoundary name="FieldTypes">
                  <FieldTypesPage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines" element={
                <ErrorBoundary name="Pipelines">
                  <PipelinesPage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines/approvals" element={
                <ErrorBoundary name="PendingApprovals">
                  <PendingApprovalsPage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines/:pipelineId" element={
                <ErrorBoundary name="PipelineEditor">
                  <PipelineEditorPage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines/:pipelineId/runs" element={
                <ErrorBoundary name="PipelineRunsList">
                  <PipelineRunsPage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines/:pipelineId/stats" element={
                <ErrorBoundary name="PipelineStats">
                  <PipelineStatsPage />
                </ErrorBoundary>
              } />
              {/*
                Static `compare` segment must come BEFORE the dynamic `:runId`
                so it isn't shadowed by the catch-all run replay route.
              */}
              <Route path="/pipelines/:pipelineId/runs/compare/:runIdA/:runIdB" element={
                <ErrorBoundary name="PipelineRunCompare">
                  <PipelineRunComparePage />
                </ErrorBoundary>
              } />
              <Route path="/pipelines/:pipelineId/runs/:runId" element={
                <ErrorBoundary name="PipelineReplay">
                  <PipelineRunReplayPage />
                </ErrorBoundary>
              } />
              <Route path="/observability" element={
                <ErrorBoundary name="Observability">
                  <ObservabilityLayout />
                </ErrorBoundary>
              }>
                <Route index element={<DashboardPage />} />
                {/*
                  Alias: `/observability/dashboard` is a common guess for the
                  dashboard URL. Keep the canonical path at `/observability`
                  (the index route) and redirect the alias there instead of
                  letting the catch-all bounce users to `/previews`.
                */}
                <Route path="dashboard" element={<Navigate to="/observability" replace />} />
                <Route path="nodes" element={<NodesPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="metrics" element={<MetricsPage />} />
              </Route>
              <Route index element={<Navigate to="/previews" replace />} />
              <Route path="*" element={<Navigate to="/previews" replace />} />
            </Route>
          </Routes>
          </ToastProvider>
        </PresenceProvider>
      </IdentityProvider>
    </WebSocketProvider>
  );
}

// ---------------------------------------------------------------------------
// Route wrapper components — read URL params and provide view-specific props
// ---------------------------------------------------------------------------

function SocialRoute(props: {
  userId: string;
  displayName: string;
  userEmail: string | null;
  connectionState: string;
  idToken: string | null;
  activityEvents: import('../hooks/useActivityBus').ActivityEvent[];
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  sendMessage: (msg: Record<string, unknown>) => void;
  onSwitchChannel: (channel: string) => void;
}) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const {
    rooms,
    createRoom,
    createDM,
    createGroupRoom,
    loading: roomsLoading,
    error: roomsError,
    retry: roomsRetry,
  } = useRooms({
    idToken: props.idToken!,
    onMessage: props.onMessage,
  });

  const handleRoomSelect = useCallback((room: RoomItem) => {
    setActiveRoomId(room.roomId);
    props.onSwitchChannel(room.channelId);
    props.sendMessage({ service: 'social', action: 'subscribe', channelId: room.channelId });
  }, [props.onSwitchChannel, props.sendMessage]);

  return (
    <SocialTabContent
      userId={props.userId}
      displayName={props.displayName}
      userEmail={props.userEmail ?? ''}
      connectionState={props.connectionState}
      idToken={props.idToken}
      rooms={rooms}
      createRoom={createRoom}
      createDM={createDM}
      createGroupRoom={createGroupRoom}
      roomsLoading={roomsLoading}
      roomsError={roomsError}
      onRoomsRetry={roomsRetry}
      handleRoomSelect={handleRoomSelect}
      activeRoomId={activeRoomId}
      activityEvents={props.activityEvents}
      onMessage={props.onMessage}
    />
  );
}

function DocumentListRoute(props: {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: ConnectionState;
}) {
  const navigate = useNavigate();
  const { documents, presence: docPresence, createDocument, deleteDocument } = useDocuments({
    sendMessage: props.sendMessage,
    onMessage: props.onMessage,
    connectionState: props.connectionState,
  });

  return (
    <DocumentListPage
      documents={documents}
      presence={docPresence}
      hideHeader
      onOpenDocument={(id: string) => {
        const doc = documents.find(d => d.id === id);
        const typeParam = doc?.type ? `?type=${encodeURIComponent(doc.type)}` : '';
        navigate(`/documents/${id}${typeParam}`);
      }}
      onCreateDocument={createDocument}
      onDeleteDocument={deleteDocument}
      onJumpToUser={(docId: string) => navigate(`/documents/${docId}`)}
    />
  );
}

function DocumentEditorRoute(props: {
  ws: ReturnType<typeof useWebSocket>;
  userId: string;
  displayName: string;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  activityEvents: import('../hooks/useActivityBus').ActivityEvent[];
}) {
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { dockedVideoDocId, setDockedVideoDocId } = useOutletContext<DockVideoContext>();

  const documentType = searchParams.get('type') ?? undefined;

  if (!documentId) return <Navigate to="/documents" replace />;

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <DocumentEditorPage
        documentId={documentId}
        documentType={documentType}
        ws={props.ws}
        userId={props.userId}
        displayName={props.displayName}
        onMessage={props.onMessage}
        activityPublish={props.activityPublish}
        activityEvents={props.activityEvents}
        onBack={() => navigate('/documents')}
        isVideoDocked={dockedVideoDocId === documentId}
        onDockVideo={() => setDockedVideoDocId(documentId)}
        onUndockVideo={() => setDockedVideoDocId(null)}
      />
    </div>
  );
}
