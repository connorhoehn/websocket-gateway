// frontend/src/hooks/usePosts.ts
//
// Posts hook — fetches and manages posts for a room with real-time WS updates.
// Handles social:post events by prepending incoming posts with a fade-in flag.
// All requests use Authorization: Bearer idToken against VITE_SOCIAL_API_URL.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostItem {
  roomId: string;
  postId: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  _fadeIn?: boolean;
}

export type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

export interface UsePostsOptions {
  idToken: string | null;
  roomId: string | null;
  onMessage: OnMessageFn;
}

export interface UsePostsReturn {
  posts: PostItem[];
  createPost: (content: string) => Promise<void>;
  editPost: (postId: string, content: string) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  getUserPosts: (userId: string) => Promise<PostItem[]>;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePosts({ idToken, roomId, onMessage }: UsePostsOptions): UsePostsReturn {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [lastKey, setLastKey] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  // ---- Stable refs for WS handler -----------------------------------------

  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const roomIdRef = useRef(roomId);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // ---- On mount: fetch posts -----------------------------------------------

  useEffect(() => {
    if (!idToken || !roomId) return;

    setLoading(true);
    setError(null);
    setPosts([]);
    setLastKey(undefined);

    fetch(`${baseUrl}/api/rooms/${roomId}/posts`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load posts (${res.status})`);
        return res.json() as Promise<{ posts: PostItem[]; lastKey?: string }>;
      })
      .then((data) => {
        setPosts(data.posts ?? []);
        setLastKey(data.lastKey);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, roomId, baseUrl]);  

  // ---- WS handler: social:post ---------------------------------------------

  useEffect(() => {
    const unregister = onMessageRef.current((msg: GatewayMessage) => {
      if (msg.type === 'social:post' && msg.roomId === roomIdRef.current) {
        const incoming = { ...(msg.post as PostItem), _fadeIn: true };
        setPosts((prev) => [incoming, ...prev]);
        // Clear fade-in flag after 300ms
        setTimeout(() => {
          setPosts((prev) =>
            prev.map((p) => (p.postId === incoming.postId ? { ...p, _fadeIn: false } : p))
          );
        }, 300);
      }
    });

    return unregister;
  }, []);  

  // ---- loadMore ------------------------------------------------------------

  const loadMore = useCallback(async (): Promise<void> => {
    if (!idToken || !roomId || !lastKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/rooms/${roomId}/posts?lastKey=${encodeURIComponent(lastKey)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!res.ok) throw new Error(`Failed to load more posts (${res.status})`);
      const data = await res.json() as { posts: PostItem[]; lastKey?: string };
      setPosts((prev) => [...prev, ...(data.posts ?? [])]);
      setLastKey(data.lastKey);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, roomId, lastKey, baseUrl]);  

  // ---- createPost ----------------------------------------------------------

  const createPost = useCallback(async (content: string): Promise<void> => {
    if (!idToken || !roomId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Failed to create post (${res.status})`);
      const post = await res.json() as PostItem;
      setPosts((prev) => [post, ...prev]);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [idToken, roomId, baseUrl]);  

  // ---- editPost ------------------------------------------------------------

  const editPost = useCallback(async (postId: string, content: string): Promise<void> => {
    if (!idToken || !roomId) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/posts/${postId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Failed to edit post (${res.status})`);
      const updated = await res.json() as PostItem;
      setPosts((prev) => prev.map((p) => (p.postId === postId ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, roomId, baseUrl]);  

  // ---- deletePost ----------------------------------------------------------

  const deletePost = useCallback(async (postId: string): Promise<void> => {
    if (!idToken || !roomId) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/posts/${postId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to delete post (${res.status})`);
      setPosts((prev) => prev.filter((p) => p.postId !== postId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, roomId, baseUrl]);  

  // ---- getUserPosts (CONT-05) -----------------------------------------------

  const getUserPosts = useCallback(async (userId: string): Promise<PostItem[]> => {
    if (!idToken) return [];
    const res = await fetch(`${baseUrl}/api/posts/${userId}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) throw new Error(`Failed to load user posts (${res.status})`);
    return ((await res.json()) as { posts: PostItem[] }).posts;
  }, [idToken, baseUrl]);  

  return {
    posts,
    createPost,
    editPost,
    deletePost,
    getUserPosts,
    loading,
    error,
    hasMore: lastKey !== undefined,
    loadMore,
  };
}
