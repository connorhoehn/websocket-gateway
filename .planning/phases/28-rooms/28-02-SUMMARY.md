---
phase: 28-rooms
plan: "02"
subsystem: social-api/routes
tags: [rooms, membership, dynamodb, express, phase-28]
dependency_graph:
  requires: [28-01]
  provides: [room-members-router, my-rooms-router]
  affects: [social-api/src/routes/index.ts]
tech_stack:
  added: []
  patterns: [mergeParams-router, scan-filter-expression, batch-get-enrich, membership-auth-gate]
key_files:
  created:
    - social-api/src/routes/room-members.ts
  modified:
    - social-api/src/routes/index.ts
decisions:
  - myRoomsRouter exported separately from room-members.ts and mounted at /rooms before roomsRouter — GET /api/rooms cannot be placed in roomMembersRouter (mergeParams mount at /rooms/:roomId never matches /rooms)
  - myRoomsRouter mount order: /rooms myRoomsRouter BEFORE /rooms roomsRouter so GET /api/rooms is captured by myRoomsRouter first
metrics:
  duration: 64s
  completed: "2026-03-17"
  tasks_completed: 2
  files_modified: 2
---

# Phase 28 Plan 02: Room Members and Router Wiring Summary

Room membership endpoints (join, list members, list my rooms) plus full Phase 28 router wiring in central index.ts using separate `myRoomsRouter` export to handle top-level `GET /api/rooms`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create room-members.ts | 0a5ae87 | social-api/src/routes/room-members.ts (created) |
| 2 | Mount all Phase 28 routers in index.ts | 6f4abcd | social-api/src/routes/index.ts (modified) |

## What Was Built

**room-members.ts** exports two routers:

- `roomMembersRouter` (`Router({ mergeParams: true })`): handles sub-routes under a specific room
  - `POST /api/rooms/:roomId/join`: 404 if room missing, 409 if already member, 201 with `{roomId, userId, role, joinedAt}`
  - `GET /api/rooms/:roomId/members`: 404 if room missing, 403 if caller is not a member, 200 with `{members: [{roomId, userId, role, joinedAt}]}`
- `myRoomsRouter` (`Router()`): handles top-level rooms listing
  - `GET /api/rooms`: ScanCommand on `social-room-members` with `FilterExpression: 'userId = :uid'`, then BatchGetCommand to enrich with room details from `social-rooms`, returns `{rooms: [...room + role]}`

**index.ts** mounts all Phase 28 routers in correct order:
- `/groups/:groupId/rooms` -> `groupRoomsRouter`
- `/rooms` -> `myRoomsRouter` (BEFORE roomsRouter — GET /api/rooms order matters)
- `/rooms` -> `roomsRouter`
- `/rooms/:roomId` -> `roomMembersRouter`

## Decisions Made

1. **Separate `myRoomsRouter` export**: `GET /api/rooms` cannot live in `roomMembersRouter` because that router is mounted at `/rooms/:roomId` — Express would never match it for `/rooms` (no roomId segment). Solution: export a second plain `Router()` from the same file and mount it at `/rooms` in index.ts.

2. **Mount order in index.ts**: `myRoomsRouter` mounted before `roomsRouter` at `/rooms` so Express routes `GET /api/rooms` to the list-my-rooms handler rather than falling through to `roomsRouter`.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- room-members.ts: FOUND
- Commit 0a5ae87: FOUND
- Commit 6f4abcd: FOUND
