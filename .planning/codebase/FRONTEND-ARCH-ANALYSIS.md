# Frontend Architecture Analysis

**Analysis Date:** 2026-04-12

## 1. Component Tree & Prop Drilling

### The GatewayDemo -> AppLayout Mega-Prop Interface

`frontend/src/app/App.tsx` renders `GatewayDemo`, which passes **43 props** to `AppLayout` (`frontend/src/components/AppLayout.tsx`). The `AppLayoutProps` interface (lines 138-198) is the single largest prop surface in the codebase.

**Prop categories flowing through AppLayout:**
- Connection (7 props): `connectionState`, `currentChannel`, `onSwitchChannel`, `onDisconnect`, `onReconnect`, `userEmail`, `onSignOut`
- Presence (2): `presenceUsers`, `currentClientId`
- Reactions (2): `activeReactions`, `onReact`
- Chat (3): `chatMessages`, `onChatSend`, `onTyping`
- Cursors (10): `cursors`, `localCursor`, `activeMode`, `onModeChange`, `onFreeformMove`, `onTableClick`, `onTextChange`, `onCanvasMove` + cursor types
- CRDT (4): `crdtContent`, `applyLocalEdit`, `hasConflict`, `onDismissConflict`
- Dev tools (4): `logEntries`, `errors`, `lastError`, `clientId`, `sessionToken`
- Social/messaging (3): `idToken`, `onMessage`, `sendMessage`
- WebSocket (1): `ws` (the full UseWebSocketReturn object)
- Identity (2): `userId`, `displayName`
- Activity bus (3): `activityEvents`, `activityPublish`, `activityIsLive`

**Verdict:** This is a God Component anti-pattern. AppLayout is 822 lines, acts as both layout and feature orchestrator, and owns local state for rooms, documents, notifications, and view switching. It is not "pure presentational" despite its header comment claiming so (line 4).

### Document Editor Prop Chain

The doc editor prop chain is 4 levels deep:

```
GatewayDemo (App.tsx)
  -> AppLayout (43 props)
    -> DocumentEditorPage (9 props from AppLayout)
      -> SectionList (16 props)
        -> SectionBlock (14 props)
          -> TiptapEditor (7 props)
          -> SectionComments (5 props)
            -> CommentNode (6 props, recursive)
```

`DocumentEditorPage` receives `ws`, `userId`, `displayName`, `onMessage`, `activityPublish`, `activityEvents` from AppLayout and immediately destructures `useCollaborativeDoc` with them. This is the correct boundary -- the hook owns the Y.js lifecycle.

However, the data then flows through **SectionList as a pass-through layer** that adds no logic -- it just maps section IDs into per-section callbacks. SectionList (106 lines) exists purely to iterate sections and curry IDs into handlers.

## 2. Component Size & Responsibility

### Oversized Components

| File | Lines | Concern Count |
|------|-------|---------------|
| `frontend/src/components/doc-editor/ReaderMode.tsx` | 993 | Layout + stats + all card renderers |
| `frontend/src/components/doc-editor/DocumentEditorPage.tsx` | 835 | Y.js orchestration + mode switching + export + activity + follow mode + version history + template loading + demo loading |
| `frontend/src/components/AppLayout.tsx` | 821 | Layout + notifications + rooms + documents + view switching + dev tools |
| `frontend/src/components/doc-editor/SectionComments.tsx` | 758 | Comment tree + mention detection + mention insertion + reply forms |
| `frontend/src/hooks/useCollaborativeDoc.ts` | 719 | Y.Doc lifecycle + all mutations + comments + awareness |

**DocumentEditorPage** (`frontend/src/components/doc-editor/DocumentEditorPage.tsx`) is the worst offender for mixed concerns. It handles:
1. Y.js document lifecycle (via useCollaborativeDoc)
2. Mode switching (editor/ack/reader) with URL sync
3. Follow mode with scroll tracking (lines 208-303)
4. Activity publishing wrappers for ack/reject/add (lines 308-338)
5. Section focus tracking via awareness (lines 363-380)
6. Comment handling with @mention extraction (lines 384-409)
7. Version history panel orchestration (lines 466-481)
8. Template auto-population (lines 485-500)
9. Demo document loading (lines 504-533)
10. Export to markdown/PDF/JSON (lines 548-598)

**ReaderMode** (993 lines) renders the entire executive briefing dashboard inline -- all card types, stats calculations, and layout are in one file with no sub-components extracted.

## 3. onMessage Registrar Pattern

### How It Works

The pattern is defined in `GatewayDemo` (`frontend/src/app/App.tsx`, lines 114-178):

```typescript
const featureHandlers = useRef<Array<(msg: GatewayMessage) => void>>([]);

// Called by useWebSocket for every incoming message:
onMessage: (msg) => {
  featureHandlers.current.forEach((h) => h(msg));
  // ... logging
}

// Registrar passed to hooks:
const onMessage = (handler: (msg: GatewayMessage) => void) => {
  featureHandlers.current.push(handler);
  return () => {
    featureHandlers.current = featureHandlers.current.filter((h) => h !== handler);
  };
};
```

### Assessment: Functional But Fragile

**Strengths:**
- Simple pub/sub: any hook can register/unregister handlers
- No centralized message routing -- each hook filters for its own message types
- Cleanup via returned unregister function integrates with useEffect

**Weaknesses:**

1. **`onMessage` is recreated every render.** The function is NOT wrapped in `useCallback` (line 173 of App.tsx). Every render of GatewayDemo creates a new function reference. Hooks that include `onMessage` in their useEffect deps (e.g., `usePresence` line 112, `useCollaborativeDoc` lines 344, 422) will re-run their effects on every parent render. Most hooks mitigate this by only depending on `[onMessage]` but the identity instability means unnecessary unregister/re-register cycles.

2. **Handler ordering is implicit.** All handlers run for all messages. If two hooks both handle the same message type (e.g., `crdt:update`), both run. There's no way to stop propagation or prioritize.

3. **No error isolation.** If any handler throws, `forEach` stops and remaining handlers are skipped. There is no try/catch wrapper around handler invocation (line 119).

4. **Memory concern with handler accumulation.** If a hook registers in a useEffect but the cleanup doesn't run (React strict mode double-mount, fast re-renders), handlers can accumulate. The filter-based cleanup (line 176) relies on reference identity, which is correct but requires the exact same function reference.

## 4. Awareness State Management (TiptapEditor Overwrite Bug)

### The Bug Pattern

Multiple components write to `provider.awareness.setLocalStateField('user', ...)` with different field subsets:

**Writer 1: `useCollaborativeDoc`** (`frontend/src/hooks/useCollaborativeDoc.ts`, line 205):
```typescript
provider.awareness.setLocalStateField('user', {
  userId, displayName, color, mode,
  currentSectionId: null,
  lastSeen: Date.now(),
  idle: false,
});
```

**Writer 2: `TiptapEditor`** (`frontend/src/components/doc-editor/TiptapEditor.tsx`, line 306):
```typescript
provider.awareness.setLocalStateField('user', {
  ...existingUser,    // spread existing
  name: user.name,    // note: "name" not "displayName"
  color: user.color,
});
```

**Writer 3: `DocumentEditorPage` handleSectionFocus** (`frontend/src/components/doc-editor/DocumentEditorPage.tsx`, line 370):
```typescript
provider.awareness.setLocalStateField('user', {
  ...currentUser,     // spread existing
  userId, displayName, color, mode,
  currentSectionId: sectionId,
  lastSeen: Date.now(),
});
```

**Writer 4: `useCollaborativeDoc` idle broadcast** (line 320):
```typescript
provider.awareness.setLocalStateField('user', {
  ...currentUser,     // spread existing
  idle: isIdle,
  lastSeen: Date.now(),
});
```

### The Race Condition

`setLocalStateField('user', ...)` replaces the entire `user` object in the awareness state. Writers 2, 3, and 4 do spread `...existingUser` / `...currentUser` to preserve fields, but Writer 1 (initial setup in the Y.Doc effect) does NOT spread. It sets the full initial state.

The timing issue: TiptapEditor's `useEffect` (Writer 2) runs after the collaborative doc setup (Writer 1). If TiptapEditor's effect fires between Writer 1 and a section focus event, it overwrites `currentSectionId`, `mode`, `idle`, and `lastSeen` with whatever was in the state at that moment, but uses key `name` instead of `displayName`, meaning remote clients may see both fields with the same value under different keys.

**Also note:** TiptapEditor uses `name` (line 308) while all other writers use `displayName`. The awareness reader in `useCollaborativeDoc` (line 268) reads `user.displayName`, meaning TiptapEditor's name field is ignored for participant display. This is not a bug per se, but an inconsistency that makes debugging harder.

### Fix Approach

Use a single awareness update function (perhaps on the GatewayProvider or a shared hook) that merges fields rather than replacing. Something like:
```typescript
function updateAwareness(fields: Partial<UserAwareness>) {
  const current = provider.awareness.getLocalState()?.user ?? {};
  provider.awareness.setLocalStateField('user', { ...current, ...fields });
}
```
This function should be the ONLY way awareness state is modified, eliminating the multi-writer problem.

## 5. Hook Dependency Chains

### Primary Chain

```
useAuth
  -> App.tsx renders GatewayDemo when authenticated

GatewayDemo orchestrates:
  useWebSocket(config, onMessage)
    -> provides: sendMessage, onMessage registrar, connectionState, clientId
  usePresence(sendMessage, onMessage, channel, connectionState, displayName)
  useCursors(sendMessage, onMessage, channel, connectionState, clientId, displayName)
  useCRDT(sendMessage, onMessage, channel, connectionState)
  useChat(sendMessage, onMessage, channel, connectionState, displayName)
  useReactions(sendMessage, onMessage, channel, connectionState)
  useActivityBus(sendMessage, onMessage, connectionState, userId, displayName)
```

All feature hooks share the same pattern:
- Accept `sendMessage` and `onMessage` from the parent
- Register a handler via `onMessage` in a useEffect
- Use `sendMessage` to subscribe/unsubscribe on channel/connection changes
- Store a `sendMessageRef` to avoid effect re-runs

### Document Editor Sub-Chain

```
DocumentEditorPage receives: ws, userId, displayName, onMessage
  useCollaborativeDoc(documentId, mode, ws, userId, displayName, color, onMessage)
    -> creates Y.Doc, GatewayProvider
    -> registers 2 onMessage handlers (reconnect + CRDT messages)
    -> returns: sections, meta, participants, comments, mutation functions
  useVersionHistory(channel, ws.sendMessage, onMessage)
  useMyMentionsAndTasks(sections, comments, displayName, userId) -- pure derivation, no WS
```

### Circular Dependency Risk

No circular import dependencies detected. All hooks follow a strict tree: `useWebSocket` is the root, feature hooks compose on it, and `useCollaborativeDoc` composes on the ws return + onMessage. The dependency graph is a DAG.

However, there is a **logical circularity** in how awareness state flows:
- `useCollaborativeDoc` sets awareness state (userId, mode, idle)
- `TiptapEditor` sets awareness state (cursor position, name, color)
- `DocumentEditorPage` sets awareness state (currentSectionId, mode)
- All three read from the same awareness object

This is not a circular dependency in the import sense, but creates a shared-mutable-state problem where the order of effect execution matters.

## 6. Missing Error Boundaries

**There are zero React Error Boundaries in the entire frontend.**

A `grep` for `ErrorBoundary` across `frontend/src/` returns no matches. This means:

1. **A crash in any doc-editor component (TiptapEditor, SectionBlock, ReaderMode) will unmount the entire App.** Y.js errors, ProseMirror state corruption, or rendering errors in the 993-line ReaderMode will show a white screen.

2. **The WebSocket reconnection UI will be lost.** If `ConnectionStatus` or `DisconnectReconnect` throws, the user loses the ability to see or control their connection state.

3. **No graceful degradation.** The `ErrorDisplay` and `ErrorPanel` components exist but only render gateway-level errors (WebSocket error messages). They do not catch React rendering errors.

### Recommended Boundaries

- Wrap `DocumentEditorPage` in an error boundary (Y.js + Tiptap are the most likely crash sources)
- Wrap each view tab content (`panels`, `social`, `dashboard`, `doc-editor`) independently
- Wrap `TiptapEditor` individually -- ProseMirror can throw on corrupt state

## 7. State Management Architecture

### No Global State Store

There is no Redux, Zustand, Jotai, or React Context used for state management. All state lives in:
- `useState` / `useRef` inside hooks
- The `featureHandlers` ref array in GatewayDemo (the message bus)
- Y.js documents (the collaborative state)
- The Awareness protocol (cursor positions, section focus)

### Consequence

Every piece of shared state must be threaded through props from GatewayDemo. This is why AppLayout has 43 props -- it's the only way to get data from the hooks to the components.

The `activityEvents` array is a good example: it's created by `useActivityBus` in GatewayDemo, passed as a prop to AppLayout, then passed again to both `BigBrotherPanel` AND `DocumentEditorPage` which passes it to `ActivityFeed`. Three levels of prop threading for a read-only array.

## 8. Data Flow Summary

```
WebSocket (binary frames)
  |
  v
useWebSocket (JSON parse, session management, reconnect)
  |
  +---> featureHandlers.current.forEach(h => h(msg))
  |       |
  |       +---> usePresence handler -> setUsers state
  |       +---> useChat handler -> setMessages state  
  |       +---> useCursors handler -> setCursors state
  |       +---> useReactions handler -> setReactions state
  |       +---> useActivityBus handler -> setEvents state
  |       +---> useCollaborativeDoc handler -> GatewayProvider -> Y.Doc
  |       +---> AppLayout notification handler -> setNotifications state
  |
  v
GatewayDemo (owns all hook state)
  |
  v
AppLayout (43 props, routes to views)
  |
  +---> Panels view (Chat, Cursors, Reactions, CRDT, Activity)
  +---> Social view (SocialPanel, GroupPanel, RoomList, PostFeed)
  +---> Dashboard view (BigBrotherPanel)
  +---> Doc Editor view
          |
          +---> DocumentEditorPage (useCollaborativeDoc, useVersionHistory)
                  |
                  +---> SectionList -> SectionBlock -> TiptapEditor
                  +---> AckMode
                  +---> ReaderMode
                  +---> ActivityFeed
                  +---> VersionHistoryPanel (slide-out)
                  +---> MyMentionsPanel (slide-out)
```

## 9. Key Risks & Recommendations

| Risk | Severity | File(s) | Recommendation |
|------|----------|---------|----------------|
| No error boundaries | High | All of `frontend/src/` | Add boundaries around TiptapEditor, each view tab, and DocumentEditorPage |
| AppLayout 43-prop God Component | Medium | `frontend/src/components/AppLayout.tsx` | Extract view-specific containers; consider React Context for ws/identity |
| onMessage not memoized | Medium | `frontend/src/app/App.tsx:173` | Wrap in useCallback or useRef-based stable reference |
| Awareness multi-writer race | Medium | `useCollaborativeDoc.ts`, `TiptapEditor.tsx`, `DocumentEditorPage.tsx` | Single `updateAwareness()` helper that always merges |
| ReaderMode 993 lines, no sub-components | Low | `frontend/src/components/doc-editor/ReaderMode.tsx` | Extract card components (ExecutiveSummary, DecisionCard, etc.) |
| DocumentEditorPage 10+ concerns | Medium | `frontend/src/components/doc-editor/DocumentEditorPage.tsx` | Extract follow-mode, export, and template-loading into custom hooks |
| No handler error isolation in message bus | Low | `frontend/src/app/App.tsx:119` | Wrap `forEach` body in try/catch |

---

*Frontend architecture analysis: 2026-04-12*
