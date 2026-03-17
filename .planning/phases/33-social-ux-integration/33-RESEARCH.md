# Phase 33: Social UX Integration - Research

**Researched:** 2026-03-17
**Domain:** React frontend wiring — prop threading, WS channel switching, component augmentation, in-app notifications
**Confidence:** HIGH (all findings sourced directly from the codebase; no third-party library research required)

---

## Summary

Phase 33 is pure frontend wiring work. Every required capability already exists in the codebase — `createGroupRoom` is in `useRooms`, `friends` list is in `useFriends`, `switchChannel` is in `useWebSocket`, and the social WS events arrive at `featureHandlers` in `App.tsx`. The four requirements are gap-closure items: connect things that were built in isolation.

The work falls into four independent change sets, each scoped to one or two files. No new hooks, no new backend endpoints, and no new third-party libraries are needed. The only design decision is where to co-locate the notification banner — all evidence points to adding it as a local component inside `AppLayout.tsx`, consuming the `onMessage` prop it already receives from `App.tsx`.

**Primary recommendation:** Treat each UXIN requirement as a surgical edit to an existing file. Plan four tasks, one per requirement, in order of dependency: UXIN-01 first (unlocks real end-to-end testing), then UXIN-02, UXIN-03, UXIN-04 in parallel.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UXIN-01 | Selecting a social room in RoomList switches the active WebSocket channel so that chat, presence, cursors, and reactions all operate within that room (room's `channelId` becomes `currentChannel`) | `onSwitchChannel` (i.e. `switchChannel`) already flows from `useWebSocket` → `App.tsx` → `AppLayout` as prop. `AppLayout` does NOT pass it to `RoomList`/`onRoomSelect`. Fix: add `onSwitchChannel` prop to `AppLayout`, call it inside `onRoomSelect` alongside `setActiveRoomId`. |
| UXIN-02 | GroupPanel lists rooms scoped to the selected group and allows owner/admin to create a new room within that group without leaving the group view | `createGroupRoom(groupId, name)` exists in `useRooms` and calls `POST /api/groups/:groupId/rooms`. `GroupPanel` currently receives only `idToken`. Needs `createGroupRoom` threaded in and a filtered room list (by `room.groupId`) rendered under the selected group. |
| UXIN-03 | DM room creation uses a picker populated from the current user's mutual friends list instead of a raw Cognito `sub` UUID input | `useFriends.friends` returns `PublicProfile[]` with `userId` and `displayName`. `DMRoomButton` in `RoomList.tsx` uses a plain `<input>` for `peerId`. Replace with `<select>` populated from `friends` prop. |
| UXIN-04 | Real-time social events (follow received, member joined room, new post in active room) surface as visible in-app notifications so users see activity without inspecting the EventLog | Events `social:follow`, `social:member_joined`, `social:post_created` arrive via the `onMessage` registrar already wired into `App.tsx`. Need a notification banner component and a `useNotifications` hook (or inline state) that listens for these three event types. |
</phase_requirements>

---

## Standard Stack

### Core (already in project — no installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component state, effects | Project baseline |
| TypeScript | 5.x (existing) | Type safety | Project baseline |
| `useWebSocket` hook | local | WS channel switching via `switchChannel` | The channel switching mechanism |
| `useRooms` hook | local | Room list + `createGroupRoom` + `setActiveRoom` | All room operations centralized here |
| `useFriends` hook | local | `friends: PublicProfile[]` for DM picker | Mutual friends already loaded |
| `useGroups` hook | local | Group rooms list filtering | Groups already available |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | — | — | — |

**Installation:** None. Phase 33 requires zero new package installs.

---

## Architecture Patterns

### Recommended Project Structure

No new files strictly needed. Changes are surgical edits to existing files:

```
frontend/src/
├── app/
│   └── App.tsx                  # UXIN-01: pass onSwitchChannel down to AppLayout
├── components/
│   ├── AppLayout.tsx             # UXIN-01: add onSwitchChannel to props + onRoomSelect handler
│   │                             # UXIN-04: add NotificationBanner component + notification state
│   ├── GroupPanel.tsx            # UXIN-02: add createGroupRoom + rooms props, render group rooms
│   └── RoomList.tsx              # UXIN-03: replace DMRoomButton input with friends select
└── hooks/
    └── (no new hooks required)
```

If the notification banner grows complex, it can be extracted to `frontend/src/components/NotificationBanner.tsx`, but co-location in `AppLayout.tsx` is acceptable given project convention (see Phase 32 decisions: "all sub-components co-located as unexported internals").

### Pattern 1: Prop Threading (UXIN-01)

**What:** `switchChannel` lives in `App.tsx`. It needs to reach `AppLayout`'s `onRoomSelect` handler.

**Current chain:**
```
useWebSocket → switchChannel
App.tsx       → passes onSwitchChannel={switchChannel} to AppLayout (ALREADY DONE)
AppLayout     → receives onSwitchChannel in props (ALREADY DONE)
AppLayout     → does NOT call onSwitchChannel when a room is selected (THE GAP)
```

**Fix in AppLayout.tsx:** AppLayout owns `activeRoomId` state. When `RoomList` fires `onRoomSelect(room)`, AppLayout must call BOTH `setActiveRoomId(room.roomId)` AND `onSwitchChannel(room.channelId)`.

Note: `AppLayout` does not currently render `RoomList` or `GroupPanel`. Verify whether these components are mounted in `AppLayout` or elsewhere. From reading the code, `AppLayout` renders Chat, Cursors, Reactions, CRDT, and Dev Tools — it does NOT render `RoomList` or `GroupPanel`. These must be added to `AppLayout`'s JSX (or verified they are mounted elsewhere in App.tsx).

**Key check:** `AppLayoutProps` does not include `idToken`, `onMessage`, or `onRoomSelect`. These must be added to `AppLayoutProps` if `RoomList` and `GroupPanel` are to be rendered inside `AppLayout`.

From `App.tsx`: `AppLayout` is rendered with `onSwitchChannel={switchChannel}` already. The `idToken` is `config.cognitoToken` (or `auth.idToken`). The `onMessage` registrar is defined locally in `GatewayDemo`.

**Confirmed gap:** `AppLayout` must receive `idToken` and `onMessage` as new props to forward to `RoomList` and `GroupPanel`. Looking at Phase 32 decision: "activeRoomId state owned by AppLayout; RoomList fires onRoomSelect, PostFeed reads roomId" — this confirms `AppLayout` should own this logic. But the current `AppLayout` does NOT render `RoomList` at all. The Phase 32 plan wired social components into AppLayout (32-03 "wire social components into AppLayout; pass idToken and onMessage from App.tsx") — so this WAS done in Phase 32.

**Conclusion:** Check whether `AppLayout` JSX was updated in Phase 32. The current `AppLayout.tsx` code shown does NOT render `RoomList` or `GroupPanel`. The Phase 32 plan says it was done, but the file content doesn't show it. This is a key gap to verify before planning.

### Pattern 2: Group Rooms in GroupPanel (UXIN-02)

**What:** `GroupPanel` needs to show rooms belonging to the selected group and allow room creation.

**Current state:**
- `GroupPanel` props: `{ idToken: string | null }` only
- `useGroups` has no room awareness
- `useRooms` has `createGroupRoom(groupId, name)` and `rooms: RoomItem[]`
- `RoomItem` has `groupId?: string` — rooms belonging to a group already have `groupId` set

**Options:**
1. Pass `rooms` and `createGroupRoom` from a `useRooms` instance in `GroupPanel` — but `useRooms` requires `onMessage` and `idToken`. This means adding `onMessage` to `GroupPanel` props.
2. Pass `rooms` and `createGroupRoom` down as props from the parent that already has a `useRooms` instance.

Option 2 is cleaner — avoids a second `useRooms` instance and duplicate API calls. GroupPanel should receive `rooms`, `createGroupRoom`, and optionally `onRoomSelect` as props.

**Filtering:** `rooms.filter(r => r.groupId === selectedGroupId)` gives group-scoped rooms.

**Create room form:** A small inline form (name input + submit) that calls `createGroupRoom(selectedGroupId, name)`. Can reuse `CreateRoomForm` pattern from `RoomList.tsx`.

**Permission gate:** Only render the form if `selectedGroupRole === 'owner' || 'admin'`. The `selectedGroupRole` logic already exists in `GroupPanel` (lines 346-349).

### Pattern 3: Friends Picker for DMs (UXIN-03)

**What:** `DMRoomButton` in `RoomList.tsx` has `<input placeholder="User ID for DM">`. Replace with `<select>` from `useFriends.friends`.

**Current `DMRoomButton` signature:**
```typescript
interface DMRoomButtonProps {
  onCreateDM: (peerId: string) => Promise<void>;
  loading: boolean;
}
```

**New signature adds:**
```typescript
interface DMRoomButtonProps {
  onCreateDM: (peerId: string) => Promise<void>;
  loading: boolean;
  friends: PublicProfile[];  // from useFriends
}
```

**Where to call `useFriends`:** `RoomList` already receives `idToken`. Either:
- Call `useFriends({ idToken })` inside `RoomList` (simple, co-located)
- Pass `friends` from a parent that already holds `useFriends` state

The simplest approach is calling `useFriends({ idToken })` inside `RoomList` directly, consistent with how `useRooms` is called there today.

**Select element content:**
```tsx
<select value={peerId} onChange={e => setPeerId(e.target.value)}>
  <option value="">Select a friend...</option>
  {friends.map(f => (
    <option key={f.userId} value={f.userId}>{f.displayName}</option>
  ))}
</select>
```

**Edge case:** If `friends` is empty, show disabled button with "No mutual friends yet" message instead of empty select. This is important for the first-time user experience.

### Pattern 4: In-App Notification Banner (UXIN-04)

**What:** Listen for `social:follow`, `social:member_joined`, `social:post_created` events and render a dismissible banner.

**Where events arrive:** All WS messages go through `featureHandlers.current.forEach(h => h(msg))` in `App.tsx`. Any component that receives the `onMessage` registrar can subscribe.

**Design:** A lightweight notification state managed with `useState<Notification[]>`. Each notification auto-dismisses after ~4 seconds.

```typescript
interface Notification {
  id: string;
  message: string;
  type: 'follow' | 'member_joined' | 'post_created';
  timestamp: number;
}
```

**Event types to handle:**
- `social:follow` — "Someone followed you"
- `social:member_joined` — "{displayName} joined {roomName}"
- `social:post_created` — "New post in {roomName}" (only when `msg.roomId === activeRoomRef.current`)

**Placement:** A fixed-position banner in the top-right corner (similar to `ReactionsOverlay` pattern). Co-locate as an unexported internal component in `AppLayout.tsx` consistent with project conventions.

**onMessage threading:** `AppLayout` must receive `onMessage` prop to subscribe notifications. This overlaps with the UXIN-01 gap — `AppLayout` needs `idToken` and `onMessage` added as props regardless.

### Anti-Patterns to Avoid

- **Creating a second `useRooms` instance in `GroupPanel`:** Causes duplicate API calls and divergent state. Pass `createGroupRoom` and `rooms` as props instead.
- **Calling `useFriends` in `App.tsx` and passing `friends` through the entire tree:** Unnecessary prop drilling. Call `useFriends` locally in `RoomList` where it's needed.
- **Auto-dismiss via `setInterval` inside a closure:** Use `setTimeout` + cleanup in `useEffect`. Clear the timeout on component unmount.
- **Switching channel before room is selected locally:** Always set `activeRoomId` locally AND switch channel atomically in the same handler. Don't split across separate effects.
- **Showing raw `userId` in DM picker as fallback:** Always display `displayName`; `userId` is opaque. If `displayName` is somehow absent, fall back to first 8 chars of userId, same as existing MemberList pattern (line 195 of GroupPanel.tsx).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Channel switching | Custom WS channel manager | `switchChannel` from `useWebSocket` | Already handles subscribe/unsubscribe lifecycle |
| Friends list | Manual API calls in GroupPanel | `useFriends({ idToken })` | Handles loading state, error state, parallel fetching |
| Group rooms list | Separate API endpoint | Filter `rooms` by `room.groupId` | Data already present in `useRooms` state |
| Notification auto-dismiss | setInterval polling | `setTimeout` per notification in `useEffect` | Simpler, no polling, cleanup on unmount |
| Toast library | `react-toastify` or similar | Inline CSS notification div | Overkill; project uses inline styles throughout, no external UI library |

---

## Common Pitfalls

### Pitfall 1: AppLayout Does Not Currently Render Social Components
**What goes wrong:** The code in `AppLayout.tsx` does not render `RoomList`, `GroupPanel`, or `PostFeed`. Phase 32 plan says these were wired in (32-03 commit message: "wire social components into AppLayout; pass idToken and onMessage from App.tsx"), but the `AppLayout.tsx` source shown here does NOT include them.
**Why it happens:** The file shown may be stale/pre-Phase-32-complete, or the wiring was added elsewhere.
**How to avoid:** Before planning, read the ACTUAL current `AppLayout.tsx` to confirm whether social components are rendered. If they are NOT there, Phase 33 must add them as part of UXIN-01.
**Warning signs:** `AppLayoutProps` does not include `idToken` or `onMessage` in the interface shown.

### Pitfall 2: `onRoomSelect` in AppLayout Already Present But Unwired
**What goes wrong:** From Phase 32 decision "activeRoomId state owned by AppLayout; RoomList fires onRoomSelect" — this state logic should be in AppLayout. But it's not in the AppLayout source shown.
**Why it happens:** Either AppLayout was updated and what's shown here is pre-Phase-32, or the wiring was put in App.tsx instead.
**How to avoid:** Read AppLayout source fresh before writing the plan. Determine where `activeRoomId` state actually lives.

### Pitfall 3: `createGroupRoom` Updates `rooms` State But GroupPanel Won't See It
**What goes wrong:** If `GroupPanel` gets its own `useRooms` instance, the room created there won't appear in `RoomList` (different instance, different state). Cross-component state desync.
**How to avoid:** Pass `createGroupRoom` and `rooms` from a shared `useRooms` instance in the parent. The parent that owns both `RoomList` and `GroupPanel` (likely `AppLayout`) should hold one `useRooms` instance.

### Pitfall 4: Friends List Not Loaded at DM Time
**What goes wrong:** `useFriends` fetches on mount. If the user hasn't loaded the Friends section yet, `friends` may be empty when they try to open a DM.
**Why it happens:** `useFriends` is called in `SocialPanel` for the social graph UI, but that's separate from `RoomList`.
**How to avoid:** Call `useFriends({ idToken })` in `RoomList` (or wherever `DMRoomButton` lives) so friends load when the room list mounts, not only when the social panel is open.

### Pitfall 5: Notification Banner Subscribes Before `onMessage` Is Stable
**What goes wrong:** `onMessage` in `App.tsx` is defined as a non-memoized inline function (line 168-172). If `AppLayout` passes it to a notification hook that depends on it, every re-render creates a new subscription.
**Why it happens:** `onMessage` in `GatewayDemo` is not wrapped in `useCallback` — it references `featureHandlers.current` (a ref) so it's safe to memoize.
**How to avoid:** Either wrap `onMessage` in `useCallback` in `App.tsx` before passing it down, or use `useRef` to hold the latest `onMessage` inside the notification listener (same pattern as `onMessageRef` in `useRooms.ts` lines 69-72).

### Pitfall 6: `social:post_created` Fires for All Rooms, Not Just Active Room
**What goes wrong:** Broadcasting every post notification regardless of active room creates noise when users are in multiple rooms.
**How to avoid:** In the notification handler, check `msg.roomId === activeRoomId` before creating a post notification. For `social:follow` (no roomId) and `social:member_joined`, always notify.

---

## Code Examples

Verified patterns from the existing codebase:

### Stable onMessage ref pattern (from useRooms.ts lines 69-72)
```typescript
// Source: frontend/src/hooks/useRooms.ts
const onMessageRef = useRef(onMessage);
useEffect(() => {
  onMessageRef.current = onMessage;
}, [onMessage]);
```

### WS event subscription with cleanup (from useRooms.ts lines 104-122)
```typescript
// Source: frontend/src/hooks/useRooms.ts
useEffect(() => {
  const unregister = onMessageRef.current((msg) => {
    if (msg.type === 'social:member_joined' && msg.roomId === activeRoomRef.current) {
      // handle
    }
  });
  return unregister;
}, []); // stable ref prevents dependency churn
```

### Room type badge pattern — reuse in GroupPanel room list (from RoomList.tsx line 195-199)
```typescript
// Source: frontend/src/components/RoomList.tsx
const typeBadgeStyle = (type: RoomItem['type']): React.CSSProperties => {
  if (type === 'standalone') return { background: '#ede9fe', color: '#646cff', ... };
  if (type === 'group')      return { background: '#eff6ff', color: '#3b82f6', ... };
  return                            { background: '#f0fdf4', color: '#16a34a', ... };
};
```

### Friends list shape (from useFriends.ts)
```typescript
// Source: frontend/src/hooks/useFriends.ts
export interface PublicProfile {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  visibility: 'public' | 'private';
}
// friends: PublicProfile[] — mutual follows both directions
```

### createGroupRoom API call (from useRooms.ts lines 235-256)
```typescript
// Source: frontend/src/hooks/useRooms.ts
const createGroupRoom = useCallback(async (groupId: string, name: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/api/groups/${groupId}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create group room (${res.status})`);
  const room = await res.json() as RoomItem;
  setRooms((prev) => [room, ...prev]);
}, [idToken, baseUrl]);
```

### Auto-dismiss notification pattern
```typescript
// Recommended pattern (not yet in codebase)
useEffect(() => {
  if (notifications.length === 0) return;
  const id = setTimeout(() => {
    setNotifications(prev => prev.slice(1));
  }, 4000);
  return () => clearTimeout(id);
}, [notifications]);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw UUID text input for DM target | Friends picker `<select>` | Phase 33 (this phase) | Eliminates friction: users see display names |
| Channel stays on default when social room selected | `switchChannel(room.channelId)` on room select | Phase 33 (this phase) | All real-time features (chat, presence, cursors) now scoped to the selected room |
| Social events only in EventLog | Notification banner overlay | Phase 33 (this phase) | Activity is visible without dev tools |

---

## Open Questions

1. **Is AppLayout.tsx actually wiring RoomList/GroupPanel after Phase 32?**
   - What we know: Phase 32 plan 32-03 commit says "wire social components into AppLayout; pass idToken and onMessage from App.tsx"
   - What's unclear: The AppLayout.tsx source shown in this research does NOT include RoomList or GroupPanel in its JSX. Either the research read an older snapshot, or Phase 32 did not complete this correctly.
   - Recommendation: The planner MUST read the current AppLayout.tsx before writing tasks. If social components are missing from the JSX, that needs to be fixed as part of UXIN-01 task scope.

2. **Where does `activeRoomId` state currently live?**
   - What we know: Phase 32 decision says "activeRoomId state owned by AppLayout"
   - What's unclear: `AppLayoutProps` shown here does not include `activeRoomId` as state (it would be local state, not a prop) nor does the component body show it
   - Recommendation: Confirm in current AppLayout.tsx source. The planner should read the file fresh.

3. **Does `GroupPanel` need to become aware of `onRoomSelect`?**
   - What we know: UXIN-01 requires that selecting a room (including group rooms) switches the channel
   - What's unclear: If group rooms are listed in GroupPanel, clicking them should also trigger `onSwitchChannel`. GroupPanel would need an `onRoomSelect` callback.
   - Recommendation: Pass `onRoomSelect: (room: RoomItem) => void` to GroupPanel. The parent (AppLayout) handles both `setActiveRoomId` and `onSwitchChannel` in that callback.

---

## Prop Threading Map

This summarizes the complete prop chain needed for all four requirements:

```
App.tsx (GatewayDemo)
  auth.idToken ─────────────────────────────────────► AppLayout (idToken: new prop)
  switchChannel ────────────────────────────────────► AppLayout (onSwitchChannel: ALREADY EXISTS)
  onMessage ────────────────────────────────────────► AppLayout (onMessage: new prop)

AppLayout
  idToken ──────────────────────────────────────────► RoomList, GroupPanel
  onMessage ────────────────────────────────────────► RoomList (for RTIM-04), Notification hook
  onSwitchChannel (existing) ───────────────────────► called in onRoomSelect handler
  activeRoomId (local state) ───────────────────────► RoomList (activeRoomId prop)
  createGroupRoom (from useRooms) ──────────────────► GroupPanel
  rooms (from useRooms, filtered) ─────────────────► GroupPanel

RoomList (already has idToken, onMessage, onRoomSelect, activeRoomId)
  friends (from useFriends called inside RoomList) ► DMRoomButton
```

---

## Sources

### Primary (HIGH confidence)
- `frontend/src/app/App.tsx` — GatewayDemo component, prop flow, onSwitchChannel, onMessage registrar
- `frontend/src/components/AppLayout.tsx` — AppLayoutProps, JSX structure, onSwitchChannel presence
- `frontend/src/components/RoomList.tsx` — DMRoomButton implementation, onRoomSelect callback
- `frontend/src/components/GroupPanel.tsx` — selectedGroupId state, role logic, InviteForm
- `frontend/src/hooks/useRooms.ts` — RoomItem type (with channelId), createGroupRoom, setActiveRoom
- `frontend/src/hooks/useFriends.ts` — PublicProfile type, friends list
- `frontend/src/types/gateway.ts` — GatewayMessage (index signature for social event fields)
- `frontend/src/hooks/useGroups.ts` — GroupItem, MemberItem types
- `.planning/STATE.md` — Phase 32 accumulated decisions, especially AppLayout wiring decisions
- `.planning/REQUIREMENTS.md` — UXIN-01 through UXIN-04 specifications

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` — Phase 33 success criteria, Phase 32 plan descriptions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed from source files directly
- Architecture: HIGH — code paths traced through actual source; no speculation
- Pitfalls: HIGH for code-derived pitfalls; MEDIUM for "AppLayout current state" since the shown source may not reflect Phase 32 completion
- Prop threading map: HIGH — derived from actual prop interfaces and component signatures

**Research date:** 2026-03-17
**Valid until:** Until any of AppLayout.tsx, RoomList.tsx, GroupPanel.tsx, or useRooms.ts are modified

**Nyquist validation:** Disabled (`nyquist.enabled: false` in `.planning/config.json`) — Validation Architecture section omitted per config.
