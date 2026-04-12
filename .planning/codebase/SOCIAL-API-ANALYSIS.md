# Social API Codebase Analysis

**Analysis Date:** 2026-04-12

---

## 1. Route Handler Patterns

### Consistency Assessment: HIGH (with caveats)

Every route handler follows the same structural pattern:

```typescript
router.METHOD('/path', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Extract params/body
    // 2. Validate input
    // 3. Authorization gate (membership check, ownership check)
    // 4. DynamoDB operation
    // 5. Cache populate/invalidate
    // 6. Broadcast via Redis (where applicable)
    // 7. Return JSON response
  } catch (err) {
    console.error('[tag] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Observed in all route files:**
- `src/routes/profiles.ts`
- `src/routes/groups.ts`
- `src/routes/rooms.ts`
- `src/routes/posts.ts`
- `src/routes/comments.ts`
- `src/routes/likes.ts`
- `src/routes/reactions.ts`
- `src/routes/social.ts`
- `src/routes/group-members.ts`
- `src/routes/group-rooms.ts`
- `src/routes/room-members.ts`
- `src/routes/activity.ts`

### Issues

**No shared middleware for common gates.** The membership check pattern is copy-pasted across `posts.ts`, `comments.ts`, `likes.ts`, `reactions.ts`, and `room-members.ts`:

```typescript
// This exact block appears in 10+ handlers:
const membership = await docClient.send(new GetCommand({
  TableName: ROOM_MEMBERS_TABLE,
  Key: { roomId, userId },
}));
if (!membership.Item) {
  res.status(403).json({ error: 'You must be a member of this room to ...' });
  return;
}
```

**Fix approach:** Extract a `requireRoomMembership` middleware that attaches `req.roomMembership` and short-circuits with 403. Same for `requireGroupMembership`.

**Inconsistent event publishing strategy.** Some handlers use the transactional outbox pattern (posts, reactions, follows, room join), while others call `publishSocialEvent()` directly (comments, likes, room leave, unfollow). This is a data consistency risk:
- `src/routes/posts.ts` line 59: TransactWriteCommand with outbox
- `src/routes/comments.ts` line 117: `void publishSocialEvent(...)` after response
- `src/routes/likes.ts` line 79: `void publishSocialEvent(...)` after response
- `src/routes/room-members.ts` line 158: `void publishSocialEvent(...)` after response

**Broadcast boilerplate is duplicated.** The "fetch room channelId from cache, fall back to DynamoDB, then emit" pattern is copy-pasted in `posts.ts`, `comments.ts`, `likes.ts`, `reactions.ts`, and `room-members.ts`. Example from `src/routes/posts.ts` lines 92-107 is nearly identical to `src/routes/comments.ts` lines 95-112 and `src/routes/likes.ts` lines 59-74.

**Fix approach:** Create a helper `broadcastToRoom(roomId, eventType, payload)` in `src/services/broadcast.ts` that encapsulates the cache-or-fetch + emit logic.

---

## 2. DynamoDB Access Layer

### Assessment: NO DATA LAYER -- Raw SDK calls everywhere

Every route file directly imports `docClient` from `src/lib/aws-clients.ts` and constructs SDK commands inline. There is no repository/DAO/service layer.

**Table name strings are hardcoded per file:**
- `src/routes/profiles.ts` line 5: `const TABLE = 'social-profiles';`
- `src/routes/groups.ts` lines 14-15: `const GROUPS_TABLE = 'social-groups';` etc.
- `src/routes/posts.ts` lines 15-18: four table constants
- `src/routes/likes.ts` lines 13-17: six table constants
- `src/routes/room-members.ts` lines 14-15: two table constants + outbox

**The same table is referenced by different constant names across files:**
- `'social-rooms'` is `ROOMS_TABLE` in rooms.ts, posts.ts, comments.ts, likes.ts, reactions.ts, group-rooms.ts, room-members.ts
- `'social-room-members'` is `ROOM_MEMBERS_TABLE` in six files

**Interface types are duplicated across files:**
- `RoomItem` is defined in `src/routes/rooms.ts`, `src/routes/group-rooms.ts`, and `src/routes/room-members.ts`
- `RoomMemberItem` is defined in `src/routes/rooms.ts`, `src/routes/group-rooms.ts`, and `src/routes/room-members.ts`
- `GroupItem` is defined in both `src/routes/groups.ts` and `src/routes/group-members.ts`
- `GroupMemberItem` is defined in both `src/routes/groups.ts` and `src/routes/group-members.ts`

**Fix approach:** Create `src/models/` directory with shared type definitions and table constants. Consider a thin repository layer (e.g., `src/repositories/room.ts`) for common operations like "get room by ID with cache" and "check room membership."

---

## 3. Error Handling Consistency

### Assessment: CONSISTENT but SHALLOW

**Good:**
- Every handler wraps in try/catch
- All catch blocks log with `console.error` and return 500
- `ConditionalCheckFailedException` is handled for idempotent writes (likes, reactions, DM creation)
- `TransactionCanceledException` is handled for transactional writes (groups, reactions)

**Issues:**

**No error typing or classification.** Every non-specific error becomes a generic 500. There is no middleware for centralized error handling. If a DynamoDB `ProvisionedThroughputExceededException` occurs, the user gets "Internal server error" with no retry hint.

**Swallowed errors in cache operations.** `src/lib/cache.ts` lines 29 and 39-41 use empty `catch {}` blocks with no logging. If Redis starts failing systematically, there is zero observability into cache miss rates.

**`void` fire-and-forget calls suppress errors silently:**
```typescript
// src/routes/profiles.ts line 72
void setCachedProfile(userId, item);

// src/routes/comments.ts line 117
void publishSocialEvent('social.comment.created', { ... });
```
The `void` operator discards the promise result, meaning unhandled rejections from these calls are silently lost (the cache layer has its own try/catch, but `publishSocialEvent` in `src/lib/aws-clients.ts` also has its own -- so this is safe but fragile).

---

## 4. Auth Middleware Robustness

**File:** `src/middleware/auth.ts`

### Assessment: SOLID for the current stage

**Good:**
- JWKS caching (`cacheMaxAge: 3600000`) avoids hitting Cognito on every request
- Rate limiting on JWKS requests (`jwksRequestsPerMinute: 10`)
- Token expiry differentiated from invalid token in error messages
- `SKIP_AUTH` escape hatch for local dev with hardcoded `dev-user` identity

**Issues:**

**`SKIP_AUTH` has no environment guard.** Line 28: `if (process.env.SKIP_AUTH === 'true')`. If this env var leaks into production, all endpoints are unauthenticated as `dev-user`. There is no additional check like `process.env.NODE_ENV === 'development'`.

**`req.user!` non-null assertion used everywhere.** Every route handler accesses `req.user!.sub` with the `!` operator (e.g., `src/routes/profiles.ts` line 44, `src/routes/posts.ts` line 37). If `requireAuth` middleware is ever bypassed or fails silently, this will throw an unhandled runtime error rather than a clean 401.

**No token scope/audience validation.** `jwt.verify()` at line 47 checks `algorithms` and `issuer` but does not validate `aud` (audience) or `token_use` claims. In a multi-app Cognito setup, a token from a different app client would pass validation.

---

## 5. Cache Integration Quality

**Files:** `src/lib/cache.ts`, `src/lib/redis-client.ts`

### Assessment: WELL-DESIGNED read-through cache with graceful degradation

**Good:**
- Graceful fallback: if Redis is down, all operations return null/void and DynamoDB is hit directly
- Clear TTL strategy: profiles 5min, rooms 2min, groups 2min
- Cache-aside pattern correctly implemented: read cache -> miss -> read DB -> populate cache
- Invalidation on writes (e.g., `src/routes/profiles.ts` line 189: `void invalidateProfileCache(userId)`)
- Lazy connection: `getRedisClient()` connects on first call, not at import time

**Issues:**

**Duplicate Redis client instances.** `src/lib/redis-client.ts` creates one shared client for cache reads. `src/services/broadcast.ts` creates its own private Redis client with identical connection logic (lines 29-51). Two independent connection pools to the same Redis. The connection management code is duplicated line-for-line.

**No cache warming or batch invalidation.** When a group is deleted (`src/routes/groups.ts` line 194), only the group cache key is invalidated. Room and member data referencing that group remain stale for up to 2 minutes.

**Silent cache failures with no metrics.** Empty `catch {}` blocks in `src/lib/cache.ts` (lines 29, 39-41, 49-51) mean systematic Redis failures produce zero log output. At minimum, these should log at `warn` level.

---

## 6. Missing Validation on Inputs

### Assessment: PARTIAL -- basic presence/length checks exist, but type safety is weak

**What exists:**
- String length limits on displayName (50), bio (160), description (500), content (10000), room name (100)
- Enum validation on visibility (`public`/`private`)
- Self-action prevention (can't follow yourself, can't DM yourself)
- Emoji allowlist in `src/routes/reactions.ts` line 18

**What is missing:**

**No input sanitization.** String inputs are stored as-is. Content fields accept arbitrary HTML/script. If any frontend renders these without sanitization, XSS is possible. Files: all `req.body` destructuring across every route.

**No type coercion guards.** Body parsing relies on `as` type assertions without runtime validation:
```typescript
// src/routes/profiles.ts line 22
const { displayName, bio, avatarUrl, visibility } = req.body as {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  visibility?: string;
};
```
If `displayName` is sent as a number or object, the `.length` check still passes because JS coercion. No schema validation library (zod, joi, etc.) is used anywhere.

**No URL validation on `avatarUrl`.** `src/routes/profiles.ts` accepts any string for `avatarUrl` -- could be a `javascript:` URI or arbitrary content.

**Pagination cursor is user-supplied JSON.** `src/routes/posts.ts` lines 213-219 and `src/routes/activity.ts` lines 18-23 base64-decode user input and pass it directly as DynamoDB `ExclusiveStartKey`. A malicious cursor could potentially probe table structure or cause unexpected query behavior.

---

## 7. Scalability Assessment

### Assessment: WILL HIT WALLS at moderate scale

**DynamoDB Scan operations are the primary concern:**

| File | Line | Operation | Impact |
|------|------|-----------|--------|
| `src/routes/posts.ts` | 250 | `ScanCommand` on social-posts with `FilterExpression: 'authorId = :uid'` | Full table scan to find user's posts across rooms. Grows linearly with total posts. |
| `src/routes/social.ts` | 151 | `ScanCommand` on social-relationships with `FilterExpression: 'followeeId = :fid'` | Full table scan for followers list. Grows linearly with total relationships. |
| `src/routes/social.ts` | 222 | `ScanCommand` on social-relationships (followers for friends calc) | Same scan, called for every /friends request. |
| `src/routes/room-members.ts` | 220 | `ScanCommand` on social-room-members with `FilterExpression: 'userId = :uid'` | Full table scan for "my rooms." Called on every page load. |

**All four scans need GSIs.** The code comments acknowledge this (e.g., `src/routes/social.ts` line 146: `// NOTE: social-relationships has no GSI on followeeId; scan with FilterExpression`).

**BatchGetCommand has a 100-item limit.** `src/routes/likes.ts` line 177 and `src/routes/social.ts` line 32 use `BatchGetCommand` without chunking. If a user has >100 likes or >100 followers, the request will silently truncate results.

**No pagination on several list endpoints:**
- `GET /api/social/followers` -- returns all followers in one response
- `GET /api/social/following` -- returns all following in one response
- `GET /api/social/friends` -- returns all friends in one response
- `GET /api/rooms` -- returns all rooms in one response
- `GET /api/rooms/:roomId/posts/:postId/comments` -- returns all comments

**Non-atomic multi-step writes.** Room creation in `src/routes/rooms.ts` lines 148-170 writes the room item, then separately writes the member item. If the process crashes between these writes, an orphaned room exists with no owner member. The group creation in `src/routes/groups.ts` correctly uses `TransactWriteCommand` -- rooms should follow the same pattern.

---

## 8. TypeScript Strictness

### Assessment: STRICT mode enabled, but undermined by patterns

**tsconfig.json** at `social-api/tsconfig.json` has `"strict": true` which is good.

**However:**

**Pervasive `as` type assertions bypass type safety:**
```typescript
// Every DynamoDB response is force-cast:
const item = result.Item as ProfileItem;         // profiles.ts line 100
const group = groupResult.Item as GroupItem;     // groups.ts line 131
const rooms = (batchResult.Responses?.[ROOMS_TABLE] ?? []) as RoomItem[];  // room-members.ts line 241
```
DynamoDB returns `Record<string, AttributeValue>` -- the `as` casts are unchecked. If the DB schema drifts from the TypeScript interface, there is no runtime error.

**Non-null assertions (`!`) are used on `req.user`:** Every handler uses `req.user!.sub` without a null check. The auth middleware should guarantee this, but it is still a code smell at scale.

**No shared type definitions.** As noted in section 2, `RoomItem`, `RoomMemberItem`, `GroupItem`, and `GroupMemberItem` are each defined 2-3 times across different route files.

---

## 9. Summary of Priority Fixes

### High Priority (data correctness / security)

1. **Add GSIs for scan-dependent queries** -- `src/routes/posts.ts` (user posts), `src/routes/social.ts` (followers, friends), `src/routes/room-members.ts` (my rooms). These will cause timeouts and high DynamoDB costs at scale.

2. **Guard `SKIP_AUTH`** in `src/middleware/auth.ts` -- add `process.env.NODE_ENV !== 'production'` check.

3. **Add audience/token_use validation** to JWT verification in `src/middleware/auth.ts` line 47.

4. **Standardize event publishing** -- migrate all `publishSocialEvent()` calls to the transactional outbox pattern used by posts, reactions, and follows.

### Medium Priority (maintainability)

5. **Extract shared types** to `src/models/` -- eliminate 10+ duplicate interface definitions.

6. **Extract room membership middleware** -- a `requireRoomMember` Express middleware would eliminate ~50 lines of duplicated gate logic.

7. **Consolidate broadcast helper** -- wrap the "cache-or-fetch room channelId + emit" pattern into a single `broadcastToRoom()` function.

8. **Add input validation library** (zod recommended) -- replace `as` body type assertions with runtime schema validation.

### Low Priority (operational)

9. **Add warn-level logging to cache failures** in `src/lib/cache.ts` empty catch blocks.

10. **Chunk BatchGetCommand calls** to respect DynamoDB's 100-item limit in `src/routes/likes.ts` and `src/routes/social.ts`.

11. **Add pagination** to followers, following, friends, rooms, and comments endpoints.

12. **Consolidate Redis client** -- `src/services/broadcast.ts` should use `src/lib/redis-client.ts` instead of managing its own connection.

---

*Analysis complete: 2026-04-12*
