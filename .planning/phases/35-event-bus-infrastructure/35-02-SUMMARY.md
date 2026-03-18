---
phase: 35-event-bus-infrastructure
plan: 02
subsystem: infra
tags: [lambda, sqs, eventbridge, dynamodb, localstack, dlq, event-source-mapping]

# Dependency graph
requires:
  - phase: 35-01
    provides: SQS queues with DLQ redrive policies and EventBridge routing rules
  - phase: 34-02
    provides: activity-log Lambda handler base + invoke-lambda.sh deploy pattern
provides:
  - activity-log Lambda with SQS batch event unwrapping (dual-mode: SQS trigger + direct invoke)
  - bootstrap.sh deploys Lambda stub and creates SQS->Lambda event-source-mapping on startup
  - test-dlq-retry.sh verifies retry exhaustion and DLQ payload preservation end-to-end
affects: [35-event-bus-infrastructure, 36-social-event-publishing, 37-activity-log]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SQS->Lambda event-source-mapping wired in LocalStack bootstrap for self-contained dev environment
    - Dual-mode Lambda handler dispatches on Records array presence (SQS vs direct invoke)
    - Lambda stub deployed at bootstrap time; real TypeScript handler deployed via invoke-lambda.sh
    - DLQ verification script pattern: deploy failing Lambda, publish event, poll DLQ, verify payload, restore stub

key-files:
  created:
    - scripts/test-dlq-retry.sh
  modified:
    - lambdas/activity-log/handler.ts
    - scripts/localstack/init/ready.d/bootstrap.sh

key-decisions:
  - "Dual-mode handler dispatches on isSQSEvent(event) check — backwards compatible with direct invoke for testing"
  - "batch-size=1 on event-source-mapping for local dev simplicity; CDK stack can use batch-size=10 for production"
  - "Bootstrap deploys a JS stub Lambda (not the full TypeScript build) — avoids npm install / tsc complexity in container init"

patterns-established:
  - "Dual-mode Lambda pattern: isSQSEvent guard routes between SQS batch handling and direct EventBridge invoke"
  - "DLQ test pattern: deploy failing stub -> publish event -> poll DLQ attributes -> verify payload -> restore stub"

requirements-completed: [EBUS-03]

# Metrics
duration: 1min
completed: 2026-03-18
---

# Phase 35 Plan 02: Lambda SQS Consumer + DLQ Retry Verification Summary

**activity-log Lambda wired as SQS consumer via event-source-mapping with dual-mode handler and end-to-end DLQ retry verification script**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-18T13:56:37Z
- **Completed:** 2026-03-18T13:57:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Refactored activity-log handler.ts to accept both SQS batch events (Records[].body) and raw EventBridge events (direct invoke) — zero breaking change
- Extended bootstrap.sh to deploy a stub Lambda and create SQS->Lambda event-source-mapping on social-follows queue at container startup
- Created test-dlq-retry.sh that deploys a deliberately failing Lambda, publishes an event, polls the DLQ for 60 seconds, verifies payload preservation, and restores the working stub

## Task Commits

Each task was committed atomically:

1. **Task 1: Update handler.ts for SQS event format + add event-source-mapping to bootstrap.sh** - `d51377c` (feat)
2. **Task 2: Create test-dlq-retry.sh verification script** - `0200a15` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified

- `lambdas/activity-log/handler.ts` - Added SQSRecord/SQSEvent interfaces, isSQSEvent guard, processEventBridgeEvent helper; handler now dispatches between SQS batch and direct invoke
- `scripts/localstack/init/ready.d/bootstrap.sh` - Added Lambda stub deployment and SQS->Lambda event-source-mapping creation at end of bootstrap
- `scripts/test-dlq-retry.sh` - New executable script verifying retry exhaustion and DLQ payload preservation

## Decisions Made

- Dual-mode handler dispatches on isSQSEvent(event): when Records array is present, iterates records and JSON.parses each body as an EventBridge event; otherwise falls through to direct processEventBridgeEvent call — backwards compatible with existing invoke-lambda.sh testing workflow.
- batch-size=1 chosen for event-source-mapping in LocalStack dev environment. Simpler to debug one event at a time; CDK EventBusStack can configure batch-size=10 for production.
- Bootstrap deploys a minimal JS stub (not the TypeScript build) — avoids requiring npm install + tsc during container init. The real handler is deployed via invoke-lambda.sh during development.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. All changes are applied automatically when `docker compose up` runs.

## Next Phase Readiness

- Durable event pipeline complete: EventBridge -> SQS -> Lambda with DLQ fallback is fully wired in LocalStack
- Phase 36 (social-event-publishing) can now publish events and verify they land in the activity-log Lambda via SQS
- test-dlq-retry.sh provides a ready-made verification harness for any future DLQ behavior testing

---
*Phase: 35-event-bus-infrastructure*
*Completed: 2026-03-18*
