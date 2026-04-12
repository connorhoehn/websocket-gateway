# Backend Architecture Deep Analysis

**Analysis Date:** 2026-04-12

## 1. Is crdt-service.js a God Object?

**Verdict: Yes.** At 1943 lines, `src/services/crdt-service.js` has at least 7 distinct responsibilities:

| Responsibility | Lines (approx) | Methods |
|---|---|---|
| CRDT Y.Doc management | ~200 | `handleSubscribe`, `handleUpdate`, `handleUnsubscribe`, Y.Doc lifecycle |
| Operation batching & broadcast | ~80 | `batchOperation`, `broadcastBatch`, awareness coalescing |
| DynamoDB snapshot persistence | ~200 | `writeSnapshot`, `retrieveLatestSnapshot`, `handleListSnapshots`, `handleGetSnapshotAtVersion`, `handleRestoreSnapshot` |
| DynamoDB document metadata CRUD | ~250 | `handleCreateDocument`, `handleDeleteDocument`, `handleUpdateDocumentMeta`, `handleListDocuments`, `_persistDocumentMeta`, `_loadDocumentMetaFromDynamo`, etc. |
| Redis hot-cache management | ~80 | `_saveSnapshotToRedis`, `_getSnapshotFromRedis`, Redis doc metadata |
| Document presence tracking | ~150 | `documentPresenceMap`, `_addToDocumentPresence`, `_removeFromDocumentPresence`, `_broadcastDocumentPresence`, `handleGetDocumentPresence` |
| Y.Doc idle eviction & lifecycle | ~80 | `_startIdleEviction`, `_cancelIdleEviction`, debounced snapshots, periodic snapshots |
| Version management | ~100 | `handleSaveVersion`, `handleClearDocument`, `_computeTtl` |
| DynamoDB table provisioning | ~60 | `_ensureTable`, `_ensureDocumentsTable` |

**Concrete split recommendation:**
- Extract `DocumentMetadataService` (CRUD for document metadata, Redis + DynamoDB dual-write)
- Extract `SnapshotService` (DynamoDB read/write, Redis cache, compression, version history)
- Extract `DocumentPresenceService` (presence map management, broadcast)
- Keep `CRDTService` focused on Y.Doc lifecycle, update application, and channel routing

## 2. Service Interface Consistency

**The `handleAction()` contract is consistent but not enforced.** All 7 routed services implement:

```javascript
async handleAction(clientId, action, data) {
  switch (action) {
    case 'subscribe': ...
    case 'unsubscribe': ...
    // service-specific actions
    default: this.sendError(clientId, `Unknown ${serviceName} action: ${action}`);
  }
}
```

**Inconsistencies found:**

| Concern | Pattern A (chat, cursor, reaction) | Pattern B (social, activity) | Pattern C (crdt) |
|---|---|---|---|
| Constructor args | `(router, logger, metrics)` | `(router, logger, metrics)` | `(router, logger, metrics, redis)` |
| `sendToClient()` | Calls `this.messageRouter.sendToClient()` | Calls `this.messageRouter.sendToClient()` | Same |
| `sendError()` | Uses `createErrorResponse()` with error codes | **Raw error message string** (no error codes) | Uses `createErrorResponse()` |
| Disconnect hook | `onClientDisconnect(clientId)` or `handleDisconnect(clientId)` | `handleDisconnect(clientId)` | `handleDisconnect()` -> `onClientDisconnect()` |
| Connect hook | `onClientConnect(clientId)` | `onClientConnect(clientId)` or none | None |
| Channel auth | Calls `checkChannelPermission()` | **Does not check** (social, activity) | Calls `checkChannelPermission()` |

**Key issue:** `server.js` calls `service.handleDisconnect()` (line 618) but some services name it `onClientDisconnect()`. PresenceService and CRDTService have `handleDisconnect()` as an alias to `onClientDisconnect()`. ChatService only has `onClientDisconnect()` which is **never called by server.js** because server.js checks for `service.handleDisconnect` (line 618).

**server.js line 616-624:**
```javascript
for (const [serviceName, service] of this.services) {
    if (service.handleDisconnect) {  // <-- only calls handleDisconnect
        await service.handleDisconnect(clientId);
    }
}
```

**Impact:** ChatService's `onClientDisconnect()` is dead code. Chat channel subscriptions are never cleaned up on disconnect (MessageRouter handles the channel unsubscribe, but ChatService's `this.clientChannels` Map leaks entries).

## 3. DynamoDB Access Patterns

**No data access layer.** DynamoDB access is entirely inline within `src/services/crdt-service.js`.

**Tables:**
- `crdt-snapshots` (env: `DYNAMODB_CRDT_TABLE`): documentId (HASH) + timestamp (RANGE)
- `crdt-documents` (env: `DYNAMODB_DOCUMENTS_TABLE`): documentId (HASH only)

**Access patterns in crdt-service.js:**

| Operation | DynamoDB Command | Location |
|---|---|---|
| Write snapshot | `PutItemCommand` | `writeSnapshot()` line 952 |
| Read latest snapshot | `QueryCommand` (ScanIndexForward: false, Limit: 1) | `retrieveLatestSnapshot()` line 772 |
| List snapshot versions | `QueryCommand` (ScanIndexForward: false, Limit: N) | `handleListSnapshots()` line 1016 |
| Get snapshot at version | `QueryCommand` (exact key) | `handleGetSnapshotAtVersion()` line 1073 |
| Write document meta | `PutItemCommand` | `_persistDocumentMeta()` line 231 |
| Read document meta | `GetItemCommand` | `_loadDocumentMetaFromDynamo()` line 246 |
| Scan all documents | `ScanCommand` | `_loadAllDocumentsFromDynamo()` line 262 |
| Delete document meta | `DeleteItemCommand` | `_deleteDocumentMetaFromDynamo()` line 294 |
| Ensure table exists | `DescribeTableCommand` / `CreateTableCommand` | `_ensureTable()`, `_ensureDocumentsTable()` |

**Concerns:**
- Raw DynamoDB SDK calls with manual attribute marshalling (`{ S: value }`, `{ N: String(value) }`, `{ B: buffer }`)
- No DynamoDB DocumentClient or Marshall/Unmarshall helpers used
- `_dynamoItemToDocument()` is a manual unmarshaller (line 277)
- `ScanCommand` used for `_loadAllDocumentsFromDynamo()` -- will not scale beyond ~1MB / 100s of documents
- No pagination support on any query
- Table creation logic mixed into service constructor

## 4. Redis Usage Patterns

**Redis access is scattered across 4 files with different patterns:**

| File | Redis Client Source | Usage |
|---|---|---|
| `src/services/crdt-service.js` | Constructor param `redisClient` | Snapshot cache, doc metadata, doc list sorted set |
| `src/services/activity-service.js` | Constructor param `redisClient` | Activity history list (LPUSH/LTRIM/LRANGE) |
| `src/services/session-service.js` | Constructor param `redis` (different name!) | Session token storage (setEx/get/del) |
| `src/core/message-router.js` | `this.redisPublisher` / `this.redisSubscriber` | Pub/sub routing channels |
| `src/core/node-manager.js` | Constructor param `redisClient` | Node registry, client mapping, channel mapping |

**Redis availability check is duplicated:**
- `crdt-service.js` line 313: `_isRedisAvailable()` checks `this.redisClient && this.messageRouter && this.messageRouter.redisAvailable !== false`
- `activity-service.js` line 187: `_isRedisAvailable()` -- identical implementation
- `session-service.js` line 139: `isRedisAvailable()` checks `this.messageRouter ? this.messageRouter.redisAvailable : true`
- `cursor-service.js` line 145: inline `this.messageRouter && this.messageRouter.redisAvailable !== false`

**Key namespaces:**
- `crdt:snapshot:{channel}` - CRDT snapshot hot-cache (1hr TTL)
- `doc:meta:{id}` - Document metadata JSON
- `doc:list` - Sorted set of document IDs by updatedAt
- `session:{token}` - Session data JSON (24hr TTL)
- `activity:history:{channel}` - Capped list of activity events (24hr TTL)
- `websocket:node:*`, `websocket:client:*`, `websocket:channel:*` - Cluster state

**No centralized Redis abstraction.** Each service directly calls Redis commands.

## 5. Message Routing Abstraction Quality

**MessageRouter (`src/core/message-router.js`) is well-designed:**

**Strengths:**
- Clean mediator pattern: services never touch WebSocket directly
- Transparent multi-node routing via Redis pub/sub
- Batched broadcast with `setImmediate()` for >50 recipients (event loop friendly)
- Monotonic sequence numbers per channel for gap detection
- `channelMessageInterceptors` allows services to react to remote messages without coupling
- Graceful Redis fallback: local-only broadcast when Redis is down
- Redis health monitoring with automatic recovery detection

**Weaknesses:**
- Validation and rate limiting are coupled into the router (`validateAndRateLimit()` method)
- `MessageRouter` also manages channel subscriptions, session sync, and Redis pub/sub lifecycle -- borderline too many responsibilities
- `NodeManager` dependency is injected but tightly coupled (calls `this.nodeManager.getNodesForChannel()`, `subscribeClientToChannel()`, etc.)

## 6. Horizontal Scaling Support

**Current state: Partially supports horizontal scaling.**

**What works:**
- Multiple gateway nodes can join a cluster via Redis SETs
- Channel-aware routing: messages only published to nodes with active subscribers
- Node heartbeat (30s) with 90s TTL for dead node detection
- `channelMessageInterceptors` allow CRDT service to apply remote Y.Doc updates to local in-memory docs
- Session tokens stored in Redis enable cross-node reconnection

**What breaks or degrades:**
- **CRDT Y.Doc per-node memory**: Each node maintains its own Y.Doc. Cross-node sync relies on broadcasting updates via Redis pub/sub + interceptors. If a node joins late or misses a message, its Y.Doc diverges.
- **Document metadata in-memory fallback**: `docMetaFallback` Map is per-node. If Redis goes down, each node has its own divergent document list.
- **Document presence is per-node**: `documentPresenceMap` in crdt-service.js only tracks local clients. `_broadcastDocumentPresence()` calls `broadcastToLocalClients()` -- other nodes don't see the full presence picture.
- **Chat history is per-node**: `channelCaches` LRU in chat-service.js is in-memory only. New node joins get empty history.
- **Presence state is per-node**: `clientPresence` Map in presence-service.js is local only. Cross-node presence requires subscribing to `presence:{channel}` Redis channel, but the presence data store is not shared.
- **No sticky sessions**: If a client reconnects to a different node, the new node's CRDT service may not have the Y.Doc loaded yet (it will hydrate from Redis cache or DynamoDB).
- **ScanCommand for document listing**: Won't scale past ~1MB of document metadata in DynamoDB.

**NodeManager unsubscribe is O(n*m)**: `unsubscribeClientFromChannel()` (line 226-258) iterates all node clients and their channel sets to check if node should be removed from channel. At scale (1000+ clients per node, 100+ channels), this becomes expensive.

---

*Deep architecture analysis: 2026-04-12*
