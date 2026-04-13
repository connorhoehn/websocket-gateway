// frontend/src/hooks/useCollaborativeDoc.ts
//
// Main hook for managing a collaborative Y.js document lifecycle.
// Creates a Y.Doc, wires it through the GatewayProvider, and exposes
// a typed React-friendly API for reading/mutating document state.

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { GatewayProvider } from '../providers/GatewayProvider';
import { useAwarenessState } from './useAwarenessState';
import type { AwarenessUpdaters } from './useAwarenessState';
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
  SectionReview,
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

  /** Mark a root comment thread as resolved. */
  resolveThread: (sectionId: string, commentId: string, resolverDisplayName: string) => void;

  /** Unresolve a previously resolved thread. */
  unresolveThread: (sectionId: string, commentId: string) => void;

  /** Per-section review statuses (keyed by sectionId). */
  sectionReviews: Record<string, SectionReview[]>;

  /** Submit a review for a section (persisted in Y.js). */
  reviewSection: (sectionId: string, status: SectionReview['status'], comment?: string) => void;

  /** Awareness state updaters — single source of truth for all awareness writes. */
  awareness: AwarenessUpdaters;
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
  const [sectionReviews, setSectionReviews] = useState<Record<string, SectionReview[]>>({});

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

    // NOTE: Initial awareness state is now set by useAwarenessState hook
    // (called below). No direct setLocalStateField here.

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

    // Observe sections array (debounced to avoid cascading re-renders)
    const ySections = ydoc.getArray<Y.Map<unknown>>('sections');
    let sectionsTimer: ReturnType<typeof setTimeout> | null = null;
    const sectionsObserver = () => {
      if (sectionsTimer) clearTimeout(sectionsTimer);
      sectionsTimer = setTimeout(() => {
        const next = yArrayToSections(ySections);
        setSections(next);

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
        setComments(nextComments);
      }, 16); // ~1 frame debounce
    };
    ySections.observeDeep(sectionsObserver);

    // Observe section reviews map
    const yReviews = ydoc.getMap('sectionReviews');
    const reviewsObserver = () => {
      const next: Record<string, SectionReview[]> = {};
      yReviews.forEach((value, key) => {
        if (!(value instanceof Y.Map)) return;
        const review = yMapToObject<SectionReview>(value);
        // Key format: sectionId:userId
        const sectionId = key.split(':')[0];
        if (!next[sectionId]) next[sectionId] = [];
        next[sectionId].push(review);
      });
      setSectionReviews(next);
    };
    yReviews.observe(reviewsObserver);

    // Listen for synced event
    const onSynced = () => setSynced(true);
    provider.on('synced', onSynced);

    // Observe awareness changes to track remote participants
    let prevParticipantKey = '';
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
          lastSeen: (user.lastSeen as number) ?? Date.now(),
          idle: (user.idle as boolean) ?? false,
        });
      });
      // Deduplicate by userId or displayName — keep the most recent entry per user
      const seen = new Map<string, Participant>();
      for (const p of parts) {
        const key = p.userId || p.displayName || p.clientId;
        const existing = seen.get(key);
        if (!existing || (p.lastSeen ?? 0) > (existing.lastSeen ?? 0)) {
          seen.set(key, p);
        }
      }
      // Avoid new array reference when participants haven't meaningfully changed
      const next = Array.from(seen.values());
      const nextKey = next.map(p => `${p.clientId}:${p.currentSectionId}:${p.mode}:${p.idle}`).join('|');
      if (nextKey === prevParticipantKey) return;
      prevParticipantKey = nextKey;
      queueMicrotask(() => setParticipants(next));
    };
    provider.awareness.on('change', awarenessHandler);

    return () => {
      // Unsubscribe from the channel
      ws.sendMessage({
        service: 'crdt',
        action: 'unsubscribe',
        channel,
      });

      if (sectionsTimer) clearTimeout(sectionsTimer);
      yMeta.unobserve(metaObserver);
      ySections.unobserveDeep(sectionsObserver);
      yReviews.unobserve(reviewsObserver);
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

  // ---- Centralized awareness state (single source of truth) -----------------
  const awarenessUpdaters = useAwarenessState(providerRef.current, {
    userId,
    displayName,
    color,
    mode,
    currentSectionId: null,
  });

  // ---- Re-subscribe on WebSocket reconnect ----------------------------------
  // When the gateway restarts, the WS auto-reconnects but doc channel
  // subscriptions are lost server-side. Listen for 'session' messages
  // (sent on every connect/reconnect) to re-send the subscribe.
  useEffect(() => {
    const channel = `doc:${documentId}`;
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type === 'session') {
        ws.sendMessage({
          service: 'crdt',
          action: 'subscribe',
          channel,
        });
      }
    });
    return unregister;
  }, [documentId, ws.sendMessage, onMessage]);

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

      // Server sends type: 'crdt:awareness' with awareness state
      if (msg.type === 'crdt:awareness') {
        if (msg.channel !== channel) return;
        const raw = msg as Record<string, unknown>;
        // Handle coalesced format: { updates: [{clientId, update}, ...] }
        const updates = raw.updates as Array<{ clientId: string; update: string }> | undefined;
        if (updates && Array.isArray(updates)) {
          for (const entry of updates) {
            if (entry.update) {
              provider.applyAwarenessUpdate(entry.update);
            }
          }
          return;
        }
        // Handle single format: { update: '...' }
        const updateB64 = raw.update as string | undefined;
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
            // Skip version-history snapshots (version: true) — those are handled
            // by useVersionHistory for preview/compare, not for the live doc.
            if (msg['version']) break;
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

  const resolveThread = useCallback((sectionId: string, commentId: string, resolverDisplayName: string) => {
    const ydoc = ydocRef.current;
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
      console.warn(`resolveThread: comment ${commentId} not found in section ${sectionId}`);
    }
  }, [getOrCreateCommentsArray]);

  const unresolveThread = useCallback((sectionId: string, commentId: string) => {
    const ydoc = ydocRef.current;
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
      console.warn(`unresolveThread: comment ${commentId} not found in section ${sectionId}`);
    }
  }, [getOrCreateCommentsArray]);

  const reviewSection = useCallback((sectionId: string, status: SectionReview['status'], comment?: string) => {
    const ydoc = ydocRef.current;
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
  }, [userId, displayName]);

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
    resolveThread,
    unresolveThread,
    sectionReviews,
    reviewSection,
    awareness: awarenessUpdaters,
  };
}
