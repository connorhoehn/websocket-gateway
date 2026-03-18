# Phase 35: Event Bus Infrastructure - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

An EventBridge custom bus routes social events by category to typed SQS queues, each backed by a DLQ with a CloudWatch alarm. Failed Lambda invocations retry via SQS visibility timeout before landing in the DLQ with full payload preserved. This phase wires up the durable event routing layer that all social event publishers (Phase 36) and consumers (Phase 37) depend on.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Key constraints from Phase 34: LocalStack environment is already provisioned with `social-events` EventBridge bus and 4 SQS queues via bootstrap.sh; Phase 35 must extend or align with those queue names and add DLQ + CloudWatch alarm configuration.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/localstack/init/ready.d/bootstrap.sh` — existing SQS queue provisioning (4 queues); Phase 35 should add DLQ sibling queues
- `social-api/src/lib/aws-clients.ts` — shared EventBridge + SQS clients with LocalStack endpoint override
- `docker-compose.localstack.yml` — LocalStack service already running with all AWS services

### Established Patterns
- Bootstrap scripts use `awslocal` CLI with `|| true` idempotency
- LocalStack single-endpoint (4566) for all services
- TypeScript CDK or plain AWS SDK for infrastructure definition

### Integration Points
- EventBridge bus `social-events` (created in Phase 34 bootstrap)
- SQS queues referenced by Phase 36 (publishers) and Phase 37 (consumers)
- Lambda error handling connects to DLQ retry logic

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Event routing rules, queue names, and DLQ configuration at Claude's discretion aligned with Phase 34 bootstrap naming conventions.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
