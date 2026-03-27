---
phase: 46-ui-polish-big-brother-view
plan: 01
status: complete
started: "2026-03-27T23:20:54Z"
completed: "2026-03-27T23:25:44Z"
duration_seconds: 290
tasks_completed: 2
tasks_total: 2
files_created: []
files_modified:
  - frontend/src/components/RoomList.tsx
  - frontend/src/components/GroupPanel.tsx
  - frontend/src/components/PostFeed.tsx
  - frontend/src/components/SocialPanel.tsx
  - frontend/src/components/ActivityPanel.tsx
  - frontend/src/index.css
  - frontend/src/hooks/useRooms.ts
  - frontend/src/hooks/useGroups.ts
  - frontend/src/hooks/usePosts.ts
  - frontend/src/hooks/useFriends.ts
files_deleted:
  - frontend/src/components/ChannelSelector.tsx
key-decisions:
  - "Re-throw after setError in hooks so component try/catch receives errors"
  - "FollowButton onFollowChange prop type updated to void | Promise<void> for async handler"
  - "ActivityPanel loading text upgraded to spinner (was already showing loading state)"
---

# Plan 46-01: UI Polish - Inline Errors, Loading, Dead Code Removal

Inline error display on all social mutation forms, loading spinners on async panels, ChannelSelector dead code removed.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Add inline error messages to all social mutation forms | be5a2a1 | Complete |
| 2 | Add loading indicators and remove ChannelSelector dead code | b7691ea | Complete |

## Task Details

### Task 1: Inline Error Messages
- Added `formError` state + try/catch pattern to CreateRoomForm, DMRoomButton, CreateGroupForm, CreatePostForm, and SocialPanel follow/unfollow handler
- Modified 4 hooks (useRooms, useGroups, usePosts, useFriends) to re-throw errors after setting internal error state, enabling component-level try/catch
- Error messages display in red (#dc2626) below form controls and clear on next submission attempt

### Task 2: Loading Indicators and Dead Code Removal
- Added `@keyframes spin` CSS animation to index.css
- Added loading spinner to RoomList (when loading + rooms empty), PostFeed (when loading + posts empty), and ActivityPanel (upgraded existing text)
- Deleted ChannelSelector.tsx (confirmed not imported anywhere in codebase)

## Files Modified

| File | Changes |
|------|---------|
| frontend/src/hooks/useRooms.ts | Re-throw in createRoom, createDM, createGroupRoom |
| frontend/src/hooks/useGroups.ts | Re-throw in createGroup |
| frontend/src/hooks/usePosts.ts | Re-throw in createPost |
| frontend/src/hooks/useFriends.ts | Re-throw in follow, unfollow |
| frontend/src/components/RoomList.tsx | formError in CreateRoomForm + DMRoomButton, loading spinner |
| frontend/src/components/GroupPanel.tsx | formError in CreateGroupForm |
| frontend/src/components/PostFeed.tsx | formError in CreatePostForm, loading spinner |
| frontend/src/components/SocialPanel.tsx | formError for follow/unfollow, async onFollowChange |
| frontend/src/components/ActivityPanel.tsx | Loading spinner upgrade |
| frontend/src/index.css | @keyframes spin animation |
| frontend/src/components/ChannelSelector.tsx | Deleted |

## Verification

- [x] `grep -l "formError"` matches all 4 components (RoomList, GroupPanel, PostFeed, SocialPanel)
- [x] `grep "dc2626"` finds error display in all 4 components
- [x] ChannelSelector.tsx deleted, no imports remain
- [x] Loading spinners present in RoomList, PostFeed, ActivityPanel
- [x] `npx tsc --noEmit` passes with zero errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Hook errors not re-thrown to components**
- **Found during:** Task 1
- **Issue:** All social hooks (useRooms, useGroups, usePosts, useFriends) caught errors and set internal state but did not re-throw, making component-level try/catch ineffective
- **Fix:** Added `throw err` after `setError()` in each mutation method (createRoom, createDM, createGroupRoom, createGroup, createPost, follow, unfollow)
- **Files modified:** useRooms.ts, useGroups.ts, usePosts.ts, useFriends.ts
- **Commit:** be5a2a1

**2. [Rule 1 - Bug] FollowButton onFollowChange type mismatch**
- **Found during:** Task 1
- **Issue:** handleFollowChange became async (returns Promise) but FollowButton/SocialGraphPanel prop type was `() => void`
- **Fix:** Updated prop type to `void | Promise<void>` and added `void` calls in FollowButton handlers
- **Files modified:** SocialPanel.tsx
- **Commit:** be5a2a1
