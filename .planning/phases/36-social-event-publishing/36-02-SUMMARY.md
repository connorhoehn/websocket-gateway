---
phase: 36-social-event-publishing
plan: "02"
subsystem: social-api
tags: [eventbridge, publishing, likes, reactions, posts, comments, verification]
dependency_graph:
  requires: [36-01]
  provides: [social.like events, social.reaction events, social.post.created events, social.comment.created events, test-social-publishing.sh]
  affects:
    - social-api/src/routes/likes.ts
    - social-api/src/routes/reactions.ts
    - social-api/src/routes/posts.ts
    - social-api/src/routes/comments.ts
    - scripts/test-social-publishing.sh
tech_stack:
  added: []
  patterns: [log-and-continue event publishing, void fire-and-forget, PutEventsCommand]
key_files:
  created:
    - scripts/test-social-publishing.sh
  modified:
    - social-api/src/routes/likes.ts
    - social-api/src/routes/reactions.ts
    - social-api/src/routes/posts.ts
    - social-api/src/routes/comments.ts
decisions:
  - "Publish calls placed after HTTP 201 response and after successful DynamoDB write — identical pattern to plan 01"
  - "Only creation events published — no DELETE handlers instrumented per CONTEXT.md"
  - "test-social-publishing.sh tests all 8 event types including social.room.leave and social.unfollow from plan 01"
metrics:
  duration: 90s
  completed: "2026-03-18"
  tasks_completed: 2
  files_modified: 5
requirements: [SEVT-03, SEVT-04]
---

# Phase 36 Plan 02: Social Event Publishing — Likes, Reactions, Posts, Comments Summary

publishSocialEvent() wired into all remaining 4 route files (likes, reactions, posts, comments), completing full 8-event instrumentation, plus end-to-end verification script covering all social event types.

## What Was Built

Completed the social event publishing layer by instrumenting the four remaining mutation route files and creating a comprehensive verification script.

### likes.ts — social.like events (2 calls)

- `POST /` (postLikesRouter): publishes `social.like` with `{ targetId, userId, roomId, postId }` after successful DynamoDB PutCommand and HTTP 201 response
- `POST /` (commentLikesRouter): publishes `social.like` with `{ targetId, userId, roomId, commentId }` after successful DynamoDB PutCommand and HTTP 201 response
- DELETE handlers not instrumented (unlike events are not published per CONTEXT.md)

### reactions.ts — social.reaction event

- `POST /reactions`: publishes `social.reaction` with `{ targetId, userId, roomId, postId, emoji }` after successful DynamoDB PutCommand and HTTP 201 response
- DELETE handler not instrumented

### posts.ts — social.post.created event

- `POST /`: publishes `social.post.created` with `{ roomId, postId, authorId }` after successful DynamoDB PutCommand and HTTP 201 response
- PUT and DELETE handlers not instrumented

### comments.ts — social.comment.created event

- `POST /`: publishes `social.comment.created` with `{ roomId, postId, commentId, authorId }` after successful DynamoDB PutCommand and HTTP 201 response
- DELETE handler not instrumented

### scripts/test-social-publishing.sh

- Executable bash script testing all 8 social event types against LocalStack SQS queues
- Tests the exact detail-type strings used by `publishSocialEvent()` in all route files
- Each test_route call: purge queue → put-events → poll for messages → PASS/FAIL
- Uses `Source: "social-api"` and `EventBusName: "social-events"` matching helper behavior
- All 8 Detail JSON payloads include a timestamp field matching publishSocialEvent's automatic merge
- Outputs "ALL 8 SOCIAL PUBLISHING TESTS PASSED" on full success

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire publishSocialEvent into likes, reactions, posts, and comments routes | 6b202b1 | likes.ts, reactions.ts, posts.ts, comments.ts |
| 2 | Create end-to-end social publishing verification script | cb25bf1 | scripts/test-social-publishing.sh |

## Verification

```
grep -rn "publishSocialEvent" social-api/src/
social-api/src/lib/aws-clients.ts:27:export async function publishSocialEvent(
social-api/src/routes/comments.ts:10:import { docClient, publishSocialEvent }
social-api/src/routes/comments.ts:108:    void publishSocialEvent('social.comment.created',
social-api/src/routes/room-members.ts:11:import { docClient, publishSocialEvent }
social-api/src/routes/room-members.ts:80:    void publishSocialEvent('social.room.join',
social-api/src/routes/room-members.ts:132:    void publishSocialEvent('social.room.leave',
social-api/src/routes/posts.ts:12:import { docClient, publishSocialEvent }
social-api/src/routes/posts.ts:80:    void publishSocialEvent('social.post.created',
social-api/src/routes/reactions.ts:8:import { docClient, publishSocialEvent }
social-api/src/routes/reactions.ts:77:    void publishSocialEvent('social.reaction',
social-api/src/routes/likes.ts:10:import { docClient, publishSocialEvent }
social-api/src/routes/likes.ts:71:    void publishSocialEvent('social.like',
social-api/src/routes/likes.ts:252:    void publishSocialEvent('social.like',
social-api/src/routes/social.ts:10:import { docClient, publishSocialEvent }
social-api/src/routes/social.ts:84:    void publishSocialEvent('social.follow',
social-api/src/routes/social.ts:121:    void publishSocialEvent('social.unfollow',

npx tsc --noEmit  → 0 errors
```

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
