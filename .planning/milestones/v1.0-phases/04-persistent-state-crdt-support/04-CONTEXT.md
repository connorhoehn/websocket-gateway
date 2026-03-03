# Phase 4: Persistent State & CRDT Support - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

CRDT operation broadcasting and periodic snapshot persistence to DynamoDB. This phase enables:
- Real-time Y.js operation broadcasting to subscribed clients via existing Redis pub/sub (<50ms latency)
- Periodic snapshots of CRDT state to DynamoDB (every 5 minutes, or 50 operations, or when all clients disconnect)
- Snapshot retrieval for clients reconnecting after disconnect

This builds on Phase 2's Redis pub/sub infrastructure and follows the established service pattern (ChatService, PresenceService, etc.).

</domain>

<decisions>
## Implementation Decisions

### CRDT Library & Data Model
- **Y.js** as the CRDT library (industry standard, proven at scale, rich ecosystem)
- **Opaque relay pattern**: Gateway treats Y.js operations as binary blobs (base64 encoded)
- Gateway does NOT parse Y.js update format — clients handle encoding/decoding
- **1:1 mapping**: One document per channel (channel name IS the document ID)
- Example: `channel='doc:abc123'` maps to document ID `abc123`

### Message Format
- **Operation message**: `{ service: 'crdt', action: 'update', channel, update: <base64> }`
- **Snapshot request**: `{ service: 'crdt', action: 'getSnapshot', channel }`
- **Snapshot response**: `{ type: 'crdt', action: 'snapshot', channel, snapshot: <base64>, timestamp }`
- Base64 encoding for Y.js binary updates (consistent with existing service pattern)
- Operations represent gzip-compressed Y.js state vectors

### Snapshot Triggers
Three triggers for writing snapshots to DynamoDB:
1. **Time-based**: Every 5 minutes (required by success criteria)
2. **Operation count**: After 50 operations since last snapshot
3. **Channel close**: When all clients disconnect from a channel (final snapshot)

### Snapshot Storage
- **Compression**: gzip before storing in DynamoDB (~60-80% size reduction)
- **TTL**: 7 days retention (balances cost with reasonable recovery window)
- **DynamoDB table**: `crdt-snapshots` with on-demand billing
- **Schema**: document ID (partition key), timestamp, gzipped snapshot payload, TTL attribute

### Broadcasting Behavior
- **Batching**: Collect operations within 10ms window, then broadcast as array
- Reduces Redis pub/sub message volume while staying well within <50ms requirement
- **Ordering**: Best-effort (no guarantees) — Y.js handles convergence regardless of order
- **Broadcast failures**: Log error and continue — snapshots provide eventual consistency
- **Echo filtering**: Don't send operations back to the sender (follows chat service pattern)

### Client Reconnection Flow
- **Explicit fetch**: Client sends `{ service: 'crdt', action: 'getSnapshot', channel }`
- **No snapshot exists**: Return empty state `{ snapshot: null }` — new documents start fresh
- **DynamoDB read failure**: Return empty state and log error (graceful degradation)
- **Response includes timestamp**: Client can see snapshot age for debugging

### Claude's Discretion
- Exact DynamoDB table configuration (indexes, provisioning)
- Logging levels and debug information
- Metrics and instrumentation specifics
- Error message wording

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **MessageRouter** (`src/core/message-router.js`): Handles Redis pub/sub broadcasting with <50ms latency. Use `sendToChannel(channel, message)` for operation broadcasting.
- **Service pattern**: All services implement `constructor(messageRouter, logger)` and `handleAction(clientId, action, data)`
- **LRU cache** from `lru-cache` library: Used in ChatService for bounded memory. Can track pending operations for batching.
- **Periodic cleanup pattern**: ChatService uses `setInterval()` for 5-minute cleanups — reuse for snapshot timing.

### Established Patterns
- **Base64 for binary data**: Existing pattern for WebSocket message payloads (used in chat)
- **Redis pub/sub**: MessageRouter already handles distributed broadcasting across nodes
- **Authorization**: Services call `checkChannelPermission()` before allowing subscriptions
- **Graceful degradation**: Services handle Redis failures by logging and continuing

### Integration Points
- **Register new service**: Add CRDTService to `src/server.js` in `initializeServices()` method (line 145-171)
- **DynamoDB client**: Create in CRDTService constructor, similar to how services use MessageRouter
- **AWS CDK infrastructure**: Add DynamoDB table definition in `lib/` (follow `redis.ts` pattern)
- **Message routing**: DistributedWebSocketServer routes `{ service: 'crdt' }` messages to CRDTService.handleAction()

### Architecture Alignment
- Follows **service-oriented architecture** with pluggable domain services
- Uses **hybrid fallback mode**: If DynamoDB unavailable, continue broadcasting (snapshots optional for ephemeral data)
- Leverages **intelligent routing**: MessageRouter only publishes to nodes with subscribed clients
- Maintains **stateful local state**: Track pending operations per channel for batching

</code_context>

<specifics>
## Specific Ideas

- Y.js state vectors are highly compressible — gzip achieves 60-80% size reduction
- 10ms batching window stays well within <50ms pub/sub requirement while reducing Redis message volume
- 50 operations threshold ensures snapshots rarely exceed 1-2 minutes old even in high-frequency scenarios
- Following ChatService's 5-minute cleanup interval pattern creates consistency across services
- Base64 encoding keeps WebSocket message handling consistent with existing chat implementation

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-persistent-state-crdt-support*
*Context gathered: 2026-03-02*
