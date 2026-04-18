// frontend/src/hooks/useDocumentMetadata.ts
//
// Observes the `meta` Y.Map on a given Y.Doc and exposes a typed
// React state + a transactional updater.

import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type { DocumentMeta } from '../types/document';

export interface UseDocumentMetadataReturn {
  meta: DocumentMeta | null;
  updateMeta: (partial: Partial<DocumentMeta>) => void;
}

function yMapToObject<T>(ymap: Y.Map<unknown>): T {
  const obj: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    obj[key] = value;
  });
  return obj as T;
}

export function useDocumentMetadata(
  ydoc: Y.Doc | null,
): UseDocumentMetadataReturn {
  const [meta, setMeta] = useState<DocumentMeta | null>(null);

  useEffect(() => {
    if (!ydoc) {
      setMeta(null);
      return;
    }
    const yMeta = ydoc.getMap('meta');
    const observer = () => {
      if (yMeta.size > 0) {
        setMeta(yMapToObject<DocumentMeta>(yMeta));
      }
    };
    yMeta.observe(observer);
    // Initial read (snapshot may already be applied)
    observer();
    return () => {
      yMeta.unobserve(observer);
    };
  }, [ydoc]);

  const updateMeta = useCallback(
    (partial: Partial<DocumentMeta>) => {
      if (!ydoc) return;
      const yMeta = ydoc.getMap('meta');
      ydoc.transact(() => {
        for (const [key, value] of Object.entries(partial)) {
          yMeta.set(key, value);
        }
      });
    },
    [ydoc],
  );

  return { meta, updateMeta };
}
