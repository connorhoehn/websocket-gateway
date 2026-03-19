---
phase: 43-transactional-outbox
verified: 2026-03-19T20:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 43: Transactional Outbox Verification Report

**Phase Goal:** Implement transactional outbox pattern — social writes atomically record both the social entity and an UNPROCESSED outbox entry; relay Lambda publishes outbox entries to SQS and marks them PROCESSED.
**Verified:** 2026-03-19T20:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from Plan 01 + Plan 02 must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A follow write atomically creates both the social-relationships record and a social-outbox record | VERIFIED | `social.ts:65` — `TransactWriteCommand` with two `Put` items: one to `REL_TABLE`, one to `OUTBOX_TABLE` |
| 2 | A room join write atomically creates both the social-room-members record and a social-outbox record | VERIFIED | `room-members.ts:66` — `TransactWriteCommand` with two `Put` items: `ROOM_MEMBERS_TABLE` + `OUTBOX_TABLE` |
| 3 | A post creation write atomically creates both the social-posts record and a social-outbox record | VERIFIED | `posts.ts:58` — `TransactWriteCommand` with two `Put` items: `POSTS_TABLE` + `OUTBOX_TABLE` |
| 4 | A reaction write atomically creates both the social-likes record and a social-outbox record | VERIFIED | `reactions.ts:61` — `TransactWriteCommand` with two `Put` items: `LIKES_TABLE` + `OUTBOX_TABLE` |
| 5 | No publishSocialEvent calls remain in the four converted routes | VERIFIED | `social.ts`: only `unfollow` call remains (in scope per plan); `room-members.ts`: only `leave` call remains; `posts.ts` and `reactions.ts`: zero calls (comments at line 101/109 only). Grep output confirms this. |
| 6 | The social-outbox DynamoDB table exists with a status-index GSI in LocalStack bootstrap | VERIFIED | `bootstrap.sh:67` — `create-table --table-name social-outbox` with `AttributeName=status,AttributeType=S` and `"IndexName":"status-index"` at line 75 |
| 7 | The outbox-relay Lambda queries social-outbox for UNPROCESSED records and publishes them to the correct SQS queue | VERIFIED | `handler.ts:25-51` — `QueryCommand` on `IndexName: 'status-index'` with `':u': 'UNPROCESSED'`, `Limit: 100`; per-record `SendMessageCommand` with `QueueUrl: QUEUE_URLS[queueName]` |
| 8 | After successful SQS publish, the outbox record is marked PROCESSED | VERIFIED | `handler.ts:59-67` — `UpdateCommand` sets `status=PROCESSED` and `processedAt` ONLY after `SendMessageCommand` succeeds |
| 9 | If SQS publish fails for one record, other records in the batch are still processed | VERIFIED | `handler.ts:57+73` — per-record `try/catch` catches and logs individual failures; loop continues to next record |
| 10 | The outbox-relay Lambda stub is deployed in LocalStack bootstrap | VERIFIED | `bootstrap.sh:392-414` — `echo "==> Deploying outbox-relay Lambda..."`, `--function-name outbox-relay`, `--timeout 60`, all four SQS queue URL env vars |
| 11 | The SQS message body matches the EventBridge event shape expected by activity-log Lambda | VERIFIED | `handler.ts:52-57` — `MessageBody: JSON.stringify({ source: 'social-api', 'detail-type': eventType, detail: JSON.parse(payload), time: createdAt })` matches the `EventBridgeEvent` interface in `activity-log/handler.ts` |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/localstack/init/ready.d/bootstrap.sh` | social-outbox table with status-index GSI | VERIFIED | Lines 67-80: `create-table social-outbox` with GSI `status-index` (PK: status, SK: createdAt, ALL projection) |
| `social-api/src/routes/social.ts` | Atomic follow + outbox write via TransactWriteCommand | VERIFIED | Line 65: `TransactWriteCommand`; line 76: `OUTBOX_TABLE`; line 80-81: `eventType: 'social.follow'`, `queueName: 'social-follows'` |
| `social-api/src/routes/room-members.ts` | Atomic room-join + outbox write via TransactWriteCommand | VERIFIED | Line 66: `TransactWriteCommand`; line 85-86: `eventType: 'social.room.join'`, `queueName: 'social-rooms'` |
| `social-api/src/routes/posts.ts` | Atomic post + outbox write via TransactWriteCommand | VERIFIED | Line 58: `TransactWriteCommand`; line 79-80: `eventType: 'social.post.created'`, `queueName: 'social-posts'`; zero `publishSocialEvent` calls |
| `social-api/src/routes/reactions.ts` | Atomic reaction + outbox write via TransactWriteCommand | VERIFIED | Line 61: `TransactWriteCommand`; `TransactionCanceledException` at line 6 and 87; `eventType: 'social.reaction'`, `queueName: 'social-reactions'` |
| `lambdas/outbox-relay/handler.ts` | Relay Lambda (>50 lines) with GSI query, SQS publish, mark PROCESSED | VERIFIED | 80 lines; exports `handler`; `QueryCommand` on `status-index`, `SendMessageCommand`, `UpdateCommand` to mark PROCESSED |
| `lambdas/outbox-relay/package.json` | Lambda package with DynamoDB + SQS SDK dependencies | VERIFIED | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sqs` all present |
| `lambdas/outbox-relay/tsconfig.json` | TypeScript config with commonjs module | VERIFIED | `"target": "ES2022"`, `"module": "commonjs"` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `social-api/src/routes/social.ts` | social-outbox table | `TransactWriteCommand Put on OUTBOX_TABLE` | WIRED | `TableName: OUTBOX_TABLE` inside `TransactWriteCommand` at line 76; `OUTBOX_TABLE = 'social-outbox'` at line 16 |
| `social-api/src/routes/reactions.ts` | social-outbox table | `TransactWriteCommand with ConditionExpression` | WIRED | `TransactionCanceledException` imported and caught at lines 6 and 87; `reasons[0]?.Code === 'ConditionalCheckFailed'` at line 89 |
| `lambdas/outbox-relay/handler.ts` | social-outbox table (status-index GSI) | `QueryCommand on status-index with status=UNPROCESSED` | WIRED | `IndexName: 'status-index'`, `':u': 'UNPROCESSED'` at lines 27-30 |
| `lambdas/outbox-relay/handler.ts` | SQS queues (social-follows, social-rooms, social-posts, social-reactions) | `SendMessageCommand with queue URL from env vars` | WIRED | `QUEUE_URLS` map at lines 17-22 using all four `SQS_*_URL` env vars; `SendMessageCommand` at line 49 |
| `lambdas/outbox-relay/handler.ts` | activity-log Lambda (downstream consumer) | SQS message body matches EventBridge event shape | WIRED | `'detail-type': eventType` at line 53 exactly matches `EventBridgeEvent['detail-type']` shape consumed by activity-log Lambda |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ALOG-01 | 43-01-PLAN.md | Lambda consumer persists all social event categories (join, follow, reaction, post) to a user-activity DynamoDB table | SATISFIED | ALOG-01 was completed in Phase 40. Phase 43 strengthens the durability guarantee for those events by ensuring they are atomically written to the outbox before delivery. The requirement itself is already marked Complete in REQUIREMENTS.md. Phase 43 does not contradict or regress it. |
| event durability | 43-01-PLAN.md, 43-02-PLAN.md | Informal label (not a formal REQ-ID in REQUIREMENTS.md) describing the transactional outbox guarantee: no event loss if process crashes between write and publish | SATISFIED | Atomic TransactWriteCommand in all four routes ensures outbox record exists before any delivery attempt; relay marks PROCESSED only after successful SQS publish; failed publishes leave records UNPROCESSED for retry. Note: "event durability" is not a formal requirement ID — it does not appear in REQUIREMENTS.md. It is a design objective label used in plan frontmatter. No formal REQ-ID is missing. |

**Orphaned requirements:** None. REQUIREMENTS.md does not map any requirement IDs to Phase 43. ALOG-01 is mapped to Phase 40 and was already marked Complete before this phase began.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `lambdas/outbox-relay/handler.ts` | 1 | Bootstrap stub in `bootstrap.sh` deploys a JS stub (`exports.handler = async function...`), not the compiled TypeScript handler | Info | Expected — dev pattern; TypeScript handler is built separately. LocalStack stub is placeholder for local testing. The actual `handler.ts` is the real implementation for production deployment. |

No blockers or warnings. The stub deployment pattern is consistent with the existing `activity-log` and `crdt-snapshot` Lambda patterns in this project.

---

### Human Verification Required

#### 1. End-to-end relay pipeline in LocalStack

**Test:** Start LocalStack (`docker compose up`). Perform a follow, room-join, post-create, and reaction-create via the social-api. Verify the `social-outbox` table has UNPROCESSED records. Invoke the `outbox-relay` Lambda (`./scripts/invoke-lambda.sh outbox-relay`). Verify records are marked PROCESSED and corresponding SQS messages appear in `social-follows`, `social-rooms`, `social-posts`, `social-reactions` queues.
**Expected:** All four UNPROCESSED records become PROCESSED; SQS messages have `{source: 'social-api', 'detail-type': 'social.follow'|'social.room.join'|'social.post.created'|'social.reaction', detail: {...}, time: '...'}` shape.
**Why human:** Requires running Docker + LocalStack; cannot verify SQS message delivery or DynamoDB state transitions programmatically from a static code scan.

#### 2. Transaction atomicity under failure

**Test:** Simulate a crash (or use DynamoDB ConditionExpression conflict) during a follow write to confirm the outbox record is NOT written unless the social-relationships record succeeds.
**Expected:** Either both records are written or neither is — the TransactWriteCommand provides all-or-nothing semantics.
**Why human:** Transaction failure scenarios require injecting faults or ConditionExpression conflicts at runtime.

#### 3. Duplicate reaction handling via TransactionCanceledException

**Test:** POST the same reaction twice from the same user. Second request should return HTTP 409 with `{"error": "Already reacted. Delete your existing reaction first."}`.
**Expected:** 409 response; no duplicate outbox record written.
**Why human:** Requires live HTTP request to running social-api.

---

## Gaps Summary

No gaps found. All 11 observable truths are verified. All 8 required artifacts exist, are substantive, and are wired into the correct data flows. All 5 key links are confirmed present in the actual code.

**Note on "event durability" requirement ID:** This label appears in plan frontmatter as a requirement but is not a formally registered REQ-ID in `.planning/REQUIREMENTS.md`. It functions as a design objective description, not a trackable requirement. No gap exists — the implementation satisfies the objective fully.

---

_Verified: 2026-03-19T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
