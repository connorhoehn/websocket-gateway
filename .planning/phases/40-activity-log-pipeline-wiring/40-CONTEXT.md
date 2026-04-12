# Phase 40: Activity Log Full Pipeline Wiring - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add three missing event-source-mappings in `bootstrap.sh` so that activity-log Lambda receives events from `social-rooms`, `social-posts`, and `social-reactions` SQS queues — not just `social-follows`. This is a single-file, surgical addition that completes ALOG-01.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure gap-closure phase.

Specific fix required:
- **MISS-3**: `bootstrap.sh` currently creates an event-source-mapping only for `social-follows → activity-log`. Add 3 more: `social-rooms → activity-log`, `social-posts → activity-log`, `social-reactions → activity-log`. Same batch-size, same function-name as the existing mapping.

</decisions>

<code_context>
## Existing Code Insights

### Files to Modify
- `lambdas/localstack/bootstrap.sh` — find the existing `social-follows` event-source-mapping block and replicate it for the 3 missing queues

### Established Patterns
- Existing ESM uses: `aws sqs get-queue-attributes` to get queue ARN, then `aws lambda create-event-source-mapping --function-name activity-log --batch-size 1 --event-source-arn <arn>`
- All ESM creation calls use the same pattern with `--endpoint-url $LOCALSTACK_URL`

### Integration Points
- activity-log Lambda handler already handles all event types (follow, room, post, reaction) — the Lambda side is complete; only the SQS trigger wiring is missing

</code_context>

<specifics>
## Specific Ideas

No specific requirements — single pattern replication for 3 additional queues.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
