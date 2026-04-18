// frontend/src/hooks/useCollaborativeDoc.ts
//
// Thin composer hook. Delegates to focused sub-hooks:
//   useYjsDoc          — Y.Doc + provider + WS wiring + synced
//   useDocumentMetadata — doc meta observer + updater
//   useSectionList      — section CRUD, item CRUD, comments, rich-text
//   useAwareness        — participants + central awareness writer
//   useDocumentExport   — exportJSON serialization
//
// This file exists purely to preserve the original public API
// (`UseCollaborativeDocReturn`) so consumers like DocumentEditorPage
// don't have to change.

import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { GatewayProvider } from '../providers/GatewayProvider';
import { useYjsDoc } from './useYjsDoc';
import { useDocumentMetadata } from './useDocumentMetadata';
import { useSectionList } from './useSectionList';
import { useAwareness } from './useAwareness';
import { useDocumentExport } from './useDocumentExport';
import type { AwarenessUpdaters } from './useAwarenessState';
import type { UseWebSocketReturn } from './useWebSocket';
import type {
  DocumentMeta,
  Participant,
  Section,
  TaskItem,
  DocumentData,
  ViewMode,
  CommentThread,
  SectionReview,
} from '../types/document';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types (unchanged from the original monolithic hook)
// ---------------------------------------------------------------------------

export interface UseCollaborativeDocOptions {
  documentId: string;
  mode: ViewMode;
  ws: UseWebSocketReturn;
  userId: string;
  displayName: string;
  color: string;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
}

export interface UseCollaborativeDocReturn {
  meta: DocumentMeta | null;
  sections: Section[];
  synced: boolean;

  updateMeta: (partial: Partial<DocumentMeta>) => void;
  addSection: (section: Section) => void;
  updateSection: (sectionId: string, partial: Partial<Section>) => void;
  removeSection: (sectionId: string) => void;
  addItem: (sectionId: string, item: TaskItem) => void;
  updateItem: (
    sectionId: string,
    itemId: string,
    partial: Partial<TaskItem>,
  ) => void;
  ackItem: (sectionId: string, itemId: string, userId: string) => void;
  rejectItem: (sectionId: string, itemId: string, userId: string) => void;
  removeItem: (sectionId: string, itemId: string) => void;

  getSectionFragment: (sectionId: string) => Y.XmlFragment | null;

  ydoc: Y.Doc | null;
  provider: GatewayProvider | null;

  loadFromMarkdown: (markdown: string) => void;
  exportJSON: () => DocumentData | null;

  participants: Participant[];
  comments: Record<string, CommentThread[]>;

  addComment: (
    sectionId: string,
    opts: {
      text: string;
      userId: string;
      displayName: string;
      color: string;
      parentCommentId?: string | null;
    },
  ) => void;
  resolveThread: (
    sectionId: string,
    commentId: string,
    resolverDisplayName: string,
  ) => void;
  unresolveThread: (sectionId: string, commentId: string) => void;

  sectionReviews: Record<string, SectionReview[]>;
  reviewSection: (
    sectionId: string,
    status: SectionReview['status'],
    comment?: string,
  ) => void;

  awareness: AwarenessUpdaters;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function yMapToObject<T>(ymap: Y.Map<unknown>): T {
  const obj: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    obj[key] = value;
  });
  return obj as T;
}

export function useCollaborativeDoc(
  options: UseCollaborativeDocOptions,
): UseCollaborativeDocReturn {
  const { documentId, mode, ws, userId, displayName, color, onMessage } =
    options;

  // Core Y.Doc + provider + WS wiring.
  const { ydoc, provider, synced } = useYjsDoc({
    documentId,
    ws,
    onMessage,
  });

  // Sub-hooks observing the shared Y.Doc / provider.
  const { meta, updateMeta } = useDocumentMetadata(ydoc);
  const sectionApi = useSectionList(ydoc);
  const { awareness, participants } = useAwareness(provider, {
    userId,
    displayName,
    color,
    mode,
  });
  const { exportJSON } = useDocumentExport(ydoc);

  // ---- Section reviews (Y.Map at doc root) --------------------------------
  // Kept here because it's a small leaf responsibility that doesn't justify
  // its own file and doesn't compose with any other observer.
  const [sectionReviews, setSectionReviews] = useState<
    Record<string, SectionReview[]>
  >({});

  useEffect(() => {
    if (!ydoc) {
      setSectionReviews({});
      return;
    }
    const yReviews = ydoc.getMap('sectionReviews');
    const observer = () => {
      const next: Record<string, SectionReview[]> = {};
      yReviews.forEach((value, key) => {
        if (!(value instanceof Y.Map)) return;
        const review = yMapToObject<SectionReview>(value);
        const sectionId = key.split(':')[0];
        if (!next[sectionId]) next[sectionId] = [];
        next[sectionId].push(review);
      });
      setSectionReviews(next);
    };
    yReviews.observeDeep(observer);
    observer();
    return () => {
      yReviews.unobserveDeep(observer);
    };
  }, [ydoc]);

  const reviewSection = useCallback(
    (
      sectionId: string,
      status: SectionReview['status'],
      comment?: string,
    ) => {
      if (!ydoc) return;
      const yReviews = ydoc.getMap('sectionReviews');
      const key = `${sectionId}:${userId}`;
      ydoc.transact(() => {
        const yReview = new Y.Map<unknown>();
        yReview.set('userId', userId);
        yReview.set('displayName', displayName);
        yReview.set('status', status);
        yReview.set('timestamp', new Date().toISOString());
        if (comment) yReview.set('comment', comment);
        yReviews.set(key, yReview);
      });
    },
    [ydoc, userId, displayName],
  );

  // ---- Stubs ---------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadFromMarkdown = useCallback((_markdown: string) => {
    console.warn('loadFromMarkdown is not yet implemented');
  }, []);

  // ---- Preserve original return shape --------------------------------------
  return {
    meta,
    sections: sectionApi.sections,
    synced,

    updateMeta,
    addSection: sectionApi.addSection,
    updateSection: sectionApi.updateSection,
    removeSection: sectionApi.removeSection,
    addItem: sectionApi.addItem,
    updateItem: sectionApi.updateItem,
    removeItem: sectionApi.removeItem,
    ackItem: sectionApi.ackItem,
    rejectItem: sectionApi.rejectItem,

    getSectionFragment: sectionApi.getSectionFragment,

    ydoc,
    provider,

    loadFromMarkdown,
    exportJSON,

    participants,
    comments: sectionApi.comments,

    addComment: sectionApi.addComment,
    resolveThread: sectionApi.resolveThread,
    unresolveThread: sectionApi.unresolveThread,

    sectionReviews,
    reviewSection,

    awareness,
  };
}
