# Post-Fix Audit — Gaps & Recommendations

> Synthesized from 6 parallel audit agents covering CDK, server runtime, frontend, social-api, deployment, and end-to-end multi-tab flows.
> Generated: 2026-04-11

---

## Executive Summary

The core architecture is sound but **not yet deployable to AWS**. The shared Redis ECS service fixes the fundamental pub/sub issue, but several supporting pieces are missing: Lambda definitions, DynamoDB tables, social-api deployment, and some server runtime bugs. Frontend is clean (0 TS/ESLint errors) but has robustness gaps in error handling.

**Total issues found: 48** (8 critical, 10 high, 18 medium, 12 low)

---

## CRITICAL — Must fix before any deployment

### 1. Missing DynamoDB tables in CDK
**Where:** `lib/social-stack.ts`
**What:** `social-outbox` and `user-activity` tables are referenced by app code but never created by CDK. Only exist in LocalStack bootstrap script.
**Impact:** TransactWrite operations fail in production. Activity log pipeline broken.
**Fix:** Add both tables to SocialStack with proper schemas and GSIs.

### 2. No Lambda functions defined in CDK
**Where:** `lib/event-bus-stack.ts`, `bin/websocker_gateway.ts`
**What:** Three Lambdas exist in code (`activity-log`, `crdt-snapshot`, `outbox-relay`) but have no CDK definitions. No event source mappings from SQS to Lambda.
**Impact:** Events route to SQS but are never consumed. Outbox pattern and activity pipeline don't execute.
**Fix:** Define Lambda functions in CDK with SQS event source mappings.

### 3. social-api not deployed in CDK
**Where:** `lib/websocket-gateway-stack.ts`
**What:** Social API Express service exists only in docker-compose. No ECS Fargate service, task definition, or ALB target in CDK.
**Impact:** Social features (posts, comments, likes, rooms, groups) completely unavailable in AWS.
**Fix:** Create social-api Fargate service in CDK, register with CloudMap, add ALB path-based routing or separate ALB.

### 4. MessageRouter missing validator/rateLimiter initialization
**Where:** `src/core/message-router.js:205-219`
**What:** `this.validator` and `this.rateLimiter` used but never instantiated in constructor.
**Impact:** Server crashes with TypeError on first client message.
**Fix:** Add `this.validator = new MessageValidator()` and `this.rateLimiter = new RateLimiter(...)` to constructor.

### 5. Unhandled async in WebSocket close/error handlers
**Where:** `src/server.js:476, 484`
**What:** `handleClientDisconnect()` is async but not awaited in close/error handlers.
**Impact:** Cleanup may not complete — leaked client refs, orphaned subscriptions.
**Fix:** Await the call or add `.catch()` error handling.

### 6. Incomplete DynamoDB IAM permissions
**Where:** `lib/task-definition.ts:29-47`
**What:** Task role only has PutItem/GetItem/Query on `crdt-snapshots`. Missing: Scan, BatchGetItem, UpdateItem, DeleteItem. Missing permissions for all `social-*` tables.
**Impact:** Most social API operations fail with permission denied.
**Fix:** Add full CRUD permissions for all social tables.

### 7. Missing cross-stack references
**Where:** `lib/websocket-gateway-stack.ts`, `lib/event-bus-stack.ts`
**What:** Three CDK stacks created independently with no exports or cross-references. SQS queue URLs, EventBus name never passed to task definitions.
**Impact:** App can't connect to event bus or SQS without hardcoding.
**Fix:** Export queue URLs and event bus name from EventBusStack, import in WebsocketGatewayStack.

### 8. docker-compose.yml references non-existent `core-redis`
**Where:** `docker-compose.yml`, `config/local-dev.env`, `config/full-service.env`
**What:** Main compose file and config files reference `core-redis` service that doesn't exist.
**Impact:** `docker compose up` and `make dev` fail immediately.
**Fix:** Delete `docker-compose.yml` or add Redis service. Update config files.

---

## HIGH — Should fix before multi-tab testing

### 9. Health endpoint always returns 200
**Where:** `src/server.js:626-641`
**What:** Returns HTTP 200 even when Redis is disconnected.
**Fix:** Return 503 when Redis unavailable.

### 10. Connection counter double-decrement
**Where:** `src/server.js:474, 482, 591`
**What:** Both close and error handlers call `handleClientDisconnect()`. Can double-decrement.
**Fix:** Add guard flag to ensure single invocation per connection.

### 11. Missing service handleDisconnect methods
**Where:** `src/services/crdt-service.js`, `cursor-service.js`, `chat-service.js`
**What:** No cleanup on client disconnect — memory leak of stale state.
**Fix:** Add `handleDisconnect()` to each service.

### 12. social-api has no CORS middleware
**Where:** `social-api/src/app.ts:9`
**What:** No CORS headers. Frontend requests from different origin will be blocked.
**Fix:** Add `cors` middleware. (Less critical if served from same ALB.)

### 13. Frontend missing `res.ok` checks before `.json()`
**Where:** All social hooks (useFriends.ts, useLikes.ts, etc.)
**What:** Promise.all chains call `.json()` without checking response status. HTML error pages crash `.json()`.
**Fix:** Add `if (!res.ok) throw` before `.json()` in all fetch chains.

### 14. Missing AbortController in all fetch effects
**Where:** All social hooks
**What:** No abort signal — unmounted components try to setState from stale responses.
**Fix:** Create AbortController per effect, pass signal to fetch, abort in cleanup.

### 15. Duplicate user in presence list
**Where:** Frontend `usePresence.ts` + backend `presence-service.js`
**What:** Each tab gets its own clientId. Same user appears multiple times.
**Fix:** Deduplicate by userId/email in PresencePanel display, or consolidate server-side.

### 16. Hardcoded AWS account IDs in CDK
**Where:** `lib/task-definition.ts:78`, `lib/websocket-gateway-stack.ts:54`
**What:** ECR image URIs hardcode `264161986065`.
**Fix:** Use `Stack.of(scope).account` and `.region` dynamically.

### 17. Missing public/ directory validation
**Where:** `src/server.js:260`
**What:** Static file server assumes `public/` exists. No startup check.
**Fix:** Validate directory exists in `setupHttpServer()`.

### 18. CRDT observer cleanup incomplete
**Where:** `frontend/src/hooks/useCRDT.ts`
**What:** Y.Doc `afterTransaction` handlers not explicitly unregistered on channel change.
**Fix:** Track handler ref and call `ydoc.off()` in cleanup.

---

## MEDIUM — Fix for production readiness

| # | Issue | Where |
|---|-------|-------|
| 19 | Scan operations without pagination limits | social-api routes (social.ts, room-members.ts) |
| 20 | CORS configured but never applied in server.js | src/server.js:82 |
| 21 | Reconnection session restoration race condition | reconnection-handler.js:40-74 |
| 22 | No error display for social API failures in UI | PostFeed, RoomList, CommentThread |
| 23 | CRDT channel unsubscribe uses stale closure | useCRDT.ts cleanup function |
| 24 | usePresence typing timeout not cleared on unmount | usePresence.ts:150 |
| 25 | Token refresh doesn't reconnect during 'reconnecting' state | useWebSocket.ts + App.tsx |
| 26 | No 401/403 handling in social API calls | All social hooks |
| 27 | social-api Redis endpoint defaults to 'redis' not 'redis.ws.local' | broadcast.ts:16 |
| 28 | No global error handler in social-api Express | social-api/src/app.ts |
| 29 | Service validator whitelist hardcoded vs ENABLED_SERVICES | message-validator.js |
| 30 | No request logging/tracing in social-api | social-api/src/app.ts |
| 31 | EventBridge permission too broad (`*` resource) | task-definition.ts:35 |
| 32 | Missing env validation at social-api startup | social-api/src/index.ts |
| 33 | Comment form has no submission loading state | CommentThread.tsx |
| 34 | Paginated posts loader only shows when list empty | usePosts.ts / PostFeed.tsx |
| 35 | Auth BroadcastChannel race condition on unmount | useAuth.ts:183-204 |
| 36 | CRDT snapshot/update ordering not validated client-side | useCRDT.ts |

---

## LOW — Nice-to-have improvements

| # | Issue | Where |
|---|-------|-------|
| 37 | CloudMap DNS TTL too aggressive (10s) | websocket-gateway-stack.ts:92 |
| 38 | WebSocket ping interval not configurable | server.js:440 |
| 39 | Service stats endpoint missing safe fallbacks | server.js:654 |
| 40 | Case-sensitive path check in static server | server.js:285 |
| 41 | Redis health listener timing gap | message-router.js:395 |
| 42 | No Redis operation timeouts in rate limiter | message-router.js:216 |
| 43 | Mutable Map in usePresence state | usePresence.ts:46 |
| 44 | No startup Redis connectivity check in social-api | broadcast.ts |
| 45 | Stale .env.real timestamp | Root directory |
| 46 | Inconsistent Redis hostnames across configs | Multiple files |
| 47 | IvsChatStack and RepositoryStack not instantiated | bin/websocker_gateway.ts |
| 48 | No integration tests for multi-tab scenarios | Test gap |

---

## Recommended Fix Order

### Phase A: Make it deployable (Critical #1-8)
1. Add missing DynamoDB tables to SocialStack
2. Define Lambda functions in CDK with SQS event source mappings
3. Add social-api Fargate service to CDK
4. Fix cross-stack references (export queue URLs, event bus name)
5. Fix MessageRouter constructor (validator + rate limiter init)
6. Fix async disconnect handlers in server.js
7. Add full DynamoDB IAM permissions
8. Fix docker-compose.yml / config files

### Phase B: Make it robust (High #9-18)
1. Fix health endpoint to return 503 when unhealthy
2. Fix connection counter double-decrement
3. Add handleDisconnect to all services
4. Add CORS to social-api
5. Add res.ok checks + AbortController to frontend fetches
6. Deduplicate presence by user
7. Remove hardcoded account IDs
8. Validate public/ directory at startup
9. Fix CRDT observer cleanup

### Phase C: Polish for production (Medium #19-36)
- Scan pagination, error display, stale closures, token handling, request logging

### Phase D: Optimization (Low #37-48)
- DNS TTL, ping interval, integration tests
