---
phase: 37-activity-log
plan: 01
subsystem: api
tags: [lambda, sqs, dynamodb, activity-log, pagination, eventbridge]

# Dependency graph
requires:
  - phase: 35-event-bus-infrastructure
    provides: SQS event-source-mapping wiring Lambda to social event queues
  - phase: 36-social-event-publishing
    provides: social-api routes publishing social events to EventBridge
provides:
  - Lambda handler persisting social events to user-activity DynamoDB table with userId PK and timestamp#eventId SK
  - GET /api/activity REST endpoint returning authenticated user's activity log in reverse-chronological order with cursor pagination
affects: [38-activity-ui, frontend-activitypanel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Composite DynamoDB SK (timestamp#eventId) for uniqueness across same-timestamp events
    - SQS batch error isolation via per-record try/catch with [activity-log] log prefix
    - Base64-encoded DynamoDB LastEvaluatedKey for cursor pagination

key-files:
  created:
    - social-api/src/routes/activity.ts
  modified:
    - lambdas/activity-log/handler.ts
    - social-api/src/routes/index.ts

key-decisions:
  - "Composite SK timestamp#eventId prevents DynamoDB PK collision when multiple events arrive at same millisecond for the same user"
  - "globalThis.crypto.randomUUID() with Math.random fallback ensures compatibility across Node 18/19+ Lambda runtimes"
  - "Timestamp in API response has #eventId suffix stripped via .split('#')[0] — UI gets clean ISO string"

patterns-established:
  - "SQS batch handler pattern: wrap each record's processX() call in try/catch, log [service-name] prefix on error, continue loop"
  - "Cursor pagination: base64-encode DynamoDB LastEvaluatedKey, accept as lastKey query param, decode to ExclusiveStartKey"

requirements-completed: [ALOG-01, ALOG-02]

# Metrics
duration: 1min
completed: 2026-03-18
---

# Phase 37 Plan 01: Activity Log Backend Summary

**Lambda consumer updated with timestamp#eventId composite SK and per-record SQS error isolation; GET /api/activity endpoint added to social-api with DynamoDB cursor pagination**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-18T17:45:32Z
- **Completed:** 2026-03-18T17:46:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Updated activity-log Lambda handler to write DynamoDB records with composite `timestamp#eventId` SK, preventing collision for same-millisecond events
- Added SQS batch error isolation — each record's processing wrapped in try/catch; bad records are logged with `[activity-log]` prefix and skipped without failing the batch
- Created `social-api/src/routes/activity.ts` with `activityRouter` — GET `/` queries user-activity table with `ScanIndexForward: false` (newest first), strips `#eventId` from timestamps in response
- Mounted `activityRouter` at `/activity` in `social-api/src/routes/index.ts` — endpoint available at `GET /api/activity`

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Lambda handler with correct SK format and batch error isolation** - `d19f8d5` (feat)
2. **Task 2: Create GET /api/activity endpoint with cursor pagination** - `9576268` (feat)

## Files Created/Modified
- `lambdas/activity-log/handler.ts` - Added composite SK construction, per-record try/catch in SQS loop
- `social-api/src/routes/activity.ts` - New file: GET /api/activity with DynamoDB Query and cursor pagination
- `social-api/src/routes/index.ts` - Added activityRouter import and mount at /activity

## Decisions Made
- Composite SK `timestamp#eventId` prevents DynamoDB PK collision when multiple events arrive at the same millisecond for the same user
- Used `globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)` for safe eventId generation across Node 18/19+ Lambda runtimes
- Timestamp in API response strips `#eventId` suffix via `.split('#')[0]` so the UI receives a clean ISO 8601 string

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Backend pipeline for activity log is complete: EventBridge → SQS → Lambda → DynamoDB → GET /api/activity
- Plan 37-02 can now build the ActivityPanel React component that fetches from GET /api/activity and renders events in the right column of AppLayout

---
*Phase: 37-activity-log*
*Completed: 2026-03-18*
