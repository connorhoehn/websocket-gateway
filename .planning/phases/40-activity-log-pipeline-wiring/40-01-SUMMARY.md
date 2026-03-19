---
phase: 40-activity-log-pipeline-wiring
plan: 01
subsystem: infra
tags: [localstack, sqs, lambda, eventbridge, bootstrap]

# Dependency graph
requires:
  - phase: 37-activity-log
    provides: activity-log Lambda deployed to LocalStack via bootstrap.sh
  - phase: 35-event-bus-infrastructure
    provides: social-rooms, social-posts, social-reactions SQS queues created in bootstrap.sh
provides:
  - SQS-to-Lambda event-source-mappings for social-rooms, social-posts, social-reactions queues to activity-log Lambda
affects: [activity-log, localstack-bootstrap, social-events-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "_ESM_ARN variable suffix used for ESM-section ARN fetches to avoid collision with earlier QUEUE_ARN vars in EventBridge routing section"

key-files:
  created: []
  modified:
    - scripts/localstack/init/ready.d/bootstrap.sh

key-decisions:
  - "MISS-3 (v3.0 audit): 3 missing SQS-to-Lambda event-source-mappings added for social-rooms, social-posts, social-reactions — activity-log Lambda now receives all 4 social event categories"
  - "Variable naming uses _ESM_ARN suffix (ROOMS_ESM_ARN, POSTS_ESM_ARN, REACTIONS_ESM_ARN) to avoid collision with existing ROOMS_QUEUE_ARN, POSTS_QUEUE_ARN, REACTIONS_QUEUE_ARN in EventBridge routing section"

patterns-established:
  - "ESM blocks follow identical pattern: fetch queue ARN via get-queue-attributes, then create-event-source-mapping with batch-size=1 and --enabled"

requirements-completed: [ALOG-01]

# Metrics
duration: 2min
completed: 2026-03-19
---

# Phase 40 Plan 01: Activity Log Pipeline Wiring Summary

**3 missing SQS-to-Lambda event-source-mappings added to bootstrap.sh — activity-log Lambda now receives room join, post, comment, reaction, and like events in addition to follows**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-19T16:36:00Z
- **Completed:** 2026-03-19T16:38:54Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added event-source-mapping from social-rooms SQS queue to activity-log Lambda
- Added event-source-mapping from social-posts SQS queue to activity-log Lambda
- Added event-source-mapping from social-reactions SQS queue to activity-log Lambda
- bootstrap.sh now has 5 total ESMs: 4 to activity-log (follows, rooms, posts, reactions) + 1 to crdt-snapshot
- Closes MISS-3 from v3.0 audit gap analysis

## Task Commits

Each task was committed atomically:

1. **Task 1: Add 3 event-source-mappings for social-rooms, social-posts, social-reactions** - `4fc8a1d` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `scripts/localstack/init/ready.d/bootstrap.sh` - Added 3 ESM blocks (ROOMS_ESM_ARN, POSTS_ESM_ARN, REACTIONS_ESM_ARN) after existing social-follows block; 30 lines inserted

## Decisions Made

- Used `_ESM_ARN` variable suffix to avoid shadowing `ROOMS_QUEUE_ARN`, `POSTS_QUEUE_ARN`, `REACTIONS_QUEUE_ARN` already in scope from the EventBridge routing section earlier in the script

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 social SQS queues are now wired to the activity-log Lambda via event-source-mappings in bootstrap.sh
- Room join, post, comment, reaction, and like events will reach the activity-log Lambda when docker-compose is restarted
- Ready for any remaining activity-log pipeline wiring tasks in phase 40

---
*Phase: 40-activity-log-pipeline-wiring*
*Completed: 2026-03-19*
