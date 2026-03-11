---
status: testing
phase: 03-monitoring-observability
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md]
started: 2026-03-03T00:00:00Z
updated: 2026-03-03T22:02:00Z
---

## Current Test

number: 2
name: Correlation IDs on Message Processing
expected: |
  Send a message through any service. The server log should include a
  `correlationId` UUID field on the message processing log line.
  Use: wscat -c "ws://localhost:8080"
  Send: {"service":"chat","action":"send","channel":"public:test","data":{"text":"hello"}}
awaiting: user response

## Tests

### 1. JSON Structured Logging Format
expected: Starting the server produces log output in JSON format with timestamp, level, name, message fields.
result: pass

### 2. Correlation IDs on Message Processing
expected: When a client sends a message, the server log includes a `correlationId` UUID field. Each message gets a unique ID.
result: [pending]

### 3. Standardized Error Codes — Auth Failure
expected: Connecting without a token results in rejection. Server logs show AUTH_TOKEN_MISSING or AUTH_FAILED error code.
result: [pending]

### 4. Standardized Error Codes — Unauthorized Channel
expected: Subscribing to an unauthorized channel returns `{ "error": { "code": "AUTHZ_CHANNEL_DENIED", "message": "...", "timestamp": "..." } }`.
result: [pending]

### 5. Standardized Error Codes — Invalid Message
expected: Sending a message missing `service` or `action` returns `{ "error": { "code": "INVALID_MESSAGE_STRUCTURE", "message": "..." } }`.
result: [pending]

### 6. Standardized Error Codes — Unknown Service
expected: Sending `{ "service": "billing", "action": "charge" }` returns an error with code `INVALID_MESSAGE_SERVICE`.
result: [pending]

### 7. MetricsCollector Unit Tests Pass
expected: All 23 tests passing.
result: pass

### 8. CloudWatch Alarms Configured (CDK Synth)
expected: 3 alarms in CloudFormation template with SNS actions.
result: pass

### 9. CloudWatch Dashboard Configured (CDK Synth)
expected: Dashboard "WebSocketGateway-Operations" in CloudFormation template.
result: pass

## Summary

total: 9
passed: 4
issues: 0
pending: 5
skipped: 0

## Gaps

[none yet]
