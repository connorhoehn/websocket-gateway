---
phase: 38-crdt-durability
plan: 01
subsystem: infra
tags: [eventbridge, sqs, lambda, dynamodb, crdt, typescript, nodejs]

# Dependency graph
requires:
  - phase: 35-event-bus-infrastructure
    provides: social-events EventBridge bus, SQS queue patterns, Lambda stub deployment pattern
  - phase: 37-activity-log
    provides: activity-log Lambda handler pattern (dual-mode SQS+EventBridge, per-record try/catch)
provides:
  - crdt-snapshot Lambda consumer (TypeScript, SQS/EventBridge dual-mode)
  - crdt-snapshots SQS queue + DLQ with redrive policy
  - crdt.checkpoint EventBridge routing rule
  - crdt-snapshots-dlq CloudWatch alarm
  - crdt-snapshot Lambda with event-source-mapping
  - crdt-snapshots DynamoDB table provisioned in bootstrap
  - writeSnapshot publishes crdt.checkpoint to EventBridge (decoupled from gateway process)
affects: [38-crdt-durability]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-eventbridge (crdt-service.js)"]
  patterns:
    - "EventBridge publish in gateway + Lambda consumer for async persistence"
    - "Log-and-continue: publish failure never crashes the gateway process"
    - "Gzip-compress in gateway, store compressed blob in DynamoDB via Lambda"

key-files:
  created:
    - lambdas/crdt-snapshot/handler.ts
    - lambdas/crdt-snapshot/package.json
    - lambdas/crdt-snapshot/tsconfig.json
  modified:
    - src/services/crdt-service.js
    - scripts/localstack/init/ready.d/bootstrap.sh

key-decisions:
  - "CRDT snapshots route through EventBridge pipeline (crdt.checkpoint) matching social event pattern — gateway no longer writes DynamoDB directly"
  - "crdt-snapshot Lambda follows identical dual-mode pattern as activity-log (SQS batch + direct invoke)"
  - "Snapshot data arrives gzip-compressed from gateway; Lambda stores it as-is (Binary DynamoDB type)"
  - "retrieveLatestSnapshot reads directly from DynamoDB — unchanged, no EventBridge involvement in reads"

patterns-established:
  - "EventBridge decoupling pattern: gateway publishes event, Lambda consumer persists — identical to social event pipeline"
  - "Log-and-continue in both gateway (EventBridge publish) and Lambda (per-record try/catch) for resilient operation"

requirements-completed: [CRDT-01]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 38 Plan 01: CRDT Durability — EventBridge Pipeline Summary

**CRDT snapshot persistence decoupled from gateway: writeSnapshot publishes crdt.checkpoint to EventBridge; crdt-snapshot Lambda consumer writes gzip-compressed snapshots to crdt-snapshots DynamoDB table**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T20:16:34Z
- **Completed:** 2026-03-18T20:18:46Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `lambdas/crdt-snapshot/handler.ts` — TypeScript Lambda with SQS+EventBridge dual-mode dispatch, per-record error isolation, writes gzip snapshots to DynamoDB
- Modified `src/services/crdt-service.js` writeSnapshot to publish `crdt.checkpoint` events to EventBridge (source: `crdt-service`) instead of direct DynamoDB PutItemCommand
- Extended `scripts/localstack/init/ready.d/bootstrap.sh` with crdt-snapshots DynamoDB table, SQS queue + DLQ, EventBridge routing rule, CloudWatch alarm, Lambda stub deployment, and event-source-mapping

## Task Commits

Each task was committed atomically:

1. **Task 1: Create crdt-snapshot Lambda consumer and bootstrap infrastructure** - `297afb0` (feat)
2. **Task 2: Replace DynamoDB write in crdt-service.js with EventBridge publish** - `7234b86` (feat)

## Files Created/Modified

- `lambdas/crdt-snapshot/handler.ts` — SQS/EventBridge dual-mode Lambda; extracts channelId + base64 snapshotData from EventBridge detail; writes compressed snapshot to crdt-snapshots DynamoDB table
- `lambdas/crdt-snapshot/package.json` — Dependencies: @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb; devDependencies: typescript, @types/node
- `lambdas/crdt-snapshot/tsconfig.json` — CommonJS ES2022 target, includes handler.ts
- `src/services/crdt-service.js` — Added EventBridgeClient + PutEventsCommand require; constructor initializes eventBridgeClient (LocalStack-aware) and eventBusName; writeSnapshot replaced with EventBridge publish
- `scripts/localstack/init/ready.d/bootstrap.sh` — Added crdt-snapshots DynamoDB table, SQS queue + DLQ, redrive policy, crdt-checkpoint-events EventBridge rule, CloudWatch alarm, crdt-snapshot Lambda stub deployment, event-source-mapping

## Decisions Made

- CRDT checkpoint writes now route through EventBridge pipeline (crdt.checkpoint detail-type) — matches the social event architecture and decouples snapshot persistence from the real-time gateway process.
- `retrieveLatestSnapshot()` left unchanged — direct DynamoDB reads remain synchronous (no EventBridge involvement in reads path).
- Snapshot data is gzip-compressed by the gateway before publishing as base64; the Lambda stores the compressed bytes directly as a Binary DynamoDB attribute.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. LocalStack bootstrap provisions all resources automatically on `docker compose up`.

## Next Phase Readiness

- CRDT durability pipeline is complete: gateway publishes, Lambda consumes, DynamoDB persists
- crdt-snapshots table is available for snapshot reads (retrieveLatestSnapshot already queries it)
- Bootstrap is self-contained — `docker compose up` provisions all crdt-snapshot infrastructure

---
*Phase: 38-crdt-durability*
*Completed: 2026-03-18*
