# Phase 34: LocalStack Dev Environment - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Every v3.0 AWS service (EventBridge, SQS, Lambda, DynamoDB) runs locally in Docker via LocalStack so development and debugging require no AWS account access. Redis runs as a standard ECS container. This phase delivers the foundational local dev environment that all downstream phases (35-38) depend on.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Key constraints from RESEARCH.md apply: LocalStack `stable` tag, init hook bootstrap pattern, separate debug compose override for `LAMBDA_DOCKER_FLAGS`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing docker-compose.yml (base) — LocalStack compose extends this
- social-api route files (11 total) — migrated to shared aws-clients.ts factory
- Lambda handler entrypoint pattern from lambdas/ directory

### Established Patterns
- Docker Compose service networking
- Environment variable configuration via .env files
- Makefile targets for dev workflows

### Integration Points
- social-api/src/lib/ — new aws-clients.ts factory
- scripts/localstack/ — bootstrap and init hooks
- .vscode/ — debug launch config

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. All specifics captured in RESEARCH.md.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
