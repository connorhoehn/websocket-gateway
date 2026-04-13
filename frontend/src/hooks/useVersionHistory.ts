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
  name?: string;
  author?: string;
  type?: 'manual' | 'auto' | 'pre-restore';
}

/** Plain-object snapshot of a section for diffing (no Y.js references). */
export interface SnapshotSection {
  id: string;
  type: string;
  title: string;
  /** Plain text extracted from the section's rich-text content. */
  textContent: string;
  items: Array<{
    id: string;
    text: string;
    status: string;
    assignee: string;
    priority: string;
  }>;
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
  /** Save a named version snapshot. */
  saveVersion: (name: string) => void;
  /** Extract sections as plain JSON from a Y.Doc (live or preview). */
  extractSections: (doc: Y.Doc) => SnapshotSection[];
  /** Compare sections: load preview for a given timestamp, returns sections via callback. */
  compareSections: SnapshotSection[] | null;
  compareTimestamp: number | null;
  compareVersion: (timestamp: number) => void;
  clearCompare: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract sections as plain JSON from a Y.Doc.
 * Reads the Y.Array<Y.Map> at 'sections' and converts each to a SnapshotSection.
 */
function extractSectionsFromDoc(doc: Y.Doc): SnapshotSection[] {
  const yArr = doc.getArray('sections');
  const result: SnapshotSection[] = [];

  for (let i = 0; i < yArr.length; i++) {
    const yMap = yArr.get(i) as Y.Map<unknown>;
    if (!yMap || typeof yMap.get !== 'function') continue;

    const id = (yMap.get('id') as string) ?? '';
    const type = (yMap.get('type') as string) ?? 'tasks';
    const title = (yMap.get('title') as string) ?? '';

    const yItems = yMap.get('items') as Y.Array<Y.Map<unknown>> | undefined;
    const items: SnapshotSection['items'] = [];

    if (yItems && typeof yItems.toArray === 'function') {
      for (const yItem of yItems.toArray()) {
        if (!yItem || typeof (yItem as Y.Map<unknown>).get !== 'function') continue;
        const m = yItem as Y.Map<unknown>;
        items.push({
          id: (m.get('id') as string) ?? '',
          text: (m.get('text') as string) ?? '',
          status: (m.get('status') as string) ?? 'pending',
          assignee: (m.get('assignee') as string) ?? '',
          priority: (m.get('priority') as string) ?? 'medium',
        });
      }
    }

    // Extract rich-text content as plain text
    let textContent = '';
    const content = yMap.get('content');
    if (content && typeof (content as Y.XmlFragment).toString === 'function') {
      // XmlFragment.toString() returns XML markup; strip tags for plain text comparison
      textContent = (content as Y.XmlFragment).toString()
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    result.push({ id, type, title, textContent, items });
  }

  return result;
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
  const [compareSections, setCompareSections] = useState<SnapshotSection[] | null>(null);
  const [compareTimestamp, setCompareTimestamp] = useState<number | null>(null);

  const previewDocRef = useRef<Y.Doc | null>(null);
  const compareDocRef = useRef<Y.Doc | null>(null);
  /** When true, the next incoming snapshot is for a compare operation. */
  const pendingCompareRef = useRef(false);

  // Register message handler via the onMessage registrar
  useEffect(() => {
    const handler = (msg: GatewayMessage) => {
      // Handle error responses — clear loading state so UI doesn't hang
      if (msg.type === 'error' && (msg as Record<string, unknown>).service === 'crdt') {
        setLoading(false);
        return;
      }

      if (msg.type !== 'crdt') return;
      if (msg.channel !== channel) return;

      switch (msg.action) {
        case 'snapshotList': {
          const list = msg['snapshots'] as Array<{
            timestamp: number;
            age: number;
            name?: string;
            author?: string;
            type?: 'manual' | 'auto' | 'pre-restore';
          }> | undefined;
          setVersions(list ?? []);
          setLoading(false);
          break;
        }
        case 'snapshot': {
          // Only handle version preview snapshots (flagged with version: true)
          if (!msg['version']) break;
          const update = msg['update'] as string | undefined;
          if (!update) break;

          const doc = new Y.Doc({ gc: false });
          const bytes = fromBase64(update);
          Y.applyUpdate(doc, bytes);

          // Route to compare or preview based on pending flag
          if (pendingCompareRef.current) {
            pendingCompareRef.current = false;
            if (compareDocRef.current) compareDocRef.current.destroy();
            compareDocRef.current = doc;
            setCompareSections(extractSectionsFromDoc(doc));
          } else {
            // Clean up previous preview doc
            if (previewDocRef.current) previewDocRef.current.destroy();
            previewDocRef.current = doc;
            setPreviewDoc(doc);
          }
          break;
        }
        case 'versionSaved': {
          // After saving a version, refresh the list
          setLoading(true);
          sendMessage({
            service: 'crdt',
            action: 'listSnapshots',
            channel,
            limit: 20,
          });
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

  // Cleanup preview/compare docs on unmount
  useEffect(() => {
    return () => {
      if (previewDocRef.current) {
        previewDocRef.current.destroy();
        previewDocRef.current = null;
      }
      if (compareDocRef.current) {
        compareDocRef.current.destroy();
        compareDocRef.current = null;
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

  const saveVersion = useCallback((name: string) => {
    sendMessage({
      service: 'crdt',
      action: 'saveVersion',
      channel,
      name,
    });
  }, [channel, sendMessage]);

  const extractSections = useCallback((doc: Y.Doc): SnapshotSection[] => {
    return extractSectionsFromDoc(doc);
  }, []);

  const compareVersion = useCallback((timestamp: number) => {
    pendingCompareRef.current = true;
    setCompareTimestamp(timestamp);
    sendMessage({
      service: 'crdt',
      action: 'getSnapshotAtVersion',
      channel,
      timestamp,
    });
  }, [channel, sendMessage]);

  const clearCompare = useCallback(() => {
    if (compareDocRef.current) {
      compareDocRef.current.destroy();
      compareDocRef.current = null;
    }
    setCompareSections(null);
    setCompareTimestamp(null);
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
    saveVersion,
    extractSections,
    compareSections,
    compareTimestamp,
    compareVersion,
    clearCompare,
  };
}
