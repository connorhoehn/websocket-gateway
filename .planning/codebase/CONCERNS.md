# Codebase Concerns

**Analysis Date:** 2026-04-12

## Tech Debt

**crdt-service.js is a 1,943-line monolith:**
- Issue: Single file handles CRDT sync, document CRUD, version history, snapshots, presence tracking, DynamoDB operations, EventBridge publishing, awareness batching, and idle eviction. This is 3-4x larger than any other service.
- Files: `src/services/crdt-service.js`
- Impact: Extremely difficult to test, review, or modify safely. Any change risks breaking unrelated CRDT functionality. New contributors cannot reason about this file.
- Fix approach: Extract into separate modules: `crdt-snapshot-manager.js`, `crdt-document-store.js`, `crdt-presence-tracker.js`, `crdt-awareness-handler.js`. The core `crdt-service.js` should only handle action routing and channel subscription.

**Duplicate validateMetadata function across services:**
- Issue: Identical `validateMetadata()` function is copy-pasted in `src/services/chat-service.js` (line 14) and `src/services/presence-service.js` (line 14).
- Files: `src/services/chat-service.js`, `src/services/presence-service.js`
- Impact: Bug fixes must be applied in multiple places. Easy to miss one.
- Fix approach: Extract to `src/validators/metadata-validator.js` and import in both services.

**Dead code - websocket-manager.js:**
- Issue: `src/core/websocket-manager.js` (218 lines) is never imported or used anywhere. It duplicates functionality already in `message-router.js`. Uses `console.log` instead of the structured Logger.
- Files: `src/core/websocket-manager.js`
- Impact: Confusing for new developers. Could be accidentally imported instead of the correct module.
- Fix approach: Delete the file entirely.

**Duplicate SIGTERM/SIGINT handlers - 3 competing registrations:**
- Issue: Signal handlers for SIGTERM/SIGINT are registered in three places: `src/server.js` (lines 830-839), `src/core/node-manager.js` `setupGracefulShutdown()` (lines 472-494), and `src/services/crdt-service.js` `_registerShutdownHandlers()` (lines 184-206). All three call `process.exit()` or expect to run cleanup. Only one handler wins the race.
- Files: `src/server.js`, `src/core/node-manager.js`, `src/services/crdt-service.js`
- Impact: Non-deterministic shutdown order. CRDT snapshots may not flush if `server.js` handler runs first and exits before the CRDT handler. The `node-manager.js` handler also calls `process.exit(0)` independently.
- Fix approach: Centralize shutdown in `server.js` only. Remove signal handlers from `node-manager.js` and `crdt-service.js`. Instead, use the existing `service.shutdown()` lifecycle and `nodeManager.addShutdownHandler()` pattern consistently.

**`uncaughtException` / `unhandledRejection` handlers also duplicated:**
- Issue: Both `src/server.js` (lines 842-849) and `src/core/node-manager.js` (lines 484-494) register global exception handlers.
- Files: `src/server.js`, `src/core/node-manager.js`
- Impact: Double-logging, unpredictable cleanup order on crash.
- Fix approach: Remove from `node-manager.js`; let `server.js` be the single owner.

## Known Bugs

**Chat service disconnect handler name mismatch:**
- Symptoms: `server.js` calls `service.handleDisconnect(clientId)` (line 618), but `ChatService` only defines `onClientDisconnect(clientId)` (line 362), not `handleDisconnect`. The disconnect handler is never called for chat.
- Files: `src/services/chat-service.js` (line 362), `src/server.js` (line 618)
- Trigger: Any client disconnect while subscribed to chat channels.
- Workaround: Message router's `unregisterLocalClient` handles Redis cleanup, but local `clientChannels` Map in ChatService leaks entries forever.

**Cursor service disconnect handler also missing:**
- Symptoms: Same issue as chat. `CursorService` defines `onClientDisconnect` (line 437) but not `handleDisconnect`. The `cursorUpdateThrottle` Map, `clientCursors` Map, and `channelCursors` Map leak entries on every disconnect.
- Files: `src/services/cursor-service.js` (lines 433-445), `src/server.js` (line 618)
- Trigger: Any client disconnect while using cursor tracking.
- Workaround: Stale cursor cleanup timer (every 10s) catches some entries, but throttle map entries accumulate indefinitely.

**Session service LRU TTL configured before `this.sessionTTL` is set:**
- Symptoms: `this.localSessionStore` is constructed with `ttl: this.sessionTTL * 1000` on line 20, but `this.sessionTTL` is set on line 22. At construction time, `this.sessionTTL` is `undefined`, so TTL is `NaN`.
- Files: `src/services/session-service.js` (lines 19-22)
- Trigger: Every session creation. LRU cache items may never expire or expire immediately depending on `lru-cache` handling of NaN TTL.
- Workaround: Sessions are also stored in Redis with correct TTL. The local cache is a fallback only.

**Rate limiter fails open when Redis is down:**
- Symptoms: When Redis is unavailable, `checkLimit()` catches the error and returns `{ allowed: true }` (line 69). ALL rate limiting is disabled during Redis outages.
- Files: `src/middleware/rate-limiter.js` (line 69)
- Trigger: Redis connection failure.
- Workaround: None. An attacker who can cause Redis to disconnect from one node gets unlimited message throughput.

## Security Considerations

**SKIP_AUTH bypass in production risk:**
- Risk: Setting `SKIP_AUTH=true` completely disables authentication, grants `isAdmin: true` to all connections, and allows arbitrary `userId` via query parameter. If this env var leaks into a production deployment, all authorization is bypassed.
- Files: `src/middleware/auth-middleware.js` (lines 71-80)
- Current mitigation: Relies on deployment configuration to not set this variable.
- Recommendations: Add a guard that refuses to start with `SKIP_AUTH=true` when `NODE_ENV=production`. Log a prominent warning at startup when SKIP_AUTH is enabled.

**JWT token passed in URL query parameter:**
- Risk: WebSocket connections pass the JWT via `?token=<jwt>` (line 86 of auth-middleware.js). URL parameters are logged by proxies, CDNs, and load balancers. Tokens appear in server access logs and browser history.
- Files: `src/middleware/auth-middleware.js` (line 86)
- Current mitigation: None.
- Recommendations: This is a known WebSocket limitation (no custom headers during upgrade). Document the risk. Ensure short-lived tokens. Consider using a one-time exchange token pattern.

**Unauthenticated health, cluster, and stats endpoints:**
- Risk: `/health`, `/cluster`, and `/stats` endpoints expose internal state (node IDs, memory usage, connection counts, channel distribution, per-service metrics) to any HTTP request with no authentication.
- Files: `src/server.js` (lines 264-269, methods at lines 639-681)
- Current mitigation: None.
- Recommendations: Restrict `/cluster` and `/stats` to internal networks or require an API key. `/health` can remain open for load balancer probes but should return minimal info externally.

**No origin validation on WebSocket upgrade:**
- Risk: `ALLOWED_ORIGINS` defaults to `['*']` (line 85) and is never checked during the HTTP upgrade handler. The variable is defined but never used in the upgrade path.
- Files: `src/server.js` (lines 83-85, 345-392)
- Current mitigation: None. Any origin can establish WebSocket connections.
- Recommendations: Check the `Origin` header during upgrade against `this.allowedOrigins`.

**Channel authorization only enforced on some services:**
- Risk: `chat-service.js`, `cursor-service.js`, `reaction-service.js`, and `presence-service.js` call `checkChannelPermission()`. However, `social-service.js` and `activity-service.js` do NOT check channel permissions at all. Any authenticated user can subscribe to any social or activity channel.
- Files: `src/services/social-service.js` (line 36), `src/services/activity-service.js` (line 49)
- Current mitigation: None.
- Recommendations: Add `checkChannelPermission()` calls to `handleSubscribe()` in both services.

**DynamoDB Scan in `_loadAllDocumentsFromDynamo`:**
- Risk: Unbounded `ScanCommand` with no pagination. As the documents table grows, this becomes increasingly expensive and silently truncates at DynamoDB's 1MB scan limit.
- Files: `src/services/crdt-service.js` (line 262)
- Current mitigation: None.
- Recommendations: Add pagination support or use a GSI for efficient listing.

## Performance Bottlenecks

**Redis SMEMBERS O(n) on every channel unsubscribe:**
- Problem: `unsubscribeClientFromChannel` in `node-manager.js` calls `sMembers` on the node's client set, then for each client calls `sMembers` on that client's channels. This is O(clients * channels_per_client) Redis operations per single unsubscribe.
- Files: `src/core/node-manager.js` (lines 226-258)
- Cause: Checking if any remaining client on this node still subscribes to the channel requires iterating all clients.
- Improvement path: Maintain a per-node reference count `channel -> count` in Redis (HINCRBY). Decrement on unsubscribe; remove from channel-nodes set when count hits 0. Eliminates the nested SMEMBERS loop entirely.

**Y.Doc per channel held in memory with no heap budget:**
- Problem: Every document channel creates an in-memory `Y.Doc` object. With 500 concurrent users editing different documents, each Y.Doc can be 100KB-10MB depending on document size, potentially consuming 500MB-5GB of heap.
- Files: `src/services/crdt-service.js` (line 66, `this.channelStates`)
- Cause: Y.Docs are only evicted after 10 minutes of zero subscribers (configurable via `IDLE_EVICTION_MS`).
- Improvement path: Monitor heap usage per channel. Consider LRU eviction with a max heap budget. Add memory pressure metrics and alerts.

**Chat message history is in-memory only (per-node, not shared):**
- Problem: Chat history is stored in an LRU cache per channel, limited to 100 messages. In a distributed setup, each node has its own cache, so clients on different nodes see different history.
- Files: `src/services/chat-service.js` (lines 46-47, `this.channelCaches`)
- Cause: No persistent storage for chat messages.
- Improvement path: Store messages in DynamoDB or Redis sorted sets for cross-node consistent history.

**Cursor and chat throttle/tracking Maps leak on disconnect:**
- Problem: `cursorUpdateThrottle` Map entries are only removed in `onClientDisconnect`, but `server.js` calls `handleDisconnect` (which does not exist on CursorService). Same for ChatService's `clientChannels`. These Maps grow monotonically.
- Files: `src/services/cursor-service.js` (lines 22, 433-445), `src/services/chat-service.js` (lines 45, 356-379)
- Cause: Disconnect handler naming mismatch between server and services.
- Improvement path: Standardize on `handleDisconnect()` as the method name. Add aliases in chat and cursor services, or rename `onClientDisconnect` to `handleDisconnect`.

## Fragile Areas

**CRDT snapshot dual-write path (EventBridge vs Direct DynamoDB):**
- Files: `src/services/crdt-service.js` (lines 905-993)
- Why fragile: `writeSnapshot()` has two completely different code paths controlled by `DIRECT_DYNAMO_WRITE` env var. The direct DynamoDB write uses `channelId` as the hash key attribute name in the Item, but `retrieveLatestSnapshot` queries with `documentId` as the key condition expression. These are the same column but with different naming conventions between write and read paths which is confusing and error-prone.
- Safe modification: Test both paths independently. Ensure column names are consistent.
- Test coverage: `test/crdt-service.test.js` exists but does not cover the full write/read roundtrip.

**Session restoration during reconnection:**
- Files: `src/middleware/reconnection-handler.js`, `src/services/session-service.js`
- Why fragile: Session restoration re-subscribes to all channels sequentially. If any subscription fails mid-way, the rollback loop attempts to undo partial subscriptions. However, the rollback can also fail, leaving a client in a half-subscribed state.
- Safe modification: Add tests for partial failure scenarios.
- Test coverage: `test/session-recovery.test.js` exists but does not test partial failure rollback.

**Health check returns 200 during initialization:**
- Files: `src/server.js` (lines 804-815, 639-654)
- Why fragile: HTTP server starts listening before `initialize()` completes (intentionally, to pass ECS health checks). However, the health endpoint returns `status: 'healthy'` immediately even though `nodeManager`, `messageRouter`, and services are all null during initialization. K8s readiness probes will route traffic to a pod that cannot serve WebSocket connections.
- Safe modification: Track an `initialized` flag and return 503 from `/health` until initialization completes. Or use separate liveness vs readiness probe paths.
- Test coverage: `test/health-endpoint.test.js` does not test the pre-initialization state.

**Multiple services maintain independent clientChannels Maps:**
- Files: `src/services/chat-service.js` (line 45), `src/services/presence-service.js` (line 47), `src/services/cursor-service.js` (line 20-21), `src/services/reaction-service.js` (line 17), `src/services/social-service.js` (line 17), `src/services/activity-service.js` (line 27)
- Why fragile: Every service independently tracks which clients are in which channels. If any one of these Maps gets out of sync with the message router's canonical state, ghost subscriptions or missed cleanup occur. The disconnect handler naming bug means several of these Maps are already leaking.
- Safe modification: Consider querying the message router for channel membership instead of maintaining parallel state.

## Scaling Limits

**Single Redis instance is a bottleneck and SPOF:**
- Current capacity: All pub/sub, session storage, rate limiting, CRDT snapshot caching, and node coordination go through one Redis connection pair.
- Limit: Redis pub/sub throughput ~100K messages/sec. At 500 users with cursor updates (40/sec each), awareness (10/sec each), and CRDT updates, that is 25K+ messages/sec of pub/sub alone. Achievable but leaves little headroom.
- Scaling path: Redis Cluster for sharding. Separate Redis instances for different concerns (pub/sub vs. session vs. rate-limiting). Note: project rule says NO ElastiCache -- Redis must run in ECS.

**In-memory connection tracking (connectionsByIp Map) is per-node:**
- Current capacity: Works correctly for a single process.
- Limit: In a multi-node deployment, per-IP limits are per-node, not global. An attacker can open `MAX_CONNECTIONS_PER_IP * num_nodes` connections.
- Scaling path: Move IP tracking to Redis with atomic INCR/DECR and short TTLs.

**Node.js single-thread event loop:**
- Current capacity: 50-100 concurrent users with moderate message rates.
- Limit: Y.js `applyUpdate` and `mergeUpdates` are CPU-bound. At 500 users doing collaborative editing, the event loop may block on CRDT operations. The 10ms batch window helps but does not eliminate the problem.
- Scaling path: Move CRDT merge operations to `worker_threads`. Horizontally scale by adding more nodes.

**DynamoDB Scan for document listing:**
- Current capacity: Works for small document counts (< 100).
- Limit: Scan reads every item in the table. At 10,000 documents, each list request costs significant read capacity and takes seconds.
- Scaling path: Add a GSI on `updatedAt` for efficient sorted listing, or use Redis sorted set as primary index with DynamoDB as backup.

## Dependencies at Risk

**AWS SDK v3 at `^3.1000.0` (extremely broad caret range):**
- Risk: `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-eventbridge`, `@aws-sdk/client-ivschat` all use `^3.1000.0`. The AWS SDK v3 releases multiple times per week. This range allows hundreds of minor versions.
- Impact: Non-deterministic builds. Occasional breaking changes in patch/minor versions are documented in AWS SDK changelogs.
- Migration plan: Pin to specific minor versions tested in CI. Use `npm ci` (not `npm install`) in all pipelines.

**ws@^8.14.0 WebSocket Library:**
- Risk: Library has history of DoS vulnerabilities (CVE-2024-37890 in 8.17.0). Version range allows anything from 8.14.0 forward.
- Impact: Slow client attacks or malformed frames could crash server.
- Migration plan: Pin to latest 8.x with known clean audit. Run `npm audit` in CI.

**No test runner configured in package.json:**
- Risk: `"test": "echo \"No tests specified\" && exit 0"` means `npm test` always passes. Tests in `test/` directory exist but are not wired up.
- Impact: CI/CD pipelines that run `npm test` get a false green signal.
- Migration plan: Install and configure Jest or Vitest. Wire up existing test files.

## Missing Critical Features

**No WebSocket message backpressure:**
- Problem: If a client's network is slow, `ws.send()` queues messages in the WebSocket buffer without limit. There is no check of `ws.bufferedAmount` before sending.
- Files: `src/core/message-router.js` (line 586)
- Blocks: At scale, a single slow client can cause memory pressure on the server node. With 500 users in a channel, a broadcast to a slow client queues every message.

**No graceful drain during rolling updates:**
- Problem: On SIGTERM, the server closes all connections with code 1001 immediately. There is no drain period where new connections are refused while existing connections finish pending operations.
- Files: `src/server.js` (lines 738-801)
- Blocks: Rolling deployments cause all connected clients to disconnect and reconnect simultaneously, creating a "thundering herd" on the remaining nodes.

**No per-client message queue or offline buffering:**
- Problem: If a client is temporarily disconnected, all messages sent during the gap are lost. Session recovery restores subscriptions but not missed messages.
- Files: `src/middleware/reconnection-handler.js`, `src/services/session-service.js`
- Blocks: Reliable delivery for collaborative editing. Users may miss chat messages or CRDT updates during brief disconnects.

## Test Coverage Gaps

**Zero backend tests for core services and routing:**
- What's not tested: `chat-service.js`, `cursor-service.js`, `reaction-service.js`, `social-service.js`, `activity-service.js`, `node-manager.js`, `message-router.js` have NO dedicated test files exercising their main logic paths.
- Files: `src/services/chat-service.js`, `src/services/cursor-service.js`, `src/services/reaction-service.js`, `src/services/social-service.js`, `src/services/activity-service.js`, `src/core/node-manager.js`, `src/core/message-router.js`
- Risk: All message routing, channel subscription, and service logic is untested. Regressions go undetected.
- Priority: High

**Test script is a no-op:**
- What's not tested: `package.json` test script is `echo "No tests specified" && exit 0` (line 9). No test runner configured. Existing tests in `test/` directory must be run manually.
- Files: `src/package.json` (line 9)
- Risk: CI/CD passes with no tests running.
- Priority: High

**CRDT snapshot write/read roundtrip not tested:**
- What's not tested: `writeSnapshot()`, `retrieveLatestSnapshot()`, Y.Doc hydration from DynamoDB, gzip compression/decompression roundtrip, Redis hot-cache read/write.
- Files: `src/services/crdt-service.js` (lines 905-993, 771-813)
- Risk: Data corruption in the snapshot pipeline would cause permanent document data loss with no safety net.
- Priority: High

**No integration test for multi-node message routing:**
- What's not tested: Redis pub/sub cross-node message delivery, channel subscription propagation across nodes, node failure handling, stale node cleanup.
- Files: `src/core/message-router.js`, `src/core/node-manager.js`
- Risk: Multi-node deployment behavior is entirely untested. Bugs only surface in production.
- Priority: Medium

**No load test or benchmark:**
- What's not tested: Behavior under 50, 100, 500 concurrent connections. Event loop blocking threshold. Memory growth patterns. Redis operation rates.
- Risk: Performance regressions and OOM crashes discovered only in production.
- Priority: Medium

## Observability Gaps

**No request-level tracing through Redis pub/sub:**
- Problem: The `correlationId` generated in `handleMessage()` is not propagated through Redis pub/sub messages. When a message traverses nodes, the correlation ID is lost. Cross-node message flows cannot be traced.
- Files: `src/server.js` (line 527), `src/core/message-router.js` (line 314)

**No per-channel or per-document metrics:**
- Problem: Metrics are aggregated at node level only. Cannot identify which channel or document is generating the most traffic, the most errors, or the highest latency.
- Files: `src/utils/metrics-collector.js`

**No memory usage alerting for Y.Doc heap:**
- Problem: In-memory Y.Docs can consume unbounded memory. The health endpoint reports `process.memoryUsage()` but there is no alarm or threshold that triggers eviction or alerts operators.
- Files: `src/server.js` (line 649), `src/services/crdt-service.js`

**CloudWatch metrics fail silently:**
- Problem: `MetricsCollector.flush()` catches all errors and logs them but never raises alarms. After 3 consecutive failures, `isHealthy()` returns false but nothing checks this value.
- Files: `src/utils/metrics-collector.js` (lines 196-198, 309-318)

---

*Concerns audit: 2026-04-12*
