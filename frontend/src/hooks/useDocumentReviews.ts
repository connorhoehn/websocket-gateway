// frontend/src/hooks/useDocumentReviews.ts
//
// REST + WebSocket hook for per-section reviews. Fetches initial state from
// social-api and applies real-time updates via the document-events WS service.
// Completely independent of Y.js.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GatewayMessage } from '../types/gateway';
import type { SectionReview } from '../types/document';
import { SOCIAL_API_URL } from '../utils/socialApi';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseDocumentReviewsOptions {
  documentId: string;
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: string;
}

export interface UseDocumentReviewsReturn {
  sectionReviews: Record<string, SectionReview[]>;  // sectionId -> reviews
  reviewSection: (sectionId: string, status: string, comment?: string) => Promise<void>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group flat reviews by sectionId. */
function groupBySection(
  reviews: Array<SectionReview & { sectionId?: string }>,
): Record<string, SectionReview[]> {
  const result: Record<string, SectionReview[]> = {};
  for (const r of reviews) {
    const sid = r.sectionId ?? '__unknown';
    if (!result[sid]) result[sid] = [];
    // Strip sectionId from the object stored in state (it's the map key)
    const { sectionId: _sid, ...review } = r;
    result[sid].push(review as SectionReview);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentReviews(
  options: UseDocumentReviewsOptions,
): UseDocumentReviewsReturn {
  const { documentId, idToken, sendMessage, onMessage, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [sectionReviews, setSectionReviews] = useState<Record<string, SectionReview[]>>({});
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

  // ---- Fetch initial reviews on mount / documentId change ------------------
  useEffect(() => {
    if (!documentId || !idToken || !SOCIAL_API_URL) return;

    setLoading(true);
    fetch(`${SOCIAL_API_URL}/api/documents/${documentId}/reviews`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`);
        return res.json() as Promise<{ reviews: Array<SectionReview & { sectionId?: string }> }>;
      })
      .then((data) => {
        setSectionReviews(groupBySection(data.reviews ?? []));
      })
      .catch((err: Error) => {
        console.warn('[useDocumentReviews] fetch error:', err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [documentId, idToken]);

  // ---- Subscribe to document-events WS service ----------------------------
  // The comments hook also subscribes — the gateway handles duplicate subscriptions
  // gracefully, so both hooks can independently subscribe/unsubscribe.
  useEffect(() => {
    if (connectionState !== 'connected' || !documentId) return;

    sendMessage({
      service: 'document-events',
      action: 'subscribe',
      documentId,
    });

    return () => {
      sendMessageRef.current({
        service: 'document-events',
        action: 'unsubscribe',
        documentId,
      });
    };
  }, [documentId, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- WebSocket message handler -------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      // Reviews are broadcast via social:post on the doc:{documentId} channel
      // with payload.type === 'section:review'
      const eventType = msg.type;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      const msgDocId = payload.documentId as string | undefined;
      if (msgDocId && msgDocId !== documentIdRef.current) return;

      // Handle review submitted event
      if (eventType === 'social:post' && payload.type === 'section:review') {
        const sectionId = payload.sectionId as string | undefined;
        const review = payload.review as SectionReview | undefined;
        if (!sectionId || !review) return;

        setSectionReviews((prev) => {
          const existing = prev[sectionId] ?? [];
          // Replace if same user already reviewed, otherwise append
          const idx = existing.findIndex((r) => r.userId === review.userId);
          const updated = [...existing];
          if (idx >= 0) {
            updated[idx] = review;
          } else {
            updated.push(review);
          }
          return { ...prev, [sectionId]: updated };
        });
        return;
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- reviewSection --------------------------------------------------------
  const reviewSection = useCallback(
    async (sectionId: string, status: string, comment?: string): Promise<void> => {
      if (!idToken || !SOCIAL_API_URL) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/sections/${sectionId}/reviews`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            status,
            ...(comment !== undefined ? { comment } : {}),
          }),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to submit review (${res.status})`);
      }

      // Optimistic update from response
      const data = (await res.json()) as { review: SectionReview };
      setSectionReviews((prev) => {
        const existing = prev[sectionId] ?? [];
        const idx = existing.findIndex((r) => r.userId === data.review.userId);
        const updated = [...existing];
        if (idx >= 0) {
          updated[idx] = data.review;
        } else {
          updated.push(data.review);
        }
        return { ...prev, [sectionId]: updated };
      });
    },
    [idToken, authHeaders],
  );

  return { sectionReviews, reviewSection, loading };
}
