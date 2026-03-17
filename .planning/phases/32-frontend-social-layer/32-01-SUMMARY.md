---
phase: 32-frontend-social-layer
plan: 01
subsystem: ui
tags: [react, typescript, hooks, websocket, social-api, cognito]

# Dependency graph
requires:
  - phase: 31-real-time-integration
    provides: WebSocket social events (social:post, social:comment, social:like, social:member_joined, social:member_left)
  - phase: 30-reactions-likes
    provides: POST/DELETE/GET likes and reactions endpoints
  - phase: 29-posts-comments
    provides: posts and comments REST endpoints
  - phase: 28-rooms
    provides: rooms REST endpoints
  - phase: 27-groups
    provides: groups REST endpoints
  - phase: 26-user-profiles-social-graph
    provides: profiles and social graph REST endpoints
provides:
  - useSocialProfile hook (fetch/update own profile, view other profiles)
  - useFriends hook (followers, following, friends, follow/unfollow)
  - useGroups hook (create/delete/join/leave groups, member management, GRUP-02)
  - useRooms hook (list/create/join/leave rooms, real-time member tracking, RTIM-04)
  - usePosts hook (room post feed, create/edit/delete, pagination, social:post WS handler)
  - useComments hook (post comments, create/delete, social:comment WS handler)
  - useLikes hook (like/unlike posts and comments, who-liked, social:like WS handler, emoji reactions)
affects:
  - 32-02-GroupPanel-RoomList-components
  - 32-03-PostFeed-CommentThread-components

# Tech tracking
tech-stack:
  added: []
  patterns:
    - onMessageRef ref pattern for stable WS subscriptions (same as useReactions.ts)
    - Optimistic UI update with revert on failure (useLikes toggle)
    - _fadeIn boolean flag on PostItem/CommentItem for 200ms opacity animation
    - JWT sub decoded via atob(idToken.split('.')[1]) for own profile fetch
    - import.meta.env.VITE_SOCIAL_API_URL as base URL for all social API calls

key-files:
  created:
    - frontend/src/hooks/useSocialProfile.ts
    - frontend/src/hooks/useFriends.ts
    - frontend/src/hooks/useGroups.ts
    - frontend/src/hooks/useRooms.ts
    - frontend/src/hooks/usePosts.ts
    - frontend/src/hooks/useComments.ts
    - frontend/src/hooks/useLikes.ts
  modified:
    - frontend/.env.example

key-decisions:
  - "All 7 hooks read VITE_SOCIAL_API_URL from import.meta.env and send Authorization: Bearer idToken on every request"
  - "useRooms tracks activeRoomRef.current inside setActiveRoom callback so WS closure always sees current room (RTIM-04)"
  - "useLikes optimistically flips isLiked/likeCount before await, reverts on failure"
  - "useLikes bundles reactWithEmoji() to keep PostActions component thin (plan spec)"
  - "comment likes skip GET on mount — no who-liked endpoint for comments, only post likes"
  - "_fadeIn flag appended to incoming WS items, cleared after 300ms via setTimeout (UI-SPEC real-time update contract)"

patterns-established:
  - "onMessageRef pattern: const ref = useRef(fn); useEffect(() => { ref.current = fn; }, [fn]) — stable WS handler without re-subscribing"
  - "WS subscription in separate useEffect from fetch effect, returns unregister fn from effect cleanup"
  - "All hooks accept { idToken: string | null } and guard early with if (!idToken) return"

requirements-completed:
  - PROF-01
  - PROF-02
  - PROF-03
  - PROF-04
  - PROF-05
  - SOCL-01
  - SOCL-02
  - SOCL-03
  - SOCL-04
  - SOCL-05
  - SOCL-06
  - GRUP-01
  - GRUP-02
  - GRUP-03
  - GRUP-04
  - GRUP-05
  - GRUP-06
  - GRUP-07
  - GRUP-08
  - GRUP-09
  - ROOM-01
  - ROOM-02
  - ROOM-03
  - ROOM-04
  - ROOM-05
  - ROOM-06
  - ROOM-07
  - ROOM-08
  - CONT-01
  - CONT-02
  - CONT-03
  - CONT-04
  - CONT-05
  - CONT-06
  - CONT-07
  - CONT-08
  - REAC-01
  - REAC-02
  - REAC-03
  - REAC-04
  - REAC-05
  - REAC-06
  - RTIM-01
  - RTIM-02
  - RTIM-03
  - RTIM-04

# Metrics
duration: 3min
completed: 2026-03-17
---

# Phase 32 Plan 01: Social API Hooks Summary

**7 typed React hooks covering all social-api REST surfaces plus real-time WS event integration for posts, comments, likes, and room member tracking**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-17T19:53:22Z
- **Completed:** 2026-03-17T19:56:44Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created all 7 social hooks with full TypeScript type annotations, zero compile errors
- usePosts, useComments, useLikes each subscribe to WS social events via the onMessageRef pattern from useReactions.ts
- useGroups exposes deleteGroup() calling DELETE /api/groups/:groupId and filtering from state on 200 (GRUP-02)
- useRooms tracks activeRoomRef and handles social:member_joined (append) and social:member_left (remove by userId) for the active room (RTIM-04)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useSocialProfile, useFriends, useGroups, useRooms hooks** - `1c3a7d4` (feat)
2. **Task 2: Create usePosts, useComments, useLikes hooks with real-time event handling** - `1aed466` (feat)

## Files Created/Modified

- `frontend/src/hooks/useSocialProfile.ts` - Profile fetch/update/view with Cognito JWT sub decoding
- `frontend/src/hooks/useFriends.ts` - Social graph: parallel fetch of followers/following/friends, follow/unfollow actions
- `frontend/src/hooks/useGroups.ts` - Group CRUD, deleteGroup (GRUP-02), member loading
- `frontend/src/hooks/useRooms.ts` - Room list/create/join/leave, activeRoom tracking, WS member events (RTIM-04)
- `frontend/src/hooks/usePosts.ts` - Room post feed with pagination, create/edit/delete, social:post WS prepend with _fadeIn
- `frontend/src/hooks/useComments.ts` - Post comments, create/delete, social:comment WS append with _fadeIn
- `frontend/src/hooks/useLikes.ts` - Post/comment likes with optimistic toggle, social:like WS integer swap, emoji reactions
- `frontend/.env.example` - Added VITE_SOCIAL_API_URL=http://localhost:3001 entry

## Decisions Made

- All hooks read base URL from `import.meta.env.VITE_SOCIAL_API_URL` and apply `Authorization: Bearer ${idToken}` on every fetch call
- useRooms updates `activeRoomRef.current` inside the `setActiveRoom` callback so the WS closure always reads the current room (avoids stale closure bug)
- useLikes performs optimistic update before await and reverts isLiked/likeCount on HTTP failure
- useLikes bundles `reactWithEmoji()` per plan spec to keep PostActions component thin
- Comment likes skip the initial GET (no who-liked endpoint for comments); only post likes load whoLiked on mount
- `_fadeIn: true` appended to WS-delivered PostItem and CommentItem; cleared after 300ms via setTimeout per UI-SPEC real-time animation contract

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required (VITE_SOCIAL_API_URL added to .env.example for user to copy).

## Next Phase Readiness

- All 7 hooks are ready for import by Phase 32-02 (GroupPanel, RoomList) and 32-03 (PostFeed, CommentThread) components
- Components should destructure hook returns directly — no REST calls in components
- SocialPanel.tsx will need to replace mock data wiring with useSocialProfile and useFriends

---
*Phase: 32-frontend-social-layer*
*Completed: 2026-03-17*
