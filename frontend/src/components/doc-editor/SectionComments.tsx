// frontend/src/components/doc-editor/SectionComments.tsx
//
// Section-scoped comment panel. The per-comment threaded rendering
// (mentions, nested replies, resolve/unresolve UX) lives in
// `CommentThread.tsx` — this file composes it alongside the top-level
// draft input, sort toggle, empty-state copy, and expand/collapse chrome.

import { useState, useRef, useCallback } from 'react';
import type { CommentThread, Participant } from '../../types/document';
import { MentionDropdown } from './MentionDropdown';
import type { MentionDropdownHandle } from './MentionDropdown';
import { useMentionUsers } from '../../hooks/useMentionUsers';
import type { MentionUser } from '../../hooks/useMentionUsers';
import CommentThreadNode, {
  MENTION_INITIAL,
  countAllComments,
  detectMention,
  insertMention,
  type MentionState,
} from './CommentThread';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SectionCommentsProps {
  comments: CommentThread[];
  onAddComment: (text: string, parentCommentId?: string | null) => void;
  participants?: Participant[];
  onResolveThread?: (commentId: string) => void;
  onUnresolveThread?: (commentId: string) => void;
}

// ---------------------------------------------------------------------------
// SectionComments — top-level component
// ---------------------------------------------------------------------------

export default function SectionComments({
  comments,
  onAddComment,
  participants = [],
  onResolveThread,
  onUnresolveThread,
}: SectionCommentsProps) {
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<MentionDropdownHandle>(null);
  const [mention, setMention] = useState<MentionState>(MENTION_INITIAL);

  const mentionUsers = useMentionUsers(participants);
  const totalCount = countAllComments(comments);
  const [sortNewest, setSortNewest] = useState(true);

  // Sort: resolved to bottom, then by time (newest or oldest first)
  const sortedComments = [...comments].sort((a, b) => {
    if (a.resolved && !b.resolved) return 1;
    if (!a.resolved && b.resolved) return -1;
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return sortNewest ? timeB - timeA : timeA - timeB;
  });

  const handlePost = () => {
    if (mention.active) return; // don't submit while picking a mention
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddComment(trimmed, null);
    setDraft('');
    setMention(MENTION_INITIAL);
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    const cursor = e.target.selectionStart ?? val.length;
    const next = detectMention(val, cursor, inputRef.current);
    setMention(next);
  };

  const handleMentionSelect = useCallback(
    (user: MentionUser) => {
      const { newValue, newCursor } = insertMention(draft, mention, user);
      setDraft(newValue);
      setMention(MENTION_INITIAL);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCursor, newCursor);
        }
      });
    },
    [draft, mention],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Forward to mention dropdown first
    if (mention.active && mentionRef.current) {
      const consumed = mentionRef.current.handleKeyDown(e);
      if (consumed) return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePost();
    }
  };

  const handleReply = (parentId: string, text: string) => {
    onAddComment(text, parentId);
  };

  return (
    <div>
      {/* Inject keyframes for slide-down animation */}
      <style>{`
        @keyframes sectionCommentsSlideDown {
          from { max-height: 0; opacity: 0; }
          to { max-height: 500px; opacity: 1; }
        }
      `}</style>

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          if (!expanded) {
            setTimeout(() => inputRef.current?.focus(), 100);
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 10,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 500,
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          background: totalCount > 0 ? '#f0f9ff' : 'transparent',
          color: totalCount > 0 ? '#2563eb' : '#64748b',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {expanded ? '\u25BC' : '\u25B6'} Comments{totalCount > 0 ? ` (${totalCount})` : ''}
      </button>

      {/* Expanded thread container */}
      {expanded && (
        <div
          style={{
            marginTop: 8,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            background: '#f8fafc',
            overflow: 'hidden',
            animation: 'sectionCommentsSlideDown 0.2s ease-out',
          }}
        >
          {/* New comment input at top */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              padding: '10px 12px',
              borderBottom: '1px solid #e2e8f0',
              background: '#fff',
            }}
          >
            <div style={{ flex: 1, position: 'relative' }}>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                placeholder="Add a comment... (type @ to mention)"
                rows={2}
                style={{
                  width: '100%',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '8px 10px',
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
            <button
              type="button"
              onClick={handlePost}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                background: '#3b82f6',
                color: '#fff',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                alignSelf: 'flex-end',
              }}
            >
              Post
            </button>
          </div>

          {/* Sort control + comment threads */}
          {comments.length > 1 && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 0',
              borderBottom: '1px solid #f1f5f9',
            }}>
              <button
                type="button"
                onClick={() => setSortNewest(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: '#64748b', padding: '2px 6px',
                  fontFamily: 'inherit',
                }}
              >
                {sortNewest ? '↓ Newest first' : '↑ Oldest first'}
              </button>
            </div>
          )}
          <div style={{ maxHeight: 420, overflowY: 'auto', padding: '8px 12px' }}>
            {comments.length === 0 && (
              <div
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: 12,
                }}
              >
                No comments yet. Start the discussion!
              </div>
            )}
            {sortedComments.map((thread) => (
              <CommentThreadNode
                key={thread.id}
                comment={thread}
                depth={0}
                onReply={handleReply}
                mentionUsers={mentionUsers}
                onResolveThread={onResolveThread}
                onUnresolveThread={onUnresolveThread}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
