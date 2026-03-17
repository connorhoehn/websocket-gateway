---
phase: 30-reactions-likes
plan: "01"
subsystem: api
tags: [dynamodb, express, likes, reactions, cognito]

# Dependency graph
requires:
  - phase: 29-posts-comments
    provides: comments.ts membership gate pattern, mergeParams usage, social-comments table schema
  - phase: 28-rooms
    provides: social-room-members table schema, roomId/userId membership gate
  - phase: 25-social-infrastructure
    provides: social-likes DynamoDB table (targetId PK, userId SK)
  - phase: 26-user-profiles-social-graph
    provides: social-profiles table (userId PK, displayName field)
provides:
  - postLikesRouter — POST/DELETE/GET /rooms/:roomId/posts/:postId/likes (like, unlike, who-liked)
  - commentLikesRouter — POST/DELETE /rooms/:roomId/posts/:postId/comments/:commentId/likes (like, unlike)
  - REAC-01, REAC-02, REAC-03, REAC-04, REAC-06 satisfied
affects: [31-reactions-emoji, 32-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Composite targetId key pattern (post:postId / comment:commentId) for polymorphic likes in single table
    - ConditionalCheckFailedException guard for 409 duplicate-like prevention
    - BatchGetCommand for displayName enrichment from social-profiles table
    - ExpressionAttributeNames '#t' guards DynamoDB reserved word 'type' in FilterExpression

key-files:
  created:
    - social-api/src/routes/likes.ts
  modified:
    - social-api/src/routes/index.ts

key-decisions:
  - "postLikesRouter and commentLikesRouter both use mergeParams:true to receive parent path params from mount point"
  - "targetId composite key (post:postId, comment:commentId) stores unlike-typed likes in single social-likes table without per-type GSIs"
  - "GET /likes filters with FilterExpression '#t = :like' to exclude future reaction items (type='reaction') from like count"
  - "Both routers wired into index.ts as Rule 2 auto-fix — endpoints unreachable without mounting (consistent with Phase 29 pattern)"

patterns-established:
  - "Polymorphic like target: prefix targetId with resource type (post: / comment:) to share single table across content types"
  - "BatchGetCommand displayName enrichment: query likers then batch-fetch profiles, fall back to userId if no displayName"

requirements-completed: [REAC-01, REAC-02, REAC-03, REAC-04, REAC-06]

# Metrics
duration: 1min
completed: 2026-03-17
---

# Phase 30 Plan 01: Reactions/Likes — likes.ts Summary

**Attribution-tracked like/unlike for posts and comments with polymorphic composite targetId, duplicate prevention via ConditionalCheckFailedException, and BatchGetCommand displayName enrichment for who-liked**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-17T18:35:30Z
- **Completed:** 2026-03-17T18:36:45Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created `social-api/src/routes/likes.ts` exporting `postLikesRouter` and `commentLikesRouter`
- Implemented POST/DELETE/GET `/likes` on posts with membership gate, 409 duplicate prevention, and BatchGetCommand displayName enrichment
- Implemented POST/DELETE `/likes` on comments with membership gate and 409 duplicate prevention
- Wired both routers into `index.ts` so all 5 endpoints are reachable

## Task Commits

Each task was committed atomically:

1. **Task 1: Create likes.ts with post like/unlike, comment like/unlike, and who-liked** - `5c9eb8d` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `social-api/src/routes/likes.ts` - postLikesRouter (POST/DELETE/GET /likes) and commentLikesRouter (POST/DELETE /likes) with membership gates, composite targetId keys, 409 duplicate guards, and who-liked BatchGetCommand enrichment
- `social-api/src/routes/index.ts` - Mounted postLikesRouter at /rooms/:roomId/posts/:postId/likes and commentLikesRouter at /rooms/:roomId/posts/:postId/comments/:commentId/likes

## Decisions Made
- `post:${postId}` and `comment:${commentId}` composite targetId keys allow future reaction items to share the same social-likes table without collision
- GET /likes uses FilterExpression `#t = :like` to exclude reaction-type items from the like count, future-proofing for Phase 31 emoji reactions
- Both routers mounted in index.ts (Rule 2) — without wiring, REAC-01 through REAC-04 and REAC-06 would be unreachable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Mounted postLikesRouter and commentLikesRouter in index.ts**
- **Found during:** Task 1 (Create likes.ts)
- **Issue:** Plan spec only creates likes.ts but does not include index.ts wiring; without mounting, all 5 like endpoints are unreachable
- **Fix:** Added import and two `router.use(...)` calls in index.ts
- **Files modified:** social-api/src/routes/index.ts
- **Verification:** TypeScript compiles clean after change
- **Committed in:** 5c9eb8d (part of Task 1 commit — same pattern as Phase 29 auto-fix)

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical)
**Impact on plan:** Router wiring is essential for endpoint reachability. Consistent with Phase 29 precedent. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Likes infrastructure complete — REAC-01, REAC-02, REAC-03, REAC-04, REAC-06 satisfied
- Phase 31 (emoji reactions) can reuse the social-likes table with `type='reaction'` and `emoji` field — GET /likes FilterExpression already excludes reaction items from like counts
- No blockers

---
*Phase: 30-reactions-likes*
*Completed: 2026-03-17*
