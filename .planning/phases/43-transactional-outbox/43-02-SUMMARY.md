---
phase: 43-transactional-outbox
plan: "02"
subsystem: event-pipeline
tags: [outbox-relay, lambda, sqs, dynamodb, transactional-outbox]
dependency_graph:
  requires: [43-01]
  provides: [outbox-relay-lambda, bootstrap-stub]
  affects: [activity-log-lambda, social-outbox-table]
tech_stack:
  added: ["@aws-sdk/client-sqs@^3.1011.0"]
  patterns: [per-record-error-isolation, mark-after-publish, poll-relay]
key_files:
  created:
    - lambdas/outbox-relay/handler.ts
    - lambdas/outbox-relay/package.json
    - lambdas/outbox-relay/tsconfig.json
    - lambdas/outbox-relay/package-lock.json
  modified:
    - scripts/localstack/init/ready.d/bootstrap.sh
decisions:
  - "outbox-relay polls social-outbox GSI (status-index) directly; no SQS trigger or event-source-mapping needed"
  - "UpdateCommand marks PROCESSED only after successful SQS publish — never before — preserving at-least-once delivery guarantee"
  - "60s timeout (not 30s) because relay processes up to 100 records per invocation with sequential SQS publishes"
  - "Queue URLs use container-internal localstack.cloud format so Lambda container can reach LocalStack"
metrics:
  duration_seconds: 113
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 4
  files_modified: 1
---

# Phase 43 Plan 02: Outbox Relay Lambda Summary

**One-liner:** outbox-relay Lambda polls social-outbox GSI for UNPROCESSED records, publishes EventBridge-shaped SQS messages, marks PROCESSED after each successful publish with per-record error isolation.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create outbox-relay Lambda handler, package.json, tsconfig.json | 8b7f951 | lambdas/outbox-relay/handler.ts, package.json, tsconfig.json, package-lock.json |
| 2 | Deploy outbox-relay Lambda stub in bootstrap.sh | a9163cc | scripts/localstack/init/ready.d/bootstrap.sh |

## What Was Built

**lambdas/outbox-relay/handler.ts** — The relay Lambda that completes the durable event delivery pipeline:
- `QueryCommand` on `status-index` GSI with `KeyConditionExpression: '#s = :u'` and `':u': 'UNPROCESSED'`, `Limit: 100`
- Per-record loop: for each item, resolve `queueUrl` from `QUEUE_URLS[queueName]`, send `SendMessageCommand` with body `{source, 'detail-type', detail, time}` matching the `EventBridgeEvent` shape consumed by `activity-log` Lambda
- `UpdateCommand` sets `status=PROCESSED` and `processedAt` only after successful SQS publish
- Per-record `try/catch` ensures one failure does not abort remaining records in batch
- Records with unknown `queueName` are logged and skipped (not retried)

**bootstrap.sh** — Stub Lambda deployed after crdt-snapshot section with:
- `--timeout 60` (not 30) for batch processing headroom
- All four SQS queue URL env vars in container-internal `localstack.cloud` format
- No event-source-mapping (relay is invoked manually via `invoke-lambda.sh`)

## Decisions Made

1. **Mark after publish, not before** — `UpdateCommand` runs only after `SendMessageCommand` succeeds. If the Lambda crashes between SQS publish and DynamoDB update, the record stays UNPROCESSED and is retried on the next invocation. This is the correct at-least-once delivery guarantee for an outbox relay.

2. **No event-source-mapping** — The relay polls the DynamoDB outbox table directly via `QueryCommand`. It is invoked manually or on a schedule. This avoids a circular dependency (relay triggered by SQS but also writing to SQS).

3. **60s Lambda timeout** — With up to 100 records per invocation and each record requiring two sequential AWS SDK calls (SQS + DynamoDB update), 30s could be tight. 60s provides adequate headroom.

4. **Container-internal queue URLs** — `http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/` works from within the Lambda Docker container. `http://localhost:4566` only works from the host machine.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- lambdas/outbox-relay/handler.ts: FOUND
- lambdas/outbox-relay/package.json: FOUND
- lambdas/outbox-relay/tsconfig.json: FOUND
- Commit 8b7f951: FOUND
- Commit a9163cc: FOUND
