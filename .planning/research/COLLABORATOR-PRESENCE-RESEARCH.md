# Collaborator Presence & Navigation Research

> Date: 2026-04-12
> Scope: Cross-document presence, jump-to-user, cursor tracking, follow mode, presence indicators, offline detection, performance

---

## Current State Inventory

### What exists today

| Layer | File | What it does |
|-------|------|-------------|
| Channel presence | `frontend/src/hooks/usePresence.ts` | Per-channel user list via gateway `presence` service. Heartbeat every 30s. Tracks `clientId`, `status`, `metadata` (displayName, isTyping). |
| Y.js awareness | `frontend/src/providers/GatewayProvider.ts` | Wraps `y-protocols/awareness`. Local state fields: `user` (userId, displayName, color, mode, currentSectionId, lastSeen). Debounces awareness sends at 50ms. |
| Document participants | `frontend/src/hooks/useCollaborativeDoc.ts` | Observes awareness `change` events, deduplicates by userId, builds `Participant[]` with clientId, userId, displayName, color, mode, currentSectionId, lastSeen. |
| Cursor positions | `frontend/src/components/doc-editor/TiptapEditor.tsx` | Stores relative cursor positions in awareness under `cursor` field ({anchor, head, sectionId}). Converts to absolute ProseMirror positions via `ySyncPluginKey`. Renders `CursorOverlay` with blinking carets, name badges, and multi-line selection highlights. |
| Section-level presence | `frontend/src/components/doc-editor/SectionBlock.tsx` | AvatarStack shows participants whose `currentSectionId` matches this section. Left border color = first participant's color. |
| Document header presence | `frontend/src/components/doc-editor/ParticipantAvatars.tsx` | Clickable avatar row. Shows mode badge (editing/reviewing/reading), section indicator, last-seen timer, online pulse dot. Click triggers `onJumpToUser`. |
| Jump-to-user (in-doc) | `frontend/src/components/doc-editor/DocumentEditorPage.tsx` | `handleJumpToUser`: switches to participant's mode, scrolls to their `currentSectionId` via `document.getElementById`, applies a 2s box-shadow flash in the participant's color. For review mode, sets `jumpToSectionIndex`. |
| Cross-doc presence | `frontend/src/hooks/useDocuments.ts` | Polls `getDocumentPresence` every 10s. Server aggregates from `channelStates` for all `doc:*` channels. Returns `Record<string, DocumentPresenceUser[]>`. |
| Document list presence | `frontend/src/components/doc-editor/DocumentListPage.tsx` | Shows `PresenceAvatars` per document card. Click on avatar calls `onJumpToUser(docId, userId)`. |
| Gateway cursor service | `frontend/src/hooks/useCursors.ts` | Multi-mode cursor (freeform, table, text, canvas) for the Previews tab. NOT used by the document editor -- the doc editor uses Y.js awareness for cursors instead. |
| Server presence | `src/services/presence-service.js` | In-memory Maps: `clientPresence`, `channelPresence`, `clientChannels`. Heartbeat check every 30s, stale threshold 90s, timeout 60s. Valid statuses: online, away, busy, offline. Disconnect cleanup after 5s delay. |
| Server CRDT awareness | `src/services/crdt-service.js` | `handleAwareness`: relays base64 awareness updates to all channel subscribers (no persistence). `handleGetDocumentPresence`: iterates `channelStates` for `doc:*` channels, pulls client metadata from message router. |

### Key architectural facts

1. **Two separate presence systems**: The `presence` service (channel-based, gateway-level) and Y.js `awareness` (per-document, CRDT-level) are independent. They share no state.
2. **Awareness is per-Y.Doc**: Each document gets its own `GatewayProvider` with its own `Awareness` instance. There is no global awareness.
3. **Cross-document presence is polling-based**: `useDocuments` polls every 10s via `getDocumentPresence`. The server derives this from subscription metadata, not from awareness states.
4. **Cursor tracking is Y.js-native**: The Tiptap editor stores relative positions in awareness (`cursor.anchor`, `cursor.head`, `cursor.sectionId`). Conversion to absolute positions uses `ySyncPluginKey`.
5. **No follow mode exists today**.
6. **No "away" detection on the client**: The client sets `lastSeen: Date.now()` when setting awareness, but there is no idle timer to transition to "away".

---

## 1. Cross-Document Presence Map

### Problem

When a user is on the document list page, they need to see who is in each document in near-real-time without subscribing to every document's Y.js awareness channel (which would create N Y.Doc instances and N WebSocket subscriptions).

### Current approach

The server's `handleGetDocumentPresence` iterates `channelStates` and pulls client metadata from the message router. The client polls every 10 seconds.

### Recommended approach: server-side presence aggregation

**Keep the current server-side aggregation, but push updates instead of polling.**

Architecture:

```
Client A opens doc:abc
  -> subscribes to crdt channel doc:abc
  -> Server records client A in doc:abc's subscriber list
  -> Server broadcasts presence:documents update to all clients
     subscribed to the "documents:presence" meta-channel

Client B is on the document list page
  -> subscribes to "documents:presence" meta-channel
  -> Receives pushed updates whenever anyone joins/leaves any doc
```

Implementation details:

1. **New meta-channel `documents:presence`**: Clients on the document list page subscribe to this. The server publishes aggregated presence diffs whenever a client subscribes/unsubscribes to any `doc:*` channel.

2. **Server tracks join/leave events**: In `crdt-service.js`, when `handleSubscribe` and `handleUnsubscribe` fire for a `doc:*` channel, also broadcast to `documents:presence`:
   ```js
   // In handleSubscribe, after subscribing the client:
   this.broadcastDocumentPresenceUpdate(channel, clientId, 'joined');
   
   // In handleUnsubscribe:
   this.broadcastDocumentPresenceUpdate(channel, clientId, 'left');
   ```

3. **Payload shape**:
   ```ts
   {
     type: 'crdt',
     action: 'documentPresenceDelta',
     documentId: string,
     userId: string,
     displayName: string,
     color: string,
     mode: string,
     event: 'joined' | 'left',
   }
   ```

4. **Client-side**: Replace the 10s polling in `useDocuments` with a subscription to `documents:presence`. Apply deltas to local state. Fall back to full refresh on reconnect.

5. **Keep the polling endpoint as a fallback** for initial load and reconnection scenarios, but reduce interval to 30s or remove it entirely once push is reliable.

### Why NOT subscribe to all awareness channels

- Each Y.js awareness subscription creates a persistent memory allocation on both client and server.
- With 50 documents, that's 50 awareness streams constantly broadcasting cursor positions, typing states, etc. -- data the list page doesn't need.
- The server already knows who is subscribed to which channels. Use that metadata instead.

---

## 2. Jump-to-User Across Documents

### Current state

- **Within a document**: `handleJumpToUser` in `DocumentEditorPage.tsx` switches mode and scrolls to the target section. Works well.
- **From document list**: `onJumpToUser(docId, userId)` in `AppLayout.tsx` calls `setActiveDocumentId(docId)` but doesn't pass the target userId to `DocumentEditorPage`.

### What's missing

When clicking an avatar on the document list, the system navigates to the document but loses the "who to jump to" context. The document editor mounts fresh with no knowledge that it should scroll to a specific user.

### Recommended approach: state passing via props + initial-jump param

**Option A: Prop-based (simplest, recommended)**

1. Add `initialJumpToUserId?: string` prop to `DocumentEditorPage`.
2. In `AppLayout`, when `onJumpToUser` fires, set both `activeDocumentId` and a new `jumpToUserId` state.
3. `DocumentEditorPage` receives `initialJumpToUserId`. On mount, after `synced` becomes true and `participants` populate, find the participant matching that userId and call `handleJumpToUser(participant)`.
4. Clear the jump state after executing.

```tsx
// AppLayout.tsx
const [jumpToUserId, setJumpToUserId] = useState<string | null>(null);

// In DocumentListPage onJumpToUser handler:
setActiveDocumentId(docId);
setJumpToUserId(userId);

// DocumentEditorPage receives initialJumpToUserId={jumpToUserId}
```

```tsx
// DocumentEditorPage.tsx - new effect
useEffect(() => {
  if (!initialJumpToUserId || !synced || participants.length === 0) return;
  const target = participants.find(p => p.userId === initialJumpToUserId);
  if (target) {
    // Small delay to let sections render
    setTimeout(() => handleJumpToUser(target), 300);
    onClearJump?.(); // Signal parent to clear the jump state
  }
}, [initialJumpToUserId, synced, participants]);
```

**Option B: URL-based deep linking**

Use query parameters: `/documents/abc?jumpTo=user123`. This enables sharing links and browser back/forward. However, this project uses SPA state management rather than URL routing, so this adds complexity for little near-term value.

**Option C: Follow-link from notification**

The existing notification system (in `AppLayout`) already handles mention clicks by setting `activeView` and scrolling. Extend this pattern: when a presence avatar is clicked in the list, create a synthetic navigation event that carries both the document ID and the target userId.

### Recommendation

Option A. It requires adding one prop and one effect. No routing changes needed. Deep linking (Option B) can be added later as an enhancement.

---

## 3. Per-Section Cursor Tracking

### Current state (already implemented)

The Tiptap editor already has per-section cursor tracking:

1. **Local cursor broadcast** (`TiptapEditor.tsx` lines 352-381): On `selectionUpdate`, converts ProseMirror selection to Y.js relative positions via `absolutePositionToRelativePosition`, then stores in awareness as `cursor: { anchor, head, sectionId }`.

2. **Remote cursor rendering** (`TiptapEditor.tsx` lines 308-350): `updateCursors` reads all awareness states, filters by `sectionId`, converts relative positions back to absolute via `relativePositionToAbsolutePosition`, builds `RemoteCursorInfo[]`.

3. **Cursor overlay** (`CursorOverlay` component, lines 137-267): Renders colored carets with name badges, blinking animation, glow effect, and multi-line selection highlights. Uses `view.coordsAtPos()` for pixel positioning.

### What could be improved

**A. Cursor persistence across re-renders**

The current overlay re-renders on awareness changes. When many users are active, the overlay can flicker because `getCoords()` returns null briefly during DOM transitions.

Recommendation: Add a `previousCoords` cache per clientId. When `getCoords` returns null, fall back to the cached position for one frame. Clear the cache if the cursor doesn't resolve after 2 consecutive misses.

**B. Selection highlight performance**

The current multi-line selection rendering (lines 157-203) walks positions one-by-one to detect line breaks. For large selections, this is O(n) where n = selection length.

Recommendation: Use ProseMirror's `doc.nodesBetween(start, end)` to find block boundaries and render one rectangle per block. This reduces the iteration from character-level to block-level.

**C. Cursor fade on inactivity**

Currently, remote cursors persist at their last position indefinitely. If a user stops typing and walks away, their cursor still shows.

Recommendation: Track `lastCursorUpdate` timestamp per remote client. After 30 seconds of no cursor movement, fade the cursor to 20% opacity. After 60 seconds, hide it entirely. Reset on any awareness update from that client.

**D. Cursor name badges: collision avoidance**

When two cursors are on adjacent lines, their name badges overlap. 

Recommendation: Before rendering, sort cursors by vertical position and nudge badges that would overlap. A simple approach: if badge N overlaps badge N-1, shift badge N leftward by its width + 4px.

---

## 4. Follow Mode

### Concept

"Follow mode" locks your viewport to mirror another user's position. When the followed user changes sections, scrolls, or moves their cursor, your view tracks them. This is useful for presentations, onboarding, and pair editing.

### Design

#### State model

```ts
interface FollowState {
  followingUserId: string | null;
  followingClientId: string | null;
  isLocked: boolean; // true = auto-scroll active
}
```

Store this in `DocumentEditorPage` as local React state. Do NOT put it in awareness (it's a local UI preference, not shared state).

#### Activation

- In `ParticipantAvatars`, add a "Follow" action (eye icon or "Follow" text) next to each avatar.
- Clicking sets `followingUserId` and `isLocked = true`.
- A persistent banner appears at the top of the editor: "Following [Name] -- click to stop" with the user's color.

#### Tracking behavior: section-level

1. **Watch awareness changes**: When the followed user's `currentSectionId` changes, scroll to that section.
2. **Implementation**: Add an effect in `DocumentEditorPage` that watches `participants` for changes to the followed user's `currentSectionId`:

```ts
useEffect(() => {
  if (!followState.isLocked || !followState.followingUserId) return;
  const target = participants.find(p => p.userId === followState.followingUserId);
  if (!target?.currentSectionId) return;
  
  const el = document.getElementById(`section-${target.currentSectionId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, [followState, participants]);
```

#### Tracking behavior: cursor-level (within a section)

For finer-grained following within a Tiptap editor:

1. When the followed user's `cursor.head` position changes, scroll the ProseMirror view to that position.
2. Pass `followingClientId` down to `TiptapEditor`. When set, call `editor.commands.scrollIntoView()` after mapping the remote cursor position.
3. This requires a new awareness listener that specifically watches the followed user's cursor updates, separate from the general cursor overlay.

#### Auto-unlock triggers

Follow mode should automatically unlock when:
- The local user clicks anywhere in the editor (they're taking control)
- The local user types anything
- The local user manually scrolls (after a 1s debounce to avoid unlocking from the auto-scroll)
- The followed user goes offline or leaves the document

#### Cross-document follow

When the followed user switches to a different document:
1. Detect via `documents:presence` meta-channel (the followed user leaves current doc, joins another).
2. Show a prompt: "[Name] moved to [Doc Title]. Follow them?" with Yes/No buttons.
3. If Yes: navigate to that document, re-establish follow mode.
4. If No: disable follow mode.

Do NOT auto-navigate without confirmation -- it's disorienting.

#### Visual indicator

```
+--------------------------------------------------+
| [Follow banner: colored stripe in user's color]   |
| "Following Alice Chen" [eye icon] [X to stop]     |
+--------------------------------------------------+
| [Editor content scrolling to match Alice's view]   |
```

---

## 5. Presence Indicators (Multi-Level Design)

### Four presence levels

Each level has different update frequency, data granularity, and visual treatment.

#### Level 1: Document List (who's in each doc)

- **Source**: Server-side aggregation via `documents:presence` channel (see Section 1)
- **Update frequency**: Push on join/leave events
- **Visual**: Avatar stack on each document card (already exists). Add:
  - Green dot for active users (last heartbeat < 30s)
  - Yellow dot for idle users (30s-120s)
  - Gray dot for away users (> 120s)
  - Count badge showing total collaborators
  - User's current mode as tiny text below avatar

#### Level 2: Document Header (who's in this doc)

- **Source**: Y.js awareness (already implemented)
- **Update frequency**: Real-time via awareness protocol
- **Visual**: `ParticipantAvatars` (already exists). Enhancements:
  - Sort by activity: actively typing users first, then idle, then away
  - Add a "You" indicator on the local user's avatar (currently excluded -- consider showing self)
  - When > 5 participants, show "+N" overflow with a dropdown listing all users on hover

#### Level 3: Section Level (who's editing this section)

- **Source**: Y.js awareness `currentSectionId` field (already implemented)
- **Update frequency**: Real-time
- **Visual**: `SectionBlock` avatar stack (already exists). Enhancements:
  - Differentiate between "focused on section" vs "actively typing in section"
  - Add typing indicator animation (pulsing dots) next to the user's avatar when their cursor is moving
  - Left border could cycle colors when multiple users are present (currently only shows first user's color)
  - Consider a subtle "live" indicator when a remote user is actively making changes

#### Level 4: Inline (cursor position in text)

- **Source**: Y.js awareness `cursor` field (already implemented)
- **Update frequency**: Debounced at 50ms (from `GatewayProvider`)
- **Visual**: `CursorOverlay` in `TiptapEditor` (already exists). Enhancements covered in Section 3.

### Presence data flow diagram

```
Server:
  PresenceService (channel-level, heartbeat-based)
       |
       v
  documents:presence meta-channel  -->  Document List (Level 1)
  
  CrdtService (per-doc awareness relay)
       |
       v
  Y.js Awareness (per-doc)  -->  Document Header (Level 2)
                              -->  Section Block (Level 3)
                              -->  TiptapEditor Cursors (Level 4)
```

### Consolidation opportunity

The `usePresence` hook (channel-level presence) and Y.js awareness serve different purposes but overlap conceptually. For the document editor flow, Y.js awareness is the single source of truth. The channel-level `usePresence` is used by the Previews tab (chat, cursors). They should remain separate -- trying to merge them would create coupling between unrelated features.

---

## 6. Offline/Away Detection

### Current state

- **Server**: Heartbeat interval 30s, timeout 60s, stale threshold 90s. Valid statuses: online, away, busy, offline.
- **Client**: Sends heartbeat every 30s via `usePresence`. Sets `lastSeen: Date.now()` in awareness on section focus changes. No idle detection.
- **Participant staleness**: `ParticipantAvatars` shows `lastSeenText()` but this is informational only -- there's no state transition.

### Recommended three-state model

| State | Trigger | Timeout | Visual |
|-------|---------|---------|--------|
| **Active** | Mouse move, keypress, focus, scroll | N/A | Green dot, solid avatar |
| **Away** | No user input for 2 minutes | 120s | Yellow dot, slightly dimmed avatar (opacity 0.7) |
| **Offline** | WebSocket disconnect, or no heartbeat for 60s | 60s | Gray dot, grayed avatar, crossed-out or faded |

### Client-side idle detection

Add a `useIdleDetector` hook:

```ts
function useIdleDetector(timeoutMs: number): boolean {
  const [isIdle, setIsIdle] = useState(false);
  
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    
    const reset = () => {
      setIsIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIsIdle(true), timeoutMs);
    };
    
    const events = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    timer = setTimeout(() => setIsIdle(true), timeoutMs);
    
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [timeoutMs]);
  
  return isIdle;
}
```

Integrate into awareness:

```ts
// In DocumentEditorPage or useCollaborativeDoc
const isIdle = useIdleDetector(120_000); // 2 minutes

useEffect(() => {
  if (!provider?.awareness) return;
  provider.awareness.setLocalStateField('user', {
    ...currentUserState,
    status: isIdle ? 'away' : 'active',
    lastSeen: Date.now(),
  });
}, [isIdle]);
```

### Heartbeat refinement

The current heartbeat in `usePresence` (30s interval) serves the channel-level presence service. For the document editor, the Y.js awareness protocol implicitly acts as a heartbeat -- every awareness update extends the user's "last seen" time.

However, if a user is reading without moving their cursor, no awareness updates are sent. The `lastSeen` field in awareness could become stale.

Recommendation: In `useCollaborativeDoc`, add a background timer that updates `lastSeen` in awareness every 30s while the document is open, regardless of user activity:

```ts
useEffect(() => {
  const timer = setInterval(() => {
    if (provider?.awareness) {
      const current = provider.awareness.getLocalState()?.user;
      if (current) {
        provider.awareness.setLocalStateField('user', {
          ...current,
          lastSeen: Date.now(),
        });
      }
    }
  }, 30_000);
  return () => clearInterval(timer);
}, [provider]);
```

### Server-side timeout handling

The server's `PresenceService` already handles stale cleanup (90s threshold). For the CRDT awareness path, the server relays awareness updates but doesn't track staleness. If a client disconnects ungracefully (no unsubscribe), other clients will keep seeing their last awareness state until the Y.js awareness protocol's own timeout fires (default: 30s in `y-protocols/awareness`).

The `y-protocols/awareness` library has a built-in `outdatedTimeout` (default 30000ms). After 30s with no update from a client, awareness automatically removes that client's state and emits a `change` event with the client in the `removed` array. This is sufficient -- no additional server-side work needed.

---

## 7. Presence Performance

### Current bottlenecks

1. **Awareness debounce at 50ms**: The `GatewayProvider` debounces local awareness updates at 50ms. This means a max of 20 awareness messages/second per client. With 10 users in a document, that's up to 200 awareness messages/second flowing through the server for that channel.

2. **Full awareness state on every update**: `encodeAwarenessUpdate` sends the entire local state, not a diff. The payload includes userId, displayName, color, mode, currentSectionId, lastSeen, and cursor positions. This is ~200-400 bytes per update.

3. **Document presence polling**: `useDocuments` polls every 10s. With many documents, the server iterates all `doc:*` channel states on every poll from every client.

4. **Cursor overlay re-renders**: `CursorOverlay` re-renders on every awareness change. With 10 users moving cursors, this triggers ~200 React re-renders/second across all section editors.

### Throttling strategy

#### Awareness updates (client to server)

The current 50ms debounce is reasonable. Recommendations:

- **Increase to 100ms for cursor positions**: Most users can't perceive cursor movement faster than 10fps. Change the debounce in `GatewayProvider` from 50ms to 100ms. This halves bandwidth.
- **Separate cursor updates from presence updates**: Cursor position changes frequently. Mode, section, and user info change rarely. Split awareness into two fields and only update the cursor field on selection changes.

```ts
// Fast path: cursor only (100ms debounce)
provider.awareness.setLocalStateField('cursor', { anchor, head, sectionId });

// Slow path: user info (no debounce needed, changes rarely)
provider.awareness.setLocalStateField('user', { userId, displayName, color, mode, currentSectionId, lastSeen });
```

This is already the case in the current code -- `cursor` and `user` are separate awareness fields. The debounce applies to any awareness change, so this is already efficient.

#### Awareness relay (server)

The server relays awareness updates to all channel subscribers. The relay is fire-and-forget (no persistence). This is correct and efficient.

For very large channels (>20 users), consider server-side awareness batching:
- Collect awareness updates for a channel within a 50ms window
- Send a single batched message containing all updates
- This reduces the per-message overhead (WebSocket framing, JSON serialization)

However, this optimization is premature until there's evidence of server-side bottlenecks.

#### Cursor overlay rendering (client)

The `CursorOverlay` React component re-renders when `remoteCursors` state changes. Each render calls `getCoords()` for every cursor, which calls `view.coordsAtPos()` -- a ProseMirror DOM measurement.

Recommendations:

1. **requestAnimationFrame throttle**: Instead of updating `remoteCursors` state on every awareness change, batch into a single rAF update:

```ts
const pendingCursorsRef = useRef<RemoteCursorInfo[]>([]);
const rafRef = useRef<number>(0);

const updateCursors = useCallback(() => {
  // ... compute cursors from awareness ...
  pendingCursorsRef.current = cursors;
  
  if (!rafRef.current) {
    rafRef.current = requestAnimationFrame(() => {
      setRemoteCursors(pendingCursorsRef.current);
      rafRef.current = 0;
    });
  }
}, [provider, editor]);
```

2. **Memoize CursorOverlay per cursor**: Use `React.memo` with a custom comparator that checks if individual cursor positions actually changed. Currently, the entire overlay re-renders even if only one cursor moved.

3. **Virtual cursor limit**: If >10 cursors are in the same section, only render the 5 most recently active. Show a "+N more" indicator.

#### Document list presence (server to client)

Replace the 10s polling with push-based updates (see Section 1). This eliminates periodic server load and provides faster updates.

### Bandwidth estimation

Per user in a document:
- Awareness updates: ~300 bytes x 10/second = 3 KB/s outbound
- Awareness relay: ~300 bytes x 10/second x (N-1 users) = 3 KB/s x N inbound
- For 10 users: ~30 KB/s per user = 300 KB/s total for the channel

With 100ms debounce: halved to ~150 KB/s total. This is well within WebSocket capacity.

### Scaling thresholds

| Users per doc | Expected behavior | Notes |
|--------------|-------------------|-------|
| 1-5 | No issues | All optimizations are premature |
| 5-15 | Cursor overlay may need rAF throttling | Implement rAF batching |
| 15-30 | Server-side batching may help | Consider awareness batching window |
| 30+ | Need to limit cursor rendering | Virtual cursor limit, reduce awareness frequency |
| 100+ | Architecture change needed | Consider read-only "spectator" mode that only receives section-level presence, not cursors |

---

## Summary of Implementation Priorities

### Quick wins (low effort, high value)

1. **Pass `initialJumpToUserId` prop** to `DocumentEditorPage` for cross-document jump (Section 2 Option A)
2. **Add idle detection** with `useIdleDetector` hook for away state (Section 6)
3. **Add cursor fade on inactivity** -- 30s dim, 60s hide (Section 3C)
4. **rAF-throttle cursor overlay** to prevent excessive re-renders (Section 7)

### Medium effort (needed for multi-document)

5. **Push-based document presence** via `documents:presence` meta-channel (Section 1)
6. **Three-state presence indicators** (active/away/offline) at all four levels (Section 5)
7. **Awareness heartbeat timer** in `useCollaborativeDoc` for readers who don't move cursors (Section 6)

### Higher effort (follow mode + polish)

8. **Follow mode** with section-level tracking, auto-unlock, and cross-document prompt (Section 4)
9. **Cursor-level follow mode** with ProseMirror scroll integration (Section 4)
10. **Server-side awareness batching** for large channels (Section 7, only if needed)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/hooks/useCollaborativeDoc.ts` | Awareness heartbeat timer, idle state integration |
| `frontend/src/components/doc-editor/DocumentEditorPage.tsx` | Follow mode state, `initialJumpToUserId` effect, idle detection |
| `frontend/src/components/doc-editor/TiptapEditor.tsx` | rAF cursor throttle, cursor fade, follow-mode scroll |
| `frontend/src/components/doc-editor/ParticipantAvatars.tsx` | Follow action button, three-state presence dots |
| `frontend/src/components/doc-editor/SectionBlock.tsx` | Typing indicator animation, multi-user border colors |
| `frontend/src/hooks/useDocuments.ts` | Push-based presence subscription replacing polling |
| `frontend/src/components/doc-editor/DocumentListPage.tsx` | Three-state dots, activity indicators |
| `frontend/src/components/AppLayout.tsx` | Pass `initialJumpToUserId` to `DocumentEditorPage` |
| `src/services/crdt-service.js` | `documents:presence` meta-channel, presence delta broadcasts |
| `frontend/src/hooks/useIdleDetector.ts` | New hook (small, standalone) |
