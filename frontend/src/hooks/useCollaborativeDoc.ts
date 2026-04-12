// frontend/src/hooks/useCollaborativeDoc.ts
//
// Main hook for managing a collaborative Y.js document lifecycle.
// Creates a Y.Doc, wires it through the GatewayProvider, and exposes
// a typed React-friendly API for reading/mutating document state.

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { GatewayProvider } from '../providers/GatewayProvider';
import type { UseWebSocketReturn } from './useWebSocket';
import type {
  DocumentMeta,
  Participant,
  Section,
  TaskItem,
  DocumentData,
  ViewMode,
  CommentData,
  CommentThread,
} from '../types/document';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseCollaborativeDocOptions {
  documentId: string;
  mode: ViewMode;
  ws: UseWebSocketReturn;
  userId: string;
  displayName: string;
  color: string;
  /** Register a handler for incoming gateway messages. Returns an unregister function. */
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
}

export interface UseCollaborativeDocReturn {
  /** Current document metadata (reactive). */
  meta: DocumentMeta | null;
  /** Current section list (reactive). */
  sections: Section[];
  /** Whether the initial snapshot has been received. */
  synced: boolean;

  // Mutations
  updateMeta: (partial: Partial<DocumentMeta>) => void;
  addSection: (section: Section) => void;
  updateSection: (sectionId: string, partial: Partial<Section>) => void;
  removeSection: (sectionId: string) => void;
  addItem: (sectionId: string, item: TaskItem) => void;
  updateItem: (sectionId: string, itemId: string, partial: Partial<TaskItem>) => void;
  ackItem: (sectionId: string, itemId: string, userId: string) => void;
  rejectItem: (sectionId: string, itemId: string, userId: string) => void;

  removeItem: (sectionId: string, itemId: string) => void;

  /** Get (or lazily create) the Y.XmlFragment for a section's rich-text content. */
  getSectionFragment: (sectionId: string) => Y.XmlFragment | null;

  /** The underlying Y.Doc instance (null before init). */
  ydoc: Y.Doc | null;
  /** The GatewayProvider instance (null before init). */
  provider: GatewayProvider | null;

  /** Stub: will parse markdown into Y.js structure in a future plan. */
  loadFromMarkdown: (markdown: string) => void;

  /** Export current Y.js state as plain JSON. */
  exportJSON: () => DocumentData | null;

  /** Remote participants currently connected to this document. */
  participants: Participant[];

  /** Threaded comments per section, built from Y.js state. */
  comments: Record<string, CommentThread[]>;

  /** Add a comment (or reply) to a section, persisted in Y.js. */
  addComment: (sectionId: string, opts: {
    text: string;
    userId: string;
    displayName: string;
    color: string;
    parentCommentId?: string | null;
  }) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a Y.Map into a plain JS object. */
function yMapToObject<T>(ymap: Y.Map<unknown>): T {
  const obj: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    obj[key] = value;
  });
  return obj as T;
}

/** Read a Y.Array of Y.Maps into a plain JS array of objects. */
function yArrayToSections(yarray: Y.Array<Y.Map<unknown>>): Section[] {
  const result: Section[] = [];
  yarray.forEach((ymap) => {
    const section = yMapToObject<Section>(ymap);
    // items is stored as a nested Y.Array — convert it too
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

function yItemsToArray(yarray: Y.Array<Y.Map<unknown>>): TaskItem[] {
  const result: TaskItem[] = [];
  yarray.forEach((ymap) => {
    result.push(yMapToObject<TaskItem>(ymap));
  });
  return result;
}

/** Populate a Y.Map from a plain object (shallow — nested objects need special handling). */
function objectToYMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    ymap.set(key, value);
  }
}

/** Read a Y.Array of comment Y.Maps into flat CommentData[]. */
function yCommentsToArray(yarray: Y.Array<Y.Map<unknown>>): CommentData[] {
  const result: CommentData[] = [];
  yarray.forEach((ymap) => {
    result.push(yMapToObject<CommentData>(ymap));
  });
  return result;
}

/** Build a nested CommentThread tree from a flat comment array. */
function buildCommentTree(flat: CommentData[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  const roots: CommentThread[] = [];

  // Create thread nodes
  for (const c of flat) {
    map.set(c.id, { ...c, replies: [] });
  }

  // Link children to parents
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
// Hook
// ---------------------------------------------------------------------------

export function useCollaborativeDoc(
  options: UseCollaborativeDocOptions,
): UseCollaborativeDocReturn {
  const { documentId, mode, ws, userId, displayName, color, onMessage } = options;

  // ---- Reactive state (drives re-renders) ---------------------------------
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [synced, setSynced] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [comments, setComments] = useState<Record<string, CommentThread[]>>({});

  // ---- Refs (mutable objects that survive renders) ------------------------
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<GatewayProvider | null>(null);

  // ---- Setup / teardown ---------------------------------------------------
  useEffect(() => {
    const ydoc = new Y.Doc({ gc: false });
    ydocRef.current = ydoc;

    const channel = `doc:${documentId}`;
    const provider = new GatewayProvider(ydoc, channel, ws.sendMessage);
    providerRef.current = provider;

    // Set awareness local state
    provider.awareness.setLocalStateField('user', {
      userId,
      displayName,
      color,
      mode,
      currentSectionId: null,
    });

    // Subscribe to the document channel
    ws.sendMessage({
      service: 'crdt',
      action: 'subscribe',
      channel,
    });

    // Observe meta map
    const yMeta = ydoc.getMap('meta');
    const metaObserver = () => {
      if (yMeta.size > 0) {
        setMeta(yMapToObject<DocumentMeta>(yMeta));
      }
    };
    yMeta.observe(metaObserver);

    // Observe sections array
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    const sectionsObserver = () => {
      const next = yArrayToSections(ySections);
      queueMicrotask(() => setSections(next));

      // Rebuild comments from all sections' Y.Arrays
      const nextComments: Record<string, CommentThread[]> = {};
      for (let i = 0; i < ySections.length; i++) {
        const ySection = ySections.get(i);
        const sectionId = ySection.get('id') as string;
        const yComments = ySection.get('comments');
        if (yComments instanceof Y.Array) {
          const flat = yCommentsToArray(yComments as Y.Array<Y.Map<unknown>>);
          nextComments[sectionId] = buildCommentTree(flat);
        }
      }
      queueMicrotask(() => setComments(nextComments));
    };
    ySections.observeDeep(sectionsObserver);

    // Listen for synced event
    const onSynced = () => setSynced(true);
    provider.on('synced', onSynced);

    // Observe awareness changes to track remote participants
    const awarenessHandler = () => {
      const states = provider.awareness.getStates();
      const parts: Participant[] = [];
      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === provider.awareness.clientID) return; // skip self
        const user = state.user as Record<string, unknown> | undefined;
        if (!user) return;
        parts.push({
          clientId: String(clientId),
          userId: (user.userId as string) ?? '',
          displayName: (user.displayName as string) ?? 'Anonymous',
          color: (user.color as string) ?? '#3b82f6',
          mode: user.mode === 'ack' ? 'reviewer' : user.mode === 'reader' ? 'reader' : 'editor',
          currentSectionId: (user.currentSectionId as string | null) ?? null,
        });
      });
      queueMicrotask(() => setParticipants(parts));
    };
    provider.awareness.on('change', awarenessHandler);

    return () => {
      // Unsubscribe from the channel
      ws.sendMessage({
        service: 'crdt',
        action: 'unsubscribe',
        channel,
      });

      yMeta.unobserve(metaObserver);
      ySections.unobserveDeep(sectionsObserver);
      provider.awareness.off('change', awarenessHandler);
      provider.off('synced', onSynced);
      provider.destroy();
      ydoc.destroy();

      ydocRef.current = null;
      providerRef.current = null;
      setSynced(false);
      setMeta(null);
      setSections([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // ---- Handle incoming gateway messages -----------------------------------
  // Register via the onMessage registrar so the hook receives live CRDT
  // messages from the WebSocket gateway.
  useEffect(() => {
    const channel = `doc:${documentId}`;

    const unregister = onMessage((msg: GatewayMessage) => {
      const provider = providerRef.current;
      if (!provider) return;

      // Server sends type: 'crdt:snapshot' with snapshot field on subscribe
      if (msg.type === 'crdt:snapshot') {
        if (msg.channel !== channel) return;
        const snapshotB64 = (msg as Record<string, unknown>).snapshot as string | undefined;
        if (snapshotB64) {
          provider.applySnapshot(snapshotB64);
        }
        return;
      }

      // Server sends type: 'crdt:update' with update field for incremental updates
      if (msg.type === 'crdt:update') {
        if (msg.channel !== channel) return;
        const updateB64 = (msg as Record<string, unknown>).update as string | undefined;
        if (updateB64) {
          provider.applyRemoteUpdate(updateB64);
        }
        return;
      }

      // Server sends type: 'crdt:awareness' with update field for awareness state
      if (msg.type === 'crdt:awareness') {
        if (msg.channel !== channel) return;
        const updateB64 = (msg as Record<string, unknown>).update as string | undefined;
        if (updateB64) {
          provider.applyAwarenessUpdate(updateB64);
        }
        return;
      }

      // Also handle type: 'crdt' with action field (used by restore, clear, etc.)
      if (msg.type === 'crdt') {
        if (msg.channel !== channel) return;
        switch (msg.action) {
          case 'snapshot':
            if (msg['update']) {
              provider.applySnapshot(msg['update'] as string);
            }
            break;
          case 'update':
            if (msg['update']) {
              provider.applyRemoteUpdate(msg['update'] as string);
            }
            break;
          case 'awareness':
            if (msg['update']) {
              provider.applyAwarenessUpdate(msg['update'] as string);
            }
            break;
        }
      }
    });

    return unregister;
  }, [documentId, onMessage]);

  // ---- Mutation helpers ---------------------------------------------------

  const updateMeta = useCallback((partial: Partial<DocumentMeta>) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const yMeta = ydoc.getMap('meta');
    ydoc.transact(() => {
      for (const [key, value] of Object.entries(partial)) {
        yMeta.set(key, value);
      }
    });
  }, []);

  const addSection = useCallback((section: Section) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    ydoc.transact(() => {
      const ySection = new Y.Map<unknown>();
      const { items, ...rest } = section;
      objectToYMap(ySection, rest as unknown as Record<string, unknown>);
      // Store items as a nested Y.Array
      const yItems = new Y.Array<Y.Map<unknown>>();
      for (const item of items) {
        const yItem = new Y.Map<unknown>();
        objectToYMap(yItem, item as unknown as Record<string, unknown>);
        yItems.push([yItem]);
      }
      ySection.set('items', yItems);
      ySections.push([ySection]);
    });
  }, []);

  const _findSection = useCallback((sectionId: string): { ySection: Y.Map<unknown>; index: number } | null => {
    const ydoc = ydocRef.current;
    if (!ydoc) return null;
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    for (let i = 0; i < ySections.length; i++) {
      const ySection = ySections.get(i);
      if (ySection.get('id') === sectionId) {
        return { ySection, index: i };
      }
    }
    return null;
  }, []);

  const updateSection = useCallback((sectionId: string, partial: Partial<Section>) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const found = _findSection(sectionId);
    if (!found) return;
    ydoc.transact(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { items: _items, ...rest } = partial;
      for (const [key, value] of Object.entries(rest)) {
        found.ySection.set(key, value);
      }
    });
  }, [_findSection]);

  const removeSection = useCallback((sectionId: string) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const found = _findSection(sectionId);
    if (!found) return;
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    ydoc.transact(() => {
      ySections.delete(found.index, 1);
    });
  }, [_findSection]);

  const _findItem = useCallback((sectionId: string, itemId: string): Y.Map<unknown> | null => {
    const found = _findSection(sectionId);
    if (!found) return null;
    const yItems = found.ySection.get('items');
    if (!(yItems instanceof Y.Array)) return null;
    for (let i = 0; i < yItems.length; i++) {
      const yItem = yItems.get(i) as Y.Map<unknown>;
      if (yItem.get('id') === itemId) return yItem;
    }
    return null;
  }, [_findSection]);

  const addItem = useCallback((sectionId: string, item: TaskItem) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const found = _findSection(sectionId);
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
  }, [_findSection]);

  const updateItem = useCallback((sectionId: string, itemId: string, partial: Partial<TaskItem>) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const yItem = _findItem(sectionId, itemId);
    if (!yItem) return;
    ydoc.transact(() => {
      for (const [key, value] of Object.entries(partial)) {
        yItem.set(key, value);
      }
    });
  }, [_findItem]);

  const removeItem = useCallback((sectionId: string, itemId: string) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const found = _findSection(sectionId);
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
  }, [_findSection]);

  const ackItem = useCallback((sectionId: string, itemId: string, ackUserId: string) => {
    updateItem(sectionId, itemId, {
      status: 'acked',
      ackedBy: ackUserId,
      ackedAt: new Date().toISOString(),
    });
  }, [updateItem]);

  const rejectItem = useCallback((sectionId: string, itemId: string, rejectUserId: string) => {
    updateItem(sectionId, itemId, {
      status: 'rejected',
      ackedBy: rejectUserId,
      ackedAt: new Date().toISOString(),
    });
  }, [updateItem]);

  const getSectionFragment = useCallback((sectionId: string): Y.XmlFragment | null => {
    const found = _findSection(sectionId);
    if (!found) return null;
    const fragment = found.ySection.get('content');
    if (fragment instanceof Y.XmlFragment) {
      return fragment;
    }
    // Don't create the fragment here — this is called during render.
    // Instead, schedule creation so it happens outside the render cycle.
    queueMicrotask(() => {
      const ydoc = ydocRef.current;
      if (!ydoc) return;
      const current = found.ySection.get('content');
      if (current instanceof Y.XmlFragment) return; // already created
      ydoc.transact(() => {
        found.ySection.set('content', new Y.XmlFragment());
      });
    });
    return null;
  }, [_findSection]);

  const getOrCreateCommentsArray = useCallback((sectionId: string): Y.Array<Y.Map<unknown>> | null => {
    const ydoc = ydocRef.current;
    if (!ydoc) return null;
    const found = _findSection(sectionId);
    if (!found) return null;
    let commentsArr = found.ySection.get('comments');
    if (!(commentsArr instanceof Y.Array)) {
      commentsArr = new Y.Array<Y.Map<unknown>>();
      found.ySection.set('comments', commentsArr);
    }
    return commentsArr as Y.Array<Y.Map<unknown>>;
  }, [_findSection]);

  const addComment = useCallback((sectionId: string, opts: {
    text: string;
    userId: string;
    displayName: string;
    color: string;
    parentCommentId?: string | null;
  }) => {
    const ydoc = ydocRef.current;
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
  }, [getOrCreateCommentsArray]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadFromMarkdown = useCallback((_markdown: string) => {
    // Stub: will be implemented in a future plan when markdown parsing is wired.
    console.warn('loadFromMarkdown is not yet implemented');
  }, []);

  const exportJSON = useCallback((): DocumentData | null => {
    const ydoc = ydocRef.current;
    if (!ydoc) return null;

    const yMeta = ydoc.getMap('meta');
    if (yMeta.size === 0) return null;

    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');

    return {
      meta: yMapToObject<DocumentMeta>(yMeta),
      sections: yArrayToSections(ySections),
    };
  }, []);

  return {
    meta,
    sections,
    synced,
    updateMeta,
    addSection,
    updateSection,
    removeSection,
    addItem,
    updateItem,
    removeItem,
    ackItem,
    rejectItem,
    getSectionFragment,
    ydoc: ydocRef.current,
    provider: providerRef.current,
    loadFromMarkdown,
    exportJSON,
    participants,
    comments,
    addComment,
  };
}
