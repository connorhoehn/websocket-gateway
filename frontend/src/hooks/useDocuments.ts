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
}

export interface DocumentPresenceUser {
  userId: string;
  displayName: string;
  color: string;
  mode: string;
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

// Presence polling interval in milliseconds
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

  // Keep stable references for use inside effects without stale closures
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // ---- Message handler -----------------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
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

      if (msg.action === 'documentPresence') {
        const incoming = msg.presence as Record<string, DocumentPresenceUser[]> | undefined;
        if (incoming) {
          setPresence(incoming);
        }
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Fetch on connect ----------------------------------------------------
  useEffect(() => {
    if (connectionState !== 'connected') return;

    // Request document list and presence on connect
    sendMessage({ service: 'crdt', action: 'listDocuments' });
    sendMessage({ service: 'crdt', action: 'getDocumentPresence' });

    // Start presence polling
    presencePollRef.current = setInterval(() => {
      sendMessageRef.current({ service: 'crdt', action: 'getDocumentPresence' });
    }, PRESENCE_POLL_INTERVAL_MS);

    return () => {
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
