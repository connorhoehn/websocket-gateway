// frontend/src/components/doc-editor/CommentThread.tsx
//
// Shared presentational layer for threaded comment rendering.
// Extracted from SectionComments so any caller that wants to render
// a threaded conversation (Reddit-style nested replies, mentions,
// resolve/unresolve) can compose this without reimplementing the UI.
//
// The component is data-source-agnostic: it takes a CommentThread tree
// (from `types/document`) plus handler callbacks; it does not fetch or
// mutate anything on its own.

import { useState, useRef, useCallback } from 'react';
import type { CommentThread } from '../../types/document';
import { MentionDropdown } from './MentionDropdown';
import type { MentionDropdownHandle } from './MentionDropdown';
import type { MentionUser } from '../../hooks/useMentionUsers';

// ---------------------------------------------------------------------------
// Small display helpers — shared by all thread-rendering callers
// ---------------------------------------------------------------------------

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

export function countAllComments(threads: CommentThread[]): number {
  let total = 0;
  for (const t of threads) {
    total += 1 + countAllComments(t.replies);
  }
  return total;
}

/** Render comment text with styled @mention spans. */
export function renderCommentText(text: string): React.ReactNode {
  const parts = text.split(/(@[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g);
  return parts.map((part, i) =>
    part.startsWith('@') && /^@[A-Z]/.test(part) ? (
      <span
        key={i}
        style={{
          color: '#3b82f6',
          fontWeight: 600,
          background: '#eff6ff',
          padding: '0 2px',
          borderRadius: 2,
        }}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// ---------------------------------------------------------------------------
// Mention detection — shared logic for any textarea with @mention support
// ---------------------------------------------------------------------------

export interface MentionState {
  active: boolean;
  query: string;
  position: { top: number; left: number };
  /** Character index in the textarea where the `@` was typed */
  atIndex: number;
}

export const MENTION_INITIAL: MentionState = {
  active: false,
  query: '',
  position: { top: 0, left: 0 },
  atIndex: -1,
};

/**
 * Given the current textarea value and selectionStart, determine
 * whether we are in an @mention context.  Returns updated MentionState.
 */
export function detectMention(
  value: string,
  cursorPos: number,
  textareaEl: HTMLTextAreaElement | null,
): MentionState {
  // Walk backwards from cursor to find un-spaced `@`
  let i = cursorPos - 1;
  while (i >= 0 && value[i] !== '@' && value[i] !== ' ' && value[i] !== '\n') {
    i--;
  }
  if (i < 0 || value[i] !== '@') {
    return MENTION_INITIAL;
  }
  // `@` must be at start of string or preceded by whitespace / newline
  if (i > 0 && value[i - 1] !== ' ' && value[i - 1] !== '\n') {
    return MENTION_INITIAL;
  }
  const query = value.slice(i + 1, cursorPos);
  // Position dropdown below the textarea using viewport-absolute coords
  // so the portal-rendered MentionDropdown (position: fixed) aligns correctly.
  const rect = textareaEl?.getBoundingClientRect();
  const position = rect
    ? { top: rect.bottom + 4, left: rect.left }
    : { top: 28, left: 0 };
  return { active: true, query, position, atIndex: i };
}

/**
 * Insert a mention into the textarea value, replacing `@query` with
 * `@DisplayName `.  Returns the new value and new cursor position.
 */
export function insertMention(
  value: string,
  mention: MentionState,
  user: MentionUser,
): { newValue: string; newCursor: number } {
  const before = value.slice(0, mention.atIndex);
  const after = value.slice(mention.atIndex + 1 + mention.query.length); // skip @+query
  const insert = `@${user.displayName} `;
  return {
    newValue: before + insert + after,
    newCursor: before.length + insert.length,
  };
}

// ---------------------------------------------------------------------------
// CommentThreadNode — recursive presentational component for a single
// comment + its replies. Pure UI: accepts the thread node and callbacks.
// ---------------------------------------------------------------------------

export interface CommentThreadNodeProps {
  comment: CommentThread;
  depth: number;
  onReply: (parentId: string, text: string) => void;
  mentionUsers: MentionUser[];
  onResolveThread?: (commentId: string) => void;
  onUnresolveThread?: (commentId: string) => void;
}

function CommentThreadNode({
  comment,
  depth,
  onReply,
  mentionUsers,
  onResolveThread,
  onUnresolveThread,
}: CommentThreadNodeProps) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [hovered, setHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<MentionDropdownHandle>(null);
  const [mention, setMention] = useState<MentionState>(MENTION_INITIAL);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);

  const isResolved = depth === 0 && !!comment.resolved;
  const cappedDepth = Math.min(depth, 5);

  const handleSubmitReply = () => {
    if (mention.active) return; // don't submit while picking a mention
    const trimmed = replyText.trim();
    if (!trimmed) return;
    onReply(comment.id, trimmed);
    setReplyText('');
    setShowReplyForm(false);
    setMention(MENTION_INITIAL);
  };

  const handleReplyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setReplyText(val);
    const cursor = e.target.selectionStart ?? val.length;
    const next = detectMention(val, cursor, textareaRef.current);
    setMention(next);
  };

  const handleMentionSelect = useCallback(
    (user: MentionUser) => {
      const { newValue, newCursor } = insertMention(replyText, mention, user);
      setReplyText(newValue);
      setMention(MENTION_INITIAL);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCursor, newCursor);
        }
      });
    },
    [replyText, mention],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Forward to mention dropdown first
    if (mention.active && mentionRef.current) {
      const consumed = mentionRef.current.handleKeyDown(e);
      if (consumed) return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitReply();
    }
    if (e.key === 'Escape') {
      setShowReplyForm(false);
    }
  };

  const borderColor = hovered ? comment.color : depth === 0 ? '#e2e8f0' : '#cbd5e1';

  // Resolved banner (shown for resolved root threads)
  if (isResolved && !resolvedExpanded) {
    return (
      <div style={{ marginLeft: cappedDepth > 0 ? 20 : 0 }}>
        <div
          style={{
            background: '#f0fdf4',
            borderLeft: '3px solid #22c55e',
            padding: '8px 12px',
            marginBottom: 4,
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onClick={() => setResolvedExpanded(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#16a34a', fontSize: 12 }}>{'\u2714'}</span>
            <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>
              Resolved by {comment.resolvedBy}
            </span>
            {comment.resolvedAt && (
              <span style={{ color: '#86efac', fontSize: 11 }}>
                {relativeTime(comment.resolvedAt)}
              </span>
            )}
            <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>
              — click to expand
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnresolveThread?.(comment.id);
            }}
            style={{
              background: 'none',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              color: '#64748b',
              fontSize: 11,
              cursor: 'pointer',
              padding: '2px 8px',
              fontFamily: 'inherit',
            }}
          >
            Reopen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginLeft: cappedDepth > 0 ? 20 : 0, opacity: isResolved ? 0.6 : 1 }}>
      {/* Resolved banner (expanded) */}
      {isResolved && resolvedExpanded && (
        <div
          style={{
            background: '#f0fdf4',
            borderLeft: '3px solid #22c55e',
            padding: '8px 12px',
            marginBottom: 4,
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onClick={() => setResolvedExpanded(false)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#16a34a', fontSize: 12 }}>{'\u2714'}</span>
            <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>
              Resolved by {comment.resolvedBy}
            </span>
            {comment.resolvedAt && (
              <span style={{ color: '#86efac', fontSize: 11 }}>
                {relativeTime(comment.resolvedAt)}
              </span>
            )}
            <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>
              — click to collapse
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnresolveThread?.(comment.id);
            }}
            style={{
              background: 'none',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              color: '#64748b',
              fontSize: 11,
              cursor: 'pointer',
              padding: '2px 8px',
              fontFamily: 'inherit',
            }}
          >
            Reopen
          </button>
        </div>
      )}

      {/* Comment card */}
      <div
        style={{
          borderLeft: `3px solid ${borderColor}`,
          padding: '8px 12px',
          marginBottom: 4,
          transition: 'border-color 0.2s',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Avatar + name + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${comment.color}, ${comment.color}dd)`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {getInitials(comment.displayName)}
          </div>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
            {comment.displayName}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {relativeTime(comment.timestamp)}
          </span>
        </div>

        {/* Comment text — with styled @mentions */}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: '#334155',
            paddingLeft: 30,
            whiteSpace: 'pre-wrap',
          }}
        >
          {renderCommentText(comment.text)}
        </div>

        {/* Reply + Resolve buttons */}
        <div style={{ paddingLeft: 30, marginTop: 4, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setShowReplyForm(!showReplyForm);
              if (!showReplyForm) {
                setTimeout(() => textareaRef.current?.focus(), 50);
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 0',
              fontFamily: 'inherit',
            }}
          >
            Reply
          </button>
          {depth === 0 && !isResolved && onResolveThread && (
            <button
              type="button"
              onClick={() => onResolveThread(comment.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: 12,
                cursor: 'pointer',
                padding: '2px 0',
                fontFamily: 'inherit',
              }}
            >
              {'\u2714'} Resolve
            </button>
          )}
        </div>

        {/* Inline reply form — slides down */}
        {showReplyForm && (
          <div
            style={{
              paddingLeft: 30,
              marginTop: 8,
              overflow: 'hidden',
              animation: 'sectionCommentsSlideDown 0.2s ease-out',
            }}
          >
            <div style={{ position: 'relative' }}>
              <textarea
                ref={textareaRef}
                value={replyText}
                onChange={handleReplyChange}
                onKeyDown={handleKeyDown}
                placeholder="Write a reply... (type @ to mention)"
                rows={2}
                style={{
                  width: '100%',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 48,
                  boxSizing: 'border-box',
                  color: '#1e293b',
                  background: '#fff',
                }}
              />
              {mention.active && (
                <MentionDropdown
                  ref={mentionRef}
                  query={mention.query}
                  users={mentionUsers}
                  position={mention.position}
                  onSelect={handleMentionSelect}
                  onDismiss={() => setMention(MENTION_INITIAL)}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={handleSubmitReply}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 6,
                  background: '#3b82f6',
                  color: '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Reply
              </button>
              <button
                type="button"
                onClick={() => setShowReplyForm(false)}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  background: 'transparent',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nested replies */}
      {comment.replies.map((reply) => (
        <CommentThreadNode
          key={reply.id}
          comment={reply}
          depth={depth + 1}
          onReply={onReply}
          mentionUsers={mentionUsers}
          onResolveThread={onResolveThread}
          onUnresolveThread={onUnresolveThread}
        />
      ))}
    </div>
  );
}

export default CommentThreadNode;
