---
phase: 26-user-profiles-social-graph
plan: 02
subsystem: api
tags: [dynamodb, express, social-graph, follow, rest]

# Dependency graph
requires:
  - phase: 26-01
    provides: social-api Express service with Cognito auth middleware and profiles router mounted

provides:
  - POST /api/social/follow/:userId — follow a user, persists to social-relationships DynamoDB table
  - DELETE /api/social/follow/:userId — unfollow a user, 404 if not currently following
  - GET /api/social/followers — scan social-relationships by followeeId, enriched with profile display names
  - GET /api/social/following — query social-relationships by followerId PK, enriched with profile display names
  - GET /api/social/friends — intersection of following and followers (mutual follows), enriched with profile display names
affects: [phase-28-dm-rooms, phase-27-groups-events]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ScanCommand with FilterExpression for reverse-lookup queries on tables without a GSI
    - BatchGetCommand for profile enrichment after relationship queries
    - Set intersection for mutual-follow (friends) computation
    - ConditionalCheckFailedException caught by name to return 409 on duplicate follow

key-files:
  created:
    - social-api/src/routes/social.ts
  modified:
    - social-api/src/routes/index.ts

key-decisions:
  - "GET /followers uses ScanCommand (not QueryCommand) because social-relationships has no GSI on followeeId"
  - "Profile enrichment returns only public fields (userId, displayName, avatarUrl, visibility) — bio excluded from social lists"
  - "409 returned on duplicate follow (not 200) — callers need to distinguish idempotent from conflicting state"

patterns-established:
  - "Reverse-lookup pattern: ScanCommand with FilterExpression when no GSI exists on sort-key attribute"
  - "Mutual-follow computation: query PK for following, scan for followers, JS Set intersection"

requirements-completed: [SOCL-01, SOCL-02, SOCL-03, SOCL-04, SOCL-05, SOCL-06]

# Metrics
duration: 12min
completed: 2026-03-17
---

# Phase 26 Plan 02: Follow/Unfollow/Friends REST Endpoints Summary

**Five social graph endpoints using DynamoDB QueryCommand/ScanCommand with profile enrichment via BatchGetCommand — self-follow protection, 409 on duplicate follow, Set-intersection friends logic**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-17T16:00:39Z
- **Completed:** 2026-03-17T16:12:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Full follow/unfollow CRUD with correct 400/404/409/201/200 semantics
- Followers endpoint implemented with ScanCommand (no GSI) plus FilterExpression on followeeId
- Friends endpoint computes mutual follows via JavaScript Set intersection of following and followers
- All 5 endpoints enrich relationship IDs with profile data (displayName, avatarUrl, visibility) via BatchGetCommand
- socialRouter mounted in central router — all endpoints available under /api/social/...

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement follow/unfollow/friends route handlers** - `d637dab` (feat)
2. **Task 2: Mount socialRouter in the central router** - `6f56f72` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `social-api/src/routes/social.ts` - All 5 social graph endpoint handlers (226 lines)
- `social-api/src/routes/index.ts` - Added socialRouter import and /social mount

## Decisions Made
- GET /followers uses ScanCommand because the CDK stack's social-relationships table has no GSI on followeeId. This is intentional per the plan spec and noted inline in the code.
- Profile enrichment returns only public fields (userId, displayName, avatarUrl, visibility) — bio is omitted from social list responses to minimize data exposure.
- 409 is returned on duplicate follow (rather than silently succeeding) so clients can distinguish "already following" from a new successful follow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Social graph endpoints are fully implemented and TypeScript-clean
- Mutual-follow (friends) relationship is available for Phase 28 DM rooms (which require mutual friendship before opening a DM channel)
- No blockers for Phase 27 (groups/events) or Phase 28 (DM rooms)

---
*Phase: 26-user-profiles-social-graph*
*Completed: 2026-03-17*
