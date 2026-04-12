---
phase: 33-social-ux-integration
verified: 2026-03-17T00:00:00Z
status: human_needed
score: 8/8 must-haves verified
re_verification: false
human_verification:
  - test: "UXIN-01 — Room channel switching: open two browser sessions, log in as different users, click a room in RoomList, send a chat message from one session"
    expected: "The ChannelSelector in the header reflects the room's channelId; chat messages appear in both sessions scoped to that room, not the default channel"
    why_human: "onSwitchChannel(room.channelId) is wired in code; whether the gateway correctly scopes WebSocket traffic to the new channel requires a live two-browser session"
  - test: "UXIN-02 — Group room creation: create a group, select it, click Create Room in the GROUP ROOMS section, submit a name"
    expected: "New room appears in the group rooms list with a 'group' badge; clicking it switches the active channel"
    why_human: "GroupRoomList renders and calls createGroupRoom via props — the API round-trip and subsequent room appearance require a running social-api"
  - test: "UXIN-03 — Friends picker: follow each other as two users, open the DM form"
    expected: "The DM input is a dropdown showing the mutual friend's display name, not a raw UUID text input; selecting a friend and submitting creates a DM room"
    why_human: "useFriends returns live data from the social-api; whether mutual-friend filtering works end-to-end requires two authenticated users"
  - test: "UXIN-04 — Notification banner: from a second session follow the first user, then join their room, then post in their active room"
    expected: "First user sees three distinct notification banners in the top-right corner ('X followed you', 'X joined [room]', 'New post in [room]'); each auto-dismisses after ~4 seconds; clicking X dismisses immediately"
    why_human: "WebSocket event delivery from the gateway, event type matching (social:follow, social:member_joined, social:post_created), and the 4-second timer are live runtime behaviours"
---

# Phase 33: Social UX Integration — Verification Report

**Phase Goal:** Wire the social layer's real-time data into the UI so users can experience a complete multi-user walkthrough: see friends, join rooms, send/receive social events, and get notified — all without inspecting raw EventLog output.
**Verified:** 2026-03-17
**Status:** human_needed — all automated checks pass; live multi-user runtime must be confirmed by a human
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking a room in RoomList switches the active WebSocket channel to that room's channelId | VERIFIED | `AppLayout.tsx:227` — `onSwitchChannel(room.channelId)` inside `handleRoomSelect`; handler wired to `<RoomList onRoomSelect={handleRoomSelect}>` at line 464 |
| 2 | GroupPanel shows rooms belonging to the selected group and owner/admin can create a new room in that group | VERIFIED | `GroupPanel.tsx:308-402` — `GroupRoomList` internal component with `rooms.filter(r => r.groupId === groupId)`, create form, and empty state; rendered at line 532 when `selectedGroupId` is set |
| 3 | DM creation uses a friends picker select dropdown instead of a raw UUID text input | VERIFIED | `RoomList.tsx:143-162` — `<select>` element with `friends.map(f => <option>)`, "No mutual friends yet" empty state, disabled when empty |
| 4 | When another user follows the current user, a notification banner appears in the UI | VERIFIED | `AppLayout.tsx:245` — `msg.type === 'social:follow'` branch in WS subscription effect produces a notification |
| 5 | When a user joins the currently active room, a notification banner appears | VERIFIED | `AppLayout.tsx:248` — `msg.type === 'social:member_joined'` branch produces a notification |
| 6 | When a new post is created in the currently active room, a notification banner appears | VERIFIED | `AppLayout.tsx:251` — `msg.type === 'social:post_created'` filtered by `activeRoomIdRef.current` |
| 7 | Notifications auto-dismiss after 4 seconds | VERIFIED | `AppLayout.tsx:268-277` — `setTimeout` with `delay = Math.max(0, 4000 - age)` removes oldest notification |
| 8 | Notifications can be manually dismissed via X button | VERIFIED | `AppLayout.tsx:89-101` — `aria-label="Dismiss notification"` button calls `onDismiss(n.id)`; `dismissNotification` filters by id at line 280 |

**Score: 8/8 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/components/AppLayout.tsx` | Room->channel wiring in `handleRoomSelect`, `useRooms` instance, rooms+createGroupRoom props to GroupPanel, `NotificationBanner` | VERIFIED | All patterns present; TypeScript compiles clean |
| `frontend/src/components/GroupPanel.tsx` | `GroupRoomList` internal component, "GROUP ROOMS" section header, props-only rooms data (no `useRooms` import) | VERIFIED | `GroupRoomList` at line 308, "GROUP ROOMS" at line 337, no `useRooms` import confirmed |
| `frontend/src/components/RoomList.tsx` | `useFriends` call, `<select>` element replacing `<input>`, "Select a friend" option | VERIFIED | `useFriends({ idToken })` at line 244, `<select>` at line 143, option text at line 158 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `AppLayout.tsx` | `useWebSocket.switchChannel` | `onSwitchChannel(room.channelId)` in `handleRoomSelect` | WIRED | Line 227 — exact pattern from plan |
| `AppLayout.tsx` | `GroupPanel.tsx` | `createGroupRoom=`, `rooms=`, `onRoomSelect=`, `roomsLoading=` props | WIRED | Lines 452-458 — all four props passed |
| `RoomList.tsx` | `useFriends.ts` | `useFriends({ idToken })` inside RoomList function | WIRED | Line 244 — call exists; `friends` destructured and passed to `DMRoomButton` at line 297 |
| `AppLayout.tsx (NotificationBanner)` | `onMessage` registrar | `useEffect` subscribing to `social:follow`, `social:member_joined`, `social:post_created` | WIRED | Lines 240-265 — all three event types handled; `onMessageRef` stable-ref pattern used |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UXIN-01 | 33-01 | Room selection switches active WebSocket channel | SATISFIED | `handleRoomSelect` calls `setActiveRoomId` + `onSwitchChannel(room.channelId)` |
| UXIN-02 | 33-01 | GroupPanel lists group-scoped rooms; owner/admin can create rooms | SATISFIED | `GroupRoomList` in GroupPanel.tsx with create form gated to `owner` or `admin` role |
| UXIN-03 | 33-01 | DM creation uses friends picker instead of raw UUID input | SATISFIED | `<select>` with `friends.map` in `DMRoomButton`; empty state: "No mutual friends yet" |
| UXIN-04 | 33-02 | Social events surface as in-app notifications | SATISFIED | `NotificationBanner` component with WS subscription, auto-dismiss (4s), manual dismiss |

All four requirements marked `[x]` complete in `REQUIREMENTS.md`. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `GroupPanel.tsx` | 51, 62, 148, 345 | `placeholder=` attribute | Info | HTML form input placeholders — not stub code, legitimate UX text |
| `GroupPanel.tsx` | 435 | `return null` | Info | Inside `NotificationBanner` — intentional: renders nothing when `notifications.length === 0` |

No blocker or warning-level anti-patterns found. All `placeholder` strings are HTML form attribute values. The `return null` is correct conditional rendering, not an empty stub implementation.

---

### Human Verification Required

#### 1. UXIN-01: Room channel switching — live two-user session

**Test:** Log in as User A and User B in separate browser sessions. User A creates a standalone room. Both users click the room in RoomList.
**Expected:** ChannelSelector in the header updates to the room's channelId; chat messages sent by User A appear in User B's ChatPanel (proves both are on the same channel).
**Why human:** `onSwitchChannel(room.channelId)` is wired correctly in code. Whether the gateway actually isolates WebSocket traffic to the new channel requires a running server and two authenticated clients.

#### 2. UXIN-02: Group room creation and channel join

**Test:** User A creates a group, selects it in GroupPanel, clicks "Create Room", enters a name, submits.
**Expected:** New room appears in the GROUP ROOMS section with a "group" badge. Clicking the room switches the active channel (ChannelSelector updates, chat is scoped).
**Why human:** Requires the social-api to accept `createGroupRoom` calls and return the new room in the rooms list. The `rooms` prop flows from AppLayout's `useRooms` — this round-trip can only be verified with a live server.

#### 3. UXIN-03: Friends picker populated with mutual friends

**Test:** User A follows User B; User B follows User A back (mutual). User A clicks "Open DM" in RoomList.
**Expected:** The DM form shows a `<select>` dropdown with User B's display name as an option (not a UUID text input). Selecting User B and submitting creates a DM room.
**Why human:** `useFriends` must return mutual friends from the social-api. The dropdown rendering is verified in code; the live data retrieval requires authenticated API calls.

#### 4. UXIN-04: Notification banner with three event types

**Test:** In a two-user session — (a) User B follows User A; (b) User B joins User A's active room; (c) User B creates a post in User A's active room.
**Expected:** User A sees three notification banners sequentially in the top-right (position: fixed, top: 64, right: 16). Each banner shows the correct message. Each auto-dismisses after approximately 4 seconds. Clicking X on any banner dismisses it immediately.
**Why human:** The WS subscription, event routing from the gateway through the social-api, and the 4-second timer are runtime behaviours. The static code analysis confirms the subscription is wired; the live delivery requires both services running and two simultaneous authenticated WebSocket connections.

---

### Gaps Summary

No code gaps found. All artifacts are substantive and fully wired. The phase status is `human_needed` because the goal explicitly requires a "complete multi-user walkthrough" (UXIN-01 through UXIN-04), which by definition cannot be confirmed without two simultaneous authenticated browser sessions against live services.

The four human verification items above correspond directly to the end-to-end walkthrough described in Plan 33-02, Task 2 (checkpoint:human-verify). That checkpoint was auto-approved in the summary — the human confirmation step still needs to occur.

---

_Verified: 2026-03-17_
_Verifier: Claude (gsd-verifier)_
