// frontend/src/components/PanelsView.tsx
//
// Lazy-loadable view for the "Previews" tab — Chat, Cursors, Reactions,
// Shared Document, and Activity panels.

import type { ChatMessage } from '../hooks/useChat';
import type { CursorMode, RemoteCursor, TextSelectionData } from '../hooks/useCursors';
import type { GatewayMessage } from '../types/gateway';

import { ChatPanel } from './ChatPanel';
import { CursorModeSelector } from './CursorModeSelector';
import { CursorCanvas } from './CursorCanvas';
import { TableCursorGrid } from './TableCursorGrid';
import { TextCursorEditor } from './TextCursorEditor';
import { CanvasCursorBoard } from './CanvasCursorBoard';
import { SharedTextEditor } from './SharedTextEditor';
import { ReactionButtons } from './ReactionButtons';
import { ActivityPanel } from './ActivityPanel';
import { ErrorBoundary } from './ErrorBoundary';

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

export interface PanelsViewProps {
  connectionState: string;
  onReact: (emoji: string) => void;
  chatMessages: ChatMessage[];
  onChatSend: (content: string) => void;
  cursors: Map<string, RemoteCursor>;
  localCursor: RemoteCursor | null;
  activeMode: CursorMode;
  onModeChange: (mode: CursorMode) => void;
  onFreeformMove: (x: number, y: number) => void;
  onTableClick: (row: number, col: number) => void;
  onTextChange: (position: number, selectionData: TextSelectionData | null, hasSelection: boolean) => void;
  onCanvasMove: (x: number, y: number, tool: import('../hooks/useCursors').CanvasTool, color: string, size: number) => void;
  crdtContent: string;
  applyLocalEdit: (newText: string) => void;
  hasConflict?: boolean;
  onDismissConflict?: () => void;
  onTyping: (isTyping: boolean) => void;
  typingUsers: string[];
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
}

export default function PanelsView({
  connectionState,
  onReact,
  chatMessages,
  onChatSend,
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
  onTyping,
  typingUsers,
  idToken,
  sendMessage,
  onMessage,
}: PanelsViewProps) {
  return (
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
      <ErrorBoundary name="ActivityPanel">
        <ActivityPanel
          idToken={idToken}
          sendMessage={sendMessage}
          onMessage={onMessage}
          connectionState={connectionState as 'connected' | 'connecting' | 'disconnected'}
        />
      </ErrorBoundary>
    </>
  );
}
