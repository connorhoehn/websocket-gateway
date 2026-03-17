---
phase: 32-frontend-social-layer
plan: 03
subsystem: ui
tags: [react, typescript, social-ui, applayout, wiring, websocket]

# Dependency graph
requires:
  - plan: 32-01
    provides: useSocialProfile, useFriends, useGroups, useRooms, usePosts, useComments, useLikes hooks
  - plan: 32-02
    provides: SocialPanel, GroupPanel, RoomList, PostFeed, CommentThread components
provides:
  - AppLayout wired with idToken and onMessage props
  - GroupPanel rendered in main content area
  - RoomList rendered with onMessage forwarded (RTIM-04 member events)
  - PostFeed rendered with activeRoomId from RoomList selection
  - SocialPanel updated from zero-argument to receive idToken and onMessage
  - App.tsx passes auth.idToken and onMessage to AppLayout
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AppLayout receives social props (idToken, onMessage) as additive extension — zero breaking changes to existing props
    - activeRoomId state lives in AppLayout; passed as prop to RoomList (onRoomSelect) and PostFeed (roomId)
    - OnMessageFn type defined at module level in AppLayout.tsx for clarity

key-files:
  created: []
  modified:
    - frontend/src/components/AppLayout.tsx
    - frontend/src/app/App.tsx
    - frontend/.env (gitignored; VITE_SOCIAL_API_URL appended)

key-decisions:
  - "activeRoomId state owned by AppLayout — RoomList fires onRoomSelect, PostFeed reads roomId; keeps room selection scoped to layout level"
  - "OnMessageFn type defined in AppLayout.tsx (not imported) — mirrors the pattern in RoomList.tsx and PostFeed.tsx for consistency"
  - "frontend/.env not committed (gitignored) but VITE_SOCIAL_API_URL=http://localhost:3001 was appended for local dev"

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
duration: 2min
completed: 2026-03-17
---

# Phase 32 Plan 03: AppLayout Social Wiring Summary

**AppLayout extended with idToken and onMessage props; GroupPanel, RoomList (RTIM-04 onMessage forwarded), and PostFeed rendered below SocialPanel; App.tsx passes auth.idToken and onMessage from GatewayDemo**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-17T20:06:22Z
- **Completed:** 2026-03-17T20:07:52Z
- **Tasks:** 1 (+ 1 auto-approved checkpoint)
- **Files modified:** 2

## Accomplishments

- Added `idToken: string | null` and `onMessage: OnMessageFn` to `AppLayoutProps`; destructured in `AppLayout` function signature with `useState<string | null>(null)` for `activeRoomId`
- Updated `<SocialPanel />` from zero-argument call to `<SocialPanel idToken={idToken} onMessage={onMessage} />`
- Added `<GroupPanel idToken={idToken} />`, `<RoomList idToken={idToken} onMessage={onMessage} onRoomSelect={...} activeRoomId={activeRoomId} />`, and `<PostFeed idToken={idToken} roomId={activeRoomId} onMessage={onMessage} />` below SocialPanel in main content area
- Added `idToken={auth.idToken}` and `onMessage={onMessage}` to `<AppLayout />` call in `GatewayDemo` (App.tsx)
- TypeScript compiles with zero errors; all 4 social components now accessible in the authenticated app

## Task Commits

Each task was committed atomically:

1. **Task 1: Add social props to AppLayout and render GroupPanel, RoomList, PostFeed** - `eebf741` (feat)

## Files Created/Modified

- `frontend/src/components/AppLayout.tsx` - Added OnMessageFn type, idToken/onMessage props, activeRoomId state, updated SocialPanel call, added GroupPanel/RoomList/PostFeed renders
- `frontend/src/app/App.tsx` - Added idToken={auth.idToken} and onMessage={onMessage} to AppLayout JSX call

## Decisions Made

- activeRoomId state owned by AppLayout — RoomList fires onRoomSelect callback, PostFeed receives roomId prop; keeps room selection logic at layout level without prop-drilling through App.tsx
- OnMessageFn type defined locally in AppLayout.tsx for clarity (mirrors pattern in RoomList.tsx and PostFeed.tsx, avoids a new shared types export)
- frontend/.env is gitignored so the VITE_SOCIAL_API_URL addition was not committed; documented in user setup below

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Append `VITE_SOCIAL_API_URL=http://localhost:3001` to `frontend/.env` (local development).
The `.env` file is gitignored so this line must be added manually by each developer.
`.env.example` should also include this variable for discoverability.

## Next Phase Readiness

- Phase 32 complete — all 7 hooks and 5 social components are wired into the running app
- Social features (profile, groups, rooms, posts, reactions, real-time) accessible to any authenticated Cognito user
- Visual browser verification checkpoint (Task 2) is auto-approved per auto_advance config

## Self-Check: PASSED

- FOUND: frontend/src/components/AppLayout.tsx
- FOUND: frontend/src/app/App.tsx
- FOUND: commit eebf741 (Task 1)

---
*Phase: 32-frontend-social-layer*
*Completed: 2026-03-17*
