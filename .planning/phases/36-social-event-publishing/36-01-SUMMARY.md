---
phase: 36-social-event-publishing
plan: "01"
subsystem: social-api
tags: [eventbridge, publishing, room-members, social-graph, aws-clients]
dependency_graph:
  requires: [35-02]
  provides: [publishSocialEvent helper, room join/leave events, follow/unfollow events]
  affects: [social-api/src/lib/aws-clients.ts, social-api/src/routes/room-members.ts, social-api/src/routes/social.ts]
tech_stack:
  added: []
  patterns: [log-and-continue event publishing, void fire-and-forget, PutEventsCommand]
key_files:
  created: []
  modified:
    - social-api/src/lib/aws-clients.ts
    - social-api/src/routes/room-members.ts
    - social-api/src/routes/social.ts
    - config/localstack.env
decisions:
  - "publishSocialEvent uses void/fire-and-forget identical to existing broadcastService.emit pattern"
  - "Publish calls placed after HTTP response to ensure DynamoDB mutation succeeded before event fires"
  - "EVENT_BUS_NAME defaults to 'social-events' matching bootstrap.sh bus name"
metrics:
  duration: 78s
  completed: "2026-03-18"
  tasks_completed: 2
  files_modified: 4
requirements: [SEVT-01, SEVT-02]
---

# Phase 36 Plan 01: Social Event Publishing — Room and Follow Events Summary

publishSocialEvent() helper wired into room join/leave and follow/unfollow routes, publishing to EventBridge bus social-events with log-and-continue error handling.

## What Was Built

Added a shared `publishSocialEvent()` helper to `aws-clients.ts` and instrumented four mutation routes to publish durable social events to EventBridge.

### publishSocialEvent helper (aws-clients.ts)

- Imports `PutEventsCommand` from `@aws-sdk/client-eventbridge` (alongside existing `EventBridgeClient`)
- Sends a single-entry PutEventsCommand with `Source: 'social-api'`, caller-supplied `DetailType` and `detail`
- Merges a `timestamp` field into every event payload
- Reads `EVENT_BUS_NAME` from env (defaults to `'social-events'`)
- Wraps send in try/catch — logs with `[event-publish]` prefix, never re-throws
- Exported as a named async function

### Room membership events (room-members.ts)

- `POST /join` publishes `social.room.join` with `{ roomId, userId }` after successful PutCommand and HTTP 201 response
- `DELETE /leave` publishes `social.room.leave` with `{ roomId, userId }` after successful DeleteCommand and HTTP 200 response
- Both calls use `void` prefix matching the existing `broadcastService.emit` pattern

### Social graph events (social.ts)

- `POST /follow/:userId` publishes `social.follow` with `{ followerId, followeeId }` after successful PutCommand and HTTP 201 response
- `DELETE /follow/:userId` publishes `social.unfollow` with `{ followerId, followeeId }` after successful DeleteCommand and HTTP 200 response
- Both calls use `void` prefix (fire-and-forget)

### Environment variable

- `EVENT_BUS_NAME=social-events` appended to `config/localstack.env`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create publishSocialEvent helper and add EVENT_BUS_NAME | 74aa76d | aws-clients.ts, localstack.env |
| 2 | Wire publishSocialEvent into room-members.ts and social.ts | 164ccd2 | room-members.ts, social.ts |

## Verification

```
grep -rn "publishSocialEvent" social-api/src/
social-api/src/lib/aws-clients.ts:27:export async function publishSocialEvent(
social-api/src/routes/room-members.ts:11:import { docClient, publishSocialEvent }
social-api/src/routes/room-members.ts:80:    void publishSocialEvent('social.room.join',
social-api/src/routes/room-members.ts:132:    void publishSocialEvent('social.room.leave',
social-api/src/routes/social.ts:10:import { docClient, publishSocialEvent }
social-api/src/routes/social.ts:84:    void publishSocialEvent('social.follow',
social-api/src/routes/social.ts:121:    void publishSocialEvent('social.unfollow',

npx tsc --noEmit  → 0 errors
```

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All files exist and all commits are present.
