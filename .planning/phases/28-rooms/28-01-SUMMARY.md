---
phase: 28-rooms
plan: "01"
subsystem: social-api/rooms
tags: [rooms, dynamodb, websocket-routing, mutual-friends, dedup]
dependency_graph:
  requires: [27-01, 27-02]
  provides: [roomsRouter, groupRoomsRouter]
  affects: [28-02, 31-websocket-rooms]
tech_stack:
  added: []
  patterns: [mergeParams-router, mutual-friend-guard, dm-dedup-scan, reserved-word-guard]
key_files:
  created:
    - social-api/src/routes/rooms.ts
    - social-api/src/routes/group-rooms.ts
  modified: []
decisions:
  - "POST /api/rooms/dm defined before /:roomId to prevent Express matching 'dm' as roomId param"
  - "DM dedup uses ScanCommand with both owner-orderings — no GSI needed for low-volume dedup"
  - "ExpressionAttributeNames '#t' guards DynamoDB reserved word 'type' in FilterExpression"
  - "groupRoomsRouter uses mergeParams: true to expose :groupId from parent mount"
  - "Invited-only group members (status='invited') treated as non-members for room creation guard"
metrics:
  duration: 65s
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 28 Plan 01: Room Creation Routes Summary

**One-liner:** Two new route files implement standalone/DM/group room creation with mutual-friend guard, dedup, group-admin guard, and separate channelId UUIDs for Phase 31 WebSocket routing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create rooms.ts with standalone and DM room creation | 8fcf97c | social-api/src/routes/rooms.ts |
| 2 | Create group-rooms.ts with group-scoped room creation | 231273d | social-api/src/routes/group-rooms.ts |

## What Was Built

### rooms.ts (roomsRouter)

- `POST /api/rooms` — creates a standalone room; generates distinct `roomId` and `channelId` UUIDs; auto-enrolls creator as owner in `social-room-members`; returns 201 with both IDs
- `POST /api/rooms/dm` — creates a DM room between two mutual friends; mutual-friend guard uses QueryCommand on caller's follows + GetCommand for reverse relationship; dedup guard ScanCommand checks both owner-orderings, returns 409 with existing `roomId` if found; enrolls both users (caller=owner, peer=member)
- DM route defined before any `/:roomId` param route to prevent Express routing ambiguity

### group-rooms.ts (groupRoomsRouter)

- `Router({ mergeParams: true })` — exposes `:groupId` param from parent mount
- `POST /` (mounted at `/api/groups/:groupId/rooms`) — verifies group exists (404 if not), checks caller is owner or admin in `social-group-members` (403 otherwise), creates group-scoped room with `type: 'group'` and `groupId` field, auto-enrolls creator as owner

## Decisions Made

- **DM route ordering:** `POST /dm` defined before any `/:roomId` param route so Express does not match the literal string "dm" as a room ID
- **DM dedup strategy:** ScanCommand with OR filter on both owner/peer orderings covers the case where either user initiated the original DM
- **Reserved word guard:** `ExpressionAttributeNames: { '#t': 'type' }` required in all FilterExpressions referencing the `type` attribute — DynamoDB reserved word
- **mergeParams: true:** Required on groupRoomsRouter so `req.params.groupId` is accessible inside the sub-router
- **Invited status treatment:** Members with `status: 'invited'` are treated as non-members for room creation — only active owner/admin roles permitted

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] social-api/src/routes/rooms.ts exists with `export const roomsRouter`
- [x] social-api/src/routes/group-rooms.ts exists with `export const groupRoomsRouter`
- [x] Both commits exist: 8fcf97c, 231273d
- [x] TypeScript compiles clean (npx tsc --noEmit exits 0)
- [x] `channelId = uuidv4()` distinct from `roomId = uuidv4()` in both files
- [x] `ExpressionAttributeNames: { '#t': 'type' }` present in DM dedup scan
- [x] `Router({ mergeParams: true })` in group-rooms.ts
- [x] `callerRole !== 'owner' && callerRole !== 'admin'` in group-admin guard
- [x] `status(409)` for DM dedup, `status(403)` for mutual-friend and group-admin guards

## Self-Check: PASSED
