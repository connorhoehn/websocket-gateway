// frontend/src/hooks/useSectionList.ts
//
// Observes the `sections` Y.Array on a given Y.Doc and exposes:
//  - `sections`: reactive plain-JS mirror
//  - Section CRUD (add / update / remove)
//  - Item CRUD (items live as a nested Y.Array on each section Y.Map)
//  - `getSectionFragment` — lazy Y.XmlFragment per section
//  - Comment helpers (comments live as a nested Y.Array on each section Y.Map)
//  - `comments` — threaded tree keyed by sectionId (derived from Y.js state)

import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type {
  Section,
  TaskItem,
  CommentData,
  CommentThread,
} from '../types/document';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function objectToYMap(
  ymap: Y.Map<unknown>,
  obj: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    ymap.set(key, value);
  }
}

function yCommentsToArray(yarray: Y.Array<Y.Map<unknown>>): CommentData[] {
  const result: CommentData[] = [];
  yarray.forEach((ymap) => {
    result.push(yMapToObject<CommentData>(ymap));
  });
  return result;
}

function buildCommentTree(flat: CommentData[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  const roots: CommentThread[] = [];
  for (const c of flat) {
    map.set(c.id, { ...c, replies: [] });
  }
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseSectionListReturn {
  sections: Section[];
  comments: Record<string, CommentThread[]>;

  // Section CRUD
  addSection: (section: Section) => void;
  updateSection: (sectionId: string, partial: Partial<Section>) => void;
  removeSection: (sectionId: string) => void;

  // Item CRUD
  addItem: (sectionId: string, item: TaskItem) => void;
  updateItem: (
    sectionId: string,
    itemId: string,
    partial: Partial<TaskItem>,
  ) => void;
  removeItem: (sectionId: string, itemId: string) => void;
  ackItem: (sectionId: string, itemId: string, userId: string) => void;
  rejectItem: (sectionId: string, itemId: string, userId: string) => void;

  // Rich-text fragment
  getSectionFragment: (sectionId: string) => Y.XmlFragment | null;

  // Comments
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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSectionList(ydoc: Y.Doc | null): UseSectionListReturn {
  const [sections, setSections] = useState<Section[]>([]);
  const [comments, setComments] = useState<Record<string, CommentThread[]>>(
    {},
  );

  useEffect(() => {
    if (!ydoc) {
      setSections([]);
      setComments({});
      return;
    }

    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const next = yArrayToSections(ySections);
        setSections(next);

        const nextComments: Record<string, CommentThread[]> = {};
        for (let i = 0; i < ySections.length; i++) {
          const ySection = ySections.get(i);
          const sectionId = ySection.get('id') as string;
          const yComments = ySection.get('comments');
          if (yComments instanceof Y.Array) {
            const flat = yCommentsToArray(
              yComments as Y.Array<Y.Map<unknown>>,
            );
            nextComments[sectionId] = buildCommentTree(flat);
          }
        }
        setComments(nextComments);
      }, 16);
    };

    ySections.observeDeep(observer);
    // Initial read
    observer();

    return () => {
      if (timer) clearTimeout(timer);
      ySections.unobserveDeep(observer);
    };
  }, [ydoc]);

  // ---- Internal lookups --------------------------------------------------

  const findSection = useCallback(
    (
      sectionId: string,
    ): { ySection: Y.Map<unknown>; index: number } | null => {
      if (!ydoc) return null;
      const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
      for (let i = 0; i < ySections.length; i++) {
        const ySection = ySections.get(i);
        if (ySection.get('id') === sectionId) {
          return { ySection, index: i };
        }
      }
      return null;
    },
    [ydoc],
  );

  const findItem = useCallback(
    (sectionId: string, itemId: string): Y.Map<unknown> | null => {
      const found = findSection(sectionId);
      if (!found) return null;
      const yItems = found.ySection.get('items');
      if (!(yItems instanceof Y.Array)) return null;
      for (let i = 0; i < yItems.length; i++) {
        const yItem = yItems.get(i) as Y.Map<unknown>;
        if (yItem.get('id') === itemId) return yItem;
      }
      return null;
    },
    [findSection],
  );

  const getOrCreateCommentsArray = useCallback(
    (sectionId: string): Y.Array<Y.Map<unknown>> | null => {
      if (!ydoc) return null;
      const found = findSection(sectionId);
      if (!found) return null;
      let commentsArr = found.ySection.get('comments');
      if (!(commentsArr instanceof Y.Array)) {
        commentsArr = new Y.Array<Y.Map<unknown>>();
        found.ySection.set('comments', commentsArr);
      }
      return commentsArr as Y.Array<Y.Map<unknown>>;
    },
    [ydoc, findSection],
  );

  // ---- Section CRUD ------------------------------------------------------

  const addSection = useCallback(
    (section: Section) => {
      if (!ydoc) return;
      const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
      ydoc.transact(() => {
        const ySection = new Y.Map<unknown>();
        const { items, ...rest } = section;
        objectToYMap(ySection, rest as unknown as Record<string, unknown>);
        const yItems = new Y.Array<Y.Map<unknown>>();
        for (const item of items) {
          const yItem = new Y.Map<unknown>();
          objectToYMap(yItem, item as unknown as Record<string, unknown>);
          yItems.push([yItem]);
        }
        ySection.set('items', yItems);
        ySections.push([ySection]);
      });
    },
    [ydoc],
  );

  const updateSection = useCallback(
    (sectionId: string, partial: Partial<Section>) => {
      if (!ydoc) return;
      const found = findSection(sectionId);
      if (!found) return;
      ydoc.transact(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { items: _items, ...rest } = partial;
        for (const [key, value] of Object.entries(rest)) {
          found.ySection.set(key, value);
        }
      });
    },
    [ydoc, findSection],
  );

  const removeSection = useCallback(
    (sectionId: string) => {
      if (!ydoc) return;
      const found = findSection(sectionId);
      if (!found) return;
      const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
      ydoc.transact(() => {
        ySections.delete(found.index, 1);
      });
    },
    [ydoc, findSection],
  );

  // ---- Item CRUD ---------------------------------------------------------

  const addItem = useCallback(
    (sectionId: string, item: TaskItem) => {
      if (!ydoc) return;
      const found = findSection(sectionId);
      if (!found) return;
      ydoc.transact(() => {
        let yItems = found.ySection.get('items');
        if (!(yItems instanceof Y.Array)) {
          yItems = new Y.Array<Y.Map<unknown>>();
          found.ySection.set('items', yItems);
        }
        const yItem = new Y.Map<unknown>();
        objectToYMap(yItem, item as unknown as Record<string, unknown>);
        (yItems as Y.Array<Y.Map<unknown>>).push([yItem]);
      });
    },
    [ydoc, findSection],
  );

  const updateItem = useCallback(
    (sectionId: string, itemId: string, partial: Partial<TaskItem>) => {
      if (!ydoc) return;
      const yItem = findItem(sectionId, itemId);
      if (!yItem) return;
      ydoc.transact(() => {
        for (const [key, value] of Object.entries(partial)) {
          yItem.set(key, value);
        }
      });
    },
    [ydoc, findItem],
  );

  const removeItem = useCallback(
    (sectionId: string, itemId: string) => {
      if (!ydoc) return;
      const found = findSection(sectionId);
      if (!found) return;
      const yItems = found.ySection.get('items');
      if (!(yItems instanceof Y.Array)) return;
      for (let i = 0; i < yItems.length; i++) {
        const yItem = yItems.get(i) as Y.Map<unknown>;
        if (yItem.get('id') === itemId) {
          ydoc.transact(() => {
            (yItems as Y.Array<Y.Map<unknown>>).delete(i, 1);
          });
          return;
        }
      }
    },
    [ydoc, findSection],
  );

  const ackItem = useCallback(
    (sectionId: string, itemId: string, ackUserId: string) => {
      updateItem(sectionId, itemId, {
        status: 'acked',
        ackedBy: ackUserId,
        ackedAt: new Date().toISOString(),
      });
    },
    [updateItem],
  );

  const rejectItem = useCallback(
    (sectionId: string, itemId: string, rejectUserId: string) => {
      updateItem(sectionId, itemId, {
        status: 'rejected',
        ackedBy: rejectUserId,
        ackedAt: new Date().toISOString(),
      });
    },
    [updateItem],
  );

  // ---- Rich-text fragment ------------------------------------------------

  const getSectionFragment = useCallback(
    (sectionId: string): Y.XmlFragment | null => {
      const found = findSection(sectionId);
      if (!found) return null;
      const fragment = found.ySection.get('content');
      if (fragment instanceof Y.XmlFragment) return fragment;
      // Defer creation to avoid mutating Y during render
      queueMicrotask(() => {
        if (!ydoc) return;
        const current = found.ySection.get('content');
        if (current instanceof Y.XmlFragment) return;
        ydoc.transact(() => {
          found.ySection.set('content', new Y.XmlFragment());
        });
      });
      return null;
    },
    [ydoc, findSection],
  );

  // ---- Comments ----------------------------------------------------------

  const addComment = useCallback(
    (
      sectionId: string,
      opts: {
        text: string;
        userId: string;
        displayName: string;
        color: string;
        parentCommentId?: string | null;
      },
    ) => {
      if (!ydoc) return;
      ydoc.transact(() => {
        const commentsArr = getOrCreateCommentsArray(sectionId);
        if (!commentsArr) return;
        const yComment = new Y.Map<unknown>();
        yComment.set('id', crypto.randomUUID());
        yComment.set('text', opts.text);
        yComment.set('userId', opts.userId);
        yComment.set('displayName', opts.displayName);
        yComment.set('color', opts.color);
        yComment.set('timestamp', new Date().toISOString());
        yComment.set('parentCommentId', opts.parentCommentId ?? null);
        commentsArr.push([yComment]);
      });
    },
    [ydoc, getOrCreateCommentsArray],
  );

  const resolveThread = useCallback(
    (sectionId: string, commentId: string, resolverDisplayName: string) => {
      if (!ydoc) return;
      const commentsArr = getOrCreateCommentsArray(sectionId);
      if (!commentsArr) return;
      let found = false;
      ydoc.transact(() => {
        for (let i = 0; i < commentsArr.length; i++) {
          const yComment = commentsArr.get(i) as Y.Map<unknown>;
          if (yComment.get('id') === commentId) {
            yComment.set('resolved', true);
            yComment.set('resolvedBy', resolverDisplayName);
            yComment.set('resolvedAt', new Date().toISOString());
            found = true;
            break;
          }
        }
      });
      if (!found) {
        console.warn(
          `resolveThread: comment ${commentId} not found in section ${sectionId}`,
        );
      }
    },
    [ydoc, getOrCreateCommentsArray],
  );

  const unresolveThread = useCallback(
    (sectionId: string, commentId: string) => {
      if (!ydoc) return;
      const commentsArr = getOrCreateCommentsArray(sectionId);
      if (!commentsArr) return;
      let found = false;
      ydoc.transact(() => {
        for (let i = 0; i < commentsArr.length; i++) {
          const yComment = commentsArr.get(i) as Y.Map<unknown>;
          if (yComment.get('id') === commentId) {
            yComment.set('resolved', false);
            yComment.delete('resolvedBy');
            yComment.delete('resolvedAt');
            found = true;
            break;
          }
        }
      });
      if (!found) {
        console.warn(
          `unresolveThread: comment ${commentId} not found in section ${sectionId}`,
        );
      }
    },
    [ydoc, getOrCreateCommentsArray],
  );

  return {
    sections,
    comments,
    addSection,
    updateSection,
    removeSection,
    addItem,
    updateItem,
    removeItem,
    ackItem,
    rejectItem,
    getSectionFragment,
    addComment,
    resolveThread,
    unresolveThread,
  };
}
