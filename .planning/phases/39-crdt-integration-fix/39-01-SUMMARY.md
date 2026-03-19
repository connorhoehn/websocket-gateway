---
phase: 39-crdt-integration-fix
plan: 01
subsystem: crdt
tags: [yjs, dynamodb, eventbridge, docker-compose, localstack]

# Dependency graph
requires:
  - phase: 38-crdt-durability
    provides: crdt-service.js snapshot pipeline, crdt-snapshot Lambda handler, DynamoDB crdt-snapshots table
provides:
  - Corrected snapshot message protocol using crdt:snapshot type matching useCRDT.ts
  - DynamoDB timestamp written as Number for reader parseInt compatibility
  - Explicit EVENT_BUS_NAME env var in websocket-gateway docker-compose
affects:
  - CRDT-01 (checkpoint pipeline end-to-end)
  - CRDT-02 (reconnect recovery via snapshot push)
  - CRDT-03 (conflict indicator dependent on working CRDT pipeline)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DynamoDBDocumentClient marshalls JS numbers as DynamoDB Number type — never use String() wrapper for numeric attributes"
    - "Explicit env vars in docker-compose even when code has defaults — makes runtime config visible and auditable"

key-files:
  created: []
  modified:
    - src/services/crdt-service.js
    - lambdas/crdt-snapshot/handler.ts
    - docker-compose.localstack.yml

key-decisions:
  - "MISS-2: snapshot message type changed from {type:'crdt',action:'snapshot'} to {type:'crdt:snapshot'} — client useCRDT.ts checks msg.type === 'crdt:snapshot' exclusively"
  - "MISS-4: timestamp written as Date.now() (Number) not String(Date.now()) — DynamoDBDocumentClient marshalls Number to {N:...} which gateway reads via parseInt(item.timestamp.N,10)"
  - "ttl written as plain number not String(ttl) — DynamoDB TTL attribute requires Number type"
  - "EVENT_BUS_NAME=social-events made explicit in docker-compose rather than relying on code default"

patterns-established:
  - "crdt:snapshot WebSocket message type: gateway sends {type:'crdt:snapshot',channel,snapshot,timestamp} — no action field"

requirements-completed:
  - CRDT-01
  - CRDT-02
  - CRDT-03

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 39 Plan 01: CRDT Integration Fix Summary

**Three CRDT integration bugs closed: snapshot message type protocol mismatch (MISS-2), DynamoDB timestamp type mismatch (MISS-4), and missing EVENT_BUS_NAME env var — unblocking end-to-end CRDT checkpoint pipeline in LocalStack**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-19T00:00:00Z
- **Completed:** 2026-03-19T00:04:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Fixed `crdt-service.js` to send `{type:'crdt:snapshot'}` (no `action` field) matching `useCRDT.ts` handler at line 67
- Fixed `lambdas/crdt-snapshot/handler.ts` to write DynamoDB timestamp as Number so gateway reader's `parseInt(item.timestamp.N, 10)` never returns NaN
- Fixed `handler.ts` ttl attribute to Number type for DynamoDB TTL compatibility
- Added explicit `EVENT_BUS_NAME=social-events` to websocket-gateway environment in docker-compose.localstack.yml

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix snapshot message type and DynamoDB timestamp attribute type** - `4094d07` (fix)
2. **Task 2: Add EVENT_BUS_NAME env var to websocket-gateway in docker-compose** - `9ece138` (fix)

## Files Created/Modified

- `src/services/crdt-service.js` - Two sendToClient snapshot calls changed from `{type:'crdt',action:'snapshot'}` to `{type:'crdt:snapshot'}` (no action field)
- `lambdas/crdt-snapshot/handler.ts` - PutCommand Item: `timestamp: String(Date.now())` -> `timestamp: Date.now()`, `ttl: String(ttl)` -> `ttl`
- `docker-compose.localstack.yml` - Added `- EVENT_BUS_NAME=social-events` to websocket-gateway environment block after AWS_REGION line

## Decisions Made

- Snapshot messages use `type: 'crdt:snapshot'` with no `action` field — matches the client's exclusive check on `msg.type === 'crdt:snapshot'` in useCRDT.ts line 67
- DynamoDB DocumentClient marshalls JS number values to `{N: "..."}` format; the gateway reader at `crdt-service.js:299` does `parseInt(item.timestamp.N, 10)` — String values land in `{S: "..."}` which `.N` is undefined on, causing NaN
- ttl as String would be silently accepted by DynamoDB but TTL evaluation requires a Number type attribute — corrected to match DynamoDB TTL spec
- EVENT_BUS_NAME explicit in compose follows the same pattern as social-api service and removes silent dependency on code defaults

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Existing `docker-compose.localstack.yml` restart picks up the new env var automatically.

## Next Phase Readiness

- CRDT checkpoint pipeline is now end-to-end correct: gateway publishes to EventBridge -> SQS -> crdt-snapshot Lambda writes Number timestamp to DynamoDB -> gateway reads back with parseInt(item.timestamp.N) returning valid numeric timestamp
- CRDT-01 (checkpoint pipeline), CRDT-02 (reconnect recovery), and CRDT-03 (conflict indicator) requirements are fulfilled
- Frontend useCRDT.ts reconnect recovery flow (subscribe -> gateway pushes crdt:snapshot -> client applies to fresh Y.Doc) will now function correctly in LocalStack

---
*Phase: 39-crdt-integration-fix*
*Completed: 2026-03-19*
