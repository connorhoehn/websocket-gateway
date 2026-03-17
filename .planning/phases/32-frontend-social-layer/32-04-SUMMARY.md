---
phase: 32-frontend-social-layer
plan: "04"
subsystem: frontend-hooks
tags: [gap-closure, hooks, react, rooms, posts, likes]
dependency_graph:
  requires: []
  provides:
    - createGroupRoom in useRooms (ROOM-02)
    - loadMembers in useRooms (ROOM-06)
    - getUserPosts in usePosts (CONT-05)
    - whoLiked display in PostFeed LikeButton (REAC-06)
  affects:
    - frontend/src/hooks/useRooms.ts
    - frontend/src/hooks/usePosts.ts
    - frontend/src/components/PostFeed.tsx
tech_stack:
  added: []
  patterns:
    - useCallback with loadMembers as dependency of setActiveRoom
    - Fragment wrapper to add sibling spans without extra DOM nodes
key_files:
  created: []
  modified:
    - frontend/src/hooks/useRooms.ts
    - frontend/src/hooks/usePosts.ts
    - frontend/src/components/PostFeed.tsx
decisions:
  - "loadMembers defined before setActiveRoom so setActiveRoom can include it in its useCallback dependency array"
  - "getUserPosts returns PostItem[] directly without mutating posts state — room feed scope is separate from profile view scope"
  - "LikeButton wrapped in React fragment to add whoLiked span as sibling without a wrapper element"
metrics:
  duration: 115s
  completed_date: "2026-03-17"
  tasks_completed: 3
  files_modified: 3
---

# Phase 32 Plan 04: Gap Closure — createGroupRoom, loadMembers, getUserPosts, whoLiked Summary

**One-liner:** Additive gap closure adding createGroupRoom (ROOM-02), loadMembers (ROOM-06), getUserPosts (CONT-05), and whoLiked display (REAC-06) to close 4 verification gaps from phase 32.

## What Was Built

Three existing files received additive changes to close gaps identified in the 32-VERIFICATION.md report. No structural rewrites — only new functions/interface members and a LikeButton render update.

### Task 1: createGroupRoom and loadMembers in useRooms.ts (ROOM-02, ROOM-06)

- Added `loadMembers(roomId)` useCallback calling `GET /api/rooms/:roomId/members` with Bearer auth, storing result in `members` state.
- Moved `loadMembers` definition before `setActiveRoom` in the hook body so `setActiveRoom` can depend on it via `[loadMembers]`.
- Updated `setActiveRoom` to call `void loadMembers(room.roomId)` when the selected room is non-null, seeding the member list from REST on room selection.
- Added `createGroupRoom(groupId, name)` useCallback calling `POST /api/groups/:groupId/rooms` with JSON body and Bearer auth, prepending the returned `RoomItem` to the `rooms` state.
- Extended `UseRoomsReturn` interface with `createGroupRoom` and `loadMembers` signatures, and added both to the return object.

### Task 2: getUserPosts in usePosts.ts (CONT-05)

- Added `getUserPosts(userId)` useCallback calling `GET /api/posts/:userId` with Bearer auth.
- Returns `PostItem[]` directly to the caller without mutating the room-scoped `posts` state (intentional separation for profile views).
- Extended `UsePostsReturn` interface and return object with `getUserPosts`.

### Task 3: whoLiked display in PostFeed LikeButton (REAC-06)

- Updated `useLikes` destructuring in `LikeButton` to include `whoLiked`.
- Wrapped the existing button in a React fragment and added a sibling `<span>` rendering "Liked by: name1, name2, name3 and N more" when `whoLiked.length > 0`.
- Shows first 3 display names with overflow count, using muted gray (#64748b) at 12px.

## Verification Results

All acceptance criteria passed:

- `grep -c "createGroupRoom" useRooms.ts` → 4 (>= 3 required)
- `grep -c "loadMembers" useRooms.ts` → 6 (>= 4 required)
- `grep "void loadMembers" useRooms.ts` → match confirmed
- `grep "groups.*rooms" useRooms.ts` → match confirmed
- `grep "rooms.*members" useRooms.ts` → match confirmed
- `grep -c "getUserPosts" usePosts.ts` → 4 (>= 3 required)
- `grep "Liked by" PostFeed.tsx` → match confirmed
- `grep -c "whoLiked" PostFeed.tsx` → 4 (>= 2 required)
- `npx tsc --noEmit` → exit code 0

## Deviations from Plan

### Structural Adjustment (not a deviation in spirit)

The plan listed `loadMembers` as being added "after leaveRoom" and `setActiveRoom` updated to depend on it. However, JavaScript/TypeScript `useCallback` hoisting does not apply — `const` declarations are not hoisted. To allow `setActiveRoom` to list `loadMembers` in its dependency array without a lint violation, `loadMembers` was defined **before** `setActiveRoom` in the hook body (between the WS effect and `setActiveRoom`), rather than after `leaveRoom` as stated in the plan's approximate line reference. The semantic behavior is identical; only the declaration order differs from the plan's line-number guidance.

All other plan instructions were followed exactly.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | aa34ede | feat(32-04): add createGroupRoom and loadMembers to useRooms hook |
| Task 2 | 3b5be3e | feat(32-04): add getUserPosts to usePosts hook |
| Task 3 | 526939f | feat(32-04): add whoLiked display to PostFeed LikeButton |

## Requirements Closed

- ROOM-02: createGroupRoom calling POST /api/groups/:groupId/rooms
- ROOM-06: loadMembers calling GET /api/rooms/:roomId/members; seeded on setActiveRoom
- CONT-05: getUserPosts calling GET /api/posts/:userId returning PostItem[]
- REAC-06: whoLiked display in PostFeed LikeButton showing first 3 names

## Self-Check: PASSED

- FOUND: frontend/src/hooks/useRooms.ts
- FOUND: frontend/src/hooks/usePosts.ts
- FOUND: frontend/src/components/PostFeed.tsx
- FOUND: .planning/phases/32-frontend-social-layer/32-04-SUMMARY.md
- FOUND commit aa34ede (Task 1)
- FOUND commit 3b5be3e (Task 2)
- FOUND commit 526939f (Task 3)
