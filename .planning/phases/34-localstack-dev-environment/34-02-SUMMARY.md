---
phase: 34-localstack-dev-environment
plan: 02
subsystem: infra
tags: [localstack, lambda, dynamodb, aws-sdk-v3, docker-compose, vscode, debugging]

# Dependency graph
requires:
  - phase: 34-01
    provides: docker-compose.localstack.yml base compose file with localstack-net network
provides:
  - lambdas/activity-log/handler.ts — placeholder EventBridge consumer writing to DynamoDB user-activity table
  - scripts/invoke-lambda.sh — build + zip + awslocal deploy + invoke workflow
  - docker-compose.debug.yml — compose override that enables --inspect-brk debugging on port 9229
  - .vscode/launch.json — VS Code attach config for Lambda breakpoint debugging
affects: [35-event-bus, 37-activity-log]

# Tech tracking
tech-stack:
  added:
    - "@aws-sdk/client-dynamodb ^3.1010.0 (Lambda handler dependency)"
    - "@aws-sdk/lib-dynamodb ^3.1010.0 (DynamoDB DocumentClient for Lambda)"
    - "typescript ~5.6.3 (Lambda build toolchain)"
  patterns:
    - "Standalone LocalStack endpoint override: LOCALSTACK_ENDPOINT || AWS_ENDPOINT_URL in Lambda handler (separate from shared aws-clients.ts — Lambda runs in its own container)"
    - "Lambda debug overlay via compose override: base compose has no debug flags; docker-compose.debug.yml adds LAMBDA_DOCKER_FLAGS=--inspect-brk only when needed"

key-files:
  created:
    - lambdas/activity-log/handler.ts
    - lambdas/activity-log/package.json
    - lambdas/activity-log/tsconfig.json
    - scripts/invoke-lambda.sh
    - docker-compose.debug.yml
    - .vscode/launch.json
  modified:
    - Makefile
    - .gitignore

key-decisions:
  - "Lambda handler uses standalone DynamoDB client (not shared aws-clients.ts) — Lambda runs in its own container with isolated env vars"
  - "LOCALSTACK_ENDPOINT || AWS_ENDPOINT_URL both checked to support both LocalStack env var naming conventions"
  - "Changed .gitignore from .vscode/ to .vscode/* + !.vscode/launch.json so shared debug config is tracked while personal IDE settings remain ignored"
  - "invoke-lambda.sh packages dist + node_modules into zip (not hot-reload) for correctness on first invocation"

patterns-established:
  - "Lambda build pattern: npm install + tsc → zip dist/ + node_modules/ → awslocal deploy/update"
  - "Debug separation pattern: normal compose stack never sets --inspect-brk; separate docker-compose.debug.yml overlay enables it on demand"

requirements-completed: [LDEV-03]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 34 Plan 02: Lambda Invocation Tooling + Debug Config Summary

**Activity-log Lambda handler with DynamoDB write, awslocal invoke script, debug compose override adding --inspect-brk on port 9229, and VS Code attach config**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-18T12:51:20Z
- **Completed:** 2026-03-18T12:52:22Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Activity-log Lambda handler that reads EventBridge events and writes to DynamoDB user-activity table via DocumentClient PutCommand
- Invoke script that builds TypeScript, packages dist + node_modules into zip, deploys or updates via awslocal, and invokes with configurable payload
- Debug compose override (separate from base) that injects `--inspect-brk=0.0.0.0:9229` into Lambda containers only when explicitly requested
- VS Code launch config for one-click debugger attach to LocalStack Lambda on port 9229

## Task Commits

Each task was committed atomically:

1. **Task 1: Placeholder Lambda Handler + Invoke Script** - `6c464d4` (feat)
2. **Task 2: Debug Compose Override + VS Code Launch Config** - `b630115` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `lambdas/activity-log/handler.ts` - EventBridge consumer: extracts userId/detail-type, writes to user-activity DynamoDB table
- `lambdas/activity-log/package.json` - Standalone Lambda package with @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb
- `lambdas/activity-log/tsconfig.json` - CommonJS + ES2022 target, outDir dist
- `scripts/invoke-lambda.sh` - Build, package, awslocal deploy/update, invoke with raw-in-base64-out
- `docker-compose.debug.yml` - Compose override: LAMBDA_DOCKER_FLAGS with --inspect-brk + port 9229 mapping
- `.vscode/launch.json` - VS Code Node attach config: port 9229, remoteRoot /var/task/, localRoot lambdas/
- `Makefile` - Added invoke-lambda and dev-localstack-debug targets
- `.gitignore` - Changed .vscode/ to .vscode/* + !.vscode/launch.json exception

## Decisions Made

- Lambda handler creates its own DynamoDB client rather than importing from social-api/src/lib/aws-clients.ts — Lambda runs in a container with separate process and env vars
- Both `LOCALSTACK_ENDPOINT` and `AWS_ENDPOINT_URL` are checked so the handler works with either LocalStack naming convention
- Debug overlay kept completely separate from base compose so `make dev-localstack` never accidentally blocks on --inspect-brk

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added .gitignore exception for .vscode/launch.json**
- **Found during:** Task 2 (Debug Compose Override + VS Code Launch Config)
- **Issue:** `.vscode/` was in .gitignore as a directory glob, preventing git from tracking launch.json as a committed project artifact
- **Fix:** Changed `.vscode/` to `.vscode/*` + added `!.vscode/launch.json` exception — preserves personal settings ignore while allowing shared debug config to be tracked
- **Files modified:** .gitignore
- **Verification:** git add .vscode/launch.json succeeded after fix; file committed in b630115
- **Committed in:** b630115 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required to fulfill plan requirement that launch.json be a committed artifact. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 34 (LocalStack Dev Environment) is complete: compose stack, bootstrap script, SDK clients, Lambda handler, invoke script, and debug tooling all in place
- Phase 35 (Event Bus) can begin: EventBridge bus and SQS queues are bootstrapped by 34-01 bootstrap.sh
- Phase 37 (Activity Log) has its handler skeleton ready in lambdas/activity-log/handler.ts
- Prerequisite: developer must install `pip install awscli-local` to use awslocal CLI (invoke-lambda.sh and bootstrap.sh depend on it)

---
*Phase: 34-localstack-dev-environment*
*Completed: 2026-03-18*
