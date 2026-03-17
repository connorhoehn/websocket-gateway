# Phase 28: Rooms - Research

**Researched:** 2026-03-17
**Domain:** Express REST API, DynamoDB (social-rooms + social-room-members tables), mutual-friend guard, WebSocket channel ID mapping
**Confidence:** HIGH

## Summary

Phase 28 introduces three room flavors — standalone, group-scoped, and DM — each sharing a common `social-rooms` DynamoDB table keyed on `roomId`. Membership is persisted in `social-room-members` (PK=`roomId`, SK=`userId`). Every room record must carry a `channelId` field that the WebSocket gateway will use in Phase 31 to fan out real-time events.

The implementation follows the same pattern established across Phases 25-27: an Express Router exported from a dedicated route file, DynamoDB access via `DynamoDBDocumentClient`, Cognito `sub` as the user identity anchor, and the central `routes/index.ts` mounting the new routers. The only new logic is the mutual-friend guard for DM rooms (query `social-relationships` twice, just as `GET /friends` does in `social.ts`) and the group-admin check for group-scoped rooms (query `social-group-members` for caller's role, mirroring Phase 27 group logic).

ROOM-07 (persistent post history) is the one room requirement that does NOT need new code in Phase 28 — posts are stored in `social-posts` (PK=`roomId`), which Phase 29 owns. Phase 28 only needs to ensure the room record exists so Phase 29 can key off it. ROOM-04 (WebSocket channel ID on every room record) is satisfied by generating a `channelId = uuidv4()` at room creation time; no gateway integration is needed in this phase.

**Primary recommendation:** Model rooms as three route groups — (a) standalone/DM create in `rooms.ts`, (b) group-scoped create as a sub-route of `groups/:groupId/rooms`, and (c) membership operations (join, list members, list my rooms) in a dedicated `room-members.ts`. Mount both routers in `index.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ROOM-01 | User can create a standalone room with a name | `POST /api/rooms` — generate `roomId` + `channelId`, write to `social-rooms`, auto-add creator to `social-room-members` as `owner` |
| ROOM-02 | Group owner/admin can create rooms scoped within a group | `POST /api/groups/:groupId/rooms` — verify caller has `role=owner` or `role=admin` in `social-group-members` before creating room with `groupId` reference |
| ROOM-03 | Two mutual friends can open a DM room | `POST /api/rooms/dm` with `{targetUserId}` — mutual-friend guard (intersect followee/follower sets, same pattern as `GET /friends`); reject if not mutual friends |
| ROOM-04 | Room membership is persisted in DynamoDB keyed on Cognito `sub` | `social-room-members` table (PK=`roomId`, SK=`userId`) written on create and join |
| ROOM-05 | Each room maps to a WebSocket channel ID | `channelId = uuidv4()` stored on the `social-rooms` item at creation time; no gateway changes needed in Phase 28 |
| ROOM-06 | User can view the member list of a room they belong to | `GET /api/rooms/:roomId/members` — verify caller is a member, then `QueryCommand` on `social-room-members` |
| ROOM-07 | Room maintains persistent post history in DynamoDB | Satisfied structurally: `social-posts` table uses `roomId` as PK; Phase 28 just needs `roomId` to exist. No new code needed in this phase. |
| ROOM-08 | User can list all rooms they are a member of | `GET /api/rooms` — `ScanCommand` on `social-room-members` with `FilterExpression: 'userId = :uid'`, then enrich from `social-rooms`; or use a GSI if added |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^4.18.2 | HTTP router and middleware | Already in social-api |
| @aws-sdk/client-dynamodb | ^3.1010.0 | Low-level DynamoDB client | Already installed in social-api |
| @aws-sdk/lib-dynamodb | ^3.1010.0 | Document client (auto-marshalling) | Already installed; used in all existing routes |
| uuid | needs install | `roomId` and `channelId` generation | Phase 27 plans reference it; confirm install |
| @types/uuid | needs install | TypeScript types for uuid | Needed for tsc --noEmit to pass |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsonwebtoken / jwks-rsa | already installed | Cognito JWT auth | Already wired — no changes needed |

**Installation (uuid may not be present yet — Phase 27 plans reference it but execution status is unknown):**
```bash
cd /Users/connorhoehn/Projects/websocker_gateway/social-api
npm install uuid
npm install --save-dev @types/uuid
```

Verify before assuming: `ls social-api/node_modules/uuid 2>/dev/null || echo "uuid missing"`.

## Architecture Patterns

### Recommended Project Structure
```
social-api/src/routes/
├── rooms.ts              # standalone + DM room CRUD (ROOM-01, ROOM-03, ROOM-05)
├── group-rooms.ts        # group-scoped room creation (ROOM-02) — mounted at /groups/:groupId/rooms
├── room-members.ts       # membership: join, list members, list my rooms (ROOM-04, ROOM-06, ROOM-08)
├── groups.ts             # already exists (Phase 27)
├── group-members.ts      # already exists (Phase 27)
├── profiles.ts           # already exists (Phase 26)
├── social.ts             # already exists (Phase 26)
└── index.ts              # central mount point — add all three new routers
```

**Alternative (fewer files, same approach as Phase 27):** Combine standalone + DM into `rooms.ts` and group-scoped into the same file with conditional routing — still mount separately. The 3-plan roadmap for Phase 28 maps cleanly to:
- Plan 28-01: `rooms.ts` (ROOM-01, ROOM-03, ROOM-05) + `group-rooms.ts` (ROOM-02) — Room CRUD
- Plan 28-02: `room-members.ts` (ROOM-04, ROOM-06, ROOM-08) — membership endpoints
- Plan 28-03: Demo UI (if included — roadmap mentions 3 plans)

### DynamoDB Table Schemas (from lib/social-stack.ts — HIGH confidence)

```
social-rooms:
  partitionKey: roomId (STRING)
  (no sort key)
  BillingMode: PAY_PER_REQUEST
  RemovalPolicy: RETAIN

social-room-members:
  partitionKey: roomId (STRING)
  sortKey: userId (STRING)
  BillingMode: PAY_PER_REQUEST
  RemovalPolicy: RETAIN
```

**There is no GSI on `social-room-members.userId`** — listing all rooms a user belongs to (`ROOM-08`) requires a `ScanCommand` with `FilterExpression: 'userId = :uid'`, the same pattern used for `GET /followers` in `social.ts`. This is acceptable at prototype scale.

### Pattern 1: Room Item Shape

```typescript
// Source: derived from existing ProfileItem/GroupItem patterns in this codebase
interface RoomItem {
  roomId: string;           // uuid v4 — PK
  channelId: string;        // uuid v4 — WebSocket channel ID (ROOM-05)
  name: string;             // display name (max 100 chars)
  type: 'standalone' | 'group' | 'dm';  // room flavor
  ownerId: string;          // Cognito sub of creator
  groupId?: string;         // present only for type='group'
  dmPeerUserId?: string;    // present only for type='dm' (the other user's sub)
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
}
```

### Pattern 2: Room Member Item Shape

```typescript
// Source: mirrors GroupMemberItem from Phase 27 (group-members.ts)
interface RoomMemberItem {
  roomId: string;     // PK
  userId: string;     // SK — Cognito sub
  role: 'owner' | 'member';
  joinedAt: string;   // ISO 8601
}
```

### Pattern 3: Mutual-Friend Guard (DM rooms — ROOM-03)

Reuse the exact two-query pattern from `social.ts GET /friends`:

```typescript
// Source: social-api/src/routes/social.ts (verified in codebase)
// Step 1: get everyone caller follows
const followingResult = await docClient.send(new QueryCommand({
  TableName: 'social-relationships',
  KeyConditionExpression: 'followerId = :fid',
  ExpressionAttributeValues: { ':fid': callerId },
}));
const followeeSet = new Set(followingResult.Items?.map(i => i['followeeId'] as string) ?? []);

// Step 2: check if targetUserId follows caller (point query, not scan)
const reverseResult = await docClient.send(new GetCommand({
  TableName: 'social-relationships',
  Key: { followerId: targetUserId, followeeId: callerId },
}));
const targetFollowsCaller = !!reverseResult.Item;

// Mutual friend check
if (!followeeSet.has(targetUserId) || !targetFollowsCaller) {
  res.status(403).json({ error: 'DM rooms can only be created between mutual friends' });
  return;
}
```

**Optimization note:** The DM guard uses a point `GetCommand` for the reverse direction (O(1)) rather than scanning. This is more efficient than the full scan used in `GET /friends` and should be the pattern used here.

### Pattern 4: Group-Admin Guard (group-scoped rooms — ROOM-02)

Mirrors the invite permission check from Phase 27 `group-members.ts`:

```typescript
// Source: Phase 27 pattern (group-members.ts POST /invite)
const callerMember = await docClient.send(new GetCommand({
  TableName: 'social-group-members',
  Key: { groupId: req.params.groupId, userId: req.user!.sub },
}));
const callerRole = callerMember.Item?.['role'] as string | undefined;
if (!callerRole || (callerRole !== 'owner' && callerRole !== 'admin')) {
  res.status(403).json({ error: 'Only group owners and admins can create rooms' });
  return;
}
```

### Pattern 5: DM Deduplication

Two users should not be able to create multiple DM rooms with each other. Before creating a DM room, check if one already exists using a scan on `social-rooms`:

```typescript
const existing = await docClient.send(new ScanCommand({
  TableName: 'social-rooms',
  FilterExpression: '#t = :dm AND ((ownerId = :caller AND dmPeerUserId = :peer) OR (ownerId = :peer AND dmPeerUserId = :caller))',
  ExpressionAttributeNames: { '#t': 'type' },
  ExpressionAttributeValues: { ':dm': 'dm', ':caller': callerId, ':peer': targetUserId },
}));
if ((existing.Items?.length ?? 0) > 0) {
  res.status(409).json({ error: 'A DM room already exists between these two users', roomId: existing.Items![0]['roomId'] });
  return;
}
```

Note: `type` is a DynamoDB reserved word — use `ExpressionAttributeNames` to alias it.

### Pattern 6: Listing My Rooms (ROOM-08 — scan pattern)

No GSI exists on `social-room-members` for `userId`. Use scan + enrich, same as `GET /followers`:

```typescript
// Source: social.ts GET /followers pattern (verified in codebase)
const membershipScan = await docClient.send(new ScanCommand({
  TableName: 'social-room-members',
  FilterExpression: 'userId = :uid',
  ExpressionAttributeValues: { ':uid': req.user!.sub },
}));
const roomIds = (membershipScan.Items ?? []).map(i => i['roomId'] as string);
// Then BatchGetCommand on social-rooms for room details
```

### Pattern 7: Router Mount with mergeParams

Group-scoped rooms need access to `req.params.groupId` — use `mergeParams: true` exactly as Phase 27 does for `groupMembersRouter`:

```typescript
// Source: Phase 27 group-members.ts + index.ts pattern
export const groupRoomsRouter = Router({ mergeParams: true });
// in index.ts:
router.use('/groups/:groupId/rooms', groupRoomsRouter);
```

### Anti-Patterns to Avoid

- **Reusing `channelId = roomId`:** The channel ID and room ID serve different purposes (channel IDs are gateway routing tokens). Generate separate UUIDs for each. If they collide with existing WebSocket channels the gateway will misroute events.
- **Missing `type` field on room items:** Phase 29 (posts) and Phase 31 (real-time) will need to distinguish room flavors. Always store `type: 'standalone' | 'group' | 'dm'`.
- **Forgetting `ExpressionAttributeNames` for `type`:** `type` is a DynamoDB reserved word. Every expression that references the `type` attribute needs `ExpressionAttributeNames: { '#t': 'type' }`.
- **Allowing duplicate DM rooms:** Without a deduplication check, two users can accumulate multiple DM rooms, breaking the "one DM room per pair" invariant. Always check for an existing DM before creating.
- **Not auto-adding the creator to room-members:** Mirrors group creation pattern — on `POST /api/rooms`, write the creator to `social-room-members` as `role: 'owner'` in the same request.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom ID generator | `uuid` v4 | Collision risk; already used in Phase 27 |
| DynamoDB marshalling | Manual `{ S: 'value' }` format | `DynamoDBDocumentClient` | Already in every route file; handles JS/DynamoDB type conversion |
| Cognito JWT auth | Custom token parser | `requireAuth` middleware already in `app.ts` | Implemented and tested in Phase 25 |
| Mutual-friend check | Custom relationship DB schema | Query existing `social-relationships` table | Table is already deployed and populated |

**Key insight:** All infrastructure is in place from Phases 25-27. Phase 28 is pure application logic — new route files, new DynamoDB write patterns, and new business rules (mutual-friend guard, group-admin guard, DM dedup).

## Common Pitfalls

### Pitfall 1: `type` is a DynamoDB Reserved Word
**What goes wrong:** `FilterExpression: 'type = :t'` throws `ValidationException: Invalid FilterExpression: Attribute name is a reserved keyword; reserved keyword: type`.
**Why it happens:** DynamoDB reserves `type` as a keyword.
**How to avoid:** Always use `ExpressionAttributeNames: { '#t': 'type' }` and reference `#t` in expressions.
**Warning signs:** Runtime `ValidationException` when scanning/querying rooms by type.

### Pitfall 2: Phase 27 May Not Be Executed Yet
**What goes wrong:** Plan 28-02 references `social-group-members` to check group admin status. If Phase 27 hasn't run, `groups.ts` and `group-members.ts` don't exist, and `index.ts` is still the Phase 26 version (only profiles + social mounted).
**Why it happens:** Phase 27 plans are written but execution status is "Not started" per ROADMAP.md; `index.ts` confirmed to only mount profiles and social as of this research date.
**How to avoid:** Plans must account for Phase 27 completing first (`depends_on: [27-01, 27-02]`). Phase 28 plan 28-02 (group rooms) must read the current `index.ts` and add its mounts without assuming Phase 27 routers are already there.

### Pitfall 3: Forgetting `mergeParams: true` on Nested Routers
**What goes wrong:** `req.params.groupId` is `undefined` in `groupRoomsRouter` handlers even though it's in the URL path.
**Why it happens:** Express does not pass parent route params to child routers by default.
**How to avoid:** Always declare `Router({ mergeParams: true })` for any router mounted at a path with params (e.g., `/groups/:groupId/rooms`).
**Warning signs:** `req.params.groupId` is undefined at runtime; DynamoDB `GetCommand` receives `Key: { groupId: undefined }`.

### Pitfall 4: No GSI for ROOM-08 (List My Rooms)
**What goes wrong:** `QueryCommand` on `social-room-members` with a `userId` key condition fails — `userId` is only a sort key, not a partition key.
**Why it happens:** The table schema is `PK=roomId, SK=userId` — you can only query by `roomId`.
**How to avoid:** Use `ScanCommand` with `FilterExpression: 'userId = :uid'` — the same approach used for `GET /followers`. This is acceptable at prototype scale.
**Warning signs:** Attempting `KeyConditionExpression: 'userId = :uid'` throws `ValidationException`.

### Pitfall 5: Duplicate DM Room Creation
**What goes wrong:** Two users can each call `POST /api/rooms/dm` creating two separate DM rooms between them, breaking the one-per-pair invariant that Phase 31 depends on for routing.
**Why it happens:** No unique constraint exists in DynamoDB to enforce uniqueness on `(ownerId, dmPeerUserId)` pairs.
**How to avoid:** Before creating a DM room, scan `social-rooms` for an existing DM between the two users (checking both orderings of `ownerId`/`dmPeerUserId`). Return 409 if one exists.

### Pitfall 6: uuid Package May Not Be Installed
**What goes wrong:** `import { v4 as uuidv4 } from 'uuid'` causes TypeScript compile error or runtime `MODULE_NOT_FOUND`.
**Why it happens:** `uuid` is referenced in Phase 27 plans but may not have been installed (Phase 27 execution status is unconfirmed).
**How to avoid:** Check `ls social-api/node_modules/uuid` before assuming it's available. Install with `npm install uuid && npm install --save-dev @types/uuid` if absent.

## Code Examples

### Room Creation (Standalone)
```typescript
// Source: derived from GroupItem pattern in Phase 27 groups.ts plan
import { v4 as uuidv4 } from 'uuid';

const roomId = uuidv4();
const channelId = uuidv4();   // separate ID — do not reuse roomId
const now = new Date().toISOString();

await docClient.send(new PutCommand({
  TableName: 'social-rooms',
  Item: {
    roomId,
    channelId,
    name: req.body.name,
    type: 'standalone',
    ownerId: req.user!.sub,
    createdAt: now,
    updatedAt: now,
  },
}));

// Auto-add creator as owner member
await docClient.send(new PutCommand({
  TableName: 'social-room-members',
  Item: {
    roomId,
    userId: req.user!.sub,
    role: 'owner',
    joinedAt: now,
  },
}));

res.status(201).json({ roomId, channelId, name, type: 'standalone', role: 'owner' });
```

### DynamoDB Client Setup (consistent with all existing routes)
```typescript
// Source: social-api/src/routes/profiles.ts, social.ts, groups.ts pattern
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddb);
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';
```

### Central Router Mount (final index.ts after Phase 28)
```typescript
// Source: pattern from social-api/src/routes/index.ts (current) + Phase 27 additions
import { Router } from 'express';
import { profilesRouter } from './profiles';
import { socialRouter } from './social';
import { groupsRouter } from './groups';              // Phase 27
import { groupMembersRouter } from './group-members'; // Phase 27
import { roomsRouter } from './rooms';                // Phase 28
import { groupRoomsRouter } from './group-rooms';     // Phase 28
import { roomMembersRouter } from './room-members';   // Phase 28

const router = Router();

router.use('/profiles', profilesRouter);
router.use('/social', socialRouter);
router.use('/groups', groupsRouter);
router.use('/groups/:groupId', groupMembersRouter);
router.use('/groups/:groupId/rooms', groupRoomsRouter);  // mergeParams: true
router.use('/rooms', roomsRouter);
router.use('/rooms/:roomId', roomMembersRouter);          // mergeParams: true

export default router;
```

### Standard Error Handling (every handler)
```typescript
// Source: every route file in social-api (profiles.ts, social.ts, groups.ts plans)
async (req: Request, res: Response): Promise<void> => {
  try {
    // handler logic
  } catch (err) {
    console.error('[rooms] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual DynamoDB type notation (`{ S: 'val' }`) | `DynamoDBDocumentClient` auto-marshalling | Phase 26 decision | Simpler code; already in all routes |
| Single monolithic routes file | One file per feature domain | Phase 26+ | Clean separation; each plan owns one file |

**Note on Phase 27 execution state:** As of this research, `social-api/src/routes/index.ts` only mounts `profilesRouter` and `socialRouter`. Phase 27 plans (`groups.ts`, `group-members.ts`) have been written but not executed. Phase 28 plans must account for Phase 27 completing first — plan authors should not assume `groups.ts` exists when writing Phase 28-01 unless Phase 27 has been completed.

## Open Questions

1. **Where does the group-scoped room router live — in `rooms.ts` or `group-rooms.ts`?**
   - What we know: Both options work; Phase 27 precedent splits by concern (groups.ts vs group-members.ts)
   - What's unclear: Whether planner prefers co-locating or splitting based on the 3-plan count
   - Recommendation: Use a separate `group-rooms.ts` (mirroring the groups/group-members split) so each plan file maps 1:1 to a route file

2. **Should `ROOM-07` (post history) require any work in Phase 28?**
   - What we know: `social-posts` table uses `roomId` as PK; Phase 29 owns post creation
   - What's unclear: Whether Phase 28 should add any structural note or stub
   - Recommendation: ROOM-07 is satisfied structurally — `social-posts` already uses `roomId` as PK. No Phase 28 action needed; flag as "satisfied by existing table schema + Phase 29"

3. **Third plan in Phase 28 — what does it cover?**
   - What we know: Roadmap says 3 plans; listed plans are 28-01 (Room CRUD), 28-02 (Membership + WS channel mapping)
   - What's unclear: Whether there's a third plan or the roadmap count is aspirational
   - Recommendation: Third plan is likely a Demo UI (following Phase 26's pattern of a `26-03` demo plan). Planner should confirm with user or leave as TBD

## Sources

### Primary (HIGH confidence)
- `/Users/connorhoehn/Projects/websocker_gateway/lib/social-stack.ts` — DynamoDB table schemas (roomId PK, userId SK, no GSIs)
- `/Users/connorhoehn/Projects/websocker_gateway/social-api/src/routes/social.ts` — mutual-friend query pattern, BatchGetCommand enrich pattern, scan-based follower lookup
- `/Users/connorhoehn/Projects/websocker_gateway/social-api/src/routes/profiles.ts` — DynamoDB client setup, error handling, validation patterns
- `/Users/connorhoehn/Projects/websocker_gateway/social-api/package.json` — confirmed dependencies (uuid NOT present, must install)
- `.planning/phases/27-groups/27-01-PLAN.md`, `27-02-PLAN.md` — group admin guard pattern, mergeParams pattern, GroupMemberItem shape

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` — Phase 28 success criteria and plan breakdown
- `.planning/REQUIREMENTS.md` — ROOM-01 through ROOM-08 definitions
- `.planning/STATE.md` — confirmed Phase 27 is "Not started"; index.ts is still Phase 26 state

### Tertiary (LOW confidence)
- None — all findings verified directly from source files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json; uuid absence confirmed
- Architecture: HIGH — table schemas from CDK source; patterns from executed Phase 26 code
- Pitfalls: HIGH — `type` reserved word and GSI absence verified from CDK stack definition; Phase 27 execution state confirmed from index.ts and STATE.md
- DM mutual-friend guard: HIGH — exact pattern verified in social.ts source

**Research date:** 2026-03-17
**Valid until:** Until Phase 27 executes (may change index.ts state) — within current session
