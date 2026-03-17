---
phase: 29-posts-comments
verified: 2026-03-17T18:10:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
---

# Phase 29: Posts and Comments Verification Report

**Phase Goal:** Users can create, edit, delete, and read text posts in rooms, and hold threaded comment conversations on those posts
**Verified:** 2026-03-17T18:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                          | Status     | Evidence                                                                                              |
|----|-----------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------|
| 1  | A room member can create a text post in a room and receive 201 with a postId                  | VERIFIED   | `postsRouter.post('/')` checks membership, calls `ulid()`, PutCommand, returns `res.status(201).json({..., postId})` |
| 2  | A non-member attempting to create a post in a room is rejected with 403                       | VERIFIED   | GetCommand on ROOM_MEMBERS_TABLE; `if (!membership.Item)` → `res.status(403)`                        |
| 3  | The post author can edit their own post body and receive 200 with the updated content         | VERIFIED   | `postsRouter.put('/:postId')` fetches post, checks `authorId === callerId`, UpdateCommand, returns 200 |
| 4  | A non-author attempting to edit a post is rejected with 403                                   | VERIFIED   | `if (result.Item['authorId'] !== callerId)` → `res.status(403)` in PUT handler                       |
| 5  | The post author can delete their own post and receive 204                                     | VERIFIED   | `postsRouter.delete('/:postId')` checks ownership, DeleteCommand, returns `res.status(204).send()`   |
| 6  | A non-author attempting to delete a post is rejected with 403                                 | VERIFIED   | `if (result.Item['authorId'] !== callerId)` → `res.status(403)` in DELETE handler                    |
| 7  | GET /rooms/:roomId/posts returns posts sorted newest-first with pagination cursor support     | VERIFIED   | QueryCommand with `ScanIndexForward: false`, `Limit`, `ExclusiveStartKey` from base64 cursor; `nextCursor` in response |
| 8  | GET /posts?userId=:uid returns all posts authored by that user                                | VERIFIED   | ScanCommand with `FilterExpression: 'authorId = :uid'`, client-side ULID localeCompare sort          |
| 9  | A room member can comment on a post in that room and receive 201 with a commentId             | VERIFIED   | `commentsRouter.post('/')` checks membership, verifies post exists, `ulid()`, PutCommand, returns 201 |
| 10 | A room member can reply to an existing comment (setting parentCommentId) and receive 201      | VERIFIED   | POST handler accepts `parentCommentId` in body, validates parent exists via GetCommand, stores field conditionally |
| 11 | The comment author can delete their own comment and receive 204                               | VERIFIED   | `commentsRouter.delete('/:commentId')` fetches comment, checks ownership, DeleteCommand, returns 204  |
| 12 | A non-author attempting to delete a comment is rejected with 403                              | VERIFIED   | `if (result.Item['authorId'] !== callerId)` → `res.status(403)` in DELETE handler                    |
| 13 | GET /rooms/:roomId/posts/:postId/comments returns all comments for a post as a flat array     | VERIFIED   | QueryCommand `KeyConditionExpression: 'postId = :pid'`, `ScanIndexForward: false`, returns `{ comments }` |
| 14 | All new Phase 29 routers are mounted in index.ts and reachable under /api                    | VERIFIED   | index.ts lines 22-24: postsRouter at `/rooms/:roomId/posts`, userPostsRouter at `/posts`, commentsRouter at `/rooms/:roomId/posts/:postId/comments` |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact                                    | Expected                                            | Status     | Details                                                             |
|---------------------------------------------|-----------------------------------------------------|------------|---------------------------------------------------------------------|
| `social-api/src/routes/posts.ts`            | postsRouter (mergeParams:true) and userPostsRouter  | VERIFIED   | Both exported; 222 lines; 5 real route handlers                     |
| `social-api/src/routes/posts.ts`            | ULID-based postId via `ulid()`                      | VERIFIED   | Line 1: `import { ulid } from 'ulid'`; line 53: `const postId = ulid()` |
| `social-api/src/routes/posts.ts`            | `POSTS_TABLE = 'social-posts'`                      | VERIFIED   | Line 16 confirmed                                                   |
| `social-api/src/routes/comments.ts`         | commentsRouter (mergeParams:true) for threaded CRUD | VERIFIED   | Exported; 173 lines; 3 real route handlers                          |
| `social-api/src/routes/comments.ts`         | `COMMENTS_TABLE = 'social-comments'`                | VERIFIED   | Line 14 confirmed                                                   |
| `social-api/src/routes/index.ts`            | Mounts postsRouter, userPostsRouter, commentsRouter | VERIFIED   | Lines 9-10 imports; lines 22-24 mounts; 11 total router.use() calls |
| `social-api/package.json`                   | ulid in dependencies                                | VERIFIED   | `"ulid": "^3.0.2"` present                                          |

---

### Key Link Verification

| From                                              | To                                    | Via                                            | Status   | Details                                                                  |
|---------------------------------------------------|---------------------------------------|------------------------------------------------|----------|--------------------------------------------------------------------------|
| POST /api/rooms/:roomId/posts                     | social-room-members GetCommand        | membership gate before PutCommand              | WIRED    | posts.ts lines 44-51: GetCommand on ROOM_MEMBERS_TABLE; 403 if no Item  |
| GET /api/rooms/:roomId/posts                      | social-posts QueryCommand             | ScanIndexForward: false + Limit + ExclusiveStartKey | WIRED | posts.ts line 182: `ScanIndexForward: false`; lines 183-184 Limit+cursor |
| GET /api/posts                                    | social-posts ScanCommand              | FilterExpression authorId = :uid               | WIRED    | posts.ts line 209: `FilterExpression: 'authorId = :uid'`                |
| POST /api/rooms/:roomId/posts/:postId/comments    | social-room-members GetCommand        | membership gate before PutCommand              | WIRED    | comments.ts lines 46-53: GetCommand on ROOM_MEMBERS_TABLE; 403 if no Item |
| GET /api/rooms/:roomId/posts/:postId/comments     | social-comments QueryCommand          | KeyConditionExpression postId = :pid           | WIRED    | comments.ts line 129: `KeyConditionExpression: 'postId = :pid'`         |
| commentsRouter                                    | index.ts                              | router.use('/rooms/:roomId/posts/:postId/comments', commentsRouter) | WIRED | index.ts line 24 confirmed |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                     | Status    | Evidence                                                              |
|-------------|-------------|-------------------------------------------------|-----------|-----------------------------------------------------------------------|
| CONT-01     | 29-01       | User can create a text post in a room           | SATISFIED | POST /rooms/:roomId/posts with membership gate, 201 + postId (ULID)  |
| CONT-02     | 29-01       | User can edit their own post                    | SATISFIED | PUT /rooms/:roomId/posts/:postId with ownership gate, 200 + updated content |
| CONT-03     | 29-01       | User can delete their own post                  | SATISFIED | DELETE /rooms/:roomId/posts/:postId with ownership gate, 204         |
| CONT-04     | 29-01       | User can view a paginated post feed for a room  | SATISFIED | GET /rooms/:roomId/posts with ScanIndexForward:false, base64 cursor pagination |
| CONT-05     | 29-01       | User can view all posts by a specific user      | SATISFIED | GET /posts?userId= with ScanCommand FilterExpression + ULID sort     |
| CONT-06     | 29-02       | User can comment on a post                      | SATISFIED | POST /rooms/:roomId/posts/:postId/comments (omit parentCommentId), 201 |
| CONT-07     | 29-02       | User can reply to an existing comment (threaded)| SATISFIED | POST same endpoint with `parentCommentId` in body; parent validated via GetCommand |
| CONT-08     | 29-02       | User can delete their own comment               | SATISFIED | DELETE /rooms/:roomId/posts/:postId/comments/:commentId with ownership gate, 204 |

All 8 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, no empty implementations, no stub return values in either posts.ts or comments.ts.

---

### Human Verification Required

#### 1. DynamoDB Table Schema Compatibility

**Test:** With live DynamoDB, confirm that `social-posts` has `roomId` as partition key and `postId` (ULID) as sort key, and that `social-comments` has `postId` as partition key and `commentId` (ULID) as sort key.
**Expected:** Queries using `KeyConditionExpression: 'roomId = :rid'` and `KeyConditionExpression: 'postId = :pid'` succeed without ValidationException.
**Why human:** Table schema is infrastructure configuration outside the codebase; cannot verify key definitions from source files alone.

#### 2. Pagination cursor round-trip

**Test:** Call GET /api/rooms/:roomId/posts with `?limit=2` on a room with 3+ posts. Take `nextCursor` from the first response and pass it as `?cursor=` in a second request.
**Expected:** Second page returns the remaining posts with no duplicates and a null `nextCursor` (or another cursor if more pages remain).
**Why human:** DynamoDB cursor mechanics depend on live table state; cannot verify correctness without a running instance.

#### 3. Reply threading in GET /comments response

**Test:** Create a post, create a top-level comment, create a reply with `parentCommentId` set to the top-level commentId, then call GET /rooms/:roomId/posts/:postId/comments.
**Expected:** Both comments appear in the flat array; the reply has `parentCommentId` populated; the top-level comment has no `parentCommentId` field.
**Why human:** Flat array shape and absent-vs-null field behavior require a live request to confirm.

---

### Gaps Summary

No gaps. All 14 observable truths are verified, all artifacts exist and are substantive (real implementations), all key links are wired, all 8 requirements are satisfied, and TypeScript compiles with zero errors (`npx tsc --noEmit` exits 0).

The three human verification items are DynamoDB infrastructure checks and live request behaviors — they do not block goal achievement from a code perspective.

---

### Commit Verification

All commits documented in SUMMARYs confirmed present in `git log`:

| Commit   | Description                                              | Verified |
|----------|----------------------------------------------------------|----------|
| `15796e1`| feat(29-01): create posts.ts with post CRUD              | Yes      |
| `de1a65a`| feat(29-01): mount postsRouter and userPostsRouter       | Yes      |
| `fe92146`| feat(29-02): create comments.ts with threaded CRUD       | Yes      |
| `d58354f`| feat(29-02): mount commentsRouter in index.ts            | Yes      |

---

_Verified: 2026-03-17T18:10:00Z_
_Verifier: Claude (gsd-verifier)_
