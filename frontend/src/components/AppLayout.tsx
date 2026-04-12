// frontend/src/components/AppLayout.tsx
//
// Structured 2-column app layout with header, sidebar, and main content sections.
// Pure presentational component — no hook calls, all data flows in via props.
// Replaces the monolithic vertical stack in GatewayDemo.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ConnectionState, GatewayError, GatewayMessage } from '../types/gateway';
import type { PresenceUser } from '../hooks/usePresence';
import type { EphemeralReaction } from '../hooks/useReactions';
import type { ChatMessage } from '../hooks/useChat';
import type { CursorMode, RemoteCursor, TextSelectionData } from '../hooks/useCursors';
import type { LogEntry } from './EventLog';
import { useRooms } from '../hooks/useRooms';
import type { RoomItem } from '../hooks/useRooms';

import { ConnectionStatus } from './ConnectionStatus';
import { PresencePanel } from './PresencePanel';
import { DisconnectReconnect } from './DisconnectReconnect';
import { ReactionsOverlay } from './ReactionsOverlay';
import { ReactionButtons } from './ReactionButtons';
import { ChatPanel } from './ChatPanel';
import { CursorModeSelector } from './CursorModeSelector';
import { CursorCanvas } from './CursorCanvas';
import { TableCursorGrid } from './TableCursorGrid';
import { TextCursorEditor } from './TextCursorEditor';
import { CanvasCursorBoard } from './CanvasCursorBoard';
import { SharedTextEditor } from './SharedTextEditor';
import { ErrorDisplay } from './ErrorDisplay';
import { ErrorPanel } from './ErrorPanel';
import { TabbedEventLog } from './TabbedEventLog';
import { SocialPanel } from './SocialPanel';
import { GroupPanel } from './GroupPanel';
import { RoomList } from './RoomList';
import { PostFeed } from './PostFeed';
import { ActivityPanel } from './ActivityPanel';
import { BigBrotherPanel } from './BigBrotherPanel';
import DocumentEditorPage from './doc-editor/DocumentEditorPage';
import DocumentListPage from './doc-editor/DocumentListPage';
import NewDocumentModal from './doc-editor/NewDocumentModal';
import { useDocuments } from '../hooks/useDocuments';
import type { UseWebSocketReturn } from '../hooks/useWebSocket';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface Notification {
  id: string;
  message: string;
  type: 'follow' | 'member_joined' | 'post_created' | 'mention';
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

  const isClickable = (n: Notification) => n.type === 'mention' && !!n.sectionId;

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
  // Connection/header
  connectionState: ConnectionState;
  currentChannel: string;
  onSwitchChannel: (channel: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  userEmail: string | null;
  onSignOut: () => void;

  // Presence sidebar
  presenceUsers: PresenceUser[];
  currentClientId: string | null;

  // Reactions overlay + buttons
  activeReactions: EphemeralReaction[];
  onReact: (emoji: string) => void;

  // Chat
  chatMessages: ChatMessage[];
  onChatSend: (content: string) => void;
  onTyping?: (isTyping: boolean) => void;

  // Cursors
  cursors: Map<string, RemoteCursor>;
  localCursor: RemoteCursor | null;
  activeMode: CursorMode;
  onModeChange: (mode: CursorMode) => void;
  onFreeformMove: (x: number, y: number) => void;
  onTableClick: (row: number, col: number) => void;
  onTextChange: (position: number, selectionData: TextSelectionData | null, hasSelection: boolean) => void;
  onCanvasMove: (x: number, y: number, tool: import('../hooks/useCursors').CanvasTool, color: string, size: number) => void;

  // CRDT
  crdtContent: string;
  applyLocalEdit: (newText: string) => void;
  hasConflict?: boolean;
  onDismissConflict?: () => void;

  // Dev tools
  logEntries: LogEntry[];
  errors: GatewayError[];
  lastError: GatewayError | null;
  clientId: string | null;
  sessionToken: string | null;

  // Social layer
  idToken: string | null;
  onMessage: OnMessageFn;
  sendMessage: (msg: Record<string, unknown>) => void;

  // WebSocket return object (needed for collaborative doc editor)
  ws: UseWebSocketReturn;
  // Identity
  userId: string;
  displayName: string;

  // Unified activity bus (lifted to GatewayDemo so it persists across tab switches)
  activityEvents: import('../hooks/useActivityBus').ActivityEvent[];
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  activityIsLive: boolean;
}

// ---------------------------------------------------------------------------
// Shared section card style
// ---------------------------------------------------------------------------

const sectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '1.25rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#64748b',
  margin: '0 0 0.75rem 0',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppLayout({
  connectionState,
  currentChannel,
  onSwitchChannel,
  onDisconnect,
  onReconnect,
  userEmail,
  onSignOut,
  presenceUsers,
  currentClientId,
  activeReactions,
  onReact,
  chatMessages,
  onChatSend,
  onTyping,
  cursors,
  localCursor,
  activeMode,
  onModeChange,
  onFreeformMove,
  onTableClick,
  onTextChange,
  onCanvasMove,
  crdtContent,
  applyLocalEdit,
  hasConflict,
  onDismissConflict,
  logEntries,
  errors,
  lastError,
  clientId,
  sessionToken,
  idToken,
  onMessage,
  sendMessage,
  ws,
  userId,
  displayName,
  activityEvents,
  activityPublish,
  activityIsLive,
}: AppLayoutProps) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'panels' | 'social' | 'dashboard' | 'doc-editor'>('panels');
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDocumentType, setActiveDocumentType] = useState<string | undefined>(undefined);
  const [showDevTools, setShowDevTools] = useState(false);
  const [showNewDocModal, setShowNewDocModal] = useState(false);

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
    loading: docsLoading,
    createDocument,
    deleteDocument,
    refreshDocuments,
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
      setActiveView('doc-editor');
      dismissNotification(notification.id);
      // Allow the doc editor view to mount before scrolling
      setTimeout(() => {
        document.getElementById(`section-${notification.sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [dismissNotification]);

  // Derive typingUsers from presenceUsers, excluding self
  const typingUsers = presenceUsers
    .filter(
      (u) => u.metadata.isTyping === true && u.clientId !== currentClientId
    )
    .map(
      (u) =>
        (u.metadata.displayName as string | undefined) ??
        u.clientId.slice(0, 8)
    );

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

        {/* Sidebar */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            padding: '1rem',
            borderRight: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <PresencePanel users={presenceUsers} currentClientId={currentClientId} />
          <DisconnectReconnect
            connectionState={connectionState}
            onDisconnect={onDisconnect}
            onReconnect={onReconnect}
          />
        </div>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            overflowY: 'auto',
          }}
        >

          {/* View switcher tabs */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            marginBottom: '0.5rem',
          }}>
            {([
              ['panels', 'Previews'],
              ['social', 'Social'],
              ['dashboard', 'Live Activity'],
              ['doc-editor', 'Documents'],
            ] as const).map(([view, label]) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
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
            {activeView === 'doc-editor' && !activeDocumentId && (
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

          {activeView === 'panels' && (
          <>
          {/* Chat section */}
          <div style={sectionCardStyle}>
            <p style={sectionHeaderStyle}>Chat</p>
            <ChatPanel
              messages={chatMessages}
              onSend={onChatSend}
              disabled={connectionState !== 'connected'}
              onTyping={onTyping}
              typingUsers={typingUsers}
            />
          </div>

          {/* Cursors section */}
          <div style={sectionCardStyle}>
            <p style={sectionHeaderStyle}>Cursors</p>
            <CursorModeSelector activeMode={activeMode} onModeChange={onModeChange} />
            {activeMode === 'freeform' && (
              <CursorCanvas cursors={cursors} localCursor={localCursor} onMouseMove={onFreeformMove} />
            )}
            {activeMode === 'table' && (
              <TableCursorGrid cursors={cursors} localCursor={localCursor} onCellClick={onTableClick} />
            )}
            {activeMode === 'text' && (
              <TextCursorEditor cursors={cursors} localCursor={localCursor} onPositionChange={onTextChange} />
            )}
            {activeMode === 'canvas' && (
              <CanvasCursorBoard cursors={cursors} localCursor={localCursor} onMouseMove={onCanvasMove} />
            )}
          </div>

          {/* Reactions section */}
          <div style={sectionCardStyle}>
            <p style={sectionHeaderStyle}>Reactions</p>
            <ReactionButtons
              onReact={onReact}
              disabled={connectionState !== 'connected'}
            />
          </div>

          {/* Shared Document (CRDT) section */}
          <div style={sectionCardStyle}>
            <p style={sectionHeaderStyle}>Shared Document</p>
            <SharedTextEditor
              content={crdtContent}
              applyLocalEdit={applyLocalEdit}
              disabled={connectionState !== 'connected'}
              hasConflict={hasConflict}
              onDismissConflict={onDismissConflict}
            />
          </div>

          {/* Activity section */}
          <ActivityPanel
            idToken={idToken}
            sendMessage={sendMessage}
            onMessage={onMessage}
            connectionState={connectionState}
          />
          </>
          )}

          {activeView === 'social' && (
          <>
          {/* Social section card */}
          <SocialPanel idToken={idToken} onMessage={onMessage} />

          {/* Groups section */}
          <GroupPanel
            idToken={idToken}
            rooms={rooms}
            createGroupRoom={createGroupRoom}
            onRoomSelect={handleRoomSelect}
            roomsLoading={roomsLoading}
          />

          {/* Rooms section */}
          <RoomList
            idToken={idToken}
            rooms={rooms}
            createRoom={createRoom}
            createDM={createDM}
            loading={roomsLoading}
            onRoomSelect={handleRoomSelect}
            activeRoomId={activeRoomId}
          />

          {/* Posts section */}
          <PostFeed idToken={idToken} roomId={activeRoomId} onMessage={onMessage} />
          </>
          )}

          {activeView === 'dashboard' && (
            <BigBrotherPanel
              rooms={rooms}
              presenceUsers={presenceUsers}
              activityEvents={activityEvents}
              activityIsLive={activityIsLive}
            />
          )}

          {activeView === 'doc-editor' && !activeDocumentId && (
            <DocumentListPage
              documents={documents}
              presence={docPresence}
              hideHeader
              onOpenDocument={(id: string) => {
                const doc = documents.find(d => d.id === id);
                setActiveDocumentType(doc?.type);
                setActiveDocumentId(id);
              }}
              onCreateDocument={(meta) => {
                createDocument(meta);
              }}
              onDeleteDocument={deleteDocument}
              onJumpToUser={(docId: string, _userId: string) => {
                setActiveDocumentId(docId);
              }}
            />
          )}

          {activeView === 'doc-editor' && activeDocumentId && (
            <div style={{ flex: 1, minHeight: 0 }}>
              <DocumentEditorPage
                documentId={activeDocumentId}
                documentType={activeDocumentType}
                ws={ws}
                userId={userId}
                displayName={displayName}
                onMessage={onMessage}
                activityPublish={activityPublish}
                activityEvents={activityEvents}
                onBack={() => { setActiveDocumentId(null); setActiveDocumentType(undefined); }}
              />
            </div>
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
