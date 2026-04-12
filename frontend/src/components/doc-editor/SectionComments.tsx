// frontend/src/components/doc-editor/SectionComments.tsx
//
// Threaded comment system with Reddit-style nested replies.
// Comments are stored in Y.js and broadcast via CRDT sync.

import { useState, useRef } from 'react';
import type { CommentThread } from '../../types/document';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SectionCommentsProps {
  comments: CommentThread[];
  onAddComment: (text: string, parentCommentId?: string | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function relativeTime(iso: string): string {
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

function countAllComments(threads: CommentThread[]): number {
  let total = 0;
  for (const t of threads) {
    total += 1 + countAllComments(t.replies);
  }
  return total;
}

// ---------------------------------------------------------------------------
// CommentNode — recursive component for a single comment + replies
// ---------------------------------------------------------------------------

function CommentNode({
  comment,
  depth,
  onReply,
}: {
  comment: CommentThread;
  depth: number;
  onReply: (parentId: string, text: string) => void;
}) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [hovered, setHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const cappedDepth = Math.min(depth, 5);

  const handleSubmitReply = () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    onReply(comment.id, trimmed);
    setReplyText('');
    setShowReplyForm(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitReply();
    }
    if (e.key === 'Escape') {
      setShowReplyForm(false);
    }
  };

  const borderColor = hovered ? comment.color : (depth === 0 ? '#e2e8f0' : '#cbd5e1');

  return (
    <div style={{ marginLeft: cappedDepth > 0 ? 20 : 0 }}>
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

        {/* Comment text */}
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#334155', paddingLeft: 30, whiteSpace: 'pre-wrap' }}>
          {comment.text}
        </div>

        {/* Reply button */}
        <div style={{ paddingLeft: 30, marginTop: 4 }}>
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
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a reply..."
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
              }}
            />
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
        <CommentNode
          key={reply.id}
          comment={reply}
          depth={depth + 1}
          onReply={onReply}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionComments — top-level component
// ---------------------------------------------------------------------------

export default function SectionComments({ comments, onAddComment }: SectionCommentsProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const totalCount = countAllComments(comments);

  const handlePost = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddComment(trimmed, null);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment..."
              rows={1}
              style={{
                flex: 1,
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'none',
                minHeight: 32,
                boxSizing: 'border-box',
              }}
            />
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

          {/* Comment threads */}
          <div style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px' }}>
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
            {comments.map((thread) => (
              <CommentNode
                key={thread.id}
                comment={thread}
                depth={0}
                onReply={handleReply}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
