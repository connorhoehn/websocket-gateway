// frontend/src/components/doc-editor/SectionBlock.tsx
//
// Renders a single document section with header, rich-text editor, and task list.
// Includes presence-aware left border, avatar stack, and focus glow.

import { useState } from 'react';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, TaskItem, Participant } from '../../types/document';
import type { CollaborationProvider } from './TiptapEditor';
import { getRenderer } from '../../renderers';
import DefaultRenderer from '../../renderers/default/DefaultRenderer';
import type { CommentThread } from '../../types/document';

export interface SectionBlockProps {
  section: Section;
  fragment: XmlFragment | null;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  user: { name: string; color: string };
  editable: boolean;
  onUpdateSection: (patch: Partial<Section>) => void;
  onAddItem: (item: Omit<TaskItem, 'id'>) => void;
  onUpdateItem: (itemId: string, patch: Partial<TaskItem>) => void;
  onRemoveItem: (itemId: string) => void;
  participants?: Participant[];
  onFocus?: () => void;
  isFocused?: boolean;
  comments?: CommentThread[];
  onAddComment?: (text: string, parentCommentId?: string | null) => void;
  onResolveThread?: (commentId: string) => void;
  onUnresolveThread?: (commentId: string) => void;
  /** Merge-safe awareness updater for Tiptap cursor info. */
  onUpdateCursorInfo?: (name: string, color: string) => void;
  /** Number of comments for this section (used for badge on comment icon). */
  commentCount?: number;
  /** Called when the user clicks the comment icon to open the sidebar. */
  onOpenComments?: (sectionId: string) => void;
  /** Participants who currently have comments open for this section. */
  commentPresence?: Participant[];
}

const typeColors: Record<Section['type'], string> = {
  summary: '#8b5cf6',
  tasks: '#3b82f6',
  decisions: '#f59e0b',
  notes: '#6b7280',
  custom: '#10b981',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  borderRadius: '8px 8px 0 0',
};

const titleInputStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid transparent',
  borderRadius: 4,
  outline: 'none',
  fontSize: 15,
  fontWeight: 600,
  fontFamily: 'inherit',
  background: 'transparent',
  color: '#1e293b',
  padding: '2px 6px',
  cursor: 'text',
};

const typeBadgeStyle = (bg: string): React.CSSProperties => ({
  padding: '2px 10px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 12,
  background: bg,
  color: '#fff',
  textTransform: 'capitalize',
  whiteSpace: 'nowrap',
});

const collapseBtnBase: React.CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 6px',
  color: '#64748b',
  lineHeight: 1,
  borderRadius: 4,
  transition: 'background 0.15s ease, transform 0.2s ease',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const bodyStyle: React.CSSProperties = {
  padding: 14,
};

/* ---- helpers ------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/* ---- avatar stack ------------------------------------------------------- */

const MAX_VISIBLE_AVATARS = 3;

function AvatarStack({ participants }: { participants: Participant[] }) {
  if (!participants || participants.length === 0) return null;

  const visible = participants.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = participants.length - MAX_VISIBLE_AVATARS;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginLeft: 'auto',
        flexShrink: 0,
      }}
    >
      {visible.map((p, i) => (
        <div
          key={p.clientId}
          title={`${p.displayName} (${p.mode})`}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${p.color || '#3b82f6'}, ${darkenHex(p.color || '#3b82f6', 0.2)})`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            border: '2px solid #fff',
            marginLeft: i === 0 ? 0 : -8,
            zIndex: MAX_VISIBLE_AVATARS - i,
            position: 'relative',
            transition: 'transform 0.2s ease',
          }}
        >
          {getInitials(p.displayName)}
          {/* Online presence dot */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#10b981',
              border: '2px solid #fff',
            }}
          />
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#e2e8f0',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            border: '2px solid #fff',
            marginLeft: -8,
            position: 'relative',
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function darkenHex(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
  const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
  const b = Math.max(0, (num & 0xff) * (1 - amount));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/* ---- component ---------------------------------------------------------- */

export default function SectionBlock({
  section,
  fragment,
  ydoc,
  provider,
  user,
  editable,
  onUpdateSection,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  participants,
  onFocus,
  isFocused,
  comments,
  onAddComment,
  onResolveThread,
  onUnresolveThread,
  onUpdateCursorInfo,
  commentCount = 0,
  onOpenComments,
  commentPresence,
}: SectionBlockProps) {
  const [collapsed, setCollapsed] = useState(section.collapsed);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    onUpdateSection({ collapsed: next });
  };

  const Renderer = getRenderer(section.sectionType ?? section.type, 'editor') ?? DefaultRenderer;

  // Presence-aware left border: pick first participant's color or none
  const hasPresence = participants && participants.length > 0;
  const presenceBorderColor = hasPresence ? (participants![0].color || '#3b82f6') : 'transparent';

  const sectionOuterStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    marginBottom: 16,
    background: '#fff',
    borderLeft: hasPresence ? `3px solid ${presenceBorderColor}` : '1px solid #e2e8f0',
    boxShadow: isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
    transition: 'border-left 0.3s ease, box-shadow 0.3s ease',
    position: 'relative',
  };

  const [commentHovered, setCommentHovered] = useState(false);

  return (
    <div id={`section-${section.id}`} style={sectionOuterStyle} onClickCapture={onFocus} onFocusCapture={onFocus}>
      {/* Comment icon button — top-right of section card */}
      {onOpenComments && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenComments(section.id); }}
          onMouseEnter={() => setCommentHovered(true)}
          onMouseLeave={() => setCommentHovered(false)}
          style={{
            position: 'absolute',
            top: '50%',
            right: -52,
            transform: 'translateY(-50%)',
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid #e2e8f0',
            background: commentHovered ? '#f1f5f9' : '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            lineHeight: 1,
            opacity: commentHovered ? 0.9 : 0.4,
            transition: 'opacity 0.15s ease, background 0.15s ease',
            padding: 0,
            zIndex: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
          title="Open comments"
        >
          <span style={{ pointerEvents: 'none' }}>💬</span>
          {/* Badge count */}
          {commentCount > 0 && (
            <span style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: '#3b82f6',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              lineHeight: 1,
            }}>
              {commentCount}
            </span>
          )}
          {/* Presence dots for users with comments open */}
          {commentPresence && commentPresence.length > 0 && (
            <span style={{
              position: 'absolute',
              left: -4,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              {commentPresence.slice(0, 3).map((p) => (
                <span
                  key={p.clientId}
                  title={p.displayName}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: p.color || '#3b82f6',
                    border: '1px solid #fff',
                    display: 'block',
                  }}
                />
              ))}
            </span>
          )}
        </button>
      )}
      <div style={headerStyle}>
        <button
          type="button"
          onClick={toggleCollapse}
          style={{
            ...collapseBtnBase,
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
          title={collapsed ? 'Expand section' : 'Collapse section'}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#e2e8f0'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        >
          {/* Chevron down SVG — rotated -90deg when collapsed */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <input
          type="text"
          value={section.title}
          onChange={(e) => onUpdateSection({ title: e.target.value })}
          readOnly={!editable}
          style={titleInputStyle}
          onFocus={(e) => { if (editable) (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'transparent'; }}
        />

        <span style={typeBadgeStyle(typeColors[section.type])}>
          {section.type}
        </span>

        <AvatarStack participants={participants ?? []} />
      </div>

      {!collapsed && (
        <div style={bodyStyle}>
          <Renderer
            section={section}
            viewMode="editor"
            editable={editable}
            fragment={fragment}
            ydoc={ydoc}
            provider={provider}
            user={user}
            onUpdateSection={onUpdateSection}
            onAddItem={onAddItem}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
            participants={participants}
            onUpdateCursorInfo={onUpdateCursorInfo}
            comments={comments}
            commentCount={commentCount}
            onOpenComments={onOpenComments}
          />
        </div>
      )}
    </div>
  );
}
