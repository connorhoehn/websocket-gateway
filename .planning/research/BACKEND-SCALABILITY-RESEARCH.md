# Backend Scalability Research

Research date: 2026-04-12
Scope: N concurrent users across M collaborative documents

---

## 1. Redis Pub/Sub Fan-Out

### Current Channel Model

Every service creates its own Redis channel namespace per logical channel:

| Service | Redis channel pattern | Example |
|---------|----------------------|---------|
| Chat | `websocket:route:{channel}` | `websocket:route:general` |
| Presence | `websocket:route:presence:{channel}` | `websocket:route:presence:doc-abc` |
| Cursor | `websocket:route:cursor:{channel}` | `websocket:route:cursor:doc-abc` |
| Reaction | `websocket:route:reactions:{channel}` | `websocket:route:reactions:doc-abc` |
| CRDT | `websocket:route:{channel}` | `websocket:route:doc-abc` |
| CRDT Awareness | `websocket:route:{channel}` (same as CRDT) | `websocket:route:doc-abc` |
| Activity | `websocket:route:activity:broadcast` | global broadcast channel |
| Social | `websocket:route:{channelId}` | `websocket:route:room-xyz` |
| Direct | `websocket:direct:{nodeId}` | `websocket:direct:node-abc123` |
| Broadcast | `websocket:broadcast:all` | global |

Per document, each user subscribes to roughly **4-5 Redis pub/sub channels** (CRDT, presence, cursor, reactions, chat). With M documents, the system creates up to **~5M Redis channels**.

### Channel Explosion Math

| Users (N) | Documents (M) | Redis Channels | Redis Subscriptions (per node) |
|-----------|---------------|----------------|-------------------------------|
| 10 | 2 | ~12 | ~12 |
| 50 | 10 | ~52 | ~52 |
| 100 | 20 | ~102 | ~102 |
| 500 | 50 | ~252 | ~252 |

Redis pub/sub performance: a single Redis 7 node can handle **~1M subscriptions** and **~500K messages/second** at small payload sizes. Channel count is not the concern -- message throughput is.

### Fan-Out Amplification

The real scaling concern is message fan-out. When user A moves their cursor in document D with 20 viewers:
1. Client sends cursor update to gateway node
2. Gateway publishes to `websocket:route:cursor:doc-D` via Redis
3. Redis delivers to **all subscribed gateway nodes** (not just those with doc-D clients)
4. Each node checks `targetNodes` list and broadcasts locally

The `targetNodes` optimization in `message-router.js` (line 309) is good: only nodes registered in `websocket:channel:{channel}:nodes` receive the message. However, the node-manager checks (`getNodesForChannel`) hit Redis on every publish with `SMEMBERS`.

### Scaling Concern: Per-Publish Redis Round-Trips

In `sendToChannel()` (message-router.js line 283), every channel message requires:
1. `SMEMBERS websocket:channel:{channel}:nodes` -- get target nodes
2. `PUBLISH websocket:route:{channel}` -- publish the message

Two Redis round-trips per message. At 40 cursor updates/sec per user with 50 users in one document, that is **4,000 Redis operations/sec** just for cursors in one document.

### Recommendations

1. **Cache `channelNodes` locally with TTL**: Instead of hitting Redis on every publish, cache the node set per channel for 5-10 seconds. Nodes joining/leaving a channel is rare vs. message frequency.

2. **Collapse channel namespaces per document**: Instead of separate channels for cursor/presence/CRDT per document, use a single document channel (`doc:{docId}`) and multiplex message types. This reduces Redis subscriptions by ~4x and simplifies the routing layer.

3. **Redis Cluster vs Single Node**: A single Redis 7 instance (ECS, per project constraints) handles 500 concurrent users comfortably. Redis Cluster is unnecessary until you exceed ~100K messages/sec sustained or ~64GB memory. Single-node Redis is the right choice for this stage.

4. **Pipeline Redis commands**: The `node-redis` client supports pipelining. Batch the `SMEMBERS` + `PUBLISH` into a single round-trip.

---

## 2. Awareness Channel Scaling

### Current Behavior

Awareness updates flow through `handleAwareness()` in crdt-service.js (line 461). Each awareness update:
- Is relayed to all channel subscribers via `sendToChannel()`
- Has **no batching** (unlike CRDT updates which batch at 10ms)
- Has **no server-side throttling** (client-side Y.js awareness protocol controls frequency)
- Is not persisted (correct -- awareness is ephemeral)

Y.js awareness protocol sends updates on:
- Cursor position changes (~50ms debounce client-side, so ~20/sec during active editing)
- User field changes (name, color -- rare)
- Heartbeat pings (every 30 seconds)
- Disconnect (once)

### Throughput Math

| Users in Doc | Awareness msgs/sec (active editing) | Redis publishes/sec |
|-------------|-------------------------------------|---------------------|
| 5 | 100 | 100 |
| 20 | 400 | 400 |
| 50 | 1,000 | 1,000 |
| 100 | 2,000 | 2,000 |

Each awareness message is ~200-500 bytes (encoded state with cursor pos, selection, user info). At 50 users actively editing one document: ~500KB/sec of awareness traffic through Redis.

### The Rate Limiter Gap

The rate limiter (rate-limiter.js) has a `crdt` bucket at **500 msgs/sec** per client. Since awareness goes through the CRDT service, it shares this bucket with actual CRDT updates. This is generous -- a single client producing 500 awareness updates/sec would indicate a bug.

However, the rate limiter does **not** differentiate awareness from CRDT updates. A client spamming awareness could crowd out real CRDT syncs.

### Recommendations

1. **Server-side awareness coalescing**: Buffer awareness updates per client per channel for 50-100ms and send only the latest state. This is safe because awareness is last-writer-wins. Implementation: add a `Map<clientId, {timer, latestUpdate}>` in crdt-service, similar to the existing `operationBatches` pattern.

2. **Separate rate limit bucket for awareness**: Add an `awareness` message type with a limit of 30 msgs/sec per client (matches ~30fps cursor tracking). Add detection in `detectMessageType()`:
   ```
   if (message.service === 'crdt' && message.action === 'awareness') return 'awareness';
   ```

3. **Delta-only awareness**: The Y.js awareness protocol already sends only changed fields. Verify the client is not sending full awareness state on every update. If it is, switch to `awareness.setLocalStateField()` for cursor-only updates.

4. **Awareness fan-out reduction**: For documents with >20 concurrent editors, consider downsampling awareness for "distant" users (users not editing the same section). This is a UX tradeoff but dramatically reduces traffic.

---

## 3. Connection Management

### Current Limits

From server.js:
- `MAX_TOTAL_CONNECTIONS`: 10,000 (env-configurable)
- `MAX_CONNECTIONS_PER_IP`: 100 (env-configurable)
- Connection tracking: `this.connections` Map (in-memory)
- Ping/pong keepalive: 30-second interval

### WebSocket Connections Per Node

Node.js with `ws` library can handle **~50K concurrent WebSocket connections** per process with modest memory (~2-4GB RSS). The 10,000 default limit is conservative and appropriate for a 512Mi pod.

Memory per connection:
- WebSocket object: ~2-4KB
- Client metadata in `localClients` Map: ~1KB
- Per-service state (presence, cursor, channels): ~2KB per service per connection
- Total: ~15-20KB per connection

At 10,000 connections: **~150-200MB** just for connection state. Combined with Y.js docs and Node.js overhead, 512Mi is tight. Recommend **1Gi memory limit** for production pods.

### Horizontal Scaling Strategy

**Current state**: The Helm chart supports `replicaCount` (values-multi-replica.yaml uses 3). The K8s Service is `ClusterIP`, which does **round-robin load balancing by default**. This is wrong for WebSockets.

**Problem**: K8s `ClusterIP` services use iptables/IPVS round-robin for new TCP connections. Once a WebSocket is established, it stays on that node. But initial connection distribution can be uneven, and there is no connection-count-aware balancing.

**Required changes for production**:

1. **Use an Ingress or NLB with WebSocket support**: The DISTRIBUTED_ARCHITECTURE.md already mentions NLB. AWS NLB with target groups balances TCP connections. ALB also works with WebSocket upgrade support and provides better L7 features (path routing, health checks).

2. **Sticky sessions are NOT needed**: The architecture already stores all shared state in Redis. Any gateway node can serve any client. The message-router correctly routes cross-node messages via Redis pub/sub. Stateless routing is the right approach.

3. **Connection draining on deploy**: The current SIGTERM handler (`server.js` line 819) calls `shutdown()` which closes all connections with code `1001`. This is correct for graceful draining. However:
   - There is no `preStop` hook in the Helm deployment to give time for draining
   - Kubernetes sends SIGTERM and waits `terminationGracePeriodSeconds` (default 30s) before SIGKILL
   - **Add a `preStop` hook** with a 10-second sleep to allow in-flight requests to complete
   - **Add `terminationGracePeriodSeconds: 60`** to the pod spec

4. **Pod Disruption Budget**: Add a PDB to ensure at least 1 pod stays running during rolling updates:
   ```yaml
   apiVersion: policy/v1
   kind: PodDisruptionBudget
   spec:
     minAvailable: 1
     selector:
       matchLabels:
         app.kubernetes.io/component: gateway
   ```

5. **HPA (Horizontal Pod Autoscaler)**: Scale based on connection count or CPU. Expose connection count via the `/stats` endpoint or Prometheus metrics.

### Client Reconnection

The reconnection-handler middleware and session-service already handle reconnection with session tokens. When a pod dies, clients reconnect to another pod, restore their session from Redis, and re-subscribe to channels. This is well-implemented.

**Gap**: After reconnection, the client gets a fresh Y.Doc state from the CRDT service (via `handleSubscribe` which hydrates from Redis/DynamoDB). But there is no mechanism to replay missed channel messages (chat, reactions) that occurred during the disconnection window. For short disconnects (<5s), this is acceptable. For longer outages, clients may miss messages.

---

## 4. DynamoDB Capacity

### Current Access Patterns

**Table: `crdt-snapshots`**
- Partition key: `documentId` (String)
- Sort key: `timestamp` (Number)
- Billing: `PAY_PER_REQUEST` (on-demand)

**Write patterns:**
1. Snapshot writes: debounced at 5s of inactivity, or every 50 operations, or periodic (default 5 minutes). One write per document per snapshot cycle.
2. Each snapshot is a gzip-compressed Y.js state. Size depends on document content -- typically 1KB-100KB compressed.

**Read patterns:**
1. On subscribe: `Query` for latest snapshot (`ScanIndexForward: false, Limit: 1`) -- one read per document load
2. List snapshots (version history): `Query` with `Limit: 20` -- rare, user-initiated
3. Get specific version: `Query` with exact key -- rare, user-initiated

### Hot Partition Analysis

DynamoDB distributes data across partitions by hash key. Each unique `documentId` gets its own partition range. Concerns:

- **No hot partition risk**: Each document has its own partition key. Even if one document gets heavy traffic, the writes are debounced and infrequent (~1 write every 5-50 seconds per active document).
- **On-demand is correct**: The access pattern is bursty (many reads at document open, then periodic writes). Provisioned capacity would either over-provision or throttle. On-demand handles this well.

### Capacity Math

| Active Documents | Snapshot Writes/min | Snapshot Reads/min | Estimated Monthly Cost |
|-----------------|--------------------|--------------------|----------------------|
| 10 | ~2-10 | ~10 (document opens) | < $1 |
| 50 | ~10-50 | ~50 | < $5 |
| 200 | ~40-200 | ~200 | < $20 |

DynamoDB is not a bottleneck at any foreseeable scale for this use case.

### Missing GSI Concerns

The document listing feature (`handleListDocuments` in crdt-service.js) currently uses Redis for document metadata with an in-memory fallback. If this needs to scale or persist beyond Redis TTL, a GSI on `documentId` with a secondary sort (e.g., `updatedAt`) would be needed. But the current approach (Redis as primary, DynamoDB for snapshots only) is sound.

### TTL

Snapshots have a 7-day TTL (`ttl` attribute set in `writeSnapshot`). This is good for controlling table growth. Verify that DynamoDB TTL is enabled on the table (it is not set in the `_ensureTable()` code -- this is a gap for local dev, but production tables via CDK likely have it).

---

## 5. Memory Pressure

### Y.js Documents In Memory

The CRDT service keeps a `Y.Doc` per active channel in `this.channelStates`. This is the primary memory concern.

**Y.Doc memory size** depends on:
- Document content volume
- Edit history (Y.js keeps a tombstone log of all operations)
- Number of types (maps, arrays, text) in the document

Typical collaborative document Y.Doc sizes:
| Document Complexity | Y.Doc Memory |
|--------------------|-------------|
| Simple (few paragraphs) | 50KB-200KB |
| Medium (10+ sections, comments) | 200KB-1MB |
| Large (lengthy doc, many edits) | 1MB-10MB |
| Very large (months of edits, no compaction) | 10MB-50MB+ |

### Scaling Math

| Active Documents | Memory Range | With 512Mi Pod Limit |
|-----------------|-------------|---------------------|
| 10 | 0.5MB - 10MB | Safe |
| 50 | 2.5MB - 50MB | Safe |
| 100 | 10MB - 100MB | Caution |
| 200 | 20MB - 200MB | Danger zone with connections |

The Y.Doc + connections + Node.js baseline (~100MB) means a 512Mi pod safely handles ~50-100 active documents. Beyond that, increase pod memory or implement eviction.

### Eviction Strategy (Not Currently Implemented)

The current code only removes channel state when `subscriberCount` drops to 0 (crdt-service.js line 388-394). But it never evicts idle documents that have subscribers. This is acceptable for small scale but needs attention:

**Recommended eviction policy:**

1. **Subscriber-based eviction**: When last subscriber leaves, write a final snapshot and evict the Y.Doc from memory (current behavior). This works correctly.

2. **Idle timeout eviction**: If a document has subscribers but no updates for 30+ minutes, snapshot and evict the Y.Doc. Keep the channel subscription alive but lazy-load the Y.Doc on next update.

3. **Memory pressure eviction**: Monitor `process.memoryUsage().heapUsed`. When it exceeds 70% of the pod memory limit, evict the least-recently-used Y.Docs. The `writeSnapshot()` method already handles persistence before eviction.

4. **Y.Doc compaction**: Periodically call `Y.encodeStateAsUpdate()` and re-apply to a fresh `Y.Doc()`. This removes tombstones and can reduce memory by 50-80% on heavily-edited documents. Schedule this during idle periods.

### Additional In-Memory State

- `PresenceService.clientPresence`: Map of all client presence data. ~1KB per client. At 500 clients: ~500KB. Not a concern.
- `PresenceService.channelPresence`: Duplicate references to the same objects. Negligible overhead.
- `CursorService.clientCursors` + `channelCursors`: ~500 bytes per active cursor. At 500: ~250KB.
- `ChatService.channelCaches`: LRU cache, max 100 messages per channel. At 50 channels with 100 messages averaging 500 bytes: ~2.5MB.
- `SessionService.localSessionStore`: LRU max 10,000 sessions at ~2KB each: ~20MB worst case.
- `ActivityService`: Redis list references, minimal local state.

**Total non-Y.Doc memory at 500 users, 50 docs**: ~25-30MB. Not a concern.

---

## 6. Load Testing Strategy

### Recommended Tools

**k6** (preferred): Native WebSocket support, JavaScript-based (matches the codebase), excellent for scripting complex scenarios. Runs locally or distributed via k6 Cloud.

**Artillery**: Good alternative with YAML-based scenarios. Built-in WebSocket engine. Better for quick smoke tests.

### Test Scenarios

#### Scenario 1: Connection Storm
- Ramp from 0 to 500 WebSocket connections over 60 seconds
- Each connection authenticates (Cognito JWT or SKIP_AUTH)
- Measure: connection success rate, time-to-first-message, memory growth
- Target: 99% success, <500ms connection time

#### Scenario 2: Single Document Collaboration
- 50 users connected to one document
- Each user sends CRDT updates (typing) at 2-5 updates/sec
- Awareness updates at 10/sec (cursor movement)
- Measure: p50/p95/p99 message latency (time from send to receive by other clients), Redis throughput
- Target: p95 < 100ms for CRDT, p95 < 200ms for awareness

#### Scenario 3: Multi-Document Spread
- 100 users across 20 documents (5 users per document average)
- Mix of active editing (20%), reading (50%), idle (30%)
- Measure: per-document latency, total Redis ops/sec, memory per pod
- Target: No degradation vs Scenario 2 per-document metrics

#### Scenario 4: Chat + Reactions Burst
- 50 users in one channel
- Burst of 100 chat messages in 10 seconds + emoji reaction storm
- Measure: message delivery completeness (all users receive all messages), ordering, rate limiter behavior
- Target: 100% delivery, correct ordering, rate limiter kicks in above 100 msgs/sec

#### Scenario 5: Reconnection Storm
- 100 connected users
- Kill a gateway pod (simulate rolling update)
- All 100 clients reconnect simultaneously
- Measure: reconnection success rate, time to restore subscriptions, missed messages
- Target: 95% reconnect within 5 seconds

#### Scenario 6: Y.Doc Memory Growth
- Single document, 10 users editing continuously for 30 minutes
- Measure: Y.Doc size growth, snapshot frequency, heap memory
- Target: Y.Doc stays under 10MB, snapshots keep DynamoDB in sync

### Metrics to Capture

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| WebSocket connection count | `/stats` endpoint | >80% of MAX_TOTAL_CONNECTIONS |
| Message latency (p95) | Custom k6 metric | >200ms |
| Redis ops/sec | Redis `INFO` | >50K/sec |
| Redis memory | Redis `INFO` | >75% of available |
| Node.js heap used | `process.memoryUsage()` | >70% of pod limit |
| Y.Doc count | CRDT service stats | >100 per pod |
| Rate limit rejections | MetricsCollector | >10/sec sustained |
| DynamoDB throttles | CloudWatch | Any |

### k6 Script Skeleton

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const url = 'ws://localhost:8080';
  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // Subscribe to CRDT channel
      socket.send(JSON.stringify({
        service: 'crdt',
        action: 'subscribe',
        channel: 'load-test-doc-1',
      }));
    });

    socket.on('message', (data) => {
      // Measure latency from message timestamp
    });

    // Simulate typing
    socket.setInterval(() => {
      socket.send(JSON.stringify({
        service: 'crdt',
        action: 'update',
        channel: 'load-test-doc-1',
        update: '<base64-encoded-yjs-update>',
      }));
    }, 500);

    socket.setTimeout(() => socket.close(), 120000);
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}
```

---

## 7. Bottleneck Analysis

### Scaling Tiers

#### 10 Concurrent Users (2-3 documents)
**Bottleneck: None**
- Everything runs comfortably on a single 512Mi pod with one Redis instance
- Redis: <100 ops/sec
- Memory: <200MB total
- Status: Current architecture handles this with zero changes

#### 50 Concurrent Users (10 documents)
**Bottleneck: Awareness message throughput**
- ~1,000 awareness messages/sec through Redis
- ~500 CRDT updates/sec
- Redis: ~3,000 ops/sec (publish + SMEMBERS per message)
- Memory: ~400MB (Y.Docs + connections)
- **Action needed**: Awareness coalescing (50ms buffer) would cut awareness traffic by 50%. Bump pod memory to 1Gi.

#### 100 Concurrent Users (20 documents)
**Bottleneck: Redis round-trips per publish + single-node event loop**
- ~4,000 awareness + CRDT messages/sec
- Redis: ~12,000 ops/sec (2 commands per publish + rate limiter checks)
- Single Node.js process handling all serialization/deserialization
- Memory: ~600MB-1GB
- **Action needed**:
  1. Cache `channelNodes` locally (eliminate 50% of Redis round-trips)
  2. Pipeline Redis commands
  3. Scale to 2-3 gateway pods (already supported by architecture)
  4. Pod memory: 1.5Gi

#### 500 Concurrent Users (50+ documents)
**Bottleneck: Y.Doc memory + Redis pub/sub throughput**
- ~10,000 messages/sec through Redis
- ~50+ Y.Docs in memory per pod (if not evicted)
- Redis single-node throughput limit (~100K ops/sec) is still far away, but the per-pod overhead is significant
- Memory: potential 2-4GB per pod with large documents
- **Action needed**:
  1. All previous optimizations
  2. Y.Doc eviction with lazy loading
  3. Y.Doc compaction on idle
  4. 5-10 gateway pods with 2Gi memory each
  5. Consider separate Redis instances for pub/sub vs. data caching
  6. Collapse channel namespaces (single channel per document)
  7. HPA based on connection count or memory pressure

### First Bottleneck Summary

The **first bottleneck** as users scale will be **awareness message throughput causing Redis round-trip overhead**. At ~50 users, the per-publish `SMEMBERS` + `PUBLISH` pattern generates thousands of Redis round-trips per second. This manifests as increased message latency (p95 climbing above 100ms) before it causes actual failures.

The fix is low-effort: cache `channelNodes` in a local Map with 5-second TTL, and coalesce awareness updates with a 50ms buffer. These two changes alone push the comfortable limit from ~50 to ~200 concurrent users on the current architecture.

### Critical Path for Multi-Document Support

The upcoming multi-document feature multiplies the per-document overhead linearly. Key concerns:

1. **Channel subscription explosion**: Each document a user opens creates ~5 new Redis subscriptions. A user with 5 open documents has 25 subscriptions. Collapsing to one channel per document is important.

2. **Y.Doc lifecycle**: When a user switches between documents, the Y.Doc should remain in memory briefly (30s grace period) then be eligible for eviction. Avoid creating/destroying Y.Docs on every tab switch.

3. **Presence across documents**: The presence service needs a concept of "active document" vs "background document" to avoid broadcasting cursor updates for documents the user is not actively viewing.

---

## Summary of Recommendations by Priority

### P0 (Do before 100 users)
1. Cache `channelNodes` locally with 5-10 second TTL in message-router
2. Add awareness coalescing (50ms buffer) in crdt-service
3. Increase pod memory limit from 512Mi to 1Gi
4. Add `terminationGracePeriodSeconds: 60` and `preStop` hook to deployment

### P1 (Do before 500 users)
1. Collapse per-service channels into single per-document channel
2. Implement Y.Doc idle eviction (30-minute timeout)
3. Implement Y.Doc compaction on idle
4. Add HPA scaling policy based on connections or CPU
5. Add PodDisruptionBudget
6. Separate rate limit bucket for awareness messages
7. Add Prometheus metrics export for observability

### P2 (Future optimization)
1. Pipeline Redis commands (SMEMBERS + PUBLISH in one round-trip)
2. Consider separate Redis instances for pub/sub vs. cache
3. Explore Y.js worker threads for heavy document operations
4. Client-side awareness downsampling for large document sessions
5. Message replay buffer for short disconnection windows
