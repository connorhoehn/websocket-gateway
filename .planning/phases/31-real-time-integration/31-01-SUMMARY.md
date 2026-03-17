---
phase: 31-real-time-integration
plan: 01
subsystem: api
tags: [redis, websocket, pub-sub, broadcast, social-events]

# Dependency graph
requires:
  - phase: 28-rooms
    provides: channelId on RoomItem — the key for Redis pub/sub routing
  - phase: 29-posts-comments
    provides: posts and comments routes that needed broadcast wired in
  - phase: 30-reactions-likes
    provides: likes and reactions routes that needed broadcast wired in

provides:
  - BroadcastService singleton publishing social events to WebSocket gateway via Redis
  - social:post emitted after every new post (RTIM-01)
  - social:comment emitted after every new comment (RTIM-02)
  - social:like emitted after every post like, comment like, and emoji reaction (RTIM-03)
  - social:member_joined emitted after a user joins a room (RTIM-04)
  - Non-fatal Redis broadcast — social writes succeed even when Redis is unavailable

affects: [32-frontend-real-time, gateway-ws-clients, social-api-routes]

# Tech tracking
tech-stack:
  added: [redis v4.6.14 (already present in package.json)]
  patterns:
    - BroadcastService singleton pattern — shared Redis client across all route handlers
    - void emit() pattern — fire-and-forget broadcast, errors caught inside service
    - targetNodes lookup via SMEMBERS websocket:channel:{channelId}:nodes before publish
    - channel_message Redis envelope format matching gateway handleChannelMessage expectations

key-files:
  created:
    - social-api/src/services/broadcast.ts
  modified:
    - social-api/src/routes/posts.ts
    - social-api/src/routes/comments.ts
    - social-api/src/routes/likes.ts
    - social-api/src/routes/reactions.ts
    - social-api/src/routes/room-members.ts

key-decisions:
  - "BroadcastService uses lazy Redis connection — connect on first emit, null client means skip (non-fatal)"
  - "targetNodes empty check before publish — avoids publishing to channels with no WS subscribers"
  - "void broadcastService.emit() in route handlers — broadcast errors never affect HTTP response status"
  - "fromNode set to 'social-api' in envelope — allows gateway to distinguish social events from chat messages"
  - "message.type set to eventType (e.g. social:post) — WS clients can filter by event type on receive"

patterns-established:
  - "Pattern 1: All social writes follow write-then-broadcast — DynamoDB PutCommand succeeds first, then Redis emit"
  - "Pattern 2: Room channelId lookup via GetCommand on social-rooms table before each emit"
  - "Pattern 3: broadcastService imported at top of route file, emit called with void keyword"

requirements-completed: [RTIM-01, RTIM-02, RTIM-03, RTIM-04]

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 31 Plan 01: Real-Time Integration Summary

**BroadcastService singleton publishing social:post, social:comment, social:like, and social:member_joined events to WebSocket gateway via Redis channel_message envelope**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-17T19:02:52Z
- **Completed:** 2026-03-17T19:07:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `social-api/src/services/broadcast.ts` with `BroadcastService` class that publishes Redis `channel_message` envelopes to `websocket:route:{channelId}` — exactly the format the gateway's `handleChannelMessage` expects
- Wired `broadcastService.emit` into all 5 route handlers: posts (RTIM-01), comments (RTIM-02), post likes + comment likes (RTIM-03), emoji reactions (RTIM-03), and room join (RTIM-04)
- All broadcast calls use `void` keyword — failures are caught internally by BroadcastService and never affect HTTP response codes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BroadcastService and add redis dependency** - `4705d93` (feat)
2. **Task 2: Wire broadcastService.emit into posts, comments, likes** - `173a57e` (feat)
3. **Task 2 completion: Wire reactions.ts and room-members.ts** - `c0520c7` (feat)

## Files Created/Modified

- `social-api/src/services/broadcast.ts` - BroadcastService class with emit(channelId, eventType, payload), lazy Redis connection, targetNodes SMEMBERS lookup, channel_message envelope builder
- `social-api/src/routes/posts.ts` - Added ROOMS_TABLE, broadcastService import, social:post emit after PutCommand
- `social-api/src/routes/comments.ts` - Added ROOMS_TABLE, broadcastService import, social:comment emit after PutCommand
- `social-api/src/routes/likes.ts` - Added ROOMS_TABLE, broadcastService import, social:like emit in both postLikesRouter POST and commentLikesRouter POST
- `social-api/src/routes/reactions.ts` - Added ROOMS_TABLE, broadcastService import, social:like (type=reaction) emit after PutCommand
- `social-api/src/routes/room-members.ts` - Added broadcastService import, social:member_joined emit after /join PutCommand

## Decisions Made

- BroadcastService uses lazy Redis connection with null client fallback — first emit attempt triggers connection; if Redis is unavailable, all emits log a warning and return without throwing
- targetNodes SMEMBERS check before every publish — if no WS clients are subscribed to the channel, skip the publish entirely (no wasted Redis bandwidth)
- `void broadcastService.emit()` in every route handler — broadcast is fire-and-forget, HTTP response is never blocked or affected by broadcast failure
- Room channelId fetched via GetCommand on `social-rooms` table before each emit — each route already has roomId from params, needs one extra DynamoDB read to get channelId

## Deviations from Plan

None - plan executed exactly as written. All 5 route files and broadcast.ts were implemented exactly per the plan specification.

## Issues Encountered

None — TypeScript compiled with zero errors on first attempt. Redis package was already present in `social-api/package.json` from prior work.

## User Setup Required

None - no external service configuration required. Redis connection uses `REDIS_ENDPOINT` and `REDIS_PORT` env vars, same as the gateway.

## Next Phase Readiness

- Real-time social event broadcasting is complete — connected WebSocket clients receive social:post, social:comment, social:like, and social:member_joined events without polling
- Phase 31-02 (SocialService in gateway) and 31-03 (frontend hooks) can now consume these events
- No blockers

---
*Phase: 31-real-time-integration*
*Completed: 2026-03-17*
