// frontend/src/components/AppLayout.tsx
//
// Structured 2-column app layout with header, sidebar, and main content sections.
// Pure presentational component — no hook calls, all data flows in via props.
// Replaces the monolithic vertical stack in GatewayDemo.

import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import type { GatewayError } from '../types/gateway';
import type { EphemeralReaction } from '../hooks/useReactions';
import type { LogEntry } from './EventLog';
import { useRooms } from '../hooks/useRooms';
import type { RoomItem } from '../hooks/useRooms';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { useIdentityContext } from '../contexts/IdentityContext';
import { usePresenceContext } from '../contexts/PresenceContext';

import { ConnectionStatus } from './ConnectionStatus';
import { CollapsibleSidebar } from './CollapsibleSidebar';
import { ReactionsOverlay } from './ReactionsOverlay';
import { ErrorDisplay } from './ErrorDisplay';
import { ErrorPanel } from './ErrorPanel';
import { TabbedEventLog } from './TabbedEventLog';
import NewDocumentModal from './doc-editor/NewDocumentModal';
import { useDocuments } from '../hooks/useDocuments';
import { ErrorBoundary } from './ErrorBoundary';

// Lazy-loaded: only DocumentEditorPage needed for docked video persistence
const DocumentEditorPage = lazy(() => import('./doc-editor/DocumentEditorPage'));

// Outlet context — lets routed pages read/mutate the docked-video state without
// prop drilling through React Router.
export interface DockVideoContext {
  dockedVideoDocId: string | null;
  setDockedVideoDocId: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Notification {
  id: string;
  message: string;
  type: 'follow' | 'member_joined' | 'post_created' | 'mention' | 'assignment';
  timestamp: number;
  /** For mention notifications: section ID to jump to */
  sectionId?: string;
}

// ---------------------------------------------------------------------------
// NotificationBanner internal component (UXIN-04)
// ---------------------------------------------------------------------------

function NotificationBanner({ notifications, onDismiss, onClick }: {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onClick?: (notification: Notification) => void;
}) {
  if (notifications.length === 0) return null;

  const isClickable = (n: Notification) => (n.type === 'mention' || n.type === 'assignment') && !!n.sectionId;

  return (
    <div style={{
      position: 'fixed',
      top: 64,
      right: 16,
      width: 320,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {notifications.map(n => (
        <div key={n.id} style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderLeft: `3px solid ${n.type === 'mention' ? '#3b82f6' : '#646cff'}`,
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          animation: 'slideInRight 0.3s ease-out',
        }}>
          <span
            role={isClickable(n) ? 'button' : undefined}
            tabIndex={isClickable(n) ? 0 : undefined}
            onClick={isClickable(n) ? () => onClick?.(n) : undefined}
            onKeyDown={isClickable(n) ? (e) => { if (e.key === 'Enter') onClick?.(n); } : undefined}
            style={{
              fontSize: 14,
              color: '#374151',
              fontWeight: 400,
              cursor: isClickable(n) ? 'pointer' : 'default',
              textDecoration: isClickable(n) ? 'underline' : 'none',
              textDecorationColor: '#94a3b8',
            }}
          >
            {n.message}
          </span>
          <button
            onClick={() => onDismiss(n.id)}
            aria-label="Dismiss notification"
            style={{
              fontSize: 16,
              color: '#94a3b8',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 0 0 12px',
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppLayoutProps {
  // Channel routing
  currentChannel: string;
  onSwitchChannel: (channel: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;

  // Reactions overlay
  activeReactions: EphemeralReaction[];

  // Dev tools
  logEntries: LogEntry[];
  errors: GatewayError[];
  lastError: GatewayError | null;

  // Activity bus
  activityEvents: import('../hooks/useActivityBus').ActivityEvent[];
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  activityIsLive: boolean;
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppLayout({
  currentChannel,
  onSwitchChannel,
  onDisconnect,
  onReconnect,
  activeReactions,
  logEntries,
  errors,
  lastError,
  activityEvents,
  activityPublish,
  activityIsLive,
}: AppLayoutProps) {
  // Pull shared state from contexts
  const { connectionState, sendMessage, onMessage, ws, clientId, sessionToken } = useWebSocketContext();
  const { userId, displayName, userEmail, idToken, onSignOut } = useIdentityContext();
  const { presenceUsers, currentClientId, setTyping: onTyping } = usePresenceContext();
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active view from URL path
  const activeView: 'panels' | 'social' | 'dashboard' | 'doc-editor' =
    location.pathname.startsWith('/documents') ? 'doc-editor' :
    location.pathname.startsWith('/social') ? 'social' :
    location.pathname.startsWith('/dashboard') ? 'dashboard' : 'panels';

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [showDevTools, setShowDevTools] = useState(false);
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  // Video call docked to sidebar — persists across document navigation
  const [dockedVideoDocId, setDockedVideoDocId] = useState<string | null>(null);
  // Collapsible left sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const SIDEBAR_WIDTH = sidebarOpen ? 260 : 0;

  const {
    rooms,
    createRoom,
    createDM,
    createGroupRoom,
    loading: roomsLoading,
  } = useRooms({ idToken: idToken!, onMessage });

  const {
    documents,
    presence: docPresence,
    createDocument,
    deleteDocument,
  } = useDocuments({
    sendMessage,
    onMessage,
    connectionState,
  });

  // Track current social channel subscription so we can unsub on room change
  const activeSocialChannelRef = useRef<string | null>(null);

  const handleRoomSelect = (room: RoomItem) => {
    // Unsubscribe from previous social channel
    if (activeSocialChannelRef.current && activeSocialChannelRef.current !== room.channelId) {
      sendMessage({ service: 'social', action: 'unsubscribe', channelId: activeSocialChannelRef.current });
    }
    activeSocialChannelRef.current = room.channelId;
    setActiveRoomId(room.roomId);
    onSwitchChannel(room.channelId);
    sendMessage({ service: 'social', action: 'subscribe', channelId: room.channelId });
  };

  // Notification state (UXIN-04)
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const activeRoomIdRef = useRef(activeRoomId);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  // Keep a ref to rooms so the notification handler can resolve names without restacking
  const roomsRef = useRef(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  // Stable onMessage ref for notification subscription
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  // Refs for notification handler (avoids stale closure in [] deps effect)
  const displayNameRef = useRef(displayName);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Subscribe to social events + mention notifications
  useEffect(() => {
    const unregister = onMessageRef.current((msg) => {
      let message: string | null = null;
      let type: Notification['type'] | null = null;
      let sectionId: string | undefined;

      if (msg.type === 'social:member_joined') {
        const payload = msg.payload as { userId?: string; roomId?: string } | undefined;
        const roomName = roomsRef.current.find(r => r.roomId === payload?.roomId)?.name ?? 'a room';
        const who = payload?.userId?.slice(0, 8) ?? 'Someone';
        message = `${who} joined ${roomName}`;
        type = 'member_joined';
      } else if (msg.type === 'social:post') {
        const payload = msg.payload as { roomId?: string } | undefined;
        if (payload?.roomId === activeRoomIdRef.current) {
          const roomName = roomsRef.current.find(r => r.roomId === payload.roomId)?.name ?? 'this room';
          message = `New post in ${roomName}`;
          type = 'post_created';
        }
      } else if (msg.type === 'activity:event') {
        const payload = msg.payload as {
          eventType?: string;
          detail?: {
            mentionedNames?: string[];
            sectionId?: string;
            sectionTitle?: string;
            authorName?: string;
          };
          userId?: string;
        } | undefined;

        if (
          payload?.eventType === 'doc.mention' &&
          payload.userId !== userIdRef.current &&
          Array.isArray(payload.detail?.mentionedNames) &&
          payload.detail!.mentionedNames.some(
            name => name.toLowerCase() === displayNameRef.current.toLowerCase()
          )
        ) {
          const author = payload.detail!.authorName ?? 'Someone';
          const section = payload.detail!.sectionTitle ?? 'a section';
          message = `${author} mentioned you in ${section}`;
          type = 'mention';
          sectionId = payload.detail!.sectionId;
        }
      }

      // Handle item assignment notifications
      if (!message && msg.type === 'social:post') {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload) {
          const postType = payload.type as string | undefined;
          if (postType === 'section:item:created' || postType === 'section:item:updated') {
            const item = payload.item as { assignee?: string } | undefined;
            const updates = payload.updates as { assignee?: string } | undefined;
            const assignee = item?.assignee ?? updates?.assignee;

            if (assignee && assignee === userIdRef.current) {
              message = 'You were assigned an action item';
              type = 'assignment';
              sectionId = payload.sectionId as string | undefined;
            }
          }
        }
      }

      if (message && type) {
        const id = `${Date.now()}-${Math.random()}`;
        setNotifications(prev => {
          const next = [{ id, message: message!, type: type!, timestamp: Date.now(), ...(sectionId ? { sectionId } : {}) }, ...prev];
          return next.slice(0, 5);
        });
      }
    });
    return unregister;
  }, []);

  // Auto-dismiss notifications after 4 seconds
  useEffect(() => {
    if (notifications.length === 0) return;
    const oldest = notifications[notifications.length - 1];
    const age = Date.now() - oldest.timestamp;
    const delay = Math.max(0, 4000 - age);
    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(0, -1));
    }, delay);
    return () => clearTimeout(timer);
  }, [notifications]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleNotificationClick = useCallback((notification: Notification) => {
    if (notification.sectionId) {
      navigate('/documents');
      dismissNotification(notification.id);
      // Allow the doc editor view to mount before scrolling
      setTimeout(() => {
        document.getElementById(`section-${notification.sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [dismissNotification]);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f8fafc',
      }}
    >
      {/* Reactions overlay — fixed-position, sits above everything */}
      <ReactionsOverlay reactions={activeReactions} />

      {/* Notification banner — fixed-position top-right (UXIN-04) */}
      <NotificationBanner notifications={notifications} onDismiss={dismissNotification} onClick={handleNotificationClick} />

      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.5rem',
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          gap: '1rem',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        {/* Left: app title */}
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: '#0f172a',
            flexShrink: 0,
          }}
        >
          WebSocket Gateway
        </span>

        {/* Center: connection status + active room/channel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'center' }}>
          <ConnectionStatus state={connectionState} />
          <span style={{
            fontSize: '0.875rem',
            color: '#64748b',
            fontFamily: 'monospace',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '0.25rem 0.625rem',
          }}>
            {rooms.find(r => r.roomId === activeRoomId)?.name ?? currentChannel}
          </span>
        </div>

        {/* Right: dev tools + user email + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          <button
            onClick={() => setShowDevTools(v => !v)}
            style={{
              background: showDevTools ? '#f1f5f9' : 'none',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '0.25rem 0.75rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: showDevTools ? '#0f172a' : '#64748b',
              fontWeight: showDevTools ? 600 : 400,
            }}
          >
            Dev Tools
          </button>
          {userEmail && (
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
              {userEmail}
            </span>
          )}
          <button
            onClick={onSignOut}
            style={{
              background: 'none',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '0.25rem 0.75rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: '#374151',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Body — sidebar + main */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 53px)' }}>

        {/* Sidebar toggle button — visible when sidebar is collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              position: 'fixed', top: 60, left: 8, zIndex: 41,
              width: 28, height: 28, borderRadius: 6,
              border: '1px solid #e2e8f0', background: '#fff',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, color: '#64748b',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
            title="Open sidebar"
          >{'\u2630'}</button>
        )}

        {/* Sidebar */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            padding: '1rem',
            borderRight: '1px solid #e2e8f0',
            background: '#ffffff',
            display: sidebarOpen ? 'flex' : 'none',
            flexDirection: 'column',
            position: 'fixed',
            top: 53,
            left: 0,
            bottom: 0,
            overflowY: 'auto',
            zIndex: 40,
            boxSizing: 'border-box',
          }}
        >
          {/* Collapse button */}
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 22, height: 22, borderRadius: 4,
              border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 14, color: '#94a3b8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Collapse sidebar"
          >{'\u2715'}</button>
          <CollapsibleSidebar
            connectionState={connectionState}
            onDisconnect={onDisconnect}
            onReconnect={onReconnect}
            presenceUsers={presenceUsers}
            currentClientId={currentClientId}
            currentChannel={currentChannel}
            activityEvents={activityEvents}
            userId={userId}
            documents={documents}
            onOpenDocument={(id: string) => {
              navigate(`/documents/${id}`);
            }}
            videoSlot={dockedVideoDocId ? <div id="sidebar-video-slot" /> : undefined}
          />
        </div>

        {/* Main content — offset by fixed sidebar width */}
        <div
          style={{
            marginLeft: SIDEBAR_WIDTH,
            width: `calc(100% - ${SIDEBAR_WIDTH}px)`,
            padding: '1.5rem 2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            minHeight: 0,
            background: '#f8fafc',
            position: 'relative',
            zIndex: 1,
          }}
        >

          {/* View switcher tabs */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            marginBottom: '0.5rem',
            position: 'sticky',
            top: 53,
            background: '#f8fafc',
            zIndex: 33,
          }}>
            {([
              ['/previews', 'panels', 'Previews'],
              ['/social', 'social', 'Social'],
              ['/dashboard', 'dashboard', 'Live Activity'],
              ['/documents', 'doc-editor', 'Documents'],
            ] as const).map(([path, view, label]) => (
              <button
                key={view}
                onClick={() => navigate(path)}
                style={{
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderBottom: activeView === view ? '2px solid #646cff' : '2px solid transparent',
                  background: 'none',
                  color: activeView === view ? '#0f172a' : '#64748b',
                  fontWeight: activeView === view ? 600 : 400,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
            {/* New Document button — shown in toolbar when on Documents tab */}
            {activeView === 'doc-editor' && location.pathname === '/documents' && (
              <button
                onClick={() => setShowNewDocModal(true)}
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 6,
                  background: '#3b82f6',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                + New Document
              </button>
            )}
          </div>

          {/* Route content — rendered by React Router */}
          <ErrorBoundary name="RouteContent">
            <Suspense fallback={<div>Loading...</div>}>
              <Outlet context={{ dockedVideoDocId, setDockedVideoDocId } satisfies DockVideoContext} />
            </Suspense>
          </ErrorBoundary>

          {/* Docked-video document — stays mounted across navigation to preserve IVS connection.
              Only rendered when user is NOT on the docked doc's route; otherwise the primary
              Outlet owns that doc's mount (avoids double-mount / conflicting portals). */}
          {dockedVideoDocId && location.pathname !== `/documents/${dockedVideoDocId}` && (
            <ErrorBoundary name="DockedVideoEditor">
              <Suspense fallback={<div>Loading...</div>}>
              <div style={{ display: 'none' }}>
                <DocumentEditorPage
                  documentId={dockedVideoDocId}
                  ws={ws}
                  userId={userId}
                  displayName={displayName}
                  onMessage={onMessage}
                  activityPublish={activityPublish}
                  activityEvents={activityEvents}
                  onBack={() => navigate('/documents')}
                  isVideoDocked
                  onDockVideo={() => setDockedVideoDocId(dockedVideoDocId)}
                  onUndockVideo={() => setDockedVideoDocId(null)}
                />
              </div>
              </Suspense>
            </ErrorBoundary>
          )}

        </div>
      </div>

      {/* Dev Tools slide-out panel */}
      {showDevTools && (
        <div style={{
          position: 'fixed',
          top: 53,
          right: 0,
          bottom: 0,
          width: 480,
          background: '#ffffff',
          borderLeft: '1px solid #e2e8f0',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid #e2e8f0',
          }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
              Dev Tools
            </span>
            <button
              onClick={() => setShowDevTools(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.25rem',
                color: '#94a3b8',
                lineHeight: 1,
                padding: '0 4px',
              }}
            >
              x
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
            <ErrorDisplay error={lastError} />
            <ErrorPanel errors={errors} />
            <TabbedEventLog entries={logEntries} />
            <div
              style={{
                fontSize: '0.75rem',
                color: '#94a3b8',
                fontFamily: 'monospace',
                marginTop: '0.5rem',
              }}
            >
              clientId: {clientId ?? '—'} | sessionToken: {sessionToken ? sessionToken.slice(0, 8) + '…' : '—'}
            </div>
          </div>
        </div>
      )}

      {/* New document modal — triggered from toolbar button */}
      <NewDocumentModal
        open={showNewDocModal}
        onClose={() => setShowNewDocModal(false)}
        onCreate={(meta) => {
          createDocument(meta);
          setShowNewDocModal(false);
        }}
      />
    </div>
  );
}
