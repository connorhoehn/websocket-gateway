---
status: complete
phase: 40-activity-log-pipeline-wiring
source: [34-01-SUMMARY.md, 34-02-SUMMARY.md, 35-01-SUMMARY.md, 35-02-SUMMARY.md, 36-01-SUMMARY.md, 36-02-SUMMARY.md, 37-01-SUMMARY.md, 37-02-SUMMARY.md, 38-01-SUMMARY.md, 38-02-SUMMARY.md, 38-03-SUMMARY.md, 39-01-SUMMARY.md, 40-01-SUMMARY.md]
mode: autonomous-code-review
focus: log-visibility, error-handling
started: 2026-03-19T17:41:00.000Z
updated: 2026-03-19T17:41:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. EventBridge publish failures are observable
expected: When PutEventsCommand returns FailedEntryCount > 0 (EventBridge-level rejection, no SDK exception), the failure is logged with enough detail to diagnose (event type, error code, error message)
result: issue
reported: "publishSocialEvent (aws-clients.ts:27-47) and crdt-service.js writeSnapshot (line 385) both call PutEventsCommand without checking response.FailedEntryCount. The SDK does NOT throw on partial failure — FailedEntryCount>0 silently drops the event. Zero visibility."
severity: major

### 2. Lambda logs are filterable in CloudWatch
expected: All Lambda log lines include a consistent service prefix (e.g. [activity-log]) so you can filter by function in CloudWatch Logs Insights with `filter @message like '[activity-log]'`
result: issue
reported: "activity-log handler.ts lines 52, 64, 70 use bare console.log without [activity-log] prefix. The crdt-snapshot Lambda is consistent with its prefix on all lines. activity-log is inconsistent — success logs have no prefix, error logs do."
severity: minor

### 3. Invalid pagination cursor returns 400 not 500
expected: GET /api/activity?lastKey=GARBAGE returns HTTP 400 with a clear error, not a 500 Internal Server Error
result: issue
reported: "activity.ts:16-17: JSON.parse(Buffer.from(lastKey, 'base64').toString()) on a malformed cursor throws SyntaxError which falls into the outer catch and returns 500. Should be caught separately and return 400 'Invalid lastKey'."
severity: minor

### 4. CRDT snapshot write is observable end-to-end
expected: From gateway log to Lambda log: can trace (a) gateway publishes checkpoint to EventBridge, (b) Lambda receives it via SQS, (c) Lambda writes to DynamoDB — all with consistent channel identifiers
result: pass
notes: "crdt-service.js logs info on publish + error on failure. crdt-snapshot Lambda logs [crdt-snapshot] prefix on all paths. channelId flows through all three steps. Readable."

### 5. SQS batch errors don't fail entire batch
expected: If one SQS record fails to parse or DynamoDB write fails, that record is logged and skipped; the rest of the batch succeeds (no full batch re-delivery)
result: pass
notes: "Both activity-log and crdt-snapshot Lambdas wrap each record in try/catch, log the error with record.messageId, and continue. The outer handler always returns { statusCode: 200 } — SQS treats the batch as success."

### 6. BroadcastService Redis failure is non-fatal and logged
expected: If Redis is down, social API calls still return their HTTP response; the broadcast failure is logged as a warning, not an error
result: pass
notes: "broadcast.ts correctly uses console.warn for all Redis failure paths. emit() catches all errors and warns. HTTP response is sent before broadcast (void fire-and-forget)."

### 7. EventBridge publish is fire-and-forget (non-fatal)
expected: A failure in publishSocialEvent never causes the HTTP endpoint to return 5xx; the social write response is already sent before publish is called
result: pass
notes: "All publishing routes follow: DynamoDB write → res.status(201).json() → void publishSocialEvent(). The void + internal try/catch in publishSocialEvent guarantees non-fatal. Pattern is consistent across posts.ts, social.ts, room-members.ts, reactions.ts."

### 8. Gateway handles missing EVENT_BUS_NAME gracefully
expected: If EVENT_BUS_NAME env var is missing, the gateway falls back to 'social-events' (documented default) rather than crashing
result: pass
notes: "crdt-service.js:39 — this.eventBusName = process.env.EVENT_BUS_NAME || 'social-events'. Also confirmed: docker-compose adds EVENT_BUS_NAME=social-events explicitly per Phase 39 fix."

## Summary

total: 8
passed: 5
issues: 3
pending: 0
skipped: 0

## Gaps

- truth: "EventBridge publish failures (FailedEntryCount > 0) are visible in logs"
  status: failed
  reason: "User reported: publishSocialEvent and crdt-service.js writeSnapshot do not check PutEventsCommand response.FailedEntryCount. SDK does not throw on partial failure — events silently dropped."
  severity: major
  test: 1
  root_cause: "PutEventsCommand returns {FailedEntryCount, Entries[{ErrorCode, ErrorMessage}]} but callers ignore the return value. Need: if (response.FailedEntryCount > 0) log each failed entry's ErrorCode and ErrorMessage."
  artifacts:
    - path: "social-api/src/lib/aws-clients.ts"
      issue: "publishSocialEvent ignores PutEventsCommand response"
    - path: "src/services/crdt-service.js"
      issue: "writeSnapshot ignores PutEventsCommand response"
  missing:
    - "Check response.FailedEntryCount after PutEventsCommand and log failed entries"

- truth: "All activity-log Lambda log lines include [activity-log] prefix for CloudWatch filtering"
  status: failed
  reason: "User reported: lambdas/activity-log/handler.ts lines 52, 64, 70 use bare console.log without prefix. Error logs on line 76 do have the prefix. Inconsistent."
  severity: minor
  test: 2
  root_cause: "Missing prefix in three console.log calls in handler.ts. processEventBridgeEvent logs are un-prefixed; only the SQS error path has [activity-log]."
  artifacts:
    - path: "lambdas/activity-log/handler.ts"
      issue: "Lines 52, 64, 70: console.log without [activity-log] prefix"
  missing:
    - "Add [activity-log] prefix to all console.log calls in handler.ts"

- truth: "GET /api/activity with malformed lastKey returns 400, not 500"
  status: failed
  reason: "User reported: activity.ts:16-17 parses lastKey inside outer try/catch — malformed JSON throws SyntaxError caught as generic 500."
  severity: minor
  test: 3
  root_cause: "lastKey parsing is not wrapped in its own try/catch to distinguish client error from server error."
  artifacts:
    - path: "social-api/src/routes/activity.ts"
      issue: "Line 16-17: no separate catch for JSON.parse failure on lastKey"
  missing:
    - "Wrap lastKey JSON.parse in try/catch, return res.status(400).json({ error: 'Invalid lastKey' }) on parse failure"
