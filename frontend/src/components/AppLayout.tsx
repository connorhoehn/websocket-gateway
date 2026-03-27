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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface Notification {
  id: string;
  message: string;
  type: 'follow' | 'member_joined' | 'post_created';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// NotificationBanner internal component (UXIN-04)
// ---------------------------------------------------------------------------

function NotificationBanner({ notifications, onDismiss }: {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) return null;

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
          borderLeft: '3px solid #646cff',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}>
          <span style={{ fontSize: 14, color: '#374151', fontWeight: 400 }}>
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
}: AppLayoutProps) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const {
    rooms,
    createRoom,
    createDM,
    createGroupRoom,
    loading: roomsLoading,
  } = useRooms({ idToken: idToken!, onMessage });

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

  // Subscribe to social events for notifications
  useEffect(() => {
    const unregister = onMessageRef.current((msg) => {
      let message: string | null = null;
      let type: Notification['type'] | null = null;

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
      }

      if (message && type) {
        const id = `${Date.now()}-${Math.random()}`;
        setNotifications(prev => {
          const next = [{ id, message: message!, type: type!, timestamp: Date.now() }, ...prev];
          return next.slice(0, 5);
        });
      }
    });
    return unregister;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      <NotificationBanner notifications={notifications} onDismiss={dismissNotification} />

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

        {/* Right: user email + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
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
              <CursorCanvas cursors={cursors} onMouseMove={onFreeformMove} />
            )}
            {activeMode === 'table' && (
              <TableCursorGrid cursors={cursors} onCellClick={onTableClick} />
            )}
            {activeMode === 'text' && (
              <TextCursorEditor cursors={cursors} onPositionChange={onTextChange} />
            )}
            {activeMode === 'canvas' && (
              <CanvasCursorBoard cursors={cursors} onMouseMove={onCanvasMove} />
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

          {/* Activity section */}
          <ActivityPanel
            idToken={idToken}
            sendMessage={sendMessage}
            onMessage={onMessage}
            connectionState={connectionState}
          />

          {/* Dev Tools section */}
          <div style={sectionCardStyle}>
            <p style={sectionHeaderStyle}>Dev Tools</p>
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
      </div>
    </div>
  );
}
