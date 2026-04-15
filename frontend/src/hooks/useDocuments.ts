// frontend/src/hooks/useDocuments.ts
//
// Document management hook — lists, creates, deletes, and tracks presence
// across all documents in the workspace via the CRDT service.
//
// Composes on top of useWebSocket: accepts sendMessage / onMessage from that
// hook and handles the document protocol independently.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  id: string;
  title: string;
  type: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  description?: string;
  activeCallSessionId?: string;
}

export interface DocumentPresenceUser {
  userId: string;
  displayName: string;
  color: string;
  mode?: string;
  idle?: boolean;
}

export interface UseDocumentsOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: ConnectionState;
}

export interface UseDocumentsReturn {
  documents: DocumentInfo[];
  presence: Record<string, DocumentPresenceUser[]>;
  loading: boolean;
  createDocument: (meta: { title: string; type: string; description?: string }) => void;
  deleteDocument: (documentId: string) => void;
  updateDocumentMeta: (documentId: string, meta: Partial<DocumentInfo>) => void;
  refreshDocuments: () => void;
  refreshPresence: () => void;
}

// If no push-based presence arrives within this window, start polling.
const PRESENCE_PUSH_TIMEOUT_MS = 15_000;
// Polling interval once fallback is activated.
const PRESENCE_POLL_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort documents by updatedAt descending (newest first). */
function sortByUpdatedAt(docs: DocumentInfo[]): DocumentInfo[] {
  return [...docs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocuments(options: UseDocumentsOptions): UseDocumentsReturn {
  const { sendMessage, onMessage, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [presence, setPresence] = useState<Record<string, DocumentPresenceUser[]>>({});
  const [loading, setLoading] = useState(true);

  // ---- Refs ----------------------------------------------------------------
  const presencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set to true once we receive at least one push-based presence message. */
  const receivedPushRef = useRef(false);

  // Keep stable references for use inside effects without stale closures
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // ---- Message handler -----------------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      // Handle push-based documents:presence (broadcast from server on sub/unsub/disconnect)
      if (msg.type === 'documents:presence') {
        console.log('[useDocuments] Received push presence:', msg);
        receivedPushRef.current = true;
        const docs = msg.documents as Array<{ documentId: string; users: DocumentPresenceUser[] }> | undefined;
        if (docs) {
          const presenceMap: Record<string, DocumentPresenceUser[]> = {};
          for (const entry of docs) {
            // Strip "doc:" prefix from channel ID to match document IDs
            const docId = entry.documentId.startsWith('doc:')
              ? entry.documentId.slice(4)
              : entry.documentId;
            presenceMap[docId] = entry.users;
          }
          console.log('[useDocuments] Presence map after strip:', presenceMap);
          setPresence(presenceMap);
        }
        return;
      }

      if (msg.type !== 'crdt') return;

      if (msg.action === 'documentList') {
        const incoming = (msg.documents as DocumentInfo[] | undefined) ?? [];
        setDocuments(sortByUpdatedAt(incoming));
        setLoading(false);
        return;
      }

      if (msg.action === 'documentCreated') {
        const doc = msg.document as DocumentInfo | undefined;
        if (doc) {
          setDocuments((prev) => sortByUpdatedAt([doc, ...prev]));
        }
        return;
      }

      if (msg.action === 'documentDeleted') {
        const documentId = msg.documentId as string | undefined;
        if (documentId) {
          setDocuments((prev) => prev.filter((d) => d.id !== documentId));
        }
        return;
      }

      if (msg.action === 'documentMetaUpdated') {
        const documentId = msg.documentId as string | undefined;
        const meta = msg.meta as Partial<DocumentInfo> | undefined;
        if (documentId && meta) {
          setDocuments((prev) =>
            sortByUpdatedAt(
              prev.map((d) => (d.id === documentId ? { ...d, ...meta } : d)),
            ),
          );
        }
        return;
      }

      // Legacy poll-based response (kept for backwards compatibility)
      if (msg.action === 'documentPresence') {
        const incoming = msg.presence as Record<string, DocumentPresenceUser[]> | undefined;
        console.log('[useDocuments] Received poll presence:', incoming);
        if (incoming) {
          // Strip "doc:" prefix from keys to match document IDs
          const stripped: Record<string, DocumentPresenceUser[]> = {};
          for (const [key, users] of Object.entries(incoming)) {
            const docId = key.startsWith('doc:') ? key.slice(4) : key;
            stripped[docId] = users;
          }
          setPresence(stripped);
        }
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Fetch on connect ----------------------------------------------------
  useEffect(() => {
    console.log('[useDocuments] connectionState changed:', connectionState);
    if (connectionState !== 'connected') return;

    receivedPushRef.current = false;

    // Request document list on connect (slight delay to ensure WS is fully ready)
    const fetchTimer = setTimeout(() => {
      console.log('[useDocuments] Sending listDocuments + getDocumentPresence');
      sendMessageRef.current({ service: 'crdt', action: 'listDocuments' });
      sendMessageRef.current({ service: 'crdt', action: 'getDocumentPresence' });
    }, 100);
    const cleanupFetch = () => clearTimeout(fetchTimer);

    // Wait for push-based presence. If none arrives within the timeout, start polling.
    pushTimeoutRef.current = setTimeout(() => {
      if (!receivedPushRef.current) {
        // No push received — activate fallback polling
        presencePollRef.current = setInterval(() => {
          sendMessageRef.current({ service: 'crdt', action: 'getDocumentPresence' });
        }, PRESENCE_POLL_INTERVAL_MS);
      }
    }, PRESENCE_PUSH_TIMEOUT_MS);

    return () => {
      cleanupFetch();
      if (pushTimeoutRef.current !== null) {
        clearTimeout(pushTimeoutRef.current);
        pushTimeoutRef.current = null;
      }
      if (presencePollRef.current !== null) {
        clearInterval(presencePollRef.current);
        presencePollRef.current = null;
      }
      // Reset state when disconnected
      setDocuments([]);
      setPresence({});
      setLoading(true);
    };
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — we use sendMessageRef for stable access.

  // ---- Actions --------------------------------------------------------------

  const createDocument = useCallback(
    (meta: { title: string; type: string; description?: string }) => {
      sendMessageRef.current({ service: 'crdt', action: 'createDocument', meta });
    },
    [],
  );

  const deleteDocument = useCallback((documentId: string) => {
    sendMessageRef.current({ service: 'crdt', action: 'deleteDocument', documentId });
  }, []);

  const updateDocumentMeta = useCallback(
    (documentId: string, meta: Partial<DocumentInfo>) => {
      sendMessageRef.current({
        service: 'crdt',
        action: 'updateDocumentMeta',
        documentId,
        meta,
      });
    },
    [],
  );

  const refreshDocuments = useCallback(() => {
    sendMessageRef.current({ service: 'crdt', action: 'listDocuments' });
  }, []);

  const refreshPresence = useCallback(() => {
    sendMessageRef.current({ service: 'crdt', action: 'getDocumentPresence' });
  }, []);

  return {
    documents,
    presence,
    loading,
    createDocument,
    deleteDocument,
    updateDocumentMeta,
    refreshDocuments,
    refreshPresence,
  };
}
