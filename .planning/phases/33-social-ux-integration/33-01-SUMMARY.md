---
phase: 33-social-ux-integration
plan: 01
subsystem: frontend
tags: [rooms, groups, dm, websocket, channel-switching, friends-picker]
dependency_graph:
  requires: [32-frontend-social-layer]
  provides: [room-channel-wiring, group-room-management, friends-picker-dm]
  affects: [AppLayout, GroupPanel, RoomList, PostFeed]
tech_stack:
  added: []
  patterns: [prop-threading, single-useRooms-instance, friends-picker-select]
key_files:
  created: []
  modified:
    - frontend/src/components/AppLayout.tsx
    - frontend/src/components/GroupPanel.tsx
    - frontend/src/components/RoomList.tsx
decisions:
  - "AppLayout owns single useRooms instance — rooms/createGroupRoom threaded to GroupPanel as props to prevent state desync (two components calling useRooms independently would have separate room lists)"
  - "handleRoomSelect in AppLayout calls both setActiveRoomId and onSwitchChannel(room.channelId) — satisfies UXIN-01 with zero duplication"
  - "GroupRoomList added as unexported internal in GroupPanel.tsx — consistent with existing co-location pattern (GroupCard, MemberList, InviteForm all internal)"
  - "DM friends picker uses <select> over all mutual friends — empty list shows 'No mutual friends yet' and disables submit"
metrics:
  duration: 152
  completed_date: "2026-03-18T00:22:33Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 33 Plan 01: Room-Channel Wiring, Group Rooms, and Friends Picker DM Summary

Room selection now switches the active WebSocket channel, GroupPanel shows group-scoped rooms with an owner/admin create form, and DM creation uses a friends picker select instead of a raw UUID text input.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire room->channel switching in AppLayout + thread rooms/createGroupRoom to GroupPanel | d44a9bc | AppLayout.tsx, GroupPanel.tsx |
| 2 | Replace DM UUID input with friends picker select | 368f4ee | RoomList.tsx |

## What Was Built

### Task 1: Room->Channel Wiring + GroupRoomList (UXIN-01, UXIN-02)

**AppLayout.tsx:**
- Added `useRooms` and `RoomItem` imports
- Instantiated `useRooms({ idToken: idToken!, onMessage })` inside AppLayout — single source of truth for rooms state
- Created `handleRoomSelect(room: RoomItem)` that calls both `setActiveRoomId(room.roomId)` and `onSwitchChannel(room.channelId)`
- Threaded `rooms`, `createGroupRoom`, `onRoomSelect={handleRoomSelect}`, `roomsLoading` as props to `<GroupPanel>`
- Updated `<RoomList>` `onRoomSelect` to use `handleRoomSelect`

**GroupPanel.tsx:**
- Added `RoomItem` type import (no useRooms import — data flows via props)
- Replaced `{ idToken: string | null }` signature with `GroupPanelProps` interface including `rooms`, `createGroupRoom`, `onRoomSelect?`, `roomsLoading`
- Added `GroupRoomList` internal component above GroupPanel export with:
  - `rooms.filter(r => r.groupId === groupId)` for scoped room list
  - Owner/admin create room form with `createGroupRoom(groupId, name)` call
  - Empty state: "No rooms in this group yet."
  - Click handler: `onRoomSelect?.(room)` for channel switching
- Rendered `<GroupRoomList>` below `<MemberList>` and `<InviteForm>` when a group is selected

### Task 2: Friends Picker Select for DMs (UXIN-03)

**RoomList.tsx:**
- Added `useFriends` and `PublicProfile` imports
- Called `useFriends({ idToken })` inside RoomList function body
- Extended `DMRoomButtonProps` with `friends: PublicProfile[]`
- Replaced raw `<input placeholder="User ID for DM">` with `<select>` dropdown
- Default option: "No mutual friends yet" (empty) or "Select a friend…" (populated)
- Mapped friends list to `<option key={f.userId} value={f.userId}>{f.displayName}</option>`
- Submit disabled when `friends.length === 0` or no selection
- Passed `friends={friends}` to `<DMRoomButton>` invocation

## Deviations from Plan

None — plan executed exactly as written. The prerequisite `git checkout HEAD --` restore step was performed before any modifications.

## Self-Check: PASSED

Files verified present:
- FOUND: frontend/src/components/AppLayout.tsx
- FOUND: frontend/src/components/GroupPanel.tsx
- FOUND: frontend/src/components/RoomList.tsx

Commits verified:
- FOUND: d44a9bc (Task 1)
- FOUND: 368f4ee (Task 2)

TypeScript: zero errors (`npx tsc --noEmit` exits 0)
