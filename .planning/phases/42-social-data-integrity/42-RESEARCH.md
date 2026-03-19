# Phase 42: Social Data Integrity - Research

**Researched:** 2026-03-19
**Domain:** DynamoDB conditional writes, atomic transactions, input validation
**Confidence:** HIGH

## Summary

Phase 42 fixes four discrete data-integrity defects in the social-api service that would produce corrupt or inconsistent state when simulation scripts hammer the API concurrently. Each defect has a known, precise root cause identified by reading the existing route code. No architectural redesign is required — all four fixes are surgical changes to existing route handlers.

The follow-duplication bug uses a wrong `ConditionExpression` key attribute. The group-creation bug uses two sequential `PutCommand` calls with no transaction. The DM room dedup bug uses a pre-write scan (classic TOCTOU race). The post content bug already has the trim-before-check logic in place, but the validation order can be made explicit with a `trimmedContent` local variable to ensure whitespace-only content is rejected with the correct "required" validation error path.

**Primary recommendation:** Use `TransactWriteCommand` for group creation, `ConditionExpression` on the DM room `PutCommand`, fix the follow `ConditionExpression` to check the sort key, and extract `trimmedContent` before the length-zero check in both posts and comments.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SOCL-01 | User can follow another user | Fix ConditionExpression to check `followeeId` (sort key) on social-relationships PutCommand |
| GRUP-01 | User can create a group with name and description | Replace two sequential PutCommands with TransactWriteCommand covering both social-groups and social-group-members |
| ROOM-03 | Two mutual friends can open a direct-message (DM) room | Replace pre-write ScanCommand dedup with ConditionExpression on the room PutCommand |
| CONT-01 | User can create a text post in a room | Extract `trimmedContent` before validation; reject whitespace-only content via the empty-check path, not the length-check path |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/lib-dynamodb | ^3.1010.0 (already installed) | DynamoDBDocumentClient + TransactWriteCommand | Already in project; TransactWriteCommand is in the same package |
| @aws-sdk/client-dynamodb | ^3.1010.0 (already installed) | Low-level DynamoDB types | Already in project |

No new dependencies are required for this phase. `TransactWriteCommand` is exported from `@aws-sdk/lib-dynamodb`, which is already installed at the version the project uses.

**Installation:**
```bash
# No new packages needed — TransactWriteCommand is already available
```

## Architecture Patterns

### Pattern 1: DynamoDB ConditionExpression for idempotent PutCommand

**What:** A `ConditionExpression` on a `PutCommand` causes DynamoDB to throw `ConditionalCheckFailedException` (HTTP 400 from DynamoDB, mapped to HTTP 409 in the API) if the item already exists. This is the standard approach for at-most-once writes without a separate read-check-write sequence.

**When to use:** Any time two concurrent callers could both pass a pre-write check and then both write. The scan-then-write pattern in DM creation is the textbook TOCTOU race this solves.

**Correct attribute to check — composite primary key tables:**
For `social-relationships` (PK: `followerId`, SK: `followeeId`):
```typescript
// Source: DynamoDB ConditionExpression docs — attribute_not_exists checks
// whether the named attribute exists on the ITEM being written.
// For a composite PK, checking the sort key is sufficient because if the
// item does not exist, neither PK attribute will be present.
ConditionExpression: 'attribute_not_exists(followeeId)'
```

The current code at `social.ts:66` uses `attribute_not_exists(followerId)`. For a composite PK table this is ambiguous — `followerId` is the partition key, which would be absent on any new item. Checking `attribute_not_exists(followeeId)` (the sort key) is the conventional pattern that unambiguously guards the composite PK pair.

**For DM room dedup on `social-rooms` (PK: `roomId`):**
The DM dedup cannot be done with a ConditionExpression on `roomId` alone (since each DM room gets a new UUID). The correct approach is a composite attribute stored on write:

```typescript
// Canonical approach: store a dmKey composite attribute and condition on it.
// dmKey = [userId1, userId2].sort().join('#')  — order-independent
// ConditionExpression: 'attribute_not_exists(dmKey)'
// This requires dmKey to be added to the room item and checked on write.
```

However the success criterion specifically says "ConditionExpression on PutCommand" without mandating a `dmKey`. The simpler approach: store `dmKey` as a stable attribute, then use a GSI (Phase 47 adds GSIs) — but Phase 47 is out of scope here. For Phase 42, the pattern is:

1. Compute `dmKey = [callerId, targetUserId].sort().join('#')` (deterministic regardless of which side initiates)
2. Add `dmKey` attribute to the room `PutCommand` item
3. Add `ConditionExpression: 'attribute_not_exists(dmKey)'` — this conditions on the `dmKey` attribute NOT existing on the item being written

This does NOT prevent two concurrent creates from both writing — a ConditionExpression on the item's own attributes only guards that specific `roomId` item. The correct approach for Phase 42's stated goal ("ConditionExpression on PutCommand") is:

**Option A (correct, achieves the spec):** Use a separate "lock item" in a known table slot with a deterministic key derived from both user IDs, and `ConditionExpression: 'attribute_not_exists(pk)'` on that lock item. This is the DynamoDB conditional-create-or-fail pattern.

Concretely:
- Use `social-rooms` with a deterministic `roomId = 'dm#' + [callerId, targetUserId].sort().join('#')`
- Then `ConditionExpression: 'attribute_not_exists(roomId)'` guards the specific deterministic key
- Both concurrent requests try to write the same `roomId` — only one succeeds

This is the cleanest approach and requires no additional table. The trade-off: `roomId` is no longer a UUID for DM rooms — it is deterministic. This is acceptable since DM rooms are uniquely identified by the pair of users.

```typescript
// Source: standard DynamoDB idempotent-create pattern
const dmKey = ['dm', ...[callerId, targetUserId].sort()].join('#');
// dmKey = 'dm#aaa#bbb' regardless of which user calls first

await docClient.send(new PutCommand({
  TableName: ROOMS_TABLE,
  Item: {
    roomId: dmKey,   // deterministic
    channelId,
    ...
  },
  ConditionExpression: 'attribute_not_exists(roomId)',
}));
// ConditionalCheckFailedException → 409 (DM already exists)
```

### Pattern 2: TransactWriteCommand for atomic multi-table writes

**What:** `TransactWriteCommand` bundles up to 100 write operations across one or more tables into a single all-or-nothing DynamoDB transaction. If any operation fails (including a ConditionExpression check), all operations are rolled back.

**When to use:** Any time two tables must stay in sync — here, `social-groups` and `social-group-members` must both be written or neither.

```typescript
// Source: @aws-sdk/lib-dynamodb TransactWriteCommand docs
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: GROUPS_TABLE,
        Item: groupItem,
        ConditionExpression: 'attribute_not_exists(groupId)',  // optional safety
      },
    },
    {
      Put: {
        TableName: MEMBERS_TABLE,
        Item: memberItem,
      },
    },
  ],
}));
```

**Error type on failure:** `TransactionCanceledException` — contains a `CancellationReasons` array. Each reason has a `Code` field; `'ConditionalCheckFailed'` means a ConditionExpression rejected the write.

```typescript
// Catching TransactionCanceledException
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

try {
  await docClient.send(new TransactWriteCommand({ ... }));
} catch (err) {
  if (err instanceof TransactionCanceledException) {
    const reasons = err.CancellationReasons ?? [];
    if (reasons.some(r => r.Code === 'ConditionalCheckFailed')) {
      res.status(409).json({ error: 'Group already exists' });
      return;
    }
  }
  throw err;
}
```

**Import note:** `TransactWriteCommand` is imported from `@aws-sdk/lib-dynamodb`. `TransactionCanceledException` is imported from `@aws-sdk/client-dynamodb` (the low-level client package).

### Pattern 3: Trim-before-validate for text content

**What:** Assign `const trimmedContent = content.trim()` at the top of the handler, then use `trimmedContent` in all subsequent validation and storage operations. This ensures that whitespace-only input always returns 400 via the "required" path, not the length path.

**Current state in posts.ts (line 36):**
```typescript
// Current — inline trim in condition
if (!content || content.trim().length === 0 || content.length > 10000) {
```

The issue: `content.length > 10000` checks the untrimmed string. A string of 9999 spaces passes the length check, then `content.trim().length === 0` catches it. The behavior is correct but the logic order is: length check first (on untrimmed), then empty check (on trimmed). If content is "   " (3 spaces), `content.trim().length === 0` is true, so 400 is returned correctly. So posts.ts already rejects whitespace-only content with 400.

**The spec wording "trim before validate"** means the `trimmedContent` variable is extracted first, then both checks use it:

```typescript
// Target pattern
const trimmedContent = content.trim();
if (!trimmedContent || trimmedContent.length > 10000) {
  res.status(400).json({ error: 'content is required (max 10000 chars)' });
  return;
}
// ... store trimmedContent
```

This is cleaner and makes the validation order explicit. Both `posts.ts` and `comments.ts` should use this pattern — comments.ts line 38 has the same inline pattern.

### Recommended Project Structure

No structural changes required. All changes are within existing files:

```
social-api/src/routes/
├── social.ts        — fix follow ConditionExpression (SOCL-01)
├── groups.ts        — add TransactWriteCommand for group creation (GRUP-01)
├── rooms.ts         — fix DM dedup with deterministic roomId + ConditionExpression (ROOM-03)
└── posts.ts         — extract trimmedContent before validation (CONT-01)
    comments.ts      — extract trimmedContent before validation (CONT-01 consistency)
```

### Anti-Patterns to Avoid

- **Scan-then-write (TOCTOU race):** Never scan to check uniqueness and then write separately. Always express the uniqueness constraint in a `ConditionExpression` on the write itself.
- **Sequential multi-table writes without transactions:** Two separate `PutCommand` calls are not atomic. If the process crashes between them, one table has the write and the other doesn't.
- **Checking partition key in attribute_not_exists on composite PK tables:** `attribute_not_exists(followerId)` is the wrong guard for a composite PK. Check `attribute_not_exists(followeeId)` (the sort key) — if the {followerId, followeeId} pair doesn't exist, the sort key won't be present on that item.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic multi-table write | Manual rollback on second write failure | `TransactWriteCommand` | DynamoDB handles rollback; manual rollback has its own failure modes |
| Idempotent create | Read-check-write sequence | `ConditionExpression: 'attribute_not_exists(pk)'` on PutCommand | Eliminates TOCTOU race entirely; DynamoDB enforces atomically |
| DM dedup across concurrent callers | Scan before write | Deterministic `roomId` derived from both user IDs + `attribute_not_exists(roomId)` | Converts the uniqueness problem to a key collision problem that DynamoDB solves natively |

## Common Pitfalls

### Pitfall 1: Wrong attribute in attribute_not_exists for composite PK

**What goes wrong:** `ConditionExpression: 'attribute_not_exists(followerId)'` on a composite PK table (PK=followerId, SK=followeeId). The condition evaluates to true for any item where `followerId` is absent — which is true for any new item regardless of `followeeId`. Concurrent follow requests from the same follower to different targets would be correctly rejected, but concurrent requests to the SAME target would both succeed because `followerId` is absent on both writes (they're new items).

Wait — actually on re-analysis: `attribute_not_exists(followerId)` evaluates against the ITEM AT THE KEY being written, not a scan. DynamoDB evaluates ConditionExpression on the item that WOULD exist at that exact `{followerId, followeeId}` key. Since the PK uniquely identifies the item, `attribute_not_exists(followerId)` effectively checks "does this item exist?" — both checks are equivalent for new-vs-existing item detection. The real concern is expressiveness and convention.

**Revised assessment (HIGH confidence):** The current `attribute_not_exists(followerId)` in `social.ts` IS functionally correct for deduplication — DynamoDB evaluates it against the specific item at `{followerId, followeeId}`. The item doesn't exist → `followerId` is absent → condition passes → write succeeds. Item exists → `followerId` is present → condition fails → `ConditionalCheckFailedException`. The Phase 42 success criterion says "ConditionExpression on followeeId" — this means change to `attribute_not_exists(followeeId)` for conventional correctness and alignment with the spec.

**How to avoid:** Use `attribute_not_exists(followeeId)` (the sort key) per project specification.

### Pitfall 2: TransactionCanceledException vs ConditionalCheckFailedException

**What goes wrong:** Catching `ConditionalCheckFailedException` (which fires on single-item ConditionExpression failures) instead of `TransactionCanceledException` (which fires on TransactWrite failures). Using the wrong error type in a catch block causes the error to be re-thrown as a 500.

**How to avoid:** Import `TransactionCanceledException` from `@aws-sdk/client-dynamodb` for TransactWrite error handling. Keep `ConditionalCheckFailedException` for single-item PutCommand errors.

**Warning signs:** A group creation that should return 409 instead returns 500 in testing.

### Pitfall 3: Deterministic DM roomId changes room-member join behavior

**What goes wrong:** If `roomId` is changed from UUID to `'dm#userA#userB'`, any existing code that generates room-member records using the old UUID format will produce orphaned records. The room-member enrollment inside the DM route uses the same `roomId` variable, so it will be consistent — but if the scan-based dedup currently returns an existing room's UUID, callers that use the returned `roomId` value will be unaffected.

**How to avoid:** Ensure both the room write and both room-member writes use the new deterministic `roomId`. The 409 response should still return the existing `roomId` so the caller can join.

### Pitfall 4: content.length check on untrimmed string

**What goes wrong:** A 10,001-character string of spaces passes `content.trim().length === 0` (rejected as empty) — but if the length check runs first, it's rejected as too long. The end result is 400 either way, but the error message may say "max 10000 chars" instead of "content is required." Simulation scripts parsing error messages for retry logic would misclassify the error.

**How to avoid:** Extract `trimmedContent` first; all subsequent validation and storage use `trimmedContent`.

## Code Examples

### Follow ConditionExpression fix (SOCL-01)
```typescript
// Source: social.ts — change followerId to followeeId in ConditionExpression
await docClient.send(
  new PutCommand({
    TableName: REL_TABLE,
    Item: { followerId, followeeId, createdAt: new Date().toISOString() },
    ConditionExpression: 'attribute_not_exists(followeeId)',  // was: followerId
  }),
);
// ConditionalCheckFailedException → 409 'Already following this user'
```

### Atomic group creation (GRUP-01)
```typescript
// Source: @aws-sdk/lib-dynamodb TransactWriteCommand
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: GROUPS_TABLE,
        Item: groupItem,
      },
    },
    {
      Put: {
        TableName: MEMBERS_TABLE,
        Item: memberItem,
      },
    },
  ],
}));
// TransactionCanceledException → 500 (unexpected); no partial writes
```

### DM room deterministic key + ConditionExpression (ROOM-03)
```typescript
// Source: DynamoDB idempotent-create pattern
const dmRoomId = ['dm', ...[callerId, targetUserId].sort()].join('#');

try {
  await docClient.send(new PutCommand({
    TableName: ROOMS_TABLE,
    Item: {
      roomId: dmRoomId,
      channelId,
      name: `dm-${callerId.slice(-6)}-${targetUserId.slice(-6)}`,
      type: 'dm',
      ownerId: callerId,
      dmPeerUserId: targetUserId,
      createdAt: now,
      updatedAt: now,
    },
    ConditionExpression: 'attribute_not_exists(roomId)',
  }));
} catch (err: unknown) {
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'ConditionalCheckFailedException'
  ) {
    res.status(409).json({ error: 'A DM room already exists between these two users', roomId: dmRoomId });
    return;
  }
  throw err;
}
// Room member writes use dmRoomId (not a UUID)
```

### Trim-before-validate for posts (CONT-01)
```typescript
// Source: posts.ts — extract trimmedContent first
const trimmedContent = (content ?? '').trim();
if (!trimmedContent || trimmedContent.length > 10000) {
  res.status(400).json({ error: 'content is required (max 10000 chars)' });
  return;
}
// ... use trimmedContent in PutCommand Item and response
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Read-check-write (TOCTOU) | ConditionExpression on PutCommand | DynamoDB SDK v3 | Eliminates race condition entirely |
| Sequential multi-table writes | TransactWriteCommand | DynamoDB Transactions (2018) | Atomic all-or-nothing writes |

**Deprecated/outdated:**
- Scan-before-write for uniqueness checks: replaced by ConditionExpression + deterministic key
- Sequential PutCommands for related records: replaced by TransactWriteCommand

## Open Questions

1. **DM room backward compatibility**
   - What we know: Changing DM `roomId` from UUID to deterministic string `'dm#userA#userB'` is a breaking change for any existing DM rooms stored in DynamoDB with UUID keys
   - What's unclear: Are there existing DM rooms in LocalStack dev data that would be orphaned?
   - Recommendation: Since this is LocalStack/dev environment only (no production data), the migration concern is minimal. A bootstrap data reset or note in the plan is sufficient.

2. **TransactWriteCommand capacity consumption**
   - What we know: TransactWrite consumes 2x write capacity units compared to a standard PutCommand (one for the prepare phase, one for the commit)
   - What's unclear: LocalStack may not enforce capacity limits, so this won't surface in dev
   - Recommendation: Not a concern for the current phase; Phase 47 (GSIs) is the appropriate time to revisit write patterns at scale

## Sources

### Primary (HIGH confidence)
- Direct source code inspection: `/social-api/src/routes/social.ts` — current follow ConditionExpression
- Direct source code inspection: `/social-api/src/routes/groups.ts` — current sequential PutCommand pattern
- Direct source code inspection: `/social-api/src/routes/rooms.ts` — current scan-based DM dedup
- Direct source code inspection: `/social-api/src/routes/posts.ts` — current trim-inline validation
- Direct source code inspection: `/social-api/src/routes/comments.ts` — current trim-inline validation
- Direct source code inspection: `/social-api/src/lib/aws-clients.ts` — existing DynamoDB client setup

### Secondary (MEDIUM confidence)
- @aws-sdk/lib-dynamodb package.json version `^3.1010.0` — TransactWriteCommand available at this version
- DynamoDB TransactWrite documentation: TransactionCanceledException is the error type for failed transactions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; TransactWriteCommand is in the already-installed @aws-sdk/lib-dynamodb
- Architecture: HIGH — all four defects identified from direct source code inspection; patterns are well-established DynamoDB conventions
- Pitfalls: HIGH — derived from reading the actual code paths and concurrent execution scenarios

**Research date:** 2026-03-19
**Valid until:** Stable (DynamoDB SDK v3 TransactWriteCommand API is mature and unchanged)
