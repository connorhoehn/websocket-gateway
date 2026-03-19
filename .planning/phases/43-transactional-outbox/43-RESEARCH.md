# Phase 43: Transactional Outbox - Research

**Researched:** 2026-03-19
**Domain:** DynamoDB transactional writes, outbox pattern, SQS publish, Lambda relay
**Confidence:** HIGH

## Summary

Phase 43 implements the Transactional Outbox pattern to make social event delivery durable. Currently, social writes (follow, room join, post, reaction) call `publishSocialEvent()` as a fire-and-forget `void` call *after* the HTTP response. If the process crashes between the DynamoDB write and the EventBridge publish, the event is silently lost.

The fix: every social write atomically creates both the social record and an outbox record in a single `TransactWriteCommand`. A separate relay Lambda polls unprocessed outbox records, publishes them to the correct SQS queue directly (bypassing EventBridge to avoid double-routing), and marks them processed. The existing SQS → activity-log Lambda pipeline is unchanged.

This requires: (1) a new `social-outbox` DynamoDB table with a GSI on `status` for polling, (2) modifying four write routes to use `TransactWriteCommand` with the outbox item, and (3) a new `outbox-relay` Lambda that polls and dispatches.

**Primary recommendation:** Use `TransactWriteCommand` (already available in `@aws-sdk/lib-dynamodb` at the installed version) to atomically write social record + outbox record. Relay Lambda uses `QueryCommand` on the GSI to find unprocessed records, publishes to SQS via `@aws-sdk/client-sqs` (already installed), then updates the outbox record to `status=processed`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ALOG-01 | Lambda consumer persists all social event categories (join, follow, reaction, post) to user-activity DynamoDB table | Phase 43 ensures events durably reach the SQS queues that the activity-log Lambda already consumes — zero loss even if social-api crashes between DB write and publish |
| event durability | Every social write atomically creates an outbox record; relay Lambda retries on failure (at-least-once) | TransactWriteCommand guarantees atomic write; relay Lambda leaves unprocessed records on failure for retry; processed flag prevents double-delivery to SQS |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/lib-dynamodb | ^3.1010.0 (installed) | `TransactWriteCommand`, `QueryCommand`, `UpdateCommand` | Already installed; TransactWriteCommand is the canonical DynamoDB atomic write API |
| @aws-sdk/client-dynamodb | ^3.1010.0 (installed) | `TransactionCanceledException` error type | Already installed in social-api; needed to catch TransactWrite failures |
| @aws-sdk/client-sqs | ^3.1011.0 (installed) | `SendMessageCommand` for relay Lambda to publish to SQS queues | Already installed; relay publishes directly to SQS, not EventBridge |

No new dependencies are required for this phase. All three packages are already present in the project.

**Latest published versions (verified 2026-03-19):**
- `@aws-sdk/lib-dynamodb`: 3.1012.0
- `@aws-sdk/client-sqs`: 3.1012.0
- `@aws-sdk/client-dynamodb`: 3.1012.0

**Installation:**
```bash
# No new packages needed — all required modules already installed
```

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ulid | 3.0.2 (installed) | Time-sortable IDs for outbox records | Use for `outboxId` so records sort naturally by creation time |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct SQS publish from relay | Re-publish to EventBridge | EventBridge routes to SQS anyway — relay → SQS directly avoids double hop and eliminates EventBridge routing rules as a dependency in the relay path |
| GSI polling for unprocessed outbox records | DynamoDB Streams | DynamoDB Streams requires a stream ARN, stream reader Lambda, and adds latency. GSI polling with a scheduled/periodic Lambda is simpler and sufficient for at-least-once at dev scale |
| `status` GSI with `UNPROCESSED` | Separate `pending-outbox` table | Single-table approach with status attribute is simpler; avoids second table for what is essentially a flag flip |

---

## Architecture Patterns

### How the Outbox Table Works

The outbox table stores one record per social event intent. The record is written atomically with the social record. The relay Lambda polls for records with `status=UNPROCESSED`, publishes them to SQS, and updates them to `status=PROCESSED`.

```
social write request
       │
       ▼
TransactWriteCommand ──────────────────────────────────────────┐
   Put: social record (social-relationships, social-rooms, etc) │  both-or-nothing
   Put: outbox record (social-outbox, status=UNPROCESSED)       │
───────────────────────────────────────────────────────────────┘
       │
       ▼
HTTP 201 response to caller

[later — relay Lambda on schedule or manual invoke]
       │
       ▼
Query social-outbox GSI (status=UNPROCESSED)
       │ for each record:
       ▼
SendMessageCommand → correct SQS queue (social-follows / social-rooms / social-posts / social-reactions)
       │
       ▼
UpdateCommand: status=PROCESSED on outbox record
       │
[existing pipeline unchanged]
       ▼
SQS → activity-log Lambda → user-activity DynamoDB
```

### Recommended Project Structure
```
lambdas/
├── activity-log/        # unchanged
├── crdt-snapshot/       # unchanged
└── outbox-relay/        # new — polls outbox, publishes to SQS, marks processed
    ├── handler.ts
    ├── package.json
    └── tsconfig.json

social-api/src/routes/
├── social.ts            # follow route: add outbox item to TransactWriteCommand
├── room-members.ts      # join route: add outbox item to TransactWriteCommand
├── posts.ts             # post creation: add outbox item to TransactWriteCommand
└── reactions.ts         # reaction creation: add outbox item to TransactWriteCommand

scripts/localstack/init/ready.d/
└── bootstrap.sh         # add: social-outbox table + GSI creation
```

### Pattern 1: Outbox Table Schema

**Table name:** `social-outbox`

**Key schema:**
- Partition key: `outboxId` (String, ULID for natural time-sort)
- Sort key: none (single-item access by outboxId is sufficient)

**Attributes:**
| Attribute | Type | Description |
|-----------|------|-------------|
| `outboxId` | String (ULID) | Unique ID, time-sortable |
| `status` | String | `UNPROCESSED` or `PROCESSED` |
| `eventType` | String | e.g. `social.follow`, `social.room.join`, `social.post.created`, `social.reaction` |
| `queueName` | String | Target SQS queue: `social-follows`, `social-rooms`, `social-posts`, `social-reactions` |
| `payload` | String | JSON-serialized event detail |
| `createdAt` | String | ISO timestamp |
| `processedAt` | String | ISO timestamp, set when relay marks processed |

**GSI:** `status-index`
- Partition key: `status`
- Sort key: `createdAt`
- Projection: ALL
- Enables: `QueryCommand` on `status=UNPROCESSED` sorted by creation time

**Why ULID for outboxId:** ULID is already used for `postId` (posts.ts line 1 imports `ulid`). Using it for outboxId ensures natural chronological ordering if the GSI is queried without a sort key filter.

```typescript
// DynamoDB CLI to create the table + GSI (for bootstrap.sh)
awslocal dynamodb create-table \
  --table-name social-outbox \
  --attribute-definitions \
    AttributeName=outboxId,AttributeType=S \
    AttributeName=status,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=outboxId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"status-index",
    "KeySchema":[
      {"AttributeName":"status","KeyType":"HASH"},
      {"AttributeName":"createdAt","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true
```

### Pattern 2: Modified Route — TransactWriteCommand with Outbox Item

The four target routes currently write to one table then call `publishSocialEvent` void. The change: replace the single `PutCommand` with a `TransactWriteCommand` that includes both the social item and an outbox item, and remove the `publishSocialEvent` call entirely.

**Current pattern (follow route — social.ts):**
```typescript
await docClient.send(new PutCommand({
  TableName: REL_TABLE,
  Item: { followerId, followeeId, createdAt },
  ConditionExpression: 'attribute_not_exists(followeeId)',
}));
// ...HTTP response...
void publishSocialEvent('social.follow', { followerId, followeeId });
```

**New pattern:**
```typescript
import { ulid } from 'ulid';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

const outboxId = ulid();
const now = new Date().toISOString();

await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: REL_TABLE,
        Item: { followerId, followeeId, createdAt: now },
        ConditionExpression: 'attribute_not_exists(followeeId)',
      },
    },
    {
      Put: {
        TableName: OUTBOX_TABLE,
        Item: {
          outboxId,
          status: 'UNPROCESSED',
          eventType: 'social.follow',
          queueName: 'social-follows',
          payload: JSON.stringify({ followerId, followeeId, timestamp: now }),
          createdAt: now,
        },
      },
    },
  ],
}));
// Source: @aws-sdk/lib-dynamodb TransactWriteCommand — ConditionalCheckFailed
// is in CancellationReasons[0].Code when the ConditionExpression on the first Put fails
```

**Error handling for ConditionalCheckFailed inside a TransactWrite:**
```typescript
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

try {
  await docClient.send(new TransactWriteCommand({ TransactItems: [...] }));
} catch (err) {
  if (err instanceof TransactionCanceledException) {
    const reasons = err.CancellationReasons ?? [];
    // Index 0 = first TransactItem; Code='ConditionalCheckFailed' means the ConditionExpression failed
    if (reasons[0]?.Code === 'ConditionalCheckFailed') {
      res.status(409).json({ error: 'Already following this user' });
      return;
    }
  }
  throw err;
}
```

**Important:** `TransactionCanceledException` is imported from `@aws-sdk/client-dynamodb`, NOT `@aws-sdk/lib-dynamodb`. The groups.ts route already demonstrates this pattern correctly (it was introduced in Phase 42) — follow the same import structure.

### Pattern 3: Relay Lambda — Poll, Publish, Mark Processed

The relay Lambda follows the same dual-mode pattern as `activity-log` and `crdt-snapshot`: accepts both SQS events and direct invocations.

```typescript
// lambdas/outbox-relay/handler.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const localstackConfig = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ddb = new DynamoDBClient({ region, ...localstackConfig });
const docClient = DynamoDBDocumentClient.from(ddb);
const sqsClient = new SQSClient({ region, ...localstackConfig });

const OUTBOX_TABLE = 'social-outbox';
// Queue URLs are environment variables — set per-environment
const QUEUE_URLS: Record<string, string> = {
  'social-follows':   process.env.SQS_FOLLOWS_URL   ?? '',
  'social-rooms':     process.env.SQS_ROOMS_URL     ?? '',
  'social-posts':     process.env.SQS_POSTS_URL     ?? '',
  'social-reactions': process.env.SQS_REACTIONS_URL ?? '',
};
```

**Polling loop:**
```typescript
async function relayUnprocessed(): Promise<void> {
  // Query the GSI for unprocessed records
  const result = await docClient.send(new QueryCommand({
    TableName: OUTBOX_TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :unprocessed',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':unprocessed': 'UNPROCESSED' },
    Limit: 100,  // process up to 100 records per invocation
  }));

  for (const item of result.Items ?? []) {
    const { outboxId, eventType, queueName, payload, createdAt } = item as OutboxRecord;
    const queueUrl = QUEUE_URLS[queueName];

    if (!queueUrl) {
      console.error(`[outbox-relay] Unknown queue: ${queueName} for outboxId=${outboxId}`);
      continue;  // skip unknown queues — don't fail the batch
    }

    try {
      // Publish to SQS
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          source: 'social-api',
          'detail-type': eventType,
          detail: JSON.parse(payload),
          time: createdAt,
        }),
      }));

      // Mark processed only after successful publish
      await docClient.send(new UpdateCommand({
        TableName: OUTBOX_TABLE,
        Key: { outboxId },
        UpdateExpression: 'SET #s = :processed, processedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':processed': 'PROCESSED',
          ':now': new Date().toISOString(),
        },
      }));

      console.log(`[outbox-relay] Relayed ${eventType} outboxId=${outboxId} → ${queueName}`);
    } catch (err) {
      // Do NOT rethrow — continue to next record; this record stays UNPROCESSED for retry
      console.error(`[outbox-relay] Failed to relay outboxId=${outboxId}:`, err);
    }
  }
}
```

**Key design decisions:**
1. Mark processed ONLY after successful SQS publish — if SQS fails, record stays `UNPROCESSED` and retries on next invocation
2. Per-record try/catch — one failed SQS publish does not abort other records in the same invocation
3. `UpdateCommand` (not `DeleteCommand`) on the outbox record — keeps a processed audit trail; deletion can be a separate cleanup job
4. Queue URLs come from env vars — allows different values in LocalStack vs production

### Pattern 4: SQS Message Format Matching Activity-Log Consumer

The activity-log Lambda's `processEventBridgeEvent` expects:
```typescript
{
  source: string,
  'detail-type': string,
  detail: Record<string, unknown>,
  time?: string,
}
```

The relay Lambda must produce this exact structure in the SQS message body so the activity-log Lambda handler (unchanged) can process it correctly. This is the same shape that EventBridge currently delivers.

### Pattern 5: LocalStack Bootstrap Additions

Two additions to `bootstrap.sh`:

1. Create `social-outbox` table with `status-index` GSI
2. Deploy `outbox-relay` Lambda stub + event-source-mapping (optional: scheduled invocation)

**For LocalStack, the relay Lambda can be invoked manually** via `invoke-lambda.sh` during development. A schedule (EventBridge cron or SQS trigger) is not required for dev — the phase spec says "relay Lambda polls unprocessed outbox records" which is triggered externally.

**Stub pattern (identical to activity-log and crdt-snapshot stubs):**
```bash
# In bootstrap.sh
cat > "$LAMBDA_DIR/handler.js" << 'HANDLER_EOF'
exports.handler = async function(event) {
  console.log("outbox-relay stub handler:", JSON.stringify(event));
  return { statusCode: 200, body: "ok" };
};
HANDLER_EOF

awslocal lambda create-function \
  --function-name outbox-relay \
  --runtime nodejs22.x \
  --zip-file fileb:///tmp/outbox-relay-stub.zip \
  --handler handler.handler \
  --timeout 60 \
  --environment "Variables={
    AWS_REGION=us-east-1,
    LOCALSTACK_ENDPOINT=http://localstack:4566,
    SQS_FOLLOWS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows,
    SQS_ROOMS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms,
    SQS_POSTS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts,
    SQS_REACTIONS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions
  }" \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || true
```

### Anti-Patterns to Avoid

- **Write outbox record then social record (non-atomic):** If the outbox record is written first, then the social write fails, you have a phantom event in the outbox. Always use `TransactWriteCommand` with both items together.
- **Delete outbox record after processing:** Deletion means no audit trail. Use `UpdateCommand` to set `status=PROCESSED`. A separate cleanup job can prune old processed records later.
- **Mark processed before SQS publish:** If marked processed first and then SQS publish fails, the event is silently dropped — exactly the problem being solved. Always publish to SQS first, then mark processed.
- **Catching `ConditionalCheckFailedException` for TransactWrite errors:** TransactWrite failures throw `TransactionCanceledException`, not `ConditionalCheckFailedException`. Using the wrong error class causes the exception to propagate as 500.
- **Re-publishing to EventBridge from relay:** The existing `social-follows`, `social-rooms`, `social-posts`, `social-reactions` SQS queues already receive from EventBridge. If the relay publishes to EventBridge again, messages will double-route through EventBridge → SQS. Publish directly to SQS from the relay.
- **Hardcoding SQS queue URLs in Lambda source:** Queue URLs differ between LocalStack and production. Use environment variables for queue URLs (the existing pattern for `LOCALSTACK_ENDPOINT`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic social write + event intent | Two-phase write with compensating logic | `TransactWriteCommand` | DynamoDB handles rollback; manual compensation has failure modes |
| Exactly-once SQS delivery | De-duplication logic in relay | At-least-once: mark-processed after publish + idempotent consumer | SQS FIFO de-duplication exists but is overkill; activity-log consumer is already idempotent via composite SK `timestamp#eventId` |
| Outbox query | Table scan with FilterExpression | GSI on `status` attribute with QueryCommand | Scan is O(N) on full table; GSI query is O(unprocessed count) |

---

## Common Pitfalls

### Pitfall 1: TransactWriteCommand Limit on ConditionExpression Index

**What goes wrong:** `TransactWriteCommand` supports up to 100 `TransactItems`. For this phase each write adds exactly 2 items (social record + outbox record), so the limit is never approached. However, if a future phase tries to add a third item (e.g., GSI projection update), be aware of the 100-item cap.

**How to avoid:** Not a concern for Phase 43 — each TransactWrite has exactly 2 items.

### Pitfall 2: GSI Eventual Consistency on Status Polling

**What goes wrong:** DynamoDB GSIs have eventual consistency. After a `TransactWriteCommand` writes an outbox record with `status=UNPROCESSED`, the GSI may not reflect it immediately (milliseconds to seconds delay). If the relay Lambda is invoked immediately after the write, it may miss the freshly written record.

**Why it happens:** GSI propagation is asynchronous.

**How to avoid:** The relay Lambda is not expected to be invoked synchronously with each write. It runs on a schedule or manual invocation. The at-least-once guarantee still holds — the record will appear in the GSI within milliseconds, well before the next relay invocation. For LocalStack dev, GSI consistency is near-instant.

**Warning signs:** Relay Lambda reports 0 unprocessed records immediately after a write — retry after 1-2 seconds.

### Pitfall 3: Double-Delivery if SQS Publish Succeeds but UpdateCommand Fails

**What goes wrong:** The relay publishes to SQS successfully, then the `UpdateCommand` to mark processed fails (network error, DynamoDB unavailable). On the next relay invocation, the same outbox record is picked up again (still `UNPROCESSED`) and published to SQS again — double delivery.

**Why it happens:** The publish and mark-processed are two separate operations, not atomic.

**How to avoid:** The activity-log Lambda's use of composite SK `timestamp#eventId` makes it effectively idempotent — a duplicate event writes a record with a different `eventId` suffix. This is the correct mitigation: accept at-least-once and make the consumer idempotent. Do NOT try to atomically publish + mark-processed (SQS and DynamoDB cannot participate in a single DynamoDB transaction).

**Warning signs:** Multiple activity records for the same social event. The existing composite SK pattern handles this gracefully — it's a feature, not a bug.

### Pitfall 4: SQS Queue URL Format in LocalStack

**What goes wrong:** LocalStack SQS queue URLs have the form `http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/queue-name` when accessed from inside a Docker container (service-to-service). Using `http://localhost:4566` (the host-accessible form) from within the Lambda container will fail with a connection error.

**How to avoid:** Use the `http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/{queue-name}` format in Lambda environment variables, consistent with existing bootstrap.sh patterns (lines 80-106 use this format for `awslocal sqs set-queue-attributes`).

### Pitfall 5: Existing publishSocialEvent Calls Must Be Removed

**What goes wrong:** If the `TransactWriteCommand` adds an outbox record AND the existing `void publishSocialEvent()` call remains, each write produces both an outbox record (relay eventually publishes) and a direct EventBridge event. The activity-log will receive duplicate writes.

**How to avoid:** Remove the `void publishSocialEvent(...)` call from each route that is converted to use the outbox pattern. The outbox record + relay is the sole delivery path.

---

## Code Examples

### Route Conversion: Follow (social.ts)

```typescript
// Source: @aws-sdk/lib-dynamodb TransactWriteCommand, groups.ts as reference pattern
import { ulid } from 'ulid';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

const OUTBOX_TABLE = 'social-outbox';

const outboxId = ulid();
const now = new Date().toISOString();

try {
  await docClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: REL_TABLE,
          Item: { followerId, followeeId, createdAt: now },
          ConditionExpression: 'attribute_not_exists(followeeId)',
        },
      },
      {
        Put: {
          TableName: OUTBOX_TABLE,
          Item: {
            outboxId,
            status: 'UNPROCESSED',
            eventType: 'social.follow',
            queueName: 'social-follows',
            payload: JSON.stringify({ followerId, followeeId, timestamp: now }),
            createdAt: now,
          },
        },
      },
    ],
  }));
} catch (err) {
  if (err instanceof TransactionCanceledException) {
    const reasons = err.CancellationReasons ?? [];
    if (reasons[0]?.Code === 'ConditionalCheckFailed') {
      res.status(409).json({ error: 'Already following this user' });
      return;
    }
  }
  throw err;
}

res.status(201).json({ followerId, followeeId });
// No publishSocialEvent call — outbox record handles delivery
```

### Route Conversion: Room Join (room-members.ts)

```typescript
// Room join currently: PutCommand for membership + void publishSocialEvent('social.room.join', ...)
// Replace with TransactWriteCommand:

const outboxId = ulid();
const now = new Date().toISOString();

await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: ROOM_MEMBERS_TABLE,
        Item: { roomId: req.params.roomId, userId: req.user!.sub, role: 'member', joinedAt: now },
      },
    },
    {
      Put: {
        TableName: OUTBOX_TABLE,
        Item: {
          outboxId,
          status: 'UNPROCESSED',
          eventType: 'social.room.join',
          queueName: 'social-rooms',
          payload: JSON.stringify({ roomId: req.params.roomId, userId: req.user!.sub, timestamp: now }),
          createdAt: now,
        },
      },
    },
  ],
}));
```

### Route Conversion: Post Creation (posts.ts)

```typescript
// Post creation currently: PutCommand for post + void publishSocialEvent('social.post.created', ...)
// Replace with TransactWriteCommand:

const outboxId = ulid();
await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: POSTS_TABLE,
        Item: { roomId, postId, authorId, content: trimmedContent, createdAt: now, updatedAt: now },
      },
    },
    {
      Put: {
        TableName: OUTBOX_TABLE,
        Item: {
          outboxId,
          status: 'UNPROCESSED',
          eventType: 'social.post.created',
          queueName: 'social-posts',
          payload: JSON.stringify({ roomId, postId, authorId, timestamp: now }),
          createdAt: now,
        },
      },
    },
  ],
}));
```

### Route Conversion: Reaction (reactions.ts)

```typescript
// Reaction currently: PutCommand with ConditionExpression + void publishSocialEvent('social.reaction', ...)
// Replace with TransactWriteCommand:

const outboxId = ulid();
try {
  await docClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: LIKES_TABLE,
          Item: { targetId, userId, type: 'reaction', emoji, createdAt },
          ConditionExpression: 'attribute_not_exists(#uid)',
          ExpressionAttributeNames: { '#uid': 'userId' },
        },
      },
      {
        Put: {
          TableName: OUTBOX_TABLE,
          Item: {
            outboxId,
            status: 'UNPROCESSED',
            eventType: 'social.reaction',
            queueName: 'social-reactions',
            payload: JSON.stringify({ targetId, userId, roomId, postId, emoji, timestamp: createdAt }),
            createdAt,
          },
        },
      },
    ],
  }));
} catch (err) {
  if (err instanceof TransactionCanceledException) {
    const reasons = err.CancellationReasons ?? [];
    if (reasons[0]?.Code === 'ConditionalCheckFailed') {
      res.status(409).json({ error: 'Already reacted. Delete your existing reaction first.' });
      return;
    }
  }
  throw err;
}
```

### Relay Lambda — Full Handler Skeleton

```typescript
// lambdas/outbox-relay/handler.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const config = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};
const region = process.env.AWS_REGION ?? 'us-east-1';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region, ...config }));
const sqsClient = new SQSClient({ region, ...config });

const OUTBOX_TABLE = 'social-outbox';
const QUEUE_URLS: Record<string, string> = {
  'social-follows':   process.env.SQS_FOLLOWS_URL   ?? '',
  'social-rooms':     process.env.SQS_ROOMS_URL     ?? '',
  'social-posts':     process.env.SQS_POSTS_URL     ?? '',
  'social-reactions': process.env.SQS_REACTIONS_URL ?? '',
};

export async function handler(_event: unknown) {
  const result = await docClient.send(new QueryCommand({
    TableName: OUTBOX_TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':u': 'UNPROCESSED' },
    Limit: 100,
  }));

  let relayed = 0;
  for (const item of result.Items ?? []) {
    const outboxId = item['outboxId'] as string;
    const eventType = item['eventType'] as string;
    const queueName = item['queueName'] as string;
    const payload = item['payload'] as string;
    const createdAt = item['createdAt'] as string;
    const queueUrl = QUEUE_URLS[queueName];

    if (!queueUrl) {
      console.error(`[outbox-relay] No URL for queue=${queueName} outboxId=${outboxId}`);
      continue;
    }

    try {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          source: 'social-api',
          'detail-type': eventType,
          detail: JSON.parse(payload),
          time: createdAt,
        }),
      }));

      await docClient.send(new UpdateCommand({
        TableName: OUTBOX_TABLE,
        Key: { outboxId },
        UpdateExpression: 'SET #s = :p, processedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':p': 'PROCESSED',
          ':now': new Date().toISOString(),
        },
      }));

      relayed++;
      console.log(`[outbox-relay] OK: ${eventType} → ${queueName} (${outboxId})`);
    } catch (err) {
      console.error(`[outbox-relay] FAIL: ${outboxId}:`, err);
      // Record stays UNPROCESSED — retried next invocation
    }
  }

  console.log(`[outbox-relay] Relayed ${relayed}/${result.Items?.length ?? 0} records`);
  return { statusCode: 200, relayed };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget `void publishSocialEvent()` after HTTP response | Atomic outbox write + relay Lambda | Phase 43 | Zero event loss if process crashes between DB write and publish |
| EventBridge as the sole delivery path | SQS as direct relay target (EventBridge path for real-time; outbox path for durability) | Phase 43 | Dual-path: relay → SQS (durable); EventBridge path removed from social writes |

**Deprecated by this phase:**
- `void publishSocialEvent(...)` calls in follow, join, post, reaction routes: replaced by outbox item in `TransactWriteCommand`

---

## Open Questions

1. **Should the relay Lambda be triggered by a schedule or invoked manually?**
   - What we know: Phase spec says "relay Lambda reads unprocessed outbox records" — no trigger mechanism is specified
   - What's unclear: For LocalStack dev, a manual trigger (via `invoke-lambda.sh`) is simpler; a schedule (EventBridge cron) is more production-realistic
   - Recommendation: For Phase 43, support manual invocation via `invoke-lambda.sh` (consistent with existing Lambda dev pattern). A cron-based trigger can be added in Phase 47 (production hardening).

2. **Which routes are in scope for outbox conversion?**
   - What we know: Phase spec says "follow, room join, post, reaction" — four routes
   - The four routes are: `POST /social/follow/:userId` (social.ts), `POST /rooms/:roomId/join` (room-members.ts), `POST /rooms/:roomId/posts` (posts.ts), `POST /rooms/:roomId/posts/:postId/reactions` (reactions.ts)
   - Comment creation (`POST /rooms/:roomId/posts/:postId/comments`) is NOT in spec scope — it currently has no `publishSocialEvent` call, so it's excluded
   - Room creation (`POST /rooms`) is NOT in spec scope — it has no `publishSocialEvent` call either

3. **CDK stack update for social-outbox table**
   - What we know: Phase 42 added LocalStack bootstrap changes only; CDK was not updated during Phase 42 either
   - Recommendation: Add `social-outbox` table to `lib/social-stack.ts` CDK definition alongside bootstrap.sh changes, following the existing pattern in `dynamodb-table.ts`

---

## Validation Architecture

> nyquist.enabled is false in .planning/config.json — this section is skipped.

---

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `/social-api/src/routes/social.ts` — current follow route with void publishSocialEvent
- Direct source inspection: `/social-api/src/routes/room-members.ts` — current join route with void publishSocialEvent
- Direct source inspection: `/social-api/src/routes/posts.ts` — current post creation with void publishSocialEvent
- Direct source inspection: `/social-api/src/routes/reactions.ts` — current reaction creation with void publishSocialEvent
- Direct source inspection: `/social-api/src/routes/groups.ts` — existing TransactWriteCommand + TransactionCanceledException pattern (Phase 42 reference)
- Direct source inspection: `/social-api/src/lib/aws-clients.ts` — publishSocialEvent pattern being replaced
- Direct source inspection: `/lambdas/activity-log/handler.ts` — downstream consumer contract (EventBridge event shape)
- Direct source inspection: `/scripts/localstack/init/ready.d/bootstrap.sh` — table + Lambda stub deployment pattern
- Direct source inspection: `/lib/event-bus-stack.ts` — SQS queue names used by relay
- npm registry: `@aws-sdk/lib-dynamodb` version 3.1012.0 (verified 2026-03-19)
- npm registry: `@aws-sdk/client-sqs` version 3.1012.0 (verified 2026-03-19)

### Secondary (MEDIUM confidence)
- DynamoDB Transactional Outbox pattern: well-established industry pattern; implementation details derived from project source code
- TransactionCanceledException.CancellationReasons[].Code behavior: consistent with existing Phase 42 groups.ts implementation and @aws-sdk/client-dynamodb documentation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all required modules already installed and in use
- Architecture: HIGH — all four routes identified from direct source code inspection; relay Lambda pattern derived from existing crdt-snapshot and activity-log Lambda patterns
- Pitfalls: HIGH — derived from reading actual code paths, existing patterns, and known DynamoDB transactional write semantics

**Research date:** 2026-03-19
**Valid until:** Stable — DynamoDB SDK v3 TransactWriteCommand and SQS SendMessageCommand APIs are mature
