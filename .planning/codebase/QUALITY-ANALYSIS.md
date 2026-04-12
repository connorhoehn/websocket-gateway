# Backend Code Quality Analysis

**Analysis Date:** 2026-04-12
**Scope:** `src/` directory (21 source files, ~8,087 lines excluding node_modules)

---

## 1. Functions That Are Too Long (>50 lines)

### Critical: `CRDTService` constructor (~127 lines)
- **File:** `src/services/crdt-service.js` lines 19-127
- **Problem:** Constructor initializes DynamoDB clients, EventBridge clients, sets up timers, registers interceptors, creates data structures, and ensures DynamoDB tables. This is a god-constructor that does too much.
- **Fix:** Extract initialization into focused methods: `_initDynamoClients()`, `_initEventBridge()`, `_initTimers()`, `_registerInterceptors()`. Call them from constructor or an `async init()` method (especially since `_ensureTable()` is async and its error is swallowed).

### Critical: `CRDTService.handleSubscribe()` (~100 lines)
- **File:** `src/services/crdt-service.js` lines 415-522
- **Problem:** Handles authorization, Y.Doc creation, Redis hydration, DynamoDB hydration, Redis cache warming, subscriber count tracking, state push to client, and presence tracking all in one method.
- **Fix:** Extract into `_authorizeChannel()`, `_hydrateYDoc(channel)`, `_pushStateToClient(clientId, channel)`.

### Critical: `CRDTService.writeSnapshot()` (~90 lines)
- **File:** `src/services/crdt-service.js` lines 905-993
- **Problem:** Two completely different code paths (EventBridge vs direct DynamoDB) in one method with complex branching.
- **Fix:** Split into `_writeSnapshotViaDynamo(channelId, compressed, meta)` and `_writeSnapshotViaEventBridge(channelId, compressed, meta)`.

### High: `DistributedWebSocketServer.setupWebSocketServer()` (~130 lines)
- **File:** `src/server.js` lines 341-523
- **Problem:** WebSocket upgrade handling, authentication, reconnection, event binding, ping/pong setup, and welcome message all in nested callbacks.
- **Fix:** Extract inner `wss.on("connection")` handler into `_handleNewConnection(ws, req, userContext)`.

### Medium: `CRDTService.handleRestoreSnapshot()` (~80 lines)
- **File:** `src/services/crdt-service.js` lines 1117-1209
- **Problem:** DynamoDB query, decompression, pre-restore checkpoint, Y.Doc replacement, broadcast, and post-restore snapshot all sequential in one method.

### Medium: `CRDTService.handleClearDocument()` (~65 lines)
- **File:** `src/services/crdt-service.js` lines 1215-1278

---

## 2. Duplicated Code Patterns

### Critical: `validateMetadata()` duplicated verbatim
- **Files:** `src/services/chat-service.js` lines 14-36 and `src/services/presence-service.js` lines 13-35
- **Impact:** Both define identical `MAX_METADATA_KEYS = 20`, `MAX_METADATA_SIZE = 4096`, and the same function body.
- **Fix:** Extract to `src/utils/validate-metadata.js` and import in both services.

### High: Authorization check boilerplate repeated 6 times
- **Files:** `src/services/chat-service.js` (lines 96-110), `src/services/cursor-service.js` (lines 253-268), `src/services/presence-service.js` (lines 179-193), `src/services/reaction-service.js` (lines 75-89), `src/services/crdt-service.js` (lines 423-438, 636-650)
- **Pattern repeated:**
  ```javascript
  const clientData = this.messageRouter.getClientData(clientId);
  if (!clientData || !clientData.userContext) { sendError(...); return; }
  try {
      checkChannelPermission(clientData.userContext, channel, this.logger, this.metricsCollector);
  } catch (error) {
      if (error instanceof AuthzError) { sendError(...); return; }
      throw error;
  }
  ```
- **Fix:** Extract to a shared method on a base class or a utility: `authorizeChannel(clientId, channel)` that throws or returns.

### High: `sendToClient()` wrapper duplicated in every service
- **Files:** All 7 service files define identical `sendToClient(clientId, message)` that delegates to `this.messageRouter.sendToClient()`.
- **Fix:** Extract to a base service class.

### High: `sendError()` pattern duplicated with minor variations
- **Files:** `src/services/chat-service.js`, `src/services/cursor-service.js`, `src/services/presence-service.js`, `src/services/reaction-service.js`, `src/services/crdt-service.js` all use the structured `createErrorResponse()` pattern.
- **Files:** `src/services/social-service.js`, `src/services/activity-service.js` use a simpler plain-message pattern without error codes.
- **Fix:** Base service class with standard `sendError()`. Also standardize social/activity services to use error codes.

### Medium: Disconnect handler boilerplate
- **Files:** `src/services/social-service.js` (lines 87-99), `src/services/activity-service.js` (lines 257-269), `src/services/reaction-service.js` (lines 256-268), `src/services/chat-service.js` (lines 360-378)
- **Pattern:** Iterate `clientChannels`, unsubscribe each, delete map entry.
- **Fix:** Base class method `_cleanupClientChannels(clientId)`.

### Medium: `broadcastToLocalClients()` stub duplicated
- **Files:** `src/services/chat-service.js` (lines 319-323), `src/services/cursor-service.js` (lines 400-404), `src/services/presence-service.js` (lines 329-333)
- **All three are identical no-op stubs:** `this.logger.warn('Local-only mode not implemented...')`
- **Fix:** Either implement properly or remove dead code.

### Medium: Channel name validation duplicated
- `src/services/crdt-service.js` has `validateChannel()` (line 1843): `typeof channel === 'string' && channel.length > 0 && channel.length <= 50`
- `src/services/chat-service.js` (line 89): `typeof channel !== 'string' || channel.length === 0 || channel.length > 50`
- `src/services/reaction-service.js` (line 68): same inline check
- `src/validators/message-validator.js` has `validateChannelName()` with regex `^[a-zA-Z0-9_:-]{1,50}$`
- **Impact:** Three different channel validation standards. The validator is stricter (regex) than the inline checks (length only).
- **Fix:** Use `MessageValidator.validateChannelName()` everywhere.

### Medium: `broadcastToLocalChannel` / `broadcastToLocalClients` duplicated
- **Files:** `src/core/message-router.js` (lines 603-698) and `src/core/websocket-manager.js` (lines 90-152)
- **Problem:** `WebSocketManager` has the exact same batched broadcast logic as `MessageRouter`. `WebSocketManager` appears to be dead code (never imported by `server.js`).

---

## 3. Inconsistent Error Handling

### Critical: `sendError()` inconsistency across services
- **Structured (with error codes):** `chat-service.js`, `cursor-service.js`, `presence-service.js`, `reaction-service.js`, `crdt-service.js`
  ```javascript
  sendError(clientId, message, errorCode = ErrorCodes.SERVICE_INTERNAL_ERROR) {
      const errorResponse = createErrorResponse(errorCode, message, { service: 'chat', clientId });
      this.sendToClient(clientId, { type: 'error', service: 'chat', ...errorResponse });
      if (this.metricsCollector) this.metricsCollector.recordError(errorCode);
  }
  ```
- **Plain (no error codes, no metrics):** `social-service.js`, `activity-service.js`
  ```javascript
  sendError(clientId, message) {
      this.sendToClient(clientId, { type: 'error', service: 'social', message, timestamp: ... });
  }
  ```
- **Impact:** Social/activity errors bypass metrics collection, making it impossible to alarm on their failures. Error response shapes differ (clients need different parsing logic).

### High: Swallowed errors in `CRDTService._registerShutdownHandlers()`
- **File:** `src/services/crdt-service.js` lines 184-206
- **Problem:** Registers SIGTERM/SIGINT handlers that flush snapshots but `NOTE: we don't call process.exit() here`. However, `server.js` lines 830-840 ALSO registers SIGTERM/SIGINT handlers that call `process.exit(0)`. The race between these handlers means CRDTService flush may not complete before process exits.

### High: Multiple SIGTERM/SIGINT handler registrations
- **File:** `src/server.js` lines 830-840 registers `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)`
- **File:** `src/core/node-manager.js` lines 473-494 `setupGracefulShutdown()` also registers handlers for SIGTERM, SIGINT, SIGUSR2, uncaughtException, unhandledRejection
- **File:** `src/services/crdt-service.js` lines 184-206 `_registerShutdownHandlers()` also registers SIGTERM, SIGINT
- **Impact:** Three separate shutdown handler chains compete. The order of execution is non-deterministic. Node.js `process.on()` allows multiple handlers, but `process.exit(0)` in one handler kills others mid-flight.

### Medium: `CRDTService._ensureTable()` error swallowed on startup
- **File:** `src/services/crdt-service.js` line 81
  ```javascript
  this._ensureTable().catch(err => this.logger.error('Failed to ensure DynamoDB table:', err.message));
  ```
- **Problem:** Table creation failure is logged but silently ignored. Subsequent DynamoDB operations will fail with cryptic errors.

---

## 4. Magic Numbers and Hardcoded Values

### High: Scattered throughout with no central config
- `src/services/crdt-service.js` line 29: `BATCH_WINDOW_MS = 10` (10ms batch window)
- `src/services/crdt-service.js` line 33: `AWARENESS_BATCH_WINDOW_MS = 50`
- `src/services/crdt-service.js` line 561: `state.operationsSinceSnapshot >= 50` (snapshot threshold)
- `src/services/crdt-service.js` line 326: `3600` (Redis TTL 1 hour, inline)
- `src/services/cursor-service.js` line 23: `throttleInterval = 250` (250ms throttle)
- `src/services/cursor-service.js` line 25: `cursorTTL = 30000` (30s TTL)
- `src/services/cursor-service.js` line 26: `cleanupInterval = 10000` (10s cleanup)
- `src/services/presence-service.js` line 51: `heartbeatInterval = 30000` (30s)
- `src/services/presence-service.js` line 52: `presenceTimeout = 60000` (60s)
- `src/services/presence-service.js` line 55: `STALE_THRESHOLD = 90000` (90s)
- `src/services/chat-service.js` line 47: `MAX_MESSAGES_PER_CHANNEL = 100`
- `src/services/chat-service.js` line 53: `300000` (5-min cleanup interval)
- `src/services/chat-service.js` line 183: `message.length > 1000` (max message length)
- `src/services/reaction-service.js` line 19: `maxHistorySize = 50`
- `src/services/activity-service.js` line 19: `MAX_HISTORY_ITEMS = 200`
- `src/services/activity-service.js` line 203: `86400` (24hr Redis TTL)
- `src/server.js` line 132: `60000` (metrics interval)
- `src/server.js` line 457: `30000` (ping interval)
- `src/core/node-manager.js` line 126: `30000` (heartbeat interval)
- `src/core/node-manager.js` line 140: `90` (heartbeat TTL seconds)
- `src/core/node-manager.js` line 31: `CHANNEL_NODES_CACHE_TTL_MS = 5000`
- `src/middleware/rate-limiter.js` lines 15-18: `cursor: 40, crdt: 500, awareness: 60, general: 100`
- **Fix:** Create `src/config/constants.js` with named exports for all tuning parameters.

---

## 5. Missing Input Validation

### High: `CRDTService` actions lack authorization
- **File:** `src/services/crdt-service.js`
- **Problem:** `handleClearDocument`, `handleRestoreSnapshot`, `handleDeleteDocument`, `handleSaveVersion` do NOT check channel permissions. Any authenticated user can clear/delete/restore any document.
- **Fix:** Add `checkChannelPermission()` to all destructive operations.

### High: Social and Activity services skip authorization entirely
- **Files:** `src/services/social-service.js`, `src/services/activity-service.js`
- **Problem:** `handleSubscribe` does not call `checkChannelPermission()`. Any authenticated user can subscribe to any social/activity channel.
- **Fix:** Add authorization checks or document that these are intentionally public channels.

### Medium: `handleSendReaction` doesn't validate metadata
- **File:** `src/services/reaction-service.js` line 142
- **Problem:** `metadata` parameter is passed through without size/key validation (unlike chat and presence which validate).

### Medium: `handlePublish` in activity service accepts arbitrary event payloads
- **File:** `src/services/activity-service.js` lines 100-158
- **Problem:** `event.detail` can be any object with no size limits. A malicious client could publish massive payloads.

### Low: `handleGetHistory` limit not validated in chat service
- **File:** `src/services/chat-service.js` line 230
- **Problem:** `limit = 50` default but no upper bound validation. Client can request `limit: 999999`.

---

## 6. Race Conditions and Concurrency Issues

### Critical: Subscriber count race in `CRDTService`
- **File:** `src/services/crdt-service.js`
- **Problem:** `state.subscriberCount++` (line 486) and `state.subscriberCount--` (line 595) are not atomic. Under concurrent subscribe/unsubscribe from multiple clients, the count can drift. If it goes negative (clamped to 0), idle eviction triggers incorrectly. If it goes too high, Y.Docs are never evicted.
- **Fix:** Use a mutex or atomic counter, or derive count from `messageRouter.getChannelClients(channel).length`.

### High: Operation batch `senderClientId` only tracks first sender
- **File:** `src/services/crdt-service.js` lines 818-840
- **Problem:** `batch.senderClientId` is set from the first operation in a batch window. If multiple clients send updates within the 10ms window, only the first client is excluded from the broadcast. Other senders will receive their own echoed updates.
- **Fix:** Track a Set of sender client IDs per batch, or exclude all senders.

### High: `connectionsByIp` counter can desynchronize
- **File:** `src/server.js`
- **Problem:** IP count is incremented in the `upgrade` handler (line 373) but decremented in `handleClientDisconnect` (line 606). If the WebSocket connection fails after increment but before the `close` event fires (e.g., during `handleReconnection`), the counter leaks. Over time, legitimate IPs could hit the per-IP limit.
- **Fix:** Tie IP counter increment/decrement to the WebSocket lifecycle events, not the upgrade handler.

### Medium: `cleanupStalePresence()` and `cleanupStaleClients()` overlap
- **File:** `src/services/presence-service.js`
- **Problem:** Two separate timers (`presenceHeartbeatInterval` at 30s and `cleanupInterval` at 30s) both iterate `clientPresence` and can modify it concurrently. The `isCleaningUp` mutex flag only guards `cleanupStaleClients`, not `cleanupStalePresence`.
- **Fix:** Consolidate into a single cleanup timer, or extend the mutex to cover both.

### Medium: Session service LRU cache TTL initialization order
- **File:** `src/services/session-service.js` lines 19-24
- **Problem:** `this.localSessionStore = new LRUCache({ ttl: this.sessionTTL * 1000 })` executes before `this.sessionTTL = 24 * 60 * 60` is assigned on the next line. `this.sessionTTL` is `undefined` at LRU construction time, so `ttl` becomes `NaN`. Sessions in the LRU cache never expire.
- **Fix:** Move `this.sessionTTL = 24 * 60 * 60` before the LRU cache initialization.

---

## 7. Memory Leak Potential

### Critical: `channelSequences` Map in MessageRouter grows unbounded
- **File:** `src/core/message-router.js` line 22
- **Problem:** `this.channelSequences = new Map()` stores a monotonic counter per channel. Entries are only deleted in `unsubscribeFromRedisChannel()` (line 508). If a channel is subscribed to, used briefly, and all clients leave, but the channel Redis unsubscribe fails, the entry persists forever. Over weeks of operation with many unique document channels, this map grows unbounded.
- **Fix:** Add periodic cleanup of channels with no local subscribers, or use a WeakRef/TTL cache.

### High: `channelNodesCache` in NodeManager grows unbounded
- **File:** `src/core/node-manager.js` line 30
- **Problem:** `this.channelNodesCache = new Map()` caches channel-to-nodes mappings with 5s TTL. Entries have TTL but expired entries are only cleaned when accessed (lazy eviction). If thousands of unique channels are queried but never re-accessed, stale entries accumulate.
- **Fix:** Add periodic cache sweep, or use an LRU cache with max size.

### High: `documentPresenceMap` and `clientDocChannels` in CRDTService
- **File:** `src/services/crdt-service.js` lines 117-120
- **Problem:** `documentPresenceMap` entries are only cleaned on client disconnect (`_removeClientFromAllDocPresence`). If a client disconnects uncleanly (network drop without WebSocket close event), the entry persists until the server restarts.
- **Fix:** Add TTL-based cleanup similar to presence service's stale client cleanup.

### Medium: `cursorUpdateThrottle` Map in CursorService
- **File:** `src/services/cursor-service.js` line 22
- **Problem:** `this.cursorUpdateThrottle = new Map()` stores last-update timestamps per client. Entries are cleaned on `onClientDisconnect()`, but if disconnect is missed, they persist. The `cleanupStaleData()` timer cleans stale cursors but does NOT clean orphaned throttle entries for clients with no cursor data.
- **Fix:** Also clean throttle entries during `cleanupStaleData()`.

### Medium: `reactionHistory` arrays in ReactionService grow per channel
- **File:** `src/services/reaction-service.js` lines 18, 166-175
- **Problem:** Each channel gets an array capped at 50 items, but the Map of channels itself is never pruned. Channels that had reactions months ago but are no longer active still occupy memory.
- **Fix:** Add periodic cleanup of empty/stale reaction history channels.

---

## 8. Dead Code and Unused Variables

### High: `WebSocketManager` is completely dead code
- **File:** `src/core/websocket-manager.js` (218 lines)
- **Problem:** Never imported by `server.js` or any other file. `MessageRouter` has superseded its functionality entirely. All broadcasting, client tracking, and channel management is done through `MessageRouter`.
- **Fix:** Delete `src/core/websocket-manager.js`.

### High: `IvsChatService` is never registered
- **File:** `src/services/ivs-chat-service.js` (163 lines)
- **Problem:** Imported nowhere. `server.js` does not include it in `initializeServices()`. The `ivs-chat` service name is not in the `MessageValidator.allowedServices` whitelist.
- **Fix:** Either integrate it properly or remove it.

### Medium: `CursorService.redisClient` is always null
- **File:** `src/services/cursor-service.js` line 17
- **Problem:** `this.redisClient = null` is set in constructor (line 17), and `this.useRedis = !!this.redisClient` (line 31) is always `false`. All Redis code paths in `storeCursorData`, `getChannelCursors`, `removeCursorData` are dead code because `useRedis` is always false.
- **Fix:** Either pass `redisClient` to the constructor (like CRDTService and ActivityService do) or remove the Redis code paths.

### Medium: `broadcastToLocalClients()` stubs are dead code
- **Files:** `src/services/chat-service.js` (line 319), `src/services/cursor-service.js` (line 400), `src/services/presence-service.js` (line 329)
- **Problem:** These methods only log a warning and do nothing. The `isDistributed` flag is always true (messageRouter always exists), so these are never reached.
- **Fix:** Remove the local-only fallback stubs or implement them properly.

### Low: `generateClientId()` in `server.js` is never called
- **File:** `src/server.js` line 635-637
- **Problem:** `reconnection-handler.js` uses `crypto.randomUUID()` instead. This method is orphaned.
- **Fix:** Remove it.

### Low: `ErrorCodeToStatus` is exported but never imported
- **File:** `src/utils/error-codes.js` lines 49-81
- **Problem:** The HTTP status code mapping is defined but never used. WebSocket errors don't use HTTP status codes.

---

## 9. Additional Concerns

### Disconnect lifecycle inconsistency
- **File:** `src/server.js` line 618 calls `service.handleDisconnect(clientId)`
- **Problem:** `src/services/cursor-service.js` defines `onClientDisconnect()` but NOT `handleDisconnect()`. The server will call `handleDisconnect()` on it, which doesn't exist, and the check `if (service.handleDisconnect)` returns false, silently skipping cursor cleanup on disconnect.
- **Impact:** Stale cursor data persists after client disconnects until TTL cleanup runs (30s).
- **Fix:** Add `handleDisconnect` alias in cursor-service, or change server to check for both method names.

### `ChatService.onClientDisconnect()` is also never called
- **File:** `src/services/chat-service.js` line 360 defines `onClientDisconnect()`
- **Problem:** Server calls `service.handleDisconnect()`, which doesn't exist on ChatService. Chat channels are not cleaned up on disconnect.
- **Impact:** Client remains tracked in `clientChannels` Map until server restart.

### Double-serialization in Logger
- **File:** `src/utils/logger.js` line 74
- **Problem:** `safeStringify()` calls `JSON.parse(JSON.stringify(obj, replacer))` which double-serializes. The outer `formatMessage()` then calls `JSON.stringify(logEntry)` again. For large context objects, this is wasteful.

---

*Quality analysis: 2026-04-12*
