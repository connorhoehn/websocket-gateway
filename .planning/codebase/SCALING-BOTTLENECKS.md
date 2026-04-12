# Scaling Bottleneck Analysis

**Date:** 2026-04-12
**Scope:** WebSocket gateway (Node.js + Redis pub/sub + DynamoDB + Y.js CRDT)
**Pod spec:** 500m CPU / 512Mi memory (Helm values.yaml)

---

## 1. What Breaks First

### At 50 concurrent users (comfortable)

The system works. The main cost is Redis ops from rate limiting and node-manager channel lookups.

- **Rate limiter:** Every inbound message triggers `INCR` + `TTL` + conditional `EXPIRE` = 2-3 Redis round-trips per message. At 50 users editing a doc, with awareness at 60/sec and CRDT updates, this is the dominant Redis load.
- **Node-manager `getNodesForChannel`:** Already mitigated with a 5-second in-memory cache (`channelNodesCache`). Without this cache the code comments estimate ~3,000 Redis ops/sec at 50 users.
- **Awareness coalescing (50ms window):** Effective. Reduces N awareness messages per window to 1 merged broadcast per channel.

**Estimated Redis ops/sec at 50 users (single document):**
| Source | ops/sec |
|---|---|
| Rate limiter (INCR+TTL+EXPIRE) | ~450 |
| Channel routing (PUBLISH) | ~120 |
| Node heartbeat | ~0.03 |
| Snapshot Redis cache writes | ~2 |
| **Total** | **~575** |

### At 100 concurrent users (stress begins)

- **`unsubscribeClientFromChannel` is O(N*M):** When a client leaves a channel, `NodeManager.unsubscribeClientFromChannel` calls `SMEMBERS` for all node clients, then for each client calls `SMEMBERS` on their channel set. With 100 clients on one node and 5 channels each, a single unsubscribe triggers up to 100 + 500 = 600 Redis commands sequentially. During a mass-disconnect (pod restart, network blip), this serializes hundreds of these O(N*M) operations.
- **Rate limiter Redis pressure doubles.** Every message still needs 2-3 Redis ops. At 100 users each sending awareness at 60/sec + CRDT at ~5/sec, rate limiting alone consumes ~6,500 Redis ops/sec.
- **Broadcast fan-out:** `broadcastToLocalChannel` iterates all `localClients` to find channel members. At 100 clients * 10 channels, this is a 1,000-entry Map scan per broadcast. Tolerable but not free on a single thread.

**Estimated Redis ops/sec at 100 users:**
| Source | ops/sec |
|---|---|
| Rate limiter | ~6,500 |
| Channel routing (PUBLISH) | ~240 |
| Snapshot + cache | ~5 |
| **Total** | **~6,750** |

### At 500 concurrent users (degraded/broken)

- **Single-threaded event loop saturation.** JSON.parse + JSON.stringify on every message, Y.applyUpdate, base64 encode/decode, and gzip for snapshots all compete for the same thread. At 500 users, the message handler processes ~30,000+ messages/sec. The 10ms CRDT batch window and 50ms awareness window start drifting as the event loop falls behind.
- **Rate limiter becomes the bottleneck.** ~32,500 Redis ops/sec just for rate limiting. A single Redis instance on ECS (no ElastiCache) will approach its single-connection throughput ceiling.
- **Y.Doc memory explosion** (see section 2).
- **`broadcastToLocalChannel` batching threshold (>50) triggers `setImmediate` yielding**, which is good but means broadcasts interleave with new inbound messages, increasing effective latency.
- **Node-manager channel cache (5s TTL) becomes stale.** With 500 users rapidly joining/leaving channels, the 5-second cache means routing decisions are based on stale membership data. Messages may be sent to nodes that no longer have subscribers, or miss nodes that just joined.

**Estimated Redis ops/sec at 500 users:**
| Source | ops/sec |
|---|---|
| Rate limiter | ~32,500 |
| Channel routing (PUBLISH) | ~1,200 |
| Snapshot + cache | ~25 |
| Session/node management | ~100 |
| **Total** | **~33,825** |

---

## 2. Memory Ceiling Per Pod

**Pod limit: 512Mi**

### Y.Doc sizing

A Y.Doc stores the full CRDT history (insertions, deletions, tombstones). Empirical estimates:

| Document complexity | Y.Doc memory | Notes |
|---|---|---|
| Empty doc | ~2 KB | Baseline |
| 10-page doc, light editing | 200-500 KB | Reasonable |
| 10-page doc, heavy multi-user editing (50 ops/sec for 1 hour) | 2-10 MB | Tombstone accumulation |
| Large doc with many sections + comments | 5-20 MB | Worst case per doc |

### Per-pod memory budget at scale

| Component | 50 users | 100 users | 500 users |
|---|---|---|---|
| Node.js baseline + V8 heap | ~80 MB | ~80 MB | ~80 MB |
| WebSocket connection state (localClients Map, buffers) | ~5 MB | ~10 MB | ~50 MB |
| Y.Doc instances (assume 5 active docs) | ~5 MB | ~25 MB | ~100 MB |
| Operation/awareness batch buffers | ~1 MB | ~3 MB | ~15 MB |
| Presence maps (documentPresenceMap, channelPresence) | ~1 MB | ~3 MB | ~15 MB |
| Rate limiter in-flight (local state is minimal, Redis-backed) | ~0.5 MB | ~1 MB | ~2 MB |
| Channel routing maps + node-manager caches | ~1 MB | ~2 MB | ~5 MB |
| **Total estimated** | **~94 MB** | **~124 MB** | **~267 MB** |

**Ceiling:** At 512Mi, the pod can likely survive 500 users if documents are small. But if even 2-3 documents grow to 20 MB Y.Doc size through heavy editing, the pod approaches OOM. The 10-minute idle eviction timer (`IDLE_EVICTION_MS = 600000`) helps, but active documents pin their Y.Docs in memory indefinitely.

**Critical risk:** There is no per-Y.Doc memory limit or circuit breaker. A pathological document (paste a novel, undo/redo spam) could grow a single Y.Doc to 50+ MB and OOM the pod.

---

## 3. Redis Ops/Sec at Each Scale Level

(Summary table from section 1)

| Scale | Rate limiter | Channel pub/sub | Node mgmt | Snapshots | **Total** |
|---|---|---|---|---|---|
| 50 users | ~450 | ~120 | ~5 | ~2 | **~575** |
| 100 users | ~6,500 | ~240 | ~10 | ~5 | **~6,750** |
| 500 users | ~32,500 | ~1,200 | ~50 | ~25 | **~33,825** |
| 1000 users | ~65,000 | ~2,400 | ~100 | ~50 | **~67,550** |

**Redis on ECS (no ElastiCache) ceiling:** A single Redis 7 instance on a typical ECS task (1 vCPU) can handle ~80,000-100,000 simple ops/sec. At 500+ users, the rate limiter alone consumes 30-40% of Redis capacity. At 1,000 users, Redis becomes the hard bottleneck.

**Note:** These estimates assume a single document channel. Multiple active documents multiply the channel PUBLISH volume linearly.

---

## 4. O(n^2) and O(n*m) Patterns

### CRITICAL: `NodeManager.unsubscribeClientFromChannel` -- O(N*M)

**File:** `src/core/node-manager.js`, lines 226-258

```javascript
const nodeClients = await this.redis.sMembers(this.keys.nodeClients(this.nodeId));
// For EACH client on this node...
for (const client of nodeClients) {
    // ...fetch ALL their channels from Redis
    const clientChannels = await this.redis.sMembers(`websocket:client:${client}:channels`);
    if (clientChannels.includes(channel)) {
        hasChannelClients = true;
        break;
    }
}
```

Where N = clients on the node, M = channels per client. This runs `N` sequential Redis `SMEMBERS` commands in the worst case (when the unsubscribing client was the last one on that channel). During pod shutdown, this runs for every client * every channel they were on.

**Impact:** At 100 clients with 5 channels each, a full pod drain triggers up to 500 unsubscribe calls, each potentially scanning 100 clients. That is 50,000 sequential Redis `SMEMBERS` calls during shutdown, taking 10+ seconds.

### MODERATE: `broadcastToLocalChannel` -- O(N) per broadcast

**File:** `src/core/message-router.js`, lines 603-648

Every channel broadcast iterates the entire `localClients` Map to find channel members. This is O(total_clients) not O(channel_members). At 500 clients, every awareness broadcast (happening every 50ms per channel) scans all 500 entries.

### MODERATE: `MessageRouter.unsubscribeFromChannel` channel liveness check -- O(N)

**File:** `src/core/message-router.js`, lines 152-171

```javascript
const stillNeeded = Array.from(this.localClients.values())
    .some(c => c.channels.has(channel));
```

Iterates all local clients to check if any still need the channel. Same O(N) per unsubscribe.

### LOW: `handleGetDocumentPresence` -- O(channels * clients)

**File:** `src/services/crdt-service.js`, lines 1597-1638

Iterates all `documentPresenceMap` entries and all `channelStates` entries, including nested loops over subscribers. Called on demand rather than per-message, so less critical.

### LOW: `_loadAllDocumentsFromDynamo` -- DynamoDB Scan

**File:** `src/services/crdt-service.js`, lines 261-272

Uses a full `ScanCommand` on the documents table. Acceptable during startup hydration but will slow down as the document count grows into thousands.

---

## 5. Hot Paths That Need Optimization

### 1. Rate Limiter (hottest path)

Every single inbound WebSocket message hits: `JSON.parse` -> `validateStructure` -> `validatePayloadSize` -> `rateLimiter.checkLimit` (2-3 Redis ops). At scale, the rate limiter generates more Redis traffic than all other operations combined.

**Fix:** Replace Redis-backed rate limiting with an in-memory sliding window per client. Rate limiting does not need cross-node consistency -- each pod rate-limits its own clients. This eliminates 60-90% of all Redis operations instantly.

### 2. CRDT Update Path

`handleUpdate` -> `Y.applyUpdate` -> `Y.encodeStateAsUpdate` -> `base64 encode` -> `_saveSnapshotToRedis` -> `batchOperation` -> `broadcastBatch` -> `mergeUpdates` -> `base64 encode` -> `sendToChannel` -> `PUBLISH`.

The hot-cache update (`_saveSnapshotToRedis`) runs on every single CRDT update, calling `Y.encodeStateAsUpdate(state.ydoc)` which re-serializes the entire document. For a 5 MB Y.Doc, this is a 5 MB allocation + base64 encode + Redis SET on every keystroke.

**Fix:** Debounce the Redis hot-cache update (it is already snapshot-debounced for DynamoDB but the Redis cache update in `handleUpdate` at line 569 is per-operation).

### 3. Awareness Broadcasting

The 50ms coalescing window is good but the broadcast itself (`sendToChannel`) still requires: serialize JSON -> PUBLISH to Redis -> all subscribed nodes parse JSON -> `broadcastToLocalChannel` iterates all clients. The JSON payload contains base64-encoded awareness state for every active user.

### 4. `JSON.stringify` / `JSON.parse` on Every Message

Every message is parsed from string to object, then re-serialized for Redis PUBLISH, then parsed again on the receiving node, then serialized again for each WebSocket client. Four serialization passes per message. Binary protocols (MessagePack, protobuf) would cut CPU and GC pressure significantly.

### 5. `crypto.randomUUID()` on Every Message

`handleMessage` in `server.js` line 527 generates a UUID correlation ID for every inbound message. UUID generation is not free at high throughput.

---

## 6. Architecture Changes to Unlock 1,000+ Users

### Tier 1: Zero-downtime wins (no architecture change)

1. **In-memory rate limiter.** Replace Redis-backed `RateLimiter` with a local sliding-window counter. Each pod rate-limits its own clients. Eliminates ~65,000 Redis ops/sec at 1,000 users.

2. **Channel-to-clients index.** Add a `Map<channel, Set<clientId>>` reverse index in `MessageRouter`. Replace the O(N) `localClients` scan in `broadcastToLocalChannel` with an O(1) lookup + O(K) send where K = channel members. This also fixes the O(N) liveness check in `unsubscribeFromChannel`.

3. **Fix `unsubscribeClientFromChannel`.** Instead of querying Redis for every client on the node, maintain a local `Map<channel, number>` counter of how many local clients are subscribed. Decrement on unsubscribe; when it hits 0, remove the node from the channel set. Eliminates the O(N*M) Redis scan entirely.

4. **Debounce Redis hot-cache updates.** The `_saveSnapshotToRedis` call in `handleUpdate` (line 569-573) should use the same debounce mechanism as `_scheduleDebouncedSnapshot`. Currently it re-encodes and pushes the full Y.Doc state to Redis on every single CRDT update.

5. **Y.Doc memory guard.** Track `Y.encodeStateAsUpdate(ydoc).byteLength` periodically and reject updates or force-compact documents exceeding a threshold (e.g., 20 MB). Prevents OOM from pathological documents.

### Tier 2: Moderate refactors

6. **Worker threads for Y.js operations.** Move `Y.applyUpdate`, `Y.encodeStateAsUpdate`, `mergeUpdates`, and gzip compression to a worker thread pool. These are CPU-bound operations that block the event loop. Node.js `worker_threads` with a shared ArrayBuffer for Y.Doc state, or a message-passing model.

7. **Binary WebSocket protocol.** Replace JSON + base64 with a binary protocol (MessagePack or protobuf). CRDT updates are already binary (Uint8Array) but get base64-encoded into JSON, inflating size by 33% and adding CPU overhead for encode/decode on both sides.

8. **Redis connection pooling / pipelining.** The current setup uses a single Redis client for all publish operations. At high throughput, pipeline multiple commands per round-trip. The `node-redis` client supports auto-pipelining but it should be verified it is enabled.

### Tier 3: Architecture changes for 1,000+ users

9. **Document-affinity routing.** Instead of any pod serving any document, use consistent hashing to assign documents to specific pods. This eliminates cross-node Redis pub/sub for CRDT updates -- the Y.Doc for a given document lives on exactly one pod, and all clients editing that document connect to that pod. Redis pub/sub becomes unnecessary for CRDT; it is only needed for global events (presence, activity).

10. **Horizontal pod autoscaling on connection count.** The Helm chart has `replicaCount: 1`. Add HPA based on WebSocket connection count (custom metric from the `/stats` endpoint). Target ~200 connections per pod for headroom.

11. **Y.Doc offloading / lazy loading.** Instead of keeping all active Y.Docs in memory, evict least-recently-used documents and reload from the Redis snapshot cache on demand. The current 10-minute idle eviction is too generous for memory-constrained pods.

12. **Separate awareness from CRDT transport.** Awareness (cursor position, user presence) is ephemeral and high-frequency. CRDT document updates are durable and lower-frequency. Running them through the same Redis pub/sub channel means awareness traffic competes with document updates. Split them into separate Redis channels with different QoS -- awareness can tolerate message drops; CRDT updates cannot.

### Summary: Scaling Ceiling by Tier

| Configuration | Max concurrent users (estimate) |
|---|---|
| Current architecture (1 pod, 512Mi) | ~200 |
| Tier 1 optimizations (same pod spec) | ~500 |
| Tier 1 + Tier 2 (same pod spec) | ~500-800 |
| Tier 1 + Tier 2 + HPA (multi-pod) | ~2,000+ |
| Tier 3 (document affinity + full refactor) | ~10,000+ |
