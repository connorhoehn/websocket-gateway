---
phase: 42-social-data-integrity
plan: "01"
subsystem: social-api
tags: [data-integrity, dynamodb, concurrency, idempotency]
dependency_graph:
  requires: []
  provides: [SOCL-01, GRUP-01, ROOM-03, CONT-01]
  affects: [social-api/src/routes/social.ts, social-api/src/routes/groups.ts, social-api/src/routes/rooms.ts, social-api/src/routes/posts.ts, social-api/src/routes/comments.ts]
tech_stack:
  added: [TransactWriteCommand, TransactionCanceledException]
  patterns: [conditional-put, atomic-transact, deterministic-key, trim-before-validate]
key_files:
  created: []
  modified:
    - social-api/src/routes/social.ts
    - social-api/src/routes/groups.ts
    - social-api/src/routes/rooms.ts
    - social-api/src/routes/posts.ts
    - social-api/src/routes/comments.ts
decisions:
  - "Follow dedup checks attribute_not_exists(followeeId) (sort key) not followerId (partition key) — checking SK is the correct uniqueness test on composite PK tables"
  - "Group creation uses TransactWriteCommand with ConditionExpression on groupId — all-or-nothing prevents orphaned membership records"
  - "DM rooms use deterministic key dm#userA#userB (sorted) + ConditionExpression — eliminates TOCTOU race without any table scan; 409 returns the deterministic roomId for idempotent retry"
  - "Trim-before-validate pattern introduces trimmedContent variable so whitespace-only strings fail validation AND stored content is always trimmed"
metrics:
  duration: 125s
  completed: "2026-03-19"
  tasks_completed: 2
  files_modified: 5
---

# Phase 42 Plan 01: Social Data Integrity Fixes Summary

Four social data integrity defects patched so concurrent API calls produce correct, consistent state — dedup follow via correct sort-key condition, atomic group creation via TransactWriteCommand, TOCTOU-safe DM room via deterministic key, whitespace-only content rejection via trim-before-validate.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Fix follow ConditionExpression + atomic group creation | da1a348 |
| 2 | DM race condition fix + trim-before-validate for posts/comments | 8ae450f |

## What Was Built

### Task 1: social.ts + groups.ts

**social.ts (SOCL-01):** The follow dedup `ConditionExpression` used `attribute_not_exists(followerId)` — the partition key, which is always present on any item written by that user. Changed to `attribute_not_exists(followeeId)` (the sort key), which correctly checks whether this specific follow relationship already exists.

**groups.ts (GRUP-01):** The POST / handler made two sequential `PutCommand` calls — one for the group record, one for the owner membership record. If the second write failed (crash, throttle, network), the group existed without an owner member (orphaned). Replaced with `TransactWriteCommand` containing both writes as `TransactItems`. Added `ConditionExpression: 'attribute_not_exists(groupId)'` on the group Put. Added `TransactionCanceledException` catch returning 409. Removed the now-unused `PutCommand` import.

### Task 2: rooms.ts + posts.ts + comments.ts

**rooms.ts (ROOM-03):** The DM creation handler used a full table scan to detect existing DM rooms — a TOCTOU race where two concurrent requests both pass the scan check and both write a duplicate room. Replaced with:
- Deterministic `dmRoomId = ['dm', ...[callerId, targetUserId].sort()].join('#')` — same key regardless of which user initiates
- `ConditionExpression: 'attribute_not_exists(roomId)'` on the PutCommand
- Catch `ConditionalCheckFailedException` returning 409 with `roomId: dmRoomId` (idempotent — caller knows the existing room's ID)
- Removed `ScanCommand` import (no longer used)
- All room-member writes and 201 response use `dmRoomId`

**posts.ts (CONT-01):** Both POST / and PUT /:postId handlers used inline `content.trim()` calls in validation (`content.trim().length === 0`) but also checked `content.length > 10000` against the un-trimmed string. Replaced with `const trimmedContent = (content ?? '').trim()` declared once, with all subsequent uses of `content.trim()` replaced by `trimmedContent`. Ensures whitespace-only content (e.g., `"   "`) correctly fails validation and stored content is always trimmed.

**comments.ts (CONT-01 consistency):** Applied identical trim-before-validate pattern to the POST / handler. No `content.trim()` inline calls remain.

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

1. **Follow ConditionExpression on sort key:** `attribute_not_exists(followeeId)` checks uniqueness of the composite key `(followerId, followeeId)` — the only correct approach on a composite PK table.

2. **Atomic group creation via TransactWriteCommand:** `ConditionExpression: 'attribute_not_exists(groupId)'` added to the group Put prevents concurrent duplicate group creation (UUID collision is astronomically unlikely but the condition also serves as the atomicity anchor).

3. **Deterministic DM roomId:** Sort order `[callerId, targetUserId].sort()` ensures `user-A` initiating and `user-B` initiating produce identical keys, making the ConditionExpression the sole dedup mechanism without needing any read-before-write.

4. **409 response includes roomId:** When DM ConditionExpression fails, the 409 response body includes `roomId: dmRoomId` — the caller receives the deterministic key and can use it directly without a subsequent lookup.

## Self-Check: PASSED

- All 5 modified files exist on disk
- Commit da1a348 (Task 1) confirmed in git log
- Commit 8ae450f (Task 2) confirmed in git log
- TypeScript compiles without errors
- No `content.trim()` inline calls remain in posts.ts or comments.ts
- `attribute_not_exists(followeeId)` confirmed in social.ts
- `TransactWriteCommand` confirmed in groups.ts
- `attribute_not_exists(roomId)` confirmed in rooms.ts
