---
phase: 34
plan: 01
subsystem: localstack-dev-environment
tags: [localstack, docker-compose, aws-sdk, dynamodb, eventbridge, sqs, infrastructure]
one_liner: "LocalStack Docker Compose environment with idempotent bootstrap for 10 DynamoDB tables + EventBridge bus + 4 SQS queues, plus shared AWS SDK v3 client factory with LOCALSTACK_ENDPOINT override for all social-api routes"
dependency_graph:
  requires: []
  provides: [localstack-docker-compose, bootstrap-script, shared-aws-clients, social-api-dockerfile]
  affects: [social-api/src/routes, docker-compose.localstack.yml]
tech_stack:
  added:
    - localstack/localstack:stable (Docker image)
    - "@aws-sdk/client-eventbridge@^3.x"
    - "@aws-sdk/client-sqs@^3.x"
  patterns:
    - LocalStack init hook (ready.d bootstrap shell script)
    - AWS SDK v3 endpoint override via LOCALSTACK_ENDPOINT env var
    - Shared client factory module (social-api/src/lib/aws-clients.ts)
    - Docker Compose service_healthy depends_on condition
key_files:
  created:
    - docker-compose.localstack.yml
    - scripts/localstack/init/ready.d/bootstrap.sh
    - config/localstack.env
    - social-api/Dockerfile
    - social-api/src/lib/aws-clients.ts
  modified:
    - Makefile (added dev-localstack, dev-localstack-stop, dev-localstack-logs targets)
    - social-api/src/routes/profiles.ts
    - social-api/src/routes/social.ts
    - social-api/src/routes/groups.ts
    - social-api/src/routes/group-members.ts
    - social-api/src/routes/rooms.ts
    - social-api/src/routes/group-rooms.ts
    - social-api/src/routes/room-members.ts
    - social-api/src/routes/posts.ts
    - social-api/src/routes/comments.ts
    - social-api/src/routes/likes.ts
    - social-api/src/routes/reactions.ts
    - social-api/package.json
decisions:
  - "All 9 existing social DynamoDB tables included in bootstrap script so docker compose up is fully self-contained for v3.0 development (addresses Pitfall 3 from research)"
  - "Network named localstack-net (not localstack-network) to match LAMBDA_DOCKER_NETWORK env var in compose file"
  - "LAMBDA_DOCKER_FLAGS omitted from base compose to avoid --inspect-brk blocking all invocations (debug overlay can be added separately)"
metrics:
  duration: 158s
  completed: "2026-03-18"
  tasks: 2
  files_created: 5
  files_modified: 13
---

# Phase 34 Plan 01: LocalStack Dev Environment Summary

LocalStack Docker Compose environment with idempotent bootstrap for 10 DynamoDB tables + EventBridge bus + 4 SQS queues, plus shared AWS SDK v3 client factory with LOCALSTACK_ENDPOINT override for all social-api routes.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Docker Compose + Bootstrap + Env Config | 541120a | docker-compose.localstack.yml, bootstrap.sh, config/localstack.env, social-api/Dockerfile, Makefile |
| 2 | Shared AWS SDK Client Factory with LocalStack Override | 49a9dcb | social-api/src/lib/aws-clients.ts, all 11 route files, package.json |

## What Was Built

**Task 1: Infrastructure layer**

- `docker-compose.localstack.yml` — 4-service compose file: localstack (with health check), redis:7-alpine, websocket-gateway (depends_on localstack service_healthy), social-api (depends_on localstack service_healthy). Network `localstack-net` with `LAMBDA_DOCKER_NETWORK=localstack-net` so Lambda containers reach LocalStack.
- `scripts/localstack/init/ready.d/bootstrap.sh` — executable shell script mounted into LocalStack's `/etc/localstack/init` directory. Provisions: 1 EventBridge custom bus (`social-events`), 4 SQS queues (`social-follows`, `social-rooms`, `social-posts`, `social-reactions`), 9 existing social DynamoDB tables, 1 new v3.0 table (`user-activity`). All create commands use `|| true` for idempotency.
- `config/localstack.env` — environment variable file with `LOCALSTACK_ENDPOINT`, test AWS credentials, region, and Cognito values.
- `social-api/Dockerfile` — `node:20-alpine` image running `npm ci`, `npx tsc`, then `node dist/index.js`.
- `Makefile` — 3 new targets: `dev-localstack`, `dev-localstack-stop`, `dev-localstack-logs`.

**Task 2: Shared AWS SDK client factory**

- `social-api/src/lib/aws-clients.ts` — exports `ddbClient`, `docClient`, `eventBridgeClient`, `sqsClient`. When `LOCALSTACK_ENDPOINT` env var is set, all clients use it as the endpoint with static test credentials. When unset, clients use standard AWS configuration.
- All 11 route files migrated: removed per-file `DynamoDBClient` instantiation, imported `docClient` from `../lib/aws-clients`. All command imports (`GetCommand`, `PutCommand`, etc.) preserved as-is.
- `@aws-sdk/client-eventbridge` and `@aws-sdk/client-sqs` added to `social-api/package.json`.

## Verification Results

1. `docker compose -f docker-compose.localstack.yml config` — PASS (compose valid)
2. `scripts/localstack/init/ready.d/bootstrap.sh` is executable — PASS
3. Bootstrap contains exactly 10 `create-table` commands — PASS
4. `cd social-api && npx tsc --noEmit` — PASS (no TypeScript errors)
5. `grep -r "new DynamoDBClient" social-api/src/routes/` — PASS (no matches)
6. `grep -r "from '../lib/aws-clients'" social-api/src/routes/ | wc -l` — PASS (11 matches)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

**Files exist:**
- docker-compose.localstack.yml: FOUND
- scripts/localstack/init/ready.d/bootstrap.sh: FOUND
- config/localstack.env: FOUND
- social-api/Dockerfile: FOUND
- social-api/src/lib/aws-clients.ts: FOUND

**Commits exist:**
- 541120a: FOUND
- 49a9dcb: FOUND

## Self-Check: PASSED
