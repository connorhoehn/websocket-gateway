---
phase: 31-real-time-integration
plan: "04"
subsystem: social-api / real-time
tags: [websocket, broadcast, rooms, leave, RTIM-04]
dependency_graph:
  requires:
    - 31-01-SUMMARY.md  # POST /join + social:member_joined already wired
    - 31-02-SUMMARY.md  # BroadcastService exists
  provides:
    - DELETE /api/rooms/:roomId/leave endpoint
    - social:member_left WebSocket broadcast on successful leave
  affects:
    - social-api/src/routes/room-members.ts
    - scripts/test-realtime-social.js
tech_stack:
  added: []
  patterns:
    - void broadcastService.emit fire-and-forget after HTTP response (non-fatal)
    - Room existence + membership check before destructive operation
    - Owner leave guard (403) to prevent orphaned rooms
key_files:
  created: []
  modified:
    - social-api/src/routes/room-members.ts
    - scripts/test-realtime-social.js
decisions:
  - "DeleteCommand added to existing @aws-sdk/lib-dynamodb import block (no new dependency)"
  - "Owner leave guard returns 403 — caller must delete room explicitly to clean up"
  - "social:member_left broadcast fires after 200 response (non-fatal void emit pattern)"
metrics:
  duration: 61s
  completed: "2026-03-17"
  tasks_completed: 2
  files_modified: 2
---

# Phase 31 Plan 04: RTIM-04 Leave Gap Closure Summary

**One-liner:** DELETE /api/rooms/:roomId/leave endpoint with social:member_left broadcast closes RTIM-04 leave half.

## What Was Built

RTIM-04 required both join AND leave real-time events. Join was already implemented in 31-01. This plan added the missing leave half:

- `DELETE /api/rooms/:roomId/leave` in `room-members.ts` — removes the caller's membership record from `social-room-members` and emits `social:member_left` to the room's WebSocket channel via `broadcastService`
- Owner leave guard: users with `role === 'owner'` receive 403 to prevent orphaned rooms
- Non-member guard: callers not in the room receive 404
- Updated `scripts/test-realtime-social.js` to document manual verification curl commands for both the join and leave halves of RTIM-04

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add DELETE /leave endpoint with social:member_left broadcast | 8358f12 | social-api/src/routes/room-members.ts |
| 2 | Update test script with leave verification notes | a7bec94 | scripts/test-realtime-social.js |

## Verification Results

1. TypeScript compiles: `npx tsc --noEmit` exits 0
2. `grep "social:member_left" social-api/src/routes/room-members.ts` — returns comment + emit line
3. `grep "void broadcastService.emit" social-api/src/routes/room-members.ts` — returns 2 lines (join + leave)
4. `grep "social:member_left" scripts/test-realtime-social.js` — returns 2 documentation lines

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All files found and all commits verified present.
