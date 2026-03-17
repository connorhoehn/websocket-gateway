---
phase: 29-posts-comments
plan: "02"
subsystem: api
tags: [express, dynamodb, ulid, threaded-comments, social]

requires:
  - phase: 29-01
    provides: postsRouter, userPostsRouter, social-posts table, ulid dependency installed
  - phase: 28-02
    provides: roomMembersRouter, social-room-members table, membership gate pattern
provides:
  - commentsRouter with mergeParams:true for threaded comment CRUD on posts
  - POST /api/rooms/:roomId/posts/:postId/comments (top-level + replies via parentCommentId)
  - GET /api/rooms/:roomId/posts/:postId/comments (flat list, newest-first)
  - DELETE /api/rooms/:roomId/posts/:postId/comments/:commentId (author-only)
  - All Phase 29 routers mounted in index.ts (postsRouter, userPostsRouter, commentsRouter)
affects: [phase-30, phase-31, frontend-social-panel]

tech-stack:
  added: []
  patterns:
    - commentsRouter mergeParams:true pattern for nested resource access to :roomId and :postId
    - Flat comment list with clientside parentCommentId grouping for thread reconstruction
    - ULID sort key + ScanIndexForward:false for newest-first without secondary index
    - parentCommentId omitted entirely (not set to null) for top-level comments

key-files:
  created:
    - social-api/src/routes/comments.ts
  modified:
    - social-api/src/routes/index.ts

key-decisions:
  - "commentsRouter uses mergeParams:true — receives :roomId (from /rooms/:roomId mount) and :postId (from /posts/:postId mount segment)"
  - "GET /comments returns flat array; clients group by parentCommentId to reconstruct thread hierarchy"
  - "parentCommentId omitted entirely for top-level comments (not null) — avoids null comparisons in thread detection"
  - "Membership gate checked on all comment operations (POST, GET, DELETE) to enforce room access control"

patterns-established:
  - "Nested resource router: mount at /rooms/:roomId/posts/:postId/comments with mergeParams:true to access all ancestor params"
  - "Reply threading: parentCommentId stored only when present; absence means top-level"

requirements-completed: [CONT-06, CONT-07, CONT-08]

duration: 2min
completed: 2026-03-17
---

# Phase 29 Plan 02: Comments Routes Summary

**Threaded comment CRUD on posts via commentsRouter with parentCommentId reply support, membership gates, and all Phase 29 routers wired into index.ts**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-17T17:56:51Z
- **Completed:** 2026-03-17T17:57:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `social-api/src/routes/comments.ts` with 3 route handlers (POST, GET, DELETE) delivering CONT-06, CONT-07, CONT-08
- Reply threading via optional `parentCommentId` — top-level comments omit the field, replies include it
- Flat GET response lets clients reconstruct thread hierarchy via `parentCommentId` grouping
- Wired `commentsRouter` into `index.ts`, completing all Phase 29 router mounts (11 total)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create comments.ts with threaded comment CRUD** - `fe92146` (feat)
2. **Task 2: Wire Phase 29 routers into index.ts** - `d58354f` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `social-api/src/routes/comments.ts` - commentsRouter with POST/GET/DELETE comment handlers, membership gate, parent comment validation
- `social-api/src/routes/index.ts` - Added commentsRouter import and mount at `/rooms/:roomId/posts/:postId/comments`

## Decisions Made
- `commentsRouter` uses `mergeParams: true` — receives both `:roomId` (from the `/rooms/:roomId` parent mount path) and `:postId` (from the `/posts/:postId` mount segment), enabling membership gate and post-existence checks without passing IDs through request body
- GET returns flat array sorted newest-first via `ScanIndexForward: false` on ULID sort key — clients are responsible for grouping by `parentCommentId` to render thread hierarchy
- `parentCommentId` is omitted from stored item for top-level comments (never set to `null`) — callers detect top-level by absence of field, not null comparison

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 29 complete: posts (CONT-01 through CONT-05) and comments (CONT-06 through CONT-08) REST APIs are fully wired
- All 11 routes mounted and reachable under `/api`
- TypeScript compiles clean with zero errors
- Ready for Phase 30 (reactions, notifications, or frontend integration)

---
*Phase: 29-posts-comments*
*Completed: 2026-03-17*

## Self-Check: PASSED
- social-api/src/routes/comments.ts: FOUND
- .planning/phases/29-posts-comments/29-02-SUMMARY.md: FOUND
- Commit fe92146: FOUND
- Commit d58354f: FOUND
