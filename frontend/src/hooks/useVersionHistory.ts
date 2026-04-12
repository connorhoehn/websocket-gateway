// frontend/src/hooks/useVersionHistory.ts
//
// Hook for listing, previewing, and restoring document version snapshots.
// Communicates with the CRDT service through the gateway WebSocket.

import { useState, useCallback, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VersionEntry {
  timestamp: number;
  age: number;
}

export interface UseVersionHistoryOptions {
  channel: string;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
}

export interface UseVersionHistoryReturn {
  versions: VersionEntry[];
  loading: boolean;
  fetchVersions: () => void;
  previewVersion: (timestamp: number) => void;
  restoreVersion: (timestamp: number) => void;
  previewDoc: Y.Doc | null;
  previewTimestamp: number | null;
  clearPreview: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVersionHistory(
  options: UseVersionHistoryOptions,
): UseVersionHistoryReturn {
  const { channel, sendMessage, onMessage } = options;

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Y.Doc | null>(null);
  const [previewTimestamp, setPreviewTimestamp] = useState<number | null>(null);

  const previewDocRef = useRef<Y.Doc | null>(null);

  // Register message handler via the onMessage registrar
  useEffect(() => {
    const handler = (msg: GatewayMessage) => {
      if (msg.type !== 'crdt') return;
      if (msg.channel !== channel) return;

      switch (msg.action) {
        case 'snapshotList': {
          const list = msg['snapshots'] as Array<{ timestamp: number; age: number }> | undefined;
          setVersions(list ?? []);
          setLoading(false);
          break;
        }
        case 'snapshot': {
          // Only handle version preview snapshots (flagged with version: true)
          if (!msg['version']) break;
          const update = msg['update'] as string | undefined;
          if (!update) break;

          // Clean up previous preview doc
          if (previewDocRef.current) {
            previewDocRef.current.destroy();
          }

          const doc = new Y.Doc({ gc: false });
          const bytes = fromBase64(update);
          Y.applyUpdate(doc, bytes);
          previewDocRef.current = doc;
          setPreviewDoc(doc);
          break;
        }
        case 'snapshotRestored': {
          // After restore, refresh the version list
          setLoading(true);
          sendMessage({
            service: 'crdt',
            action: 'listSnapshots',
            channel,
            limit: 20,
          });
          break;
        }
      }
    };

    const unregister = onMessage(handler);
    return unregister;
  }, [channel, onMessage, sendMessage]);

  // Cleanup preview doc on unmount
  useEffect(() => {
    return () => {
      if (previewDocRef.current) {
        previewDocRef.current.destroy();
        previewDocRef.current = null;
      }
    };
  }, []);

  const fetchVersions = useCallback(() => {
    setLoading(true);
    sendMessage({
      service: 'crdt',
      action: 'listSnapshots',
      channel,
      limit: 20,
    });
  }, [channel, sendMessage]);

  const previewVersion = useCallback((timestamp: number) => {
    setPreviewTimestamp(timestamp);
    sendMessage({
      service: 'crdt',
      action: 'getSnapshotAtVersion',
      channel,
      timestamp,
    });
  }, [channel, sendMessage]);

  const restoreVersion = useCallback((timestamp: number) => {
    sendMessage({
      service: 'crdt',
      action: 'restoreSnapshot',
      channel,
      timestamp,
    });
  }, [channel, sendMessage]);

  const clearPreview = useCallback(() => {
    if (previewDocRef.current) {
      previewDocRef.current.destroy();
      previewDocRef.current = null;
    }
    setPreviewDoc(null);
    setPreviewTimestamp(null);
  }, []);

  return {
    versions,
    loading,
    fetchVersions,
    previewVersion,
    restoreVersion,
    previewDoc,
    previewTimestamp,
    clearPreview,
  };
}
