# Codebase Concerns

**Analysis Date:** 2026-03-02

## Tech Debt

**Duplicate WebSocket Manager Pattern:**
- Issue: `WebSocketManager` class in `src/core/websocket-manager.js` is not used by the main application. The `DistributedWebSocketServer` in `src/server.js` duplicates its functionality (client tracking, message routing) without reusing this abstraction.
- Files: `src/core/websocket-manager.js`, `src/server.js` (lines 48-292)
- Impact: Code duplication makes maintenance harder; changes needed in both places. Creates confusion about which implementation is canonical.
- Fix approach: Either remove the unused `WebSocketManager` class or refactor `server.js` to use it as a base abstraction.

**Inconsistent Logging:**
- Issue: `websocket-manager.js` uses raw `console.log/console.error` (lines 30, 34, 49, 65, 86, 104, 110, 124) while the rest of the codebase uses a `Logger` utility class.
- Files: `src/core/websocket-manager.js`
- Impact: Inconsistent log formatting, harder to filter logs by service, no log level control for this module.
- Fix approach: Replace all `console.*` calls with `Logger` instance created in constructor.

**Signal Handler Duplication:**
- Issue: Signal handlers (`SIGTERM`, `SIGINT`, `uncaughtException`, `unhandledRejection`) are registered in both `server.js` (lines 465-485) and `node-manager.js` (lines 435-457). Both try to initiate shutdown.
- Files: `src/server.js` (lines 465-485), `src/core/node-manager.js` (lines 435-457)
- Impact: Race condition potential during shutdown. Both handlers may execute simultaneously, attempting to close resources twice.
- Fix approach: Centralize shutdown coordination. Have `node-manager` register its handlers once and remove duplicate registration from `server.js`.

**Hardcoded Configuration Values:**
- Issue: Magic numbers scattered throughout services without explanation: throttle interval (250ms in `cursor-service.js:18`), presence timeout (60000ms in `presence-service.js:18`), cursor TTL (30000ms in `cursor-service.js:21`), history sizes (100 for chat, 50 for reactions).
- Files: `src/services/chat-service.js:15`, `src/services/cursor-service.js:18,21-22`, `src/services/presence-service.js:17-18`, `src/services/reaction-service.js:15`
- Impact: Hard to tune performance; values cannot be adjusted without code changes. Different services have different timeout strategies (inconsistent).
- Fix approach: Extract all configurable values to `config` objects passed at service initialization or environment variables.

## Known Bugs

**Memory Leak in Presence Service:**
- Symptoms: `clientPresence` Map grows unbounded when clients disconnect and reconnect repeatedly. The 5-second cleanup delay in `handleDisconnect` (lines 317-329) is not reliable if clients reconnect before cleanup executes.
- Files: `src/services/presence-service.js` (lines 317-329)
- Trigger: Rapid client connect/disconnect cycles
- Workaround: None. Requires code fix.

**Stale Data in Chat Service History:**
- Symptoms: Channel history in `channelHistory` Map never expires. A channel created and abandoned will keep messages indefinitely, consuming memory.
- Files: `src/services/chat-service.js` (lines 14, 194-206)
- Trigger: Create channels, send messages, then never access them again
- Workaround: Manually flush `channelHistory` during shutdown or restart server.

**Cursor Service Redis Fallback Not Tested:**
- Symptoms: When Redis fails (line 160-164), code falls back to local storage. But when cursor data is queried later (lines 313-337), it only checks Redis, not the fallback local storage.
- Files: `src/services/cursor-service.js` (lines 136-169, 313-337)
- Trigger: Redis connection drops after cursor is stored; subsequent cursor queries return empty
- Workaround: Restart server to clear local cursor state.

**Race Condition in Channel Cleanup:**
- Symptoms: In `node-manager.js`, `unsubscribeClientFromChannel` (lines 225-241) checks if a node still serves a channel by iterating all clients and their channels. If a client disconnects while this check runs, the cleanup may be incorrect.
- Files: `src/core/node-manager.js` (lines 225-241)
- Trigger: Concurrent client disconnects while another client unsubscribes from channel
- Workaround: Add locking mechanism (requires code change).

## Security Considerations

**No Authentication or Authorization:**
- Risk: Any WebSocket client can connect and subscribe to any channel. No verification of client identity or permissions. A malicious client can impersonate other users or subscribe to private channels.
- Files: `src/server.js` (lines 191-233), all service files
- Current mitigation: None
- Recommendations:
  1. Implement WebSocket authentication (token validation on connect)
  2. Add channel-level access control (verify client can subscribe to requested channel)
  3. Validate client identity on each message
  4. Use JWT or similar token scheme with expiration

**No Input Validation in Message Routing:**
- Risk: `server.js` accepts any JSON and routes to services. While individual services validate their input, the routing layer could be exploited.
- Files: `src/server.js` (lines 236-275)
- Current mitigation: Basic service/action validation (lines 243-262)
- Recommendations:
  1. Add schema validation for message structure before routing
  2. Add rate limiting per client
  3. Implement message size limits

**Sensitive Data in Logs:**
- Risk: Error logs may contain user data (client IPs, metadata, message content). These logs go to stdout with no filtering.
- Files: All services, core modules
- Current mitigation: None
- Recommendations:
  1. Implement log sanitization for sensitive fields
  2. Add configuration to exclude certain fields from debug/verbose logging
  3. Never log full message payloads in production

**Redis Connection Without Authentication:**
- Risk: Redis client connects using URL with no password validation. If Redis is exposed or compromised, system is fully accessible.
- Files: `src/server.js` (lines 21-23, 88-100)
- Current mitigation: Default configuration connects to local Redis
- Recommendations:
  1. Support Redis password in connection URL from environment variable
  2. Validate Redis SSL/TLS requirements for production
  3. Document secure configuration requirements

**ClientId Generation Weakness:**
- Risk: `server.js` generates clientId using `Date.now() + crypto.randomBytes(8)`. This is predictable within a time window.
- Files: `src/server.js` (line 299)
- Current mitigation: Uses crypto randomBytes for entropy
- Recommendations:
  1. Use `crypto.randomUUID()` instead (better entropy)
  2. Or increase random bytes to 16 (instead of 8)

## Performance Bottlenecks

**In-Memory Channel Iteration on Every Message:**
- Problem: `node-manager.unsubscribeClientFromChannel` (lines 225-241) iterates all clients on the node to determine if a channel should be removed. This is O(n*m) where n=clients, m=channels per client.
- Files: `src/core/node-manager.js` (lines 225-241)
- Cause: No inverse index from channel to clients; must scan all clients
- Improvement path: Add `channelToClients` reverse index to track which clients are in each channel. Update on subscribe/unsubscribe.

**Presence Cleanup Iterates All Clients Every 30 Seconds:**
- Problem: `cleanupStalePresence` in `presence-service.js` (lines 244-263) iterates all clients in `clientPresence` every 30 seconds. With thousands of clients, this becomes expensive.
- Files: `src/services/presence-service.js` (lines 236-263)
- Cause: Heartbeat-based cleanup instead of lazy expiration
- Improvement path: Use lazy cleanup (only check when queried) or implement priority queue for expiration.

**Unbounded Message History in Memory:**
- Problem: Chat service stores up to 100 messages per channel in `channelHistory`. With 1000 channels, that's 100KB+ of memory just for history.
- Files: `src/services/chat-service.js` (lines 14, 194-206)
- Cause: No TTL on history; channels with old messages never expire
- Improvement path: Add TTL-based expiration. Delete channel history if no messages in 1 hour.

**Cursor Cleanup Requires Manual Interval:**
- Problem: `cursor-service.js` (lines 503-506) runs cleanup every 10 seconds, scanning all cursor data. High frequency relative to data size.
- Files: `src/services/cursor-service.js` (lines 502-530)
- Cause: No event-driven cleanup; must poll
- Improvement path: Move to Redis-based TTL expiration (already done), disable local cleanup interval, rely on Redis expiration.

**No Backpressure on WebSocket Messages:**
- Problem: `server.js` accepts messages without checking if client's send buffer is full. Could cause memory buildup if client is slow to consume.
- Files: `src/server.js` (lines 207-210)
- Cause: No check of `ws.readyState` or `ws.bufferedAmount` before sending
- Improvement path: Check `ws.bufferedAmount` before sending large messages; implement flow control.

## Fragile Areas

**Message Router Service Discovery:**
- Files: `src/core/message-router.js` (lines 109-144, 149-188, 193-215)
- Why fragile: Relies on `nodeManager.getNodesForChannel()` being accurate. If Redis hash gets corrupted or out-of-sync, routing fails silently.
- Safe modification: Add checksums to node registrations. Validate channel node list before routing.
- Test coverage: No tests for node-to-node message routing. No tests for recovery from corrupted Redis state.

**Service Discovery on Node Startup:**
- Files: `src/core/node-manager.js` (lines 309-363)
- Why fragile: `getClusterInfo` parses JSON fields from Redis hashes (line 334). If data was stored without proper serialization, JSON.parse fails.
- Safe modification: Add try-catch blocks around JSON.parse calls. Provide schema validation.
- Test coverage: No tests for malformed data in Redis.

**Concurrent Service Initialization:**
- Files: `src/server.js` (lines 145-171)
- Why fragile: Services are initialized sequentially but there's no dependency ordering. If a service fails to initialize, others continue as if nothing happened.
- Safe modification: Add initialization phase validation. Check that all required services initialized successfully before accepting connections.
- Test coverage: No tests for failed service initialization.

**Async Error Handling in Cleanup:**
- Files: `src/server.js` (lines 347-388), `src/core/message-router.js` (lines 405-435)
- Why fragile: Cleanup loops call async functions in a for loop (lines 410-418 in message-router.js). If one fails, others may not execute.
- Safe modification: Use `Promise.allSettled()` instead of sequential for loops to ensure all cleanups attempt to run.
- Test coverage: No tests for cleanup with errors.

**Channel Name Validation Inconsistency:**
- Files: Multiple files validate channel names differently
  - `chat-service.js` (lines 48-51): 1-50 chars
  - `presence-service.js`: No explicit validation of channel name length
  - `cursor-service.js`: No validation at all
  - `reaction-service.js` (lines 64-67): 1-50 chars
- Why fragile: A 100-character channel in cursor service breaks chat service's constraint
- Safe modification: Create shared validation function in a `validators.js` file.
- Test coverage: No validation tests.

## Scaling Limits

**Single Node Heartbeat Interval:**
- Current capacity: Heartbeat every 30 seconds per node. With 1000 nodes, that's 1000 heartbeat writes per 30 seconds (33 writes/sec to Redis).
- Limit: Redis can handle ~10k ops/sec, so heartbeats are fine, but adding client registration (lines 141-169) on every connection saturates this quickly at scale.
- Scaling path: Batch heartbeats. Use Redis pub/sub for node discovery instead of polling.

**In-Memory Client Maps Per Node:**
- Current capacity: `localClients` Map in `message-router.js` stores all clients on the node. Each entry holds WebSocket object (not serializable).
- Limit: With 10k clients per node, Maps become slow due to GC pressure.
- Scaling path: Implement client eviction policy. Shard clients across worker threads.

**Channel Subscription Tracking:**
- Current capacity: `nodeManager` tracks `channelToNodes` mapping in Redis (lines 200-204). Every channel subscribe does `sAdd`. No limit on channels per node.
- Limit: Redis SET operations are O(1), but total keyspace grows. With 100k channels, Redis memory increases.
- Scaling path: Add channel grouping/sharding. Only track "hot" channels in Redis; use local caches for others.

**Message History Growth:**
- Current capacity: Chat service keeps 100 messages per channel in memory. Reactions keep 50.
- Limit: With 1000 active channels, that's 150KB of message data per node. Multiplied across 10 nodes, it's manageable, but with 100k channels, it becomes 15MB per node.
- Scaling path: Move history to Redis or a database. Implement eviction policies.

## Dependencies at Risk

**redis@4.6.0 Compatibility:**
- Risk: Package is from 2023 and may have unpatched vulnerabilities. Current Node.js runtime may have dropped support for older Node 14.x.
- Impact: If a CVE is found, upgrading may break compatibility
- Migration plan: Test on Node 18+ LTS before upgrading redis. Consider using `redis@5.x` for better Node 20 support.

**AWS CDK 2.1016.0 is Outdated:**
- Risk: CDK version is from early 2024. Current version is ~2.130+. Missing security patches and feature improvements.
- Impact: Infrastructure deployments may fail on newer AWS regions or service versions
- Migration plan: Plan CDK upgrade in separate phase. Review breaking changes in 2.2.x - 2.130 releases first.

**ws@8.14.0 WebSocket Library:**
- Risk: Library has history of DoS vulnerabilities. Version 8.14.0 is from 2023.
- Impact: Slow client attacks or malformed frames could crash server
- Migration plan: Upgrade to `ws@8.17+` which includes DoS mitigations.

**Deprecated @aws-cdk/aws-* Packages:**
- Risk: Using old `@aws-cdk/*` packages (v1) alongside new `aws-cdk-lib` (v2). Mixing versions can cause conflicts.
- Impact: Hard to maintain; dependency resolution issues
- Migration plan: Migrate all `@aws-cdk/*` imports to `aws-cdk-lib`. Remove old packages.

## Missing Critical Features

**No Graceful Degradation When Redis is Down:**
- Problem: If Redis fails after initialization, some services (cursor, presence) try to use it but fail without fallback.
- Blocks: Multi-node deployments are not viable without Redis. Single-node deployments can't fail over.
- Solution:
  1. Cache Redis keys locally in a Map during outage
  2. Flush local cache back to Redis when it recovers
  3. Add monitoring alerts when Redis connection drops

**No Message Persistence or Redelivery:**
- Problem: If client disconnects, buffered messages are lost. No message queue or durability.
- Blocks: Building reliable collaborative apps (e.g., shared documents) requires message history
- Solution: Add message queue (SQS, Kafka, or Redis Streams). Store failed deliveries for retry.

**No Client ID Handshake/Recovery:**
- Problem: Client has no way to recover if connection drops. Must reconnect with new client ID.
- Blocks: Mobile clients with intermittent connections have poor UX
- Solution: Implement session token. Allow client to resume session with same ID after brief reconnection window.

**No Rate Limiting:**
- Problem: A malicious client can spam channel messages and exhaust system resources.
- Blocks: Production deployment without rate limiting is vulnerable to abuse
- Solution: Implement per-client rate limiting. Track message count per second. Reject or throttle excess messages.

**No Message Type Extensibility:**
- Problem: Services are hardcoded (chat, presence, cursor, reaction). Adding a new service requires modifying server.js.
- Blocks: Community extensions or plugins not possible
- Solution: Implement service registry. Allow dynamic service loading from plugins directory.

## Test Coverage Gaps

**No Tests for Distributed Message Routing:**
- What's not tested: Node-to-node message delivery, channel routing to correct nodes, fallback when node is down
- Files: `src/core/message-router.js`
- Risk: Core distributed feature is untested. Bugs could go unnoticed until production.
- Priority: High

**No Tests for Redis Failure Scenarios:**
- What's not tested: Connection drops, reconnection, stale data, fallback to local storage
- Files: `src/server.js`, `src/services/cursor-service.js`
- Risk: Most likely failure mode in production is untested
- Priority: High

**No Tests for Service Initialization:**
- What's not tested: Failed service startup, missing dependencies, configuration errors
- Files: `src/server.js` (lines 145-171)
- Risk: Server could start with broken services
- Priority: Medium

**No Integration Tests:**
- What's not tested: Full client-server-redis-cluster communication
- Files: All
- Risk: Integration bugs between layers are missed
- Priority: High

**No Load/Stress Tests:**
- What's not tested: Behavior under 1000+ concurrent clients, message throughput, memory growth
- Files: All services
- Risk: Performance bottlenecks discovered in production
- Priority: Medium

**No Cleanup/Shutdown Tests:**
- What's not tested: Graceful shutdown, cleanup of resources, proper signal handling
- Files: `src/server.js`, `src/core/message-router.js`, all services
- Risk: Resource leaks, orphaned connections, data loss during shutdown
- Priority: Medium

---

*Concerns audit: 2026-03-02*
