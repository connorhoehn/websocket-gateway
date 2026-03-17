// frontend/src/components/CommentThread.tsx
//
// Inline comment thread — rendered below an expanded PostCard in PostFeed.
// All sub-components co-located as unexported internals.
// Only CommentThread is exported.

import { useState, useEffect } from 'react';
import { useComments } from '../hooks/useComments';
import type { CommentItem } from '../hooks/useComments';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface CommentThreadProps {
  idToken: string | null;
  roomId: string | null;
  postId: string | null;
  onMessage: OnMessageFn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return createdAt.slice(0, 10);
}

function decodeUserId(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    return (JSON.parse(atob(idToken.split('.')[1])) as { sub: string }).sub;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ReplyForm (internal)
// ---------------------------------------------------------------------------

interface ReplyFormProps {
  onSubmit: (content: string) => Promise<void>;
  placeholder?: string;
  loading: boolean;
}

function ReplyForm({ onSubmit, placeholder = 'Write a reply…', loading }: ReplyFormProps) {
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    void onSubmit(content.trim());
    setContent('');
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 14,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f9fafb',
          color: '#0f172a',
        }}
      />
      <button
        type="submit"
        disabled={!content.trim() || loading}
        style={{
          height: 28,
          padding: '0 10px',
          background: !content.trim() || loading ? '#f1f5f9' : '#646cff',
          color: !content.trim() || loading ? '#9ca3af' : '#ffffff',
          border: !content.trim() || loading ? '1px solid #e2e8f0' : 'none',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: !content.trim() || loading ? 'default' : 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Comment
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// CommentItemView (internal)
// ---------------------------------------------------------------------------

interface CommentItemViewProps {
  comment: CommentItem;
  currentUserId: string | null;
  loading: boolean;
  onDelete: (commentId: string) => Promise<void>;
  onReply: (parentCommentId: string, content: string) => Promise<void>;
}

function CommentItemView({ comment, currentUserId, loading, onDelete, onReply }: CommentItemViewProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [opacity, setOpacity] = useState(comment._fadeIn ? 0 : 1);

  useEffect(() => {
    if (comment._fadeIn) {
      const timer = setTimeout(() => setOpacity(1), 10);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isOwn = comment.authorId === currentUserId;
  const isReply = !!comment.parentCommentId;
  const initials = comment.authorId.slice(0, 2).toUpperCase();

  const inner = (
    <div style={{ opacity, transition: 'opacity 200ms ease' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          color: '#374151',
          flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
              {comment.authorId}
            </span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              {relativeTime(comment.createdAt)}
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
            {comment.content}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setShowReplyForm(prev => !prev)}
              style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Reply
            </button>
            {isOwn && !showConfirmDelete && (
              <button
                onClick={() => setShowConfirmDelete(true)}
                style={{ fontSize: 14, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}
                aria-label="Delete comment"
              >
                Delete
              </button>
            )}
            {isOwn && showConfirmDelete && (
              <div role="group" aria-label="Confirm delete comment" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#374151' }}>Delete this comment?</span>
                <button
                  onClick={() => setShowConfirmDelete(false)}
                  style={{ fontSize: 12, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void onDelete(comment.commentId); setShowConfirmDelete(false); }}
                  style={{ fontSize: 12, color: '#ffffff', background: '#dc2626', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
          {showReplyForm && (
            <ReplyForm
              onSubmit={async (content) => {
                await onReply(comment.commentId, content);
                setShowReplyForm(false);
              }}
              placeholder="Write a reply…"
              loading={loading}
            />
          )}
        </div>
      </div>
    </div>
  );

  if (isReply) {
    return (
      <div style={{ paddingLeft: 32, paddingTop: 8, paddingBottom: 8 }}>
        {inner}
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 8, paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
      {inner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentThread (exported)
// ---------------------------------------------------------------------------

export function CommentThread({ idToken, roomId, postId, onMessage }: CommentThreadProps) {
  const { comments, createComment, deleteComment, loading } = useComments({ idToken, roomId, postId, onMessage });

  const currentUserId = decodeUserId(idToken);

  const handleReply = async (parentCommentId: string, content: string) => {
    await createComment(content, parentCommentId);
  };

  return (
    <div style={{ paddingTop: 8, paddingLeft: 8, borderTop: '1px solid #f1f5f9' }}>
      {loading ? (
        <div style={{ fontSize: 14, color: '#9ca3af', padding: '8px 0' }}>
          Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>
          No comments yet
        </div>
      ) : (
        comments.map(comment => (
          <CommentItemView
            key={comment.commentId}
            comment={comment}
            currentUserId={currentUserId}
            loading={loading}
            onDelete={deleteComment}
            onReply={handleReply}
          />
        ))
      )}
      <ReplyForm
        onSubmit={(content) => createComment(content)}
        placeholder="Write a comment…"
        loading={loading}
      />
    </div>
  );
}
