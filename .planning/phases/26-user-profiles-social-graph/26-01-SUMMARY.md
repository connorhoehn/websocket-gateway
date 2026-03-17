---
phase: 26-user-profiles-social-graph
plan: 01
subsystem: api
tags: [dynamodb, aws-sdk-v3, express, cognito, crud, profiles]

# Dependency graph
requires:
  - phase: 25-social-infrastructure
    provides: social-profiles DynamoDB table (userId PK), social-api Express service with Cognito auth middleware
provides:
  - POST /api/profiles — create own profile (201), 409 on duplicate, 400 on validation
  - GET /api/profiles/:userId — read profile with 403 visibility gate for private profiles, 404 on missing
  - PUT /api/profiles — update own profile with partial field updates, 404 if no profile exists
affects: [27-following-system, 28-groups, 29-rooms, 30-posts-reactions]

# Tech tracking
tech-stack:
  added:
    - "@aws-sdk/client-dynamodb v3.1010.0"
    - "@aws-sdk/lib-dynamodb v3.1010.0"
  patterns:
    - "DynamoDBDocumentClient.from(ddb) wrapping pattern for document-style API"
    - "Dynamic UpdateExpression builder for partial updates via push/join"
    - "req.user!.sub as DynamoDB partition key for all user-owned resources"
    - "GetCommand existence check before PutCommand to enforce 409 on duplicate create"

key-files:
  created:
    - social-api/src/routes/profiles.ts
  modified:
    - social-api/src/routes/index.ts
    - social-api/package.json

key-decisions:
  - "DynamoDBDocumentClient (lib-dynamodb) used over raw DynamoDBClient — marshals JS objects to DynamoDB AttributeValues automatically"
  - "PUT endpoint uses dynamic UpdateExpression rather than full item replace — only provided fields are updated, preserving existing data"
  - "Visibility gate in GET /:userId returns 403 (not 404) for private profiles — reveals profile existence to owner while blocking others"

patterns-established:
  - "Profile ownership: req.user!.sub === userId check for write operations"
  - "DynamoDB pattern: GetCommand existence check before PutCommand (no ConditionExpression needed for readable conflict handling)"
  - "Partial update pattern: build updates[] and exprValues{} arrays dynamically, always append updatedAt"

requirements-completed: [PROF-01, PROF-02, PROF-03, PROF-04, PROF-05]

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 26 Plan 01: User Profiles CRUD Summary

**Profile CRUD REST API with DynamoDB-backed POST/GET/PUT endpoints using AWS SDK v3 DocumentClient, Cognito sub as PK, and visibility-based 403 gating**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-17T00:00:00Z
- **Completed:** 2026-03-17T00:05:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- AWS SDK v3 DynamoDB packages installed and verified importable in social-api
- POST /api/profiles creates profile in `social-profiles` DynamoDB table keyed on Cognito sub; returns 201 with full item, 409 on duplicate, 400 on validation failures
- GET /api/profiles/:userId fetches profile with visibility gate — 403 for private profiles when requester is not owner, 404 for missing profiles
- PUT /api/profiles updates only provided fields using dynamic UpdateExpression builder; always updates `updatedAt`; 404 if profile does not exist
- profilesRouter mounted in routes/index.ts at `/profiles`; TypeScript compiles clean

## Task Commits

1. **Task 1: Add AWS SDK DynamoDB packages** - `c438928` (chore)
2. **Task 2: Implement POST/GET/PUT /api/profiles route handlers** - `d8f1cff` (feat)

## Files Created/Modified

- `social-api/src/routes/profiles.ts` - Profile CRUD route handlers with DynamoDB DocumentClient, validation, visibility gating
- `social-api/src/routes/index.ts` - Central API router updated to mount profilesRouter at /profiles
- `social-api/package.json` - Added @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb runtime dependencies

## Decisions Made

- Used `DynamoDBDocumentClient` from `@aws-sdk/lib-dynamodb` rather than raw `DynamoDBClient` — automatic JS-to-DynamoDB type marshalling eliminates manual `{ S: "..." }` wrapper syntax
- PUT uses dynamic `UpdateExpression` (push/join pattern) rather than full item overwrite — preserves fields not included in request body
- GET returns 403 (not 404) for private profiles — this reveals existence only to the owner and correctly communicates access denial vs. not found

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. DynamoDB table `social-profiles` was provisioned in Phase 25.

## Next Phase Readiness

- Profile CRUD foundation complete; any social graph feature (following, friends, groups) can now reference profiles by userId
- Following system (Phase 27) can link follower/followee by Cognito sub immediately
- No blockers

---
*Phase: 26-user-profiles-social-graph*
*Completed: 2026-03-17*
