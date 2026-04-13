// frontend/src/hooks/useDocumentComments.ts
//
// REST + WebSocket hook for document comments. Fetches initial state from
// social-api and applies real-time updates via the document-events WS service.
// Completely independent of Y.js.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GatewayMessage } from '../types/gateway';
import type { CommentData, CommentThread } from '../types/document';
import { SOCIAL_API_URL } from '../utils/socialApi';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseDocumentCommentsOptions {
  documentId: string;
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: string;
}

export interface UseDocumentCommentsReturn {
  comments: Record<string, CommentThread[]>;  // sectionId -> threads
  addComment: (sectionId: string, text: string, parentCommentId?: string | null) => Promise<void>;
  resolveThread: (sectionId: string, commentId: string) => Promise<void>;
  unresolveThread: (sectionId: string, commentId: string) => Promise<void>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a nested CommentThread tree from a flat comment array. */
function buildCommentTree(flat: CommentData[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  const roots: CommentThread[] = [];

  // Create thread nodes
  for (const c of flat) {
    map.set(c.id, { ...c, replies: [] });
  }

  // Link children to parents
  for (const c of flat) {
    const node = map.get(c.id)!;
    if (c.parentCommentId && map.has(c.parentCommentId)) {
      map.get(c.parentCommentId)!.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Normalize API comment (which uses `commentId`) to frontend CommentData (which uses `id`). */
function normalizeComment(raw: Record<string, unknown>): CommentData & { sectionId?: string } {
  return {
    ...(raw as CommentData & { sectionId?: string }),
    id: (raw.id as string) ?? (raw.commentId as string) ?? '',
  };
}

/** Group flat comments by sectionId and build trees for each section. */
function groupBySectionAndBuildTrees(
  flatComments: CommentData[],
): Record<string, CommentThread[]> {
  const bySection = new Map<string, CommentData[]>();
  for (const c of flatComments) {
    const sid = (c as CommentData & { sectionId?: string }).sectionId ?? '__unknown';
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid)!.push(c);
  }

  const result: Record<string, CommentThread[]> = {};
  for (const [sectionId, comments] of bySection) {
    result[sectionId] = buildCommentTree(comments);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentComments(
  options: UseDocumentCommentsOptions,
): UseDocumentCommentsReturn {
  const { documentId, idToken, sendMessage, onMessage, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  // Store flat comments internally; derive trees via useMemo
  const [flatComments, setFlatComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(false);

  // ---- Stable refs ----------------------------------------------------------
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const documentIdRef = useRef(documentId);
  useEffect(() => { documentIdRef.current = documentId; }, [documentId]);

  const authHeaders = useMemo(() => {
    if (!idToken) return {};
    return {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  }, [idToken]);

  // ---- Fetch initial comments on mount / documentId change -----------------
  useEffect(() => {
    if (!documentId || !idToken) return;

    setLoading(true);
    fetch(`${SOCIAL_API_URL}/api/documents/${documentId}/comments`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
        return res.json() as Promise<{ comments: CommentData[] }>;
      })
      .then((data) => {
        setFlatComments((data.comments ?? []).map((c: Record<string, unknown>) => normalizeComment(c)));
      })
      .catch((err: Error) => {
        console.warn('[useDocumentComments] fetch error:', err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [documentId, idToken]);

  // NOTE: document-events subscription is managed centrally by DocumentEditorPage,
  // not by individual hooks. This avoids one hook's cleanup unsubscribing all hooks.

  // ---- WebSocket message handler -------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      // Comment events arrive as channel messages with type set to the event type
      // and payload containing the data.
      const eventType = msg.type;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      // Only handle events for our document
      const msgDocId = payload.documentId as string | undefined;
      if (msgDocId && msgDocId !== documentIdRef.current) return;

      if (eventType === 'doc:comment_added') {
        const raw = payload.comment as Record<string, unknown> | undefined;
        if (!raw) return;
        const comment = normalizeComment(raw);
        setFlatComments((prev) => {
          if (prev.some((c) => c.id === comment.id)) return prev;
          return [...prev, comment];
        });
        return;
      }

      if (eventType === 'doc:comment_resolved') {
        const commentId = payload.commentId as string | undefined;
        const resolved = payload.resolved as boolean;
        if (!commentId) return;
        setFlatComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  resolved,
                  ...(resolved
                    ? {
                        resolvedBy: payload.resolvedBy as string,
                        resolvedAt: payload.resolvedAt as string,
                      }
                    : { resolvedBy: undefined, resolvedAt: undefined }),
                }
              : c,
          ),
        );
        return;
      }

      if (eventType === 'doc:comment_deleted') {
        const commentId = payload.commentId as string | undefined;
        if (!commentId) return;
        setFlatComments((prev) => prev.filter((c) => c.id !== commentId));
        return;
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Derived: grouped + threaded comments --------------------------------
  const comments = useMemo(
    () => groupBySectionAndBuildTrees(flatComments),
    [flatComments],
  );

  // ---- addComment -----------------------------------------------------------
  const addComment = useCallback(
    async (sectionId: string, text: string, parentCommentId?: string | null): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/comments`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            sectionId,
            text,
            ...(parentCommentId ? { parentCommentId } : {}),
          }),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to add comment (${res.status})`);
      }

      // The broadcast will update other clients; optimistically add to local state
      const data = (await res.json()) as { comment: Record<string, unknown> };
      const normalized = normalizeComment(data.comment);
      setFlatComments((prev) => {
        if (prev.some((c) => c.id === normalized.id)) return prev;
        return [...prev, normalized];
      });
    },
    [idToken, authHeaders],
  );

  // ---- resolveThread --------------------------------------------------------
  const resolveThread = useCallback(
    async (sectionId: string, commentId: string): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/comments/${commentId}`,
        {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ resolved: true }),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to resolve thread (${res.status})`);
      }

      // Optimistic update
      const data = (await res.json()) as { comment: { resolvedBy?: string; resolvedAt?: string } };
      setFlatComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                resolved: true,
                resolvedBy: data.comment.resolvedBy,
                resolvedAt: data.comment.resolvedAt,
              }
            : c,
        ),
      );
    },
    [idToken, authHeaders],
  );

  // ---- unresolveThread ------------------------------------------------------
  const unresolveThread = useCallback(
    async (sectionId: string, commentId: string): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/comments/${commentId}`,
        {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ resolved: false }),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to unresolve thread (${res.status})`);
      }

      // Optimistic update
      setFlatComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, resolved: false, resolvedBy: undefined, resolvedAt: undefined }
            : c,
        ),
      );
    },
    [idToken, authHeaders],
  );

  return { comments, addComment, resolveThread, unresolveThread, loading };
}
