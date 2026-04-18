// frontend/src/hooks/useDocumentExport.ts
//
// Exports the current Y.Doc state as a plain JSON DocumentData object.

import { useCallback } from 'react';
import * as Y from 'yjs';
import type {
  DocumentData,
  DocumentMeta,
  Section,
  TaskItem,
} from '../types/document';

function yMapToObject<T>(ymap: Y.Map<unknown>): T {
  const obj: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    obj[key] = value;
  });
  return obj as T;
}

function yItemsToArray(yarray: Y.Array<Y.Map<unknown>>): TaskItem[] {
  const result: TaskItem[] = [];
  yarray.forEach((ymap) => {
    result.push(yMapToObject<TaskItem>(ymap));
  });
  return result;
}

function yArrayToSections(yarray: Y.Array<Y.Map<unknown>>): Section[] {
  const result: Section[] = [];
  yarray.forEach((ymap) => {
    const section = yMapToObject<Section>(ymap);
    const yItems = ymap.get('items');
    if (yItems instanceof Y.Array) {
      section.items = yItemsToArray(yItems);
    } else {
      section.items = [];
    }
    result.push(section);
  });
  return result;
}

export interface UseDocumentExportReturn {
  exportJSON: () => DocumentData | null;
}

export function useDocumentExport(
  ydoc: Y.Doc | null,
): UseDocumentExportReturn {
  const exportJSON = useCallback((): DocumentData | null => {
    if (!ydoc) return null;
    const yMeta = ydoc.getMap('meta');
    if (yMeta.size === 0) return null;
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    return {
      meta: yMapToObject<DocumentMeta>(yMeta),
      sections: yArrayToSections(ySections),
    };
  }, [ydoc]);

  return { exportJSON };
}
