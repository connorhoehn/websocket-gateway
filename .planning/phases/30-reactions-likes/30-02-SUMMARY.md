---
phase: 30-reactions-likes
plan: "02"
subsystem: social-api/reactions
tags: [reactions, emoji, dynamodb, express, routing]
dependency_graph:
  requires: [30-01]
  provides: [reactionsRouter, REAC-05]
  affects: [social-api/src/routes/index.ts]
tech_stack:
  added: []
  patterns: [mergeParams router, ConditionalCheckFailedException 409, decodeURIComponent emoji params]
key_files:
  created:
    - social-api/src/routes/reactions.ts
  modified:
    - social-api/src/routes/index.ts
decisions:
  - "reactionsRouter mounted at /rooms/:roomId/posts/:postId and handles /reactions sub-paths internally — consistent with postLikesRouter pattern from 30-01 auto-fix"
  - "targetId key uses post:{postId}:reaction suffix — distinct from post:{postId} likes, enabling same user to both like and react to same post"
  - "One reaction per user per post enforced via ConditionExpression attribute_not_exists(userId) — 409 on duplicate"
  - "DELETE /reactions/:emoji uses decodeURIComponent since emoji are multi-byte Unicode that require URL encoding in path params"
metrics:
  duration: 57s
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 30 Plan 02: Reactions Router and Phase 30 Wiring Summary

**One-liner:** Emoji reactions on posts using 12-type VALID_EMOJI validation, composite targetId key, and ConditionalCheckFailedException-based 409 deduplication.

## What Was Built

### reactions.ts — Emoji Reactions Router

Created `social-api/src/routes/reactions.ts` exporting `reactionsRouter` with two handlers:

**POST /rooms/:roomId/posts/:postId/reactions (REAC-05)**
- Validates emoji against a 12-type `VALID_EMOJI` Set; returns 400 on invalid input
- Membership gate (403) and post existence check (404)
- PutCommand with `ConditionExpression: 'attribute_not_exists(userId)'` — 409 on duplicate reaction
- targetId = `post:${postId}:reaction` (distinct from plain like's `post:${postId}`)
- Returns 201 with `{ targetId, userId, type: 'reaction', emoji, createdAt }`

**DELETE /rooms/:roomId/posts/:postId/reactions/:emoji (REAC-05)**
- Decodes URL-encoded emoji from path param via `decodeURIComponent`
- Validates emoji against VALID_EMOJI set (400 on invalid)
- Membership gate (403)
- GetCommand verifies reaction exists before deleting (404 if not found)
- DeleteCommand removes the reaction; returns 204

### index.ts — Phase 30 Router Wiring Completed

Added `reactionsRouter` import and mount to `social-api/src/routes/index.ts`:
```typescript
import { reactionsRouter } from './reactions';
router.use('/rooms/:roomId/posts/:postId', reactionsRouter);
```

Note: `postLikesRouter` and `commentLikesRouter` were already imported and mounted in 30-01 as a Rule 2 auto-fix. This task added only the `reactionsRouter` to complete Phase 30.

## Deviations from Plan

### Observed Difference in index.ts State

**Found during:** Task 2 context read

**Issue:** Plan described index.ts with three Phase 30 mounts missing — but 30-01 had already added `postLikesRouter` and `commentLikesRouter` as a Rule 2 auto-fix. The mounts were already present with slightly different paths: `postLikesRouter` mounted at `/rooms/:roomId/posts/:postId/likes` (full path) rather than `/rooms/:roomId/posts/:postId` as the plan's interface block suggested.

**Resolution:** The existing mounts are correct — `postLikesRouter` handles routes with `.post('/')` and `.delete('/')` so the parent mount path must include `/likes`. Only `reactionsRouter` was added. The plan's interface block described canonical Express sub-router mounting patterns which may have been written assuming the router handled the suffix internally.

**Impact:** None. All Phase 30 endpoints are correctly reachable. No existing mounts were changed.

## Self-Check

Verified:
- `social-api/src/routes/reactions.ts` exists: FOUND
- `social-api/src/routes/index.ts` has reactionsRouter: FOUND
- Commit `0a50ba4` (reactions.ts): FOUND
- Commit `b6925ab` (index.ts): FOUND
- TypeScript compile: PASS (zero errors)

## Self-Check: PASSED
