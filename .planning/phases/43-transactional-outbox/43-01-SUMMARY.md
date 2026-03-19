---
phase: 43-transactional-outbox
plan: 01
subsystem: database
tags: [dynamodb, transactional-outbox, TransactWriteCommand, social-api, event-durability]

# Dependency graph
requires:
  - phase: 36-social-event-publishing
    provides: publishSocialEvent fire-and-forget pattern that this replaces
  - phase: 42-social-data-integrity
    provides: TransactWriteCommand pattern in groups.ts reference implementation
provides:
  - social-outbox DynamoDB table with status-index GSI in LocalStack bootstrap
  - Atomic follow + outbox write in social.ts
  - Atomic room-join + outbox write in room-members.ts
  - Atomic post-create + outbox write in posts.ts
  - Atomic reaction-create + outbox write in reactions.ts
affects: [44-outbox-relay, future-outbox-processor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transactional outbox: social write + UNPROCESSED outbox record in single TransactWriteCommand"
    - "TransactionCanceledException with CancellationReasons[0].Code check (follow + reaction dedup)"
    - "OUTBOX_TABLE = 'social-outbox' constant in each route file"

key-files:
  created: []
  modified:
    - scripts/localstack/init/ready.d/bootstrap.sh
    - social-api/src/routes/social.ts
    - social-api/src/routes/room-members.ts
    - social-api/src/routes/posts.ts
    - social-api/src/routes/reactions.ts

key-decisions:
  - "Outbox item schema: outboxId (ULID PK), status='UNPROCESSED', eventType, queueName, payload (JSON string), createdAt — aligns with RESEARCH.md design"
  - "status-index GSI (PK: status, SK: createdAt, Projection: ALL) enables future relay processor to query UNPROCESSED items in arrival order"
  - "Leave and unfollow routes not converted — publishSocialEvent retained there; only creation events in scope per RESEARCH.md"
  - "PutCommand import removed from reactions.ts (no longer used after TransactWriteCommand conversion)"

patterns-established:
  - "Transactional outbox pattern: every social write atomically creates a corresponding outbox record; no separate EventBridge publish call"

requirements-completed: [ALOG-01, event durability]

# Metrics
duration: 3min
completed: 2026-03-19
---

# Phase 43 Plan 01: Transactional Outbox - Social Routes Summary

**Four social write routes (follow, room-join, post-create, reaction-create) converted from fire-and-forget EventBridge publish to atomic DynamoDB TransactWriteCommand that durably captures event intent in social-outbox table before delivery**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-19T19:30:00Z
- **Completed:** 2026-03-19T19:33:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added social-outbox DynamoDB table with status-index GSI to bootstrap.sh so LocalStack creates it on startup
- Converted follow route from PutCommand + publishSocialEvent to single TransactWriteCommand (social-relationships + social-outbox)
- Converted room-join, post-create, and reaction-create routes to TransactWriteCommand with outbox item
- Removed all publishSocialEvent calls from the four converted routes; broadcastService.emit calls untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Add social-outbox table to bootstrap.sh and convert follow route to TransactWriteCommand** - `3214ca2` (feat)
2. **Task 2: Convert room-members, posts, and reactions routes to TransactWriteCommand with outbox** - `9b76403` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `scripts/localstack/init/ready.d/bootstrap.sh` - Added social-outbox table creation with status-index GSI after user-activity table block
- `social-api/src/routes/social.ts` - Added TransactWriteCommand + TransactionCanceledException + ulid imports; OUTBOX_TABLE constant; follow route converted; unfollow unchanged
- `social-api/src/routes/room-members.ts` - Added TransactWriteCommand + ulid imports; OUTBOX_TABLE constant; join route converted; leave route unchanged
- `social-api/src/routes/posts.ts` - Added TransactWriteCommand import; OUTBOX_TABLE constant; create route converted; publishSocialEvent import removed
- `social-api/src/routes/reactions.ts` - Added TransactWriteCommand + TransactionCanceledException + ulid imports; OUTBOX_TABLE constant; reaction create converted; PutCommand dead import removed

## Decisions Made
- Outbox item uses ULID for `outboxId` PK (time-sortable, no hotspot) and stores `payload` as JSON string for relay processor flexibility
- `queueName` field on outbox item encodes the SQS queue name destination, enabling the future relay processor to deliver without re-deriving routing
- `status-index` GSI enables efficient query of UNPROCESSED items sorted by `createdAt` for relay processor batch reads
- PutCommand dead import removed from reactions.ts after TransactWriteCommand conversion (minor cleanup, no behavioral impact)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed dead PutCommand import from reactions.ts**
- **Found during:** Task 2 (reactions.ts conversion)
- **Issue:** After replacing PutCommand with TransactWriteCommand, PutCommand remained in the import list but was unused — TypeScript would warn
- **Fix:** Removed PutCommand from the @aws-sdk/lib-dynamodb import
- **Files modified:** social-api/src/routes/reactions.ts
- **Verification:** grep confirms PutCommand not in import or usage
- **Committed in:** 9b76403 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (dead import cleanup)
**Impact on plan:** Minor cleanup only, no behavioral change.

## Issues Encountered
None — plan executed smoothly. The groups.ts reference implementation pattern transferred cleanly to all four routes.

## User Setup Required
None — no external service configuration required. LocalStack bootstrap.sh will create the social-outbox table automatically on next `docker compose up`.

## Next Phase Readiness
- social-outbox table and four atomic write routes are ready for Phase 44 outbox relay processor
- All outbox items written with status=UNPROCESSED, eventType, queueName, and payload — relay processor has all fields needed to dispatch to SQS without re-querying source tables
- Leave and unfollow routes still use publishSocialEvent (not in scope for outbox) — Phase 44 should document this intentional asymmetry

## Self-Check: PASSED

- bootstrap.sh: FOUND
- social.ts: FOUND
- room-members.ts: FOUND
- posts.ts: FOUND
- reactions.ts: FOUND
- Commit 3214ca2: FOUND
- Commit 9b76403: FOUND

---
*Phase: 43-transactional-outbox*
*Completed: 2026-03-19*
