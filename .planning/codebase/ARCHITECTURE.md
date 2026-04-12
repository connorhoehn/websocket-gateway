# Architecture

**Analysis Date:** 2026-04-12

## Pattern Overview

**Overall:** Distributed WebSocket Gateway with Service-Oriented Message Routing

**Key Characteristics:**
- Single monolithic Node.js process hosting multiple real-time services
- Redis pub/sub for cross-node message routing (horizontal scaling)
- Service dispatch via `handleAction(clientId, action, data)` contract
- Channel-based subscription model for all real-time features
- Graceful degradation to standalone mode when Redis is unavailable
- CRDT-based collaborative document editing with Y.js

## Layers

**HTTP/WebSocket Entry Point:**
- Purpose: Accept connections, authenticate, route messages
- Location: `src/server.js`
- Contains: `DistributedWebSocketServer` class (855 lines) - HTTP server, WS upgrade, connection lifecycle, service dispatch
- Depends on: All core modules, all services, middleware
- Used by: External clients

**Core Infrastructure:**
- Purpose: Node clustering, message routing, client management
- Location: `src/core/`
- Contains:
  - `src/core/message-router.js` (781 lines) - Channel subscription, Redis pub/sub routing, validation, rate limiting
  - `src/core/node-manager.js` (498 lines) - Node registration, heartbeat, client-to-node mapping in Redis
  - `src/core/websocket-manager.js` (218 lines) - **Legacy/unused** simple WebSocket manager, superseded by MessageRouter
- Depends on: Redis, validators, middleware
- Used by: All services

**Services:**
- Purpose: Domain-specific real-time feature handlers
- Location: `src/services/`
- Contains: 8 service modules (see Service Inventory below)
- Depends on: MessageRouter for all client communication
- Used by: Server.js dispatches to services via `handleAction()`

**Middleware:**
- Purpose: Cross-cutting concerns (auth, authz, rate limiting, reconnection)
- Location: `src/middleware/`
- Contains:
  - `src/middleware/auth-middleware.js` - Cognito JWT validation at WS upgrade
  - `src/middleware/authz-middleware.js` - Channel permission checks (`checkChannelPermission()`)
  - `src/middleware/rate-limiter.js` - Per-client rate limiting (Redis-backed with local fallback)
  - `src/middleware/reconnection-handler.js` - Session token recovery on reconnect
- Depends on: Utils, Redis
- Used by: Server.js and services

**Utilities:**
- Purpose: Shared helpers
- Location: `src/utils/`
- Contains:
  - `src/utils/error-codes.js` - Standardized error codes (`AUTH_*`, `AUTHZ_*`, `RATE_LIMIT_*`, `SERVICE_*`) and `createErrorResponse()` factory
  - `src/utils/logger.js` - Structured logging with `withCorrelation()` support
  - `src/utils/metrics-collector.js` - CloudWatch metrics emission

**Validators:**
- Purpose: Message structure and payload validation
- Location: `src/validators/`
- Contains:
  - `src/validators/message-validator.js` - Service whitelist, payload size (64KB), channel name format

## Data Flow

**Client Message Processing:**

1. Client sends JSON over WebSocket: `{ service: 'crdt', action: 'update', channel: '...', ... }`
2. `server.js` `handleMessage()` generates correlation ID, calls `messageRouter.validateAndRateLimit()`
3. `MessageValidator` checks structure (service + action required), payload size (64KB), channel name format
4. `RateLimiter` checks per-client rate (uses Redis or local fallback)
5. `server.js` looks up service instance from `this.services` Map, calls `serviceInstance.handleAction(clientId, action, data)`
6. Service processes action, uses `messageRouter.sendToChannel()` or `messageRouter.sendToClient()` for responses
7. `MessageRouter.sendToChannel()` publishes to Redis channel `websocket:route:{channel}`, targeting specific nodes
8. Receiving nodes' Redis subscribers deliver to local WebSocket clients via `broadcastToLocalChannel()`

**Channel Subscription Flow:**

1. Service calls `messageRouter.subscribeToChannel(clientId, channel)`
2. MessageRouter adds channel to client's local channel set
3. NodeManager registers node-to-channel mapping in Redis SET `websocket:channel:{channel}:nodes`
4. MessageRouter subscribes to Redis channel `websocket:route:{channel}` if not already subscribed
5. SessionService updates session subscriptions for reconnection recovery

**CRDT Document Sync Flow:**

1. Client subscribes to `doc:{documentId}` channel via `crdt` service `subscribe` action
2. CRDTService creates Y.Doc in memory, hydrates from Redis cache or DynamoDB snapshot
3. Client receives full Y.Doc state as `crdt:snapshot` message
4. Client sends Y.js updates as base64-encoded binary via `crdt` service `update` action
5. CRDTService applies update to in-memory Y.Doc, batches operations (10ms window)
6. Batched updates merged via `Y.mergeUpdates()` and broadcast to channel
7. Remote nodes apply updates to their local Y.Doc via `channelMessageInterceptors`
8. Debounced snapshot writes to DynamoDB (5s inactivity) or threshold-based (50 ops)

**State Management:**
- **Ephemeral state** (presence, cursors, reactions): In-memory Maps per service, lost on restart
- **Session state**: Redis + LRU local cache with 24hr TTL (`src/services/session-service.js`)
- **CRDT document state**: In-memory Y.Doc per channel, snapshotted to DynamoDB via debounced writes
- **Document metadata**: Redis (hot, sorted set `doc:list` + `doc:meta:{id}`) + DynamoDB `crdt-documents` table (durable), with Redis-to-DynamoDB hydration on cache miss
- **CRDT snapshots**: DynamoDB `crdt-snapshots` table (compressed gzip), Redis hot-cache `crdt:snapshot:{channel}` (1hr TTL)
- **Node cluster state**: Redis SETs and hashes with TTL-based heartbeats (90s expiry)
- **Activity history**: Redis list `activity:history:{channel}` (capped at 200, 24hr TTL)

## Service Inventory

| Service | File | Lines | Constructor Args | DynamoDB | Redis Direct | Lifecycle Hooks |
|---------|------|-------|-----------------|----------|-------------|----------------|
| ChatService | `src/services/chat-service.js` | 407 | router, logger, metrics | No | No | onClientConnect, onClientDisconnect, shutdown |
| PresenceService | `src/services/presence-service.js` | 533 | router, **nodeManager**, logger, metrics | No | No | onClientConnect, handleDisconnect, shutdown |
| CursorService | `src/services/cursor-service.js` | 607 | router, logger, metrics | No | No (dead code) | onClientConnect, onClientDisconnect, shutdown |
| ReactionService | `src/services/reaction-service.js` | 285 | router, logger, metrics | No | No | handleDisconnect |
| CRDTService | `src/services/crdt-service.js` | **1943** | router, logger, metrics, **redis** | **Yes** (2 tables) | **Yes** | handleDisconnect, shutdown |
| SessionService | `src/services/session-service.js` | 144 | redis, logger, router | No | **Yes** | (called directly, not routed via handleAction) |
| SocialService | `src/services/social-service.js` | 127 | router, logger, metrics | No | No | handleDisconnect |
| ActivityService | `src/services/activity-service.js` | 297 | router, logger, metrics, **redis** | No | **Yes** | onClientConnect, handleDisconnect |

## Key Abstractions

**MessageRouter (`src/core/message-router.js`):**
- Purpose: Central abstraction for all client communication and channel management
- Pattern: Mediator - all services communicate through this, never directly to WebSockets
- Key methods: `sendToClient()`, `sendToChannel()`, `subscribeToChannel()`, `getClientData()`, `broadcastToAll()`, `getChannelClients()`
- Handles Redis pub/sub for multi-node routing transparently
- Includes `channelMessageInterceptors` Map for services needing to react to remote messages (used by CRDT)
- Batched broadcast: uses `setImmediate()` for recipient lists > 50 to avoid blocking event loop

**NodeManager (`src/core/node-manager.js`):**
- Purpose: Cluster membership, client-to-node mapping, channel-to-node mapping
- Pattern: Registry with heartbeat-based health (30s interval, 90s TTL)
- Redis key namespace: `websocket:node:*`, `websocket:client:*`, `websocket:channel:*`
- Includes local cache (`channelNodesCache`) for `getNodesForChannel()` with 5s TTL to reduce Redis SMEMBERS calls

**Service Contract (implicit, not enforced by base class):**
- Required: `handleAction(clientId, action, data)` - message dispatch entry point
- Optional: `handleDisconnect(clientId)` - cleanup on client disconnect
- Optional: `onClientConnect(clientId)` - initialization on connect
- Optional: `shutdown()` - graceful teardown (flush state, clear timers)
- Optional: `getStats()` - monitoring data for `/stats` endpoint
- Helper pattern: Each service implements `sendToClient()` and `sendError()` as wrappers around MessageRouter

**Authorization (`src/middleware/authz-middleware.js`):**
- Channel-based: `public:*` open, `admin:*` requires isAdmin, others checked against user's `channels` array
- Called inline by each service that needs it (not middleware in the traditional sense)
- Throws `AuthzError` with standardized error codes

## Entry Points

**HTTP Server (`src/server.js` line 262):**
- Routes: `/health` (GET), `/cluster` (GET), `/stats` (GET), static SPA serving with fallback to `index.html`

**WebSocket Upgrade (`src/server.js` line 345):**
- Flow: Connection limit check -> JWT validation via `AuthMiddleware` -> Session recovery via `handleReconnection()` -> Client registration -> Service `onClientConnect` hooks -> Welcome message with `sessionToken`

**Lambda Handler (`src/lambda/message-review-handler.js`):**
- Triggers: EventBridge events
- Purpose: CRDT snapshot persistence (decoupled from gateway process, production path)

## Error Handling

**Strategy:** Defensive try/catch at every level with graceful degradation

**Patterns:**
- Each service wraps `handleAction()` in try/catch, sends structured error via `sendError()`
- `sendError()` uses `createErrorResponse()` from `src/utils/error-codes.js`
- Standardized error codes: `AUTH_*`, `AUTHZ_*`, `RATE_LIMIT_*`, `VALIDATION_*`, `SERVICE_*`
- Redis failures: fall back to local-only mode (messages only reach same-node clients)
- DynamoDB failures: non-fatal for CRDT operations (Y.Doc stays in memory, snapshots retried later)
- Correlation IDs generated per message in `server.js` `handleMessage()` and passed to services via `data.correlationId`

## Cross-Cutting Concerns

**Logging:** Structured logger at `src/utils/logger.js` with `withCorrelation()` support. All services receive logger via constructor. Controlled by `LOG_LEVEL` env var.

**Validation:** Two-tier: (1) `MessageValidator` in `src/validators/message-validator.js` validates structure/size at router level, (2) each service validates action-specific fields inline (channel names, payload formats, etc.).

**Authentication:** Cognito JWT validation at WebSocket upgrade time (`src/middleware/auth-middleware.js`). User context (`userId`, `email`, `channels`, `isAdmin`, `displayName`) stored in connection metadata and accessible via `messageRouter.getClientData(clientId).userContext`.

**Authorization:** Channel-based permission checks via `checkChannelPermission()` in `src/middleware/authz-middleware.js`. Called by individual services (chat, presence, cursor, reaction, crdt) before channel operations. Not a request pipeline middleware.

**Metrics:** CloudWatch metrics via `src/utils/metrics-collector.js`. Flushed every 60 seconds. Tracks: `ConnectionFailures`, `AuthorizationDenials`, connection counts, message latency, error counts.

**Horizontal Scaling:**
- Supported via Redis pub/sub: each node publishes to `websocket:route:{channel}`, only nodes with subscribers receive
- NodeManager tracks client-to-node and channel-to-node mappings in Redis
- Direct client messaging across nodes via `websocket:direct:{nodeId}` channels
- Limitation: CRDT Y.Doc state is per-node in memory. Cross-node sync handled by `channelMessageInterceptors` but snapshot writes could conflict if same document open on multiple nodes

---

*Architecture analysis: 2026-04-12*
