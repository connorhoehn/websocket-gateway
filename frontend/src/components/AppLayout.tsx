// frontend/src/components/AppLayout.tsx
//
// Structured 2-column app layout with header, sidebar, and main content sections.
// Pure presentational component — no hook calls, all data flows in via props.
// Replaces the monolithic vertical stack in GatewayDemo.

import { useState } from 'react';
import type { ConnectionState, GatewayError, GatewayMessage } from '../types/gateway';
import type { PresenceUser } from '../hooks/usePresence';
import type { EphemeralReaction } from '../hooks/useReactions';
import type { ChatMessage } from '../hooks/useChat';
import type { CursorMode, RemoteCursor, TextSelectionData } from '../hooks/useCursors';
import type { LogEntry } from './EventLog';

import { ConnectionStatus } from './ConnectionStatus';
import { ChannelSelector } from './ChannelSelector';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

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

  // Dev tools
  logEntries: LogEntry[];
  errors: GatewayError[];
  lastError: GatewayError | null;
  clientId: string | null;
  sessionToken: string | null;

  // Social layer
  idToken: string | null;
  onMessage: OnMessageFn;
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
  logEntries,
  errors,
  lastError,
  clientId,
  sessionToken,
  idToken,
  onMessage,
}: AppLayoutProps) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

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

        {/* Center: connection status + channel selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'center' }}>
          <ConnectionStatus state={connectionState} />
          <ChannelSelector currentChannel={currentChannel} onSwitch={onSwitchChannel} />
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
            />
          </div>

          {/* Social section card */}
          <SocialPanel idToken={idToken} onMessage={onMessage} />

          {/* Groups section */}
          <GroupPanel idToken={idToken} />

          {/* Rooms section */}
          <RoomList
            idToken={idToken}
            onMessage={onMessage}
            onRoomSelect={(room) => setActiveRoomId(room.roomId)}
            activeRoomId={activeRoomId}
          />

          {/* Posts section */}
          <PostFeed idToken={idToken} roomId={activeRoomId} onMessage={onMessage} />

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
