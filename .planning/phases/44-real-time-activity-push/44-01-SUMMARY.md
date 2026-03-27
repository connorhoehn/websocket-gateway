---
phase: 44-real-time-activity-push
plan: 01
subsystem: api, infra
tags: [redis, websocket, lambda, dynamodb, pub-sub, activity-feed]

# Dependency graph
requires:
  - phase: 37-activity-log
    provides: activity-log Lambda with DynamoDB write, user-activity table
  - phase: 43-transactional-outbox
    provides: outbox-relay Lambda routing events to SQS, activity-log Lambda triggered by SQS
provides:
  - ActivityService in gateway for user-scoped activity channel subscriptions
  - Redis publish in activity-log Lambda after DynamoDB write for real-time delivery
  - Validator whitelist updated with 'activity' service
affects: [44-02, frontend-activity-panel, simulation-view]

# Tech tracking
tech-stack:
  added: [redis (in activity-log Lambda)]
  patterns: [Lambda-to-Redis publish with module-level singleton, user-scoped channel subscription]

key-files:
  created:
    - src/services/activity-service.js
  modified:
    - src/validators/message-validator.js
    - src/server.js
    - lambdas/activity-log/handler.ts
    - lambdas/activity-log/package.json
    - scripts/invoke-lambda.sh
    - scripts/localstack/init/ready.d/bootstrap.sh

key-decisions:
  - "ActivityService mirrors SocialService exactly -- same constructor, methods, and lifecycle"
  - "Module-level Redis client singleton in Lambda for connection reuse across warm invocations"
  - "Lambda checks sMembers for subscriber nodes before publishing -- skips when no clients subscribed"
  - "REDIS_ENDPOINT=localstack-redis used in Lambda env (Docker container name on localstack-net network)"

patterns-established:
  - "Lambda-to-Redis publish: getRedisClient singleton, sMembers for targetNodes, channel_message envelope, websocket:route:channelId publish"
  - "User-scoped activity channel: activity:userId naming convention for privacy isolation"

requirements-completed: [ALOG-02]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 44 Plan 01: Real-time Activity Push Backend Summary

**ActivityService in gateway with Redis publish from activity-log Lambda enabling live WebSocket delivery of activity events to subscribed clients**

## Performance

- **Duration:** 2 min 16s
- **Started:** 2026-03-27T21:55:40Z
- **Completed:** 2026-03-27T21:57:56Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created ActivityService mirroring SocialService for user-scoped activity channel subscriptions (subscribe/unsubscribe/disconnect)
- Added Redis publish path in activity-log Lambda after DynamoDB write with module-level client singleton and subscriber check
- Updated validator whitelist and bootstrap/invoke scripts with Redis connectivity env vars

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ActivityService + register in gateway + update validator whitelist** - `3345c98` (feat)
2. **Task 2: Add Redis publish to activity-log Lambda after DynamoDB write** - `f39c00e` (feat)

## Files Created/Modified
- `src/services/activity-service.js` - New ActivityService handling subscribe/unsubscribe/disconnect for activity channels
- `src/validators/message-validator.js` - Added 'activity' to allowedServices whitelist
- `src/server.js` - Imported and registered ActivityService unconditionally (not gated by ENABLED_SERVICES)
- `lambdas/activity-log/handler.ts` - Added Redis import, getRedisClient singleton, publishActivityEvent function, publish call after DynamoDB PutCommand
- `lambdas/activity-log/package.json` - Added redis ^4.7.0 dependency
- `scripts/invoke-lambda.sh` - Added REDIS_ENDPOINT=localstack-redis and REDIS_PORT=6379 to Lambda env
- `scripts/localstack/init/ready.d/bootstrap.sh` - Added REDIS_ENDPOINT and REDIS_PORT to activity-log Lambda create-function block

## Decisions Made
- ActivityService mirrors SocialService exactly (same constructor, methods, lifecycle) per plan specification
- Module-level Redis client singleton in Lambda for connection reuse across warm invocations (matches BroadcastService pattern)
- Lambda checks sMembers for subscriber nodes before publishing (skips when no clients subscribed) to avoid unnecessary Redis publish traffic
- REDIS_ENDPOINT=localstack-redis used as the Docker container name on the localstack-net network

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend plumbing complete: gateway accepts activity subscriptions and Lambda publishes to Redis
- Ready for Plan 02: React useActivityFeed hook and ActivityPanel integration for frontend live updates

---
*Phase: 44-real-time-activity-push*
*Completed: 2026-03-27*
