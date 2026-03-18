---
phase: 35-event-bus-infrastructure
plan: 01
subsystem: infra
tags: [eventbridge, sqs, dlq, cloudwatch, localstack, cdk, aws]

# Dependency graph
requires:
  - phase: 34-localstack-dev-environment
    provides: LocalStack docker compose with EventBridge bus and SQS queues already created

provides:
  - EventBridge routing rules that direct social events by detail-type prefix to typed SQS queues
  - DLQ sibling queues for all 4 main queues with redrive policies (maxReceiveCount=3)
  - VisibilityTimeout=60s set on all main queues for LocalStack/production parity
  - CloudWatch alarms on all 4 DLQs (fires when ApproximateNumberOfMessagesVisible > 0)
  - CDK EventBusStack for production deployment mirroring local bootstrap
  - End-to-end routing verification script (test-event-routing.sh)

affects:
  - 36-event-publishers
  - 37-follow-consumer
  - 38-activity-consumer

# Tech tracking
tech-stack:
  added: [aws-cdk-lib/aws-events, aws-cdk-lib/aws-events-targets, aws-cdk-lib/aws-cloudwatch]
  patterns:
    - EventBridge prefix-based routing to typed SQS queues
    - DLQ redrive policy with maxReceiveCount=3 and 14-day retention
    - LocalStack/CDK parity via matching VisibilityTimeout=60s

key-files:
  created:
    - lib/event-bus-stack.ts
    - scripts/test-event-routing.sh
  modified:
    - scripts/localstack/init/ready.d/bootstrap.sh

key-decisions:
  - "VisibilityTimeout=60s set in both bootstrap.sh and CDK EventBusStack for LocalStack/production parity — avoids divergent retry behavior (LocalStack default is 30s)"
  - "EventBridge prefix matching used (detail-type prefix) so social.follow, social.follow.created, etc. all route to social-follows queue without enumerating every event type"
  - "post-events rule handles both social.post.* and social.comment.* prefixes routing to social-posts queue — comments are logically post content"
  - "reaction-events rule handles both social.reaction.* and social.like.* prefixes routing to social-reactions queue"

patterns-established:
  - "Bootstrap-CDK parity: all LocalStack queue/bus attributes must match CDK stack values exactly"
  - "DLQ pattern: every SQS queue gets a -dlq sibling with redrive policy maxReceiveCount=3 and 14-day retention"
  - "CloudWatch alarm per DLQ: threshold=0, GreaterThanThreshold, evaluation-periods=1, treat-missing=notBreaching/IGNORE"

requirements-completed: [EBUS-01, EBUS-02]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 35 Plan 01: Event Bus Infrastructure Summary

**EventBridge routing rules, DLQ sibling queues, CloudWatch alarms, CDK EventBusStack, and end-to-end routing test script — all social events now route by detail-type prefix to typed SQS queues with full DLQ protection**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-18T13:52:35Z
- **Completed:** 2026-03-18T13:54:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended bootstrap.sh with 4 DLQ queues, set-queue-attributes for VisibilityTimeout=60s + RedrivePolicy, 4 EventBridge routing rules with SQS targets, and 4 CloudWatch DLQ depth alarms
- Created CDK EventBusStack mirroring bootstrap configuration for production deployment (EventBus, typed Queues, DLQs, Rules, Alarms, CfnOutputs)
- Created executable test-event-routing.sh that verifies all 6 event type routes (follow, room.join, post.created, reaction, comment.created, like) against LocalStack

## Task Commits

Each task was committed atomically:

1. **Task 1: Update bootstrap.sh — DLQs, redrive policies, VisibilityTimeout, EventBridge rules, CloudWatch alarms** - `6642b43` (feat)
2. **Task 2: CDK EventBusStack + test-event-routing.sh** - `f080ab5` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `scripts/localstack/init/ready.d/bootstrap.sh` - Added 4 DLQ creates, set-queue-attributes for all 4 main queues (VisibilityTimeout=60s + RedrivePolicy), 4 EventBridge rules with SQS targets, 4 CloudWatch alarms
- `lib/event-bus-stack.ts` - New CDK stack: EventBus, 4 typed SQS queues + DLQ siblings, routing Rules with prefix patterns, CloudWatch Alarms, CfnOutputs
- `scripts/test-event-routing.sh` - End-to-end routing verification script; tests 6 event routes against LocalStack

## Decisions Made
- VisibilityTimeout=60s in both bootstrap.sh and CDK so LocalStack and production retry behavior matches
- EventBridge prefix matching routes all variants of a social event type to one queue (e.g., social.post.created, social.post.deleted both go to social-posts)
- social.comment.* events route to social-posts (logically post content), social.like.* route to social-reactions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 36 (event publishers) can now publish to social-events EventBridge bus knowing events will route correctly to typed queues
- Phase 37/38 (consumers) can subscribe to social-follows, social-posts, social-rooms, social-reactions queues
- test-event-routing.sh can be run anytime against a live LocalStack instance to verify routing

---
*Phase: 35-event-bus-infrastructure*
*Completed: 2026-03-18*
