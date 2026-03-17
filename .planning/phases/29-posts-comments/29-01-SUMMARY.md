---
phase: 29-posts-comments
plan: "01"
subsystem: api
tags: [dynamodb, express, ulid, posts, pagination, cursor]

# Dependency graph
requires:
  - phase: 28-rooms
    provides: social-room-members table with roomId/userId keys for membership gate
provides:
  - postsRouter (mergeParams:true) mounted at /rooms/:roomId/posts — POST/PUT/DELETE/GET
  - userPostsRouter mounted at /posts — GET ?userId cross-room post history
  - social-posts DynamoDB table usage with ULID postId sort key
  - Paginated room feed via ScanIndexForward:false + base64 cursor
affects: [30-comments, 31-reactions, any phase reading post data]

# Tech tracking
tech-stack:
  added: [ulid@3.0.2]
  patterns:
    - ULID postId for lexicographically time-sortable DynamoDB sort key
    - Membership gate via GetCommand on social-room-members before write/read operations
    - Ownership gate via GetCommand on social-posts before edit/delete operations
    - Pagination cursor as base64-encoded JSON of DynamoDB LastEvaluatedKey
    - ScanIndexForward:false on ULID sort key gives true newest-first ordering without GSI

key-files:
  created:
    - social-api/src/routes/posts.ts
  modified:
    - social-api/src/routes/index.ts
    - social-api/package.json
    - social-api/package-lock.json

key-decisions:
  - "ULID used for postId (not uuid) — lexicographic sort = chronological order, enabling ScanIndexForward:false for newest-first without secondary index"
  - "Membership gate on both POST and GET /rooms/:roomId/posts — non-members cannot create or read posts"
  - "Ownership gate on PUT and DELETE — only the author can modify or remove their own post"
  - "userPostsRouter GET /posts uses ScanCommand with FilterExpression authorId=:uid — no GSI on authorId; sorted client-side via ULID localeCompare"
  - "Pagination cursor is base64(JSON(LastEvaluatedKey)) for clean URL encoding"
  - "postsRouter and userPostsRouter wired into index.ts as Rule 2 auto-fix — endpoints unreachable without mounting"

patterns-established:
  - "ULID sort key pattern: ulid() for IDs where chronological ordering via localeCompare is needed"
  - "Cursor pagination pattern: base64(JSON(LastEvaluatedKey)) for DynamoDB-native pagination"

requirements-completed: [CONT-01, CONT-02, CONT-03, CONT-04, CONT-05]

# Metrics
duration: 2min
completed: 2026-03-17
---

# Phase 29 Plan 01: Posts Routes Summary

**ULID-keyed post CRUD with membership/ownership gates, ScanIndexForward:false pagination, and cross-room user history via two exported Express routers**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-17T17:53:31Z
- **Completed:** 2026-03-17T17:54:52Z
- **Tasks:** 1 (+ 1 auto-fix deviation)
- **Files modified:** 4

## Accomplishments
- Created social-api/src/routes/posts.ts with 5 route handlers covering full CRUD + pagination
- Installed ulid package for time-sortable postIds enabling newest-first DynamoDB queries without GSI
- Mounted postsRouter and userPostsRouter in index.ts making all 5 endpoints reachable

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ulid and create posts.ts** - `15796e1` (feat)
2. **Deviation: Mount routers in index.ts** - `de1a65a` (feat)

**Plan metadata:** (docs commit, see below)

## Files Created/Modified
- `social-api/src/routes/posts.ts` - postsRouter and userPostsRouter with all 5 handlers
- `social-api/src/routes/index.ts` - Added postsRouter and userPostsRouter mounts
- `social-api/package.json` - Added ulid dependency
- `social-api/package-lock.json` - Lock file update for ulid

## Decisions Made
- Used ULID instead of UUID for postId — lexicographic sort matches chronological order, enabling ScanIndexForward:false for newest-first without any GSI
- Pagination cursor as base64(JSON(LastEvaluatedKey)) keeps URLs clean
- GET /posts uses client-side ULID localeCompare sort after ScanCommand — avoids GSI requirement while maintaining correct order

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Mounted routers in index.ts**
- **Found during:** After Task 1 (route file creation)
- **Issue:** postsRouter and userPostsRouter were created but not mounted — all 5 endpoints unreachable without wiring into the central router index
- **Fix:** Added imports and two `router.use()` calls in social-api/src/routes/index.ts
- **Files modified:** social-api/src/routes/index.ts
- **Verification:** npx tsc --noEmit exits 0 after update
- **Committed in:** de1a65a

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical wiring)
**Impact on plan:** Auto-fix essential for endpoints to be accessible. No scope creep.

## Issues Encountered
None — TypeScript compiled clean on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- postsRouter and userPostsRouter fully operational and mounted
- social-posts table must exist in DynamoDB (ULID sort key on postId) before live use
- Phase 30 (comments) can build on post existence checks using the same POSTS_TABLE constant and roomId/postId key schema

## Self-Check: PASSED

- social-api/src/routes/posts.ts: FOUND
- .planning/phases/29-posts-comments/29-01-SUMMARY.md: FOUND
- Commit 15796e1: FOUND
- Commit de1a65a: FOUND

---
*Phase: 29-posts-comments*
*Completed: 2026-03-17*
