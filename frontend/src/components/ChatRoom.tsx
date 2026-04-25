// frontend/src/components/ChatRoom.tsx
//
// Slack/iMessage-style chat view for a room. Own messages right-aligned,
// others left-aligned with avatar bubbles. Auto-scrolls to newest message.

import { useState, useEffect, useRef } from 'react';
import { usePosts } from '../hooks/usePosts';
import type { PostItem } from '../hooks/usePosts';
import type { GatewayMessage } from '../types/gateway';

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface ChatRoomProps {
  idToken: string | null;
  roomId: string;
  roomName: string;
  onMessage: OnMessageFn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
  '#64b5f6', '#4dd0e1', '#4db6ac', '#81c784', '#ffb74d',
  '#ff8a65', '#a1887f', '#90a4ae', '#4fc3f7', '#aed581',
];

function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = ((h * 31) + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(userId: string): string {
  const parts = userId.split(/[\s._@-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return userId.slice(0, 2).toUpperCase();
}

function relativeTime(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(createdAt).toLocaleDateString();
}

function decodeUserId(idToken: string | null): string | null {
  if (!idToken) return null;
  try { return (JSON.parse(atob(idToken.split('.')[1])) as { sub: string }).sub; }
  catch { return null; }
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  post: PostItem;
  isOwn: boolean;
  showSender: boolean;
}

function MessageBubble({ post, isOwn, showSender }: MessageBubbleProps) {
  const color = avatarColor(post.authorId);

  return (
    <div style={{
      display: 'flex',
      flexDirection: isOwn ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: showSender ? '8px 16px 2px' : '1px 16px',
    }}>
      {/* Avatar — left side only, shown for first in group */}
      <div style={{ width: 32, flexShrink: 0, alignSelf: 'flex-end' }}>
        {!isOwn && showSender && (
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: color, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, userSelect: 'none',
          }}>
            {initials(post.authorId)}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{
        maxWidth: '68%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOwn ? 'flex-end' : 'flex-start',
        gap: 2,
      }}>
        {!isOwn && showSender && (
          <span style={{ fontSize: 11, color: color, fontWeight: 600, paddingLeft: 4 }}>
            {post.authorId}
          </span>
        )}
        <div style={{
          background: isOwn ? '#646cff' : '#f1f5f9',
          color: isOwn ? '#fff' : '#0f172a',
          borderRadius: isOwn ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
          padding: '9px 14px',
          fontSize: 14,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          opacity: post._fadeIn ? 0 : 1,
          transition: 'opacity 200ms ease',
        }}>
          {post.content}
        </div>
        {showSender && (
          <span style={{ fontSize: 10, color: '#94a3b8', paddingLeft: 4, paddingRight: 4 }}>
            {relativeTime(post.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatRoom (exported)
// ---------------------------------------------------------------------------

export function ChatRoom({ idToken, roomId, roomName, onMessage }: ChatRoomProps) {
  const { posts, createPost, loading, hasMore, loadMore, error } = usePosts({ idToken, roomId, onMessage });
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const currentUserId = decodeUserId(idToken);

  // Chronological order (oldest → top, newest → bottom)
  const chronological = [...posts].reverse();

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts.length]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const text = message.trim();
    setMessage('');
    setSendError(null);
    setSending(true);
    try {
      await createPost(text);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
      setMessage(text); // restore so user can retry
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      background: '#ffffff',
      borderRadius: 8, border: '1px solid #e2e8f0',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        borderBottom: '1px solid #e2e8f0',
        background: '#fff', flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
          # {roomName}
        </span>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
        {hasMore && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <button onClick={() => void loadMore()} disabled={loading}
              style={{ fontSize: 12, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 20, padding: '3px 14px', cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Loading…' : 'Load earlier'}
            </button>
          </div>
        )}

        {loading && chronological.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading messages…
          </div>
        ) : chronological.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 6 }}>
            <span style={{ fontSize: 28 }}>💬</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>No messages yet</span>
            <span style={{ fontSize: 13 }}>Be the first to say something!</span>
          </div>
        ) : (
          chronological.map((post, i) => {
            const isOwn = post.authorId === currentUserId;
            const prev = chronological[i - 1];
            const showSender = !prev || prev.authorId !== post.authorId ||
              (new Date(post.createdAt).getTime() - new Date(prev.createdAt).getTime()) > 5 * 60 * 1000;
            return (
              <MessageBubble key={post.postId} post={post} isOwn={isOwn} showSender={showSender} />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error banners */}
      {(error || sendError) && (
        <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
          {sendError ?? error}
        </div>
      )}

      {/* Input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderTop: '1px solid #e2e8f0',
        background: '#fff', flexShrink: 0,
      }}>
        <input
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${roomName}…`}
          disabled={sending}
          style={{
            flex: 1, border: '1px solid #d1d5db', borderRadius: 22,
            padding: '8px 16px', fontSize: 14,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!message.trim() || sending}
          style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: !message.trim() || sending ? '#f1f5f9' : '#646cff',
            color: !message.trim() || sending ? '#9ca3af' : '#fff',
            border: 'none', cursor: !message.trim() || sending ? 'default' : 'pointer',
            fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
