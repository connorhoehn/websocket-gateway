// frontend/src/components/PostFeed.tsx
//
// Post feed section card for a room — all sub-components co-located as unexported internals.
// Only PostFeed is exported.

import { useState, useEffect } from 'react';
import { usePosts } from '../hooks/usePosts';
import { useLikes } from '../hooks/useLikes';
import type { PostItem } from '../hooks/usePosts';
import type { GatewayMessage } from '../types/gateway';
import { CommentThread } from './CommentThread';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface PostFeedProps {
  idToken: string | null;
  roomId: string | null;
  onMessage: OnMessageFn;
}

// ---------------------------------------------------------------------------
// Constants — same EMOJIS array as ReactionButtons.tsx
// ---------------------------------------------------------------------------

const EMOJIS = ['❤️', '😂', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '⚡', '💯', '🚀'] as const;

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
// CreatePostForm (internal)
// ---------------------------------------------------------------------------

interface CreatePostFormProps {
  onCreate: (content: string) => Promise<void>;
  loading: boolean;
}

function CreatePostForm({ onCreate, loading }: CreatePostFormProps) {
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setFormError(null);
    try {
      await onCreate(content.trim());
      setContent('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create post');
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }}>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="What's on your mind?"
        maxLength={10000}
        rows={3}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 14,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f9fafb',
          color: '#0f172a',
          resize: 'vertical',
          marginBottom: 8,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={!content.trim() || loading}
          style={{
            height: 36,
            padding: '0 16px',
            background: !content.trim() || loading ? '#f1f5f9' : '#646cff',
            color: !content.trim() || loading ? '#9ca3af' : '#ffffff',
            border: !content.trim() || loading ? '1px solid #e2e8f0' : 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: !content.trim() || loading ? 'default' : 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {loading ? 'Posting…' : 'Post'}
        </button>
      </div>
      {formError && (
        <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {formError}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// LikeButton (internal)
// ---------------------------------------------------------------------------

interface LikeButtonProps {
  idToken: string | null;
  roomId: string | null;
  postId: string;
  onMessage: OnMessageFn;
}

function LikeButton({ idToken, roomId, postId, onMessage }: LikeButtonProps) {
  const { isLiked, likeCount, toggle, whoLiked } = useLikes({ idToken, roomId, postId, onMessage });

  return (
    <>
      <button
        onClick={() => void toggle()}
        aria-label="Like post"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <span style={{ fontSize: 16, color: isLiked ? '#646cff' : '#9ca3af' }}>&#10084;</span>
        <span style={{ fontSize: 14, color: isLiked ? '#646cff' : '#9ca3af' }}>{likeCount}</span>
      </button>
      {whoLiked.length > 0 && (
        <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>
          Liked by: {whoLiked.slice(0, 3).map(p => p.displayName).join(', ')}
          {whoLiked.length > 3 ? ` and ${whoLiked.length - 3} more` : ''}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// EmojiReactionBar (internal)
// ---------------------------------------------------------------------------

interface EmojiReactionBarProps {
  idToken: string | null;
  roomId: string | null;
  postId: string;
  onMessage: OnMessageFn;
}

function EmojiReactionBar({ idToken, roomId, postId, onMessage }: EmojiReactionBarProps) {
  const { reactWithEmoji } = useLikes({ idToken, roomId, postId, onMessage });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
      {EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => void reactWithEmoji(emoji)}
          style={{
            fontSize: 16,
            background: 'none',
            border: 'none',
            padding: '2px 4px',
            cursor: 'pointer',
          }}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostCard (internal)
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: PostItem;
  idToken: string | null;
  roomId: string | null;
  currentUserId: string | null;
  onMessage: OnMessageFn;
  onEdit: (postId: string, content: string) => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
}

function PostCard({ post, idToken, roomId, currentUserId, onMessage, onEdit, onDelete }: PostCardProps) {
  const [opacity, setOpacity] = useState(post._fadeIn ? 0 : 1);
  const [showComments, setShowComments] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(post.content);

  useEffect(() => {
    if (post._fadeIn) {
      const timer = setTimeout(() => setOpacity(1), 10);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isOwn = post.authorId === currentUserId;
  const initials = post.authorId.slice(0, 2).toUpperCase();

  return (
    <div style={{ opacity, transition: 'opacity 200ms ease', borderBottom: '1px solid #f1f5f9', paddingBottom: 16, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{post.authorId}</span>
          <span style={{ fontSize: 14, color: '#9ca3af', marginLeft: 8 }}>{relativeTime(post.createdAt)}</span>
        </div>
      </div>

      {/* Body */}
      {editMode ? (
        <div style={{ marginBottom: 8 }}>
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 14,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              background: '#f9fafb',
              color: '#0f172a',
              resize: 'vertical',
              marginBottom: 8,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { void onEdit(post.postId, editContent); setEditMode(false); }}
              disabled={!editContent.trim()}
              style={{
                height: 36,
                padding: '0 12px',
                background: !editContent.trim() ? '#f1f5f9' : '#646cff',
                color: !editContent.trim() ? '#9ca3af' : '#ffffff',
                border: !editContent.trim() ? '1px solid #e2e8f0' : 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: !editContent.trim() ? 'default' : 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              Save
            </button>
            <button
              onClick={() => { setEditMode(false); setEditContent(post.content); }}
              style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Discard Changes
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 16, color: '#374151', marginTop: 8, marginBottom: 8 }}>
          {post.content}
        </div>
      )}

      {/* PostActions */}
      <div style={{ display: 'flex', gap: 16, fontSize: 14, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <LikeButton idToken={idToken} roomId={roomId} postId={post.postId} onMessage={onMessage} />
        <EmojiReactionBar idToken={idToken} roomId={roomId} postId={post.postId} onMessage={onMessage} />
        <button
          onClick={() => setShowComments(prev => !prev)}
          style={{ background: 'none', border: 'none', fontSize: 14, color: '#64748b', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 0 }}
        >
          Comment
        </button>
        {isOwn && !editMode && (
          <button
            onClick={() => setEditMode(true)}
            style={{ background: 'none', border: 'none', fontSize: 14, color: '#9ca3af', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 0 }}
          >
            Edit
          </button>
        )}
        {isOwn && !showConfirmDelete && !editMode && (
          <button
            onClick={() => setShowConfirmDelete(true)}
            style={{ background: 'none', border: 'none', fontSize: 14, color: '#9ca3af', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 0 }}
          >
            Delete
          </button>
        )}
        {isOwn && showConfirmDelete && (
          <div role="group" aria-label="Confirm delete post" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#374151' }}>Delete this post?</span>
            <button
              onClick={() => setShowConfirmDelete(false)}
              style={{ fontSize: 12, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Cancel
            </button>
            <button
              onClick={() => { void onDelete(post.postId); setShowConfirmDelete(false); }}
              style={{ fontSize: 12, color: '#ffffff', background: '#dc2626', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Inline CommentThread */}
      {showComments && (
        <CommentThread
          idToken={idToken}
          roomId={roomId}
          postId={post.postId}
          onMessage={onMessage}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostFeed (exported)
// ---------------------------------------------------------------------------

export function PostFeed({ idToken, roomId, onMessage }: PostFeedProps) {
  const { posts, createPost, editPost, deletePost, loading, hasMore, loadMore } = usePosts({ idToken, roomId, onMessage });

  const currentUserId = decodeUserId(idToken);

  const sectionCardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '1.25rem',
  };

  return (
    <div style={sectionCardStyle}>
      <CreatePostForm onCreate={createPost} loading={loading} />
      <div style={{ borderTop: '1px solid #e2e8f0', margin: '16px 0' }} />
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          style={{
            width: '100%',
            height: 36,
            marginBottom: 16,
            background: '#ffffff',
            color: '#374151',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 14,
            cursor: loading ? 'default' : 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {loading && posts.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1rem', justifyContent: 'center', color: '#64748b' }}>
          <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: '#646cff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading...
        </div>
      ) : posts.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            No posts yet
          </div>
          <div style={{ fontSize: 14, color: '#9ca3af' }}>
            Be the first to post in this room.
          </div>
        </div>
      ) : (
        posts.map(post => (
          <PostCard
            key={post.postId}
            post={post}
            idToken={idToken}
            roomId={roomId}
            currentUserId={currentUserId}
            onMessage={onMessage}
            onEdit={editPost}
            onDelete={deletePost}
          />
        ))
      )}
    </div>
  );
}
