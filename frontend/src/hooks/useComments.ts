// frontend/src/hooks/useComments.ts
//
// Comments hook — fetches and manages comments for a post with real-time updates.
// Handles social:comment events by appending incoming comments with a fade-in flag.
// All requests use Authorization: Bearer idToken against VITE_SOCIAL_API_URL.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentItem {
  postId: string;
  commentId: string;
  authorId: string;
  content: string;
  parentCommentId?: string;
  createdAt: string;
  _fadeIn?: boolean;
}

export type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

export interface UseCommentsOptions {
  idToken: string | null;
  roomId: string | null;
  postId: string | null;
  onMessage: OnMessageFn;
}

export interface UseCommentsReturn {
  comments: CommentItem[];
  createComment: (content: string, parentCommentId?: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useComments({ idToken, roomId, postId, onMessage }: UseCommentsOptions): UseCommentsReturn {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  // ---- Stable refs for WS handler -----------------------------------------

  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const postIdRef = useRef(postId);
  useEffect(() => {
    postIdRef.current = postId;
  }, [postId]);

  // ---- On mount: fetch comments --------------------------------------------

  useEffect(() => {
    if (!idToken || !roomId || !postId) return;

    setLoading(true);
    setError(null);

    fetch(`${baseUrl}/api/rooms/${roomId}/posts/${postId}/comments`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
        return res.json() as Promise<{ comments: CommentItem[] }>;
      })
      .then((data) => {
        setComments(data.comments ?? []);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, roomId, postId, baseUrl]);  

  // ---- WS handler: social:comment -----------------------------------------

  useEffect(() => {
    const unregister = onMessageRef.current((msg: GatewayMessage) => {
      if (msg.type === 'social:comment' && msg.postId === postIdRef.current) {
        const incoming = { ...(msg.comment as CommentItem), _fadeIn: true };
        setComments((prev) => [...prev, incoming]);
        // Clear fade-in flag after 300ms
        setTimeout(() => {
          setComments((prev) =>
            prev.map((c) =>
              c.commentId === incoming.commentId ? { ...c, _fadeIn: false } : c
            )
          );
        }, 300);
      }
    });

    return unregister;
  }, []);  

  // ---- createComment -------------------------------------------------------

  const createComment = useCallback(async (
    content: string,
    parentCommentId?: string,
  ): Promise<void> => {
    if (!idToken || !roomId || !postId) return;
    setLoading(true);
    setError(null);
    try {
      const body: { content: string; parentCommentId?: string } = { content };
      if (parentCommentId) body.parentCommentId = parentCommentId;
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed to create comment (${res.status})`);
      const comment = await res.json() as CommentItem;
      setComments((prev) => [...prev, comment]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, roomId, postId, baseUrl]);  

  // ---- deleteComment -------------------------------------------------------

  const deleteComment = useCallback(async (commentId: string): Promise<void> => {
    if (!idToken || !roomId || !postId) return;
    setError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/rooms/${roomId}/posts/${postId}/comments/${commentId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
      if (!res.ok) throw new Error(`Failed to delete comment (${res.status})`);
      setComments((prev) => prev.filter((c) => c.commentId !== commentId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, roomId, postId, baseUrl]);  

  return { comments, createComment, deleteComment, loading, error };
}
