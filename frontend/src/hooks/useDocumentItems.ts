// frontend/src/hooks/useDocumentItems.ts
//
// REST + WebSocket hook for per-section action items (tasks). Fetches initial
// state from social-api and applies real-time updates via document-events WS.
// Completely independent of Y.js.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GatewayMessage } from '../types/gateway';
import type { TaskItem } from '../types/document';
import { SOCIAL_API_URL } from '../utils/socialApi';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseDocumentItemsOptions {
  documentId: string;
  /** Section IDs to load items for. Items are fetched per-section. */
  sectionIds: string[];
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: string;
}

export interface UseDocumentItemsReturn {
  items: Record<string, TaskItem[]>;  // sectionId -> items
  addItem: (sectionId: string, item: Partial<TaskItem>) => Promise<void>;
  updateItem: (sectionId: string, itemId: string, updates: Partial<TaskItem>) => Promise<void>;
  removeItem: (sectionId: string, itemId: string) => Promise<void>;
  ackItem: (sectionId: string, itemId: string) => Promise<void>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentItems(
  options: UseDocumentItemsOptions,
): UseDocumentItemsReturn {
  const { documentId, sectionIds, idToken, sendMessage, onMessage, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [items, setItems] = useState<Record<string, TaskItem[]>>({});
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

  // Stable serialized sectionIds for dependency tracking
  const sectionIdsKey = sectionIds.join(',');

  // ---- Fetch initial items on mount / documentId / sectionIds change -------
  useEffect(() => {
    if (!documentId || !idToken || sectionIds.length === 0) return;

    setLoading(true);

    // Fetch items for each section in parallel
    const fetches = sectionIds.map(async (sectionId) => {
      try {
        const res = await fetch(
          `${SOCIAL_API_URL}/api/documents/${documentId}/sections/${sectionId}/items`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        if (!res.ok) throw new Error(`Failed to load items for section ${sectionId} (${res.status})`);
        const data = (await res.json()) as { items: TaskItem[] };
        return { sectionId, items: data.items ?? [] };
      } catch (err) {
        console.warn(`[useDocumentItems] fetch error for section ${sectionId}:`, (err as Error).message);
        return { sectionId, items: [] as TaskItem[] };
      }
    });

    Promise.all(fetches)
      .then((results) => {
        const grouped: Record<string, TaskItem[]> = {};
        for (const { sectionId, items: sectionItems } of results) {
          grouped[sectionId] = sectionItems;
        }
        setItems(grouped);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [documentId, idToken, sectionIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: document-events subscription is managed centrally by DocumentEditorPage,
  // not by individual hooks. This avoids one hook's cleanup unsubscribing all hooks.

  // ---- WebSocket message handler -------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      // Item events are broadcast via social:post on doc:{documentId} channel
      const eventType = msg.type;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      const msgDocId = payload.documentId as string | undefined;
      if (msgDocId && msgDocId !== documentIdRef.current) return;

      // section:item:created
      if (eventType === 'social:post' && payload.type === 'section:item:created') {
        const sectionId = payload.sectionId as string | undefined;
        const item = payload.item as TaskItem | undefined;
        if (!sectionId || !item) return;

        setItems((prev) => {
          const existing = prev[sectionId] ?? [];
          if (existing.some((i) => i.id === item.id)) return prev;
          return { ...prev, [sectionId]: [...existing, item] };
        });
        return;
      }

      // section:item:updated
      if (eventType === 'social:post' && payload.type === 'section:item:updated') {
        const sectionId = payload.sectionId as string | undefined;
        const itemId = payload.itemId as string | undefined;
        const updates = payload.updates as Partial<TaskItem> | undefined;
        if (!sectionId || !itemId || !updates) return;

        setItems((prev) => {
          const existing = prev[sectionId];
          if (!existing) return prev;
          return {
            ...prev,
            [sectionId]: existing.map((i) =>
              i.id === itemId ? { ...i, ...updates } : i,
            ),
          };
        });
        return;
      }

      // section:item:deleted
      if (eventType === 'social:post' && payload.type === 'section:item:deleted') {
        const sectionId = payload.sectionId as string | undefined;
        const itemId = payload.itemId as string | undefined;
        if (!sectionId || !itemId) return;

        setItems((prev) => {
          const existing = prev[sectionId];
          if (!existing) return prev;
          return {
            ...prev,
            [sectionId]: existing.filter((i) => i.id !== itemId),
          };
        });
        return;
      }

      // section:item:acked
      if (eventType === 'social:post' && payload.type === 'section:item:acked') {
        const sectionId = payload.sectionId as string | undefined;
        const itemId = payload.itemId as string | undefined;
        const ackedBy = payload.ackedBy as string | undefined;
        if (!sectionId || !itemId) return;

        setItems((prev) => {
          const existing = prev[sectionId];
          if (!existing) return prev;
          return {
            ...prev,
            [sectionId]: existing.map((i) =>
              i.id === itemId
                ? { ...i, status: 'acked' as const, ackedBy: ackedBy ?? i.ackedBy, ackedAt: new Date().toISOString() }
                : i,
            ),
          };
        });
        return;
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- addItem --------------------------------------------------------------
  const addItem = useCallback(
    async (sectionId: string, item: Partial<TaskItem>): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/sections/${sectionId}/items`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(item),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to add item (${res.status})`);
      }

      const data = (await res.json()) as { item: TaskItem };
      setItems((prev) => {
        const existing = prev[sectionId] ?? [];
        if (existing.some((i) => i.id === data.item.id)) return prev;
        return { ...prev, [sectionId]: [...existing, data.item] };
      });
    },
    [idToken, authHeaders],
  );

  // ---- updateItem -----------------------------------------------------------
  const updateItem = useCallback(
    async (sectionId: string, itemId: string, updates: Partial<TaskItem>): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/sections/${sectionId}/items/${itemId}`,
        {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify(updates),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to update item (${res.status})`);
      }

      const data = (await res.json()) as { item: TaskItem };
      setItems((prev) => {
        const existing = prev[sectionId];
        if (!existing) return prev;
        return {
          ...prev,
          [sectionId]: existing.map((i) => (i.id === itemId ? data.item : i)),
        };
      });
    },
    [idToken, authHeaders],
  );

  // ---- removeItem -----------------------------------------------------------
  const removeItem = useCallback(
    async (sectionId: string, itemId: string): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/sections/${sectionId}/items/${itemId}`,
        {
          method: 'DELETE',
          headers: authHeaders,
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to remove item (${res.status})`);
      }

      setItems((prev) => {
        const existing = prev[sectionId];
        if (!existing) return prev;
        return {
          ...prev,
          [sectionId]: existing.filter((i) => i.id !== itemId),
        };
      });
    },
    [idToken, authHeaders],
  );

  // ---- ackItem --------------------------------------------------------------
  const ackItem = useCallback(
    async (sectionId: string, itemId: string): Promise<void> => {
      if (!idToken) return;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/sections/${sectionId}/items/${itemId}/ack`,
        {
          method: 'POST',
          headers: authHeaders,
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to acknowledge item (${res.status})`);
      }

      const data = (await res.json()) as { item: TaskItem };
      setItems((prev) => {
        const existing = prev[sectionId];
        if (!existing) return prev;
        return {
          ...prev,
          [sectionId]: existing.map((i) => (i.id === itemId ? data.item : i)),
        };
      });
    },
    [idToken, authHeaders],
  );

  return { items, addItem, updateItem, removeItem, ackItem, loading };
}
