# CRDT Persistence Research

> How to make Y.js persistence robust, durable, and recoverable across gateway restarts, network partitions, and multi-node deployments.

---

## Current Implementation Summary

Before diving into recommendations, here is what exists today in `src/services/crdt-service.js`:

- **In-memory Y.Doc per channel**: `channelStates` Map holds a `Y.Doc` per active channel. Created on first subscribe, destroyed on last unsubscribe or document delete.
- **Redis hot-cache**: Full `Y.encodeStateAsUpdate()` stored at `crdt:snapshot:{channel}` with 1-hour TTL. Updated on every incoming update (non-blocking) and on every snapshot write.
- **DynamoDB cold storage**: Gzip-compressed Y.js state stored in `crdt-snapshots` table. Schema: `documentId` (HASH, string) + `timestamp` (RANGE, number). Snapshot binary stored as DynamoDB Binary attribute. 7-day TTL on items (when using direct write path).
- **Snapshot triggers**: Three paths trigger DynamoDB writes:
  1. Every 50 operations (`operationsSinceSnapshot >= 50`)
  2. Debounced after 5 seconds of inactivity (`SNAPSHOT_DEBOUNCE_MS`)
  3. Periodic timer (default every 5 minutes, `SNAPSHOT_INTERVAL_MS`)
- **EventBridge path**: Production uses EventBridge `crdt.checkpoint` events consumed by a Lambda (indirect write). Local dev uses `DIRECT_DYNAMO_WRITE=true` for direct `PutItemCommand`.
- **Hydration order on subscribe**: Redis cache first, then DynamoDB query (newest item), then empty doc.
- **Garbage collection disabled**: Both client (`{ gc: false }`) and server-side `clearDocument` use `gc: false`.
- **No state vector exchange**: Reconnecting clients receive a full `encodeStateAsUpdate()` -- no differential sync via `encodeStateVector` / `diffUpdate`.
- **Document metadata**: Stored in Redis (`doc:meta:{id}`, `doc:list` sorted set) with in-memory fallback. Not persisted to DynamoDB.

---

## 1. Y.js Snapshot Storage

### What Gets Stored

`Y.encodeStateAsUpdate(doc)` produces a `Uint8Array` containing the full document state as a single merged Y.js update. This is the correct format for persistence -- it can be applied to a fresh `Y.Doc` to reconstruct the full document.

An alternative is `Y.snapshot(doc)` which creates a read-only point-in-time view. Snapshots are useful for version history (comparing two points in time) but are **not suitable as the primary persistence format** because they cannot be used to reconstruct a writable document. The current approach of storing `encodeStateAsUpdate` is correct.

### Serialization Format

The current pipeline is:

```
Y.encodeStateAsUpdate(doc)  -->  gzip  -->  DynamoDB Binary attribute
```

This is good. Key considerations:

- **Base64 overhead**: The Redis cache stores base64 (33% size increase). This is fine for Redis since it avoids binary encoding issues, but DynamoDB correctly stores raw binary.
- **Gzip compression**: Y.js updates compress well (typically 60-80% reduction) because they contain repetitive CRDT metadata. The current `zlib.gzip` usage is appropriate.
- **Alternative: zstd**: For documents with heavy rich-text content, zstd can achieve 10-20% better compression ratios than gzip at comparable speed. Node.js requires a native addon (`@aspect-build/zstd` or similar). Worth benchmarking but not urgent.

### DynamoDB Size Limits

- **DynamoDB item size limit**: 400 KB per item.
- **Y.js document size**: A typical collaborative document with 10 sections, rich text, comments, and task items will produce an `encodeStateAsUpdate` of roughly 50-200 KB uncompressed. After gzip, this drops to 15-60 KB. Well within the 400 KB limit.
- **Danger zone**: Documents with heavy paste operations, many images (as data URIs in rich text), or thousands of comment threads could exceed limits. A document with 500+ operations and no compaction could reach 1-2 MB uncompressed.
- **Mitigation**: Monitor compressed snapshot sizes. If any approach 300 KB, trigger an alert. For very large documents, consider splitting the Y.Doc into sub-documents (one per section) -- Y.js supports this via `Y.Doc` subdocuments, though it adds complexity.

### Recommendation

The current storage format (gzip-compressed `encodeStateAsUpdate` as DynamoDB Binary) is correct and efficient. No changes needed. Add a size check before DynamoDB writes:

```javascript
if (compressed.length > 350_000) {
  this.logger.warn(`Snapshot for ${channelId} is ${compressed.length} bytes -- approaching DynamoDB 400KB limit`);
}
```

---

## 2. Incremental Updates vs Periodic Snapshots

### Current Approach: Periodic Compacted Snapshots Only

The current system stores only full snapshots (the latest merged state). Individual incremental updates are never persisted -- they exist only transiently in Redis pub/sub and in-memory Y.Doc. This is a **snapshot-only** strategy.

### Trade-offs

| Strategy | Pros | Cons |
|---|---|---|
| **Snapshot-only** (current) | Simple, small storage footprint, fast hydration (one read) | Data loss window between snapshots; no granular undo/audit trail |
| **Update log + periodic snapshot** | Zero data loss (every keystroke persisted), granular history | High write volume, complex replay logic, storage grows fast |
| **Hybrid: snapshot + recent updates** | Best of both; snapshot for base state, updates for recent changes | More complex hydration (apply snapshot then replay updates) |

### Analysis for This Project

The current snapshot-only approach has a **data loss window** equal to the time between the last snapshot write and a crash. In the worst case:

- A user makes 49 edits (below the 50-operation threshold).
- No 5-second inactivity pause occurs (continuous typing).
- The 5-minute periodic timer hasn't fired yet.
- The gateway crashes.
- **Result**: Up to 5 minutes of edits are lost.

In practice, the debounce timer (5s after last edit) significantly narrows this window. Most realistic data loss is 0-5 seconds.

### Recommendation: Keep Snapshot-Only, Tighten the Window

For a collaborative document tool (not a financial ledger), snapshot-only is the right trade-off. The complexity of an update log is not justified. However, tighten the safety net:

1. **Lower `SNAPSHOT_DEBOUNCE_MS` to 2000ms** (2 seconds). This bounds the worst-case data loss to ~2 seconds for active documents.
2. **Lower the operation threshold from 50 to 30**. Triggers faster snapshot writes under sustained load.
3. **Add a "dirty flag" flush on graceful shutdown**. When the process receives SIGTERM, iterate `channelStates` and write all dirty snapshots synchronously before exiting. This is the biggest gap today -- a rolling deploy can lose pending snapshots.

```javascript
// In constructor or init:
process.on('SIGTERM', async () => {
  this.logger.info('SIGTERM received, flushing dirty snapshots...');
  await this.writePeriodicSnapshots();
  process.exit(0);
});
```

---

## 3. Reconnect Recovery

### Current Behavior

When a client reconnects and sends `subscribe`, the server:

1. Checks Redis cache for the channel snapshot.
2. Falls back to DynamoDB if Redis misses.
3. Sends a full `encodeStateAsUpdate(state.ydoc)` as a `crdt:snapshot` message.
4. The client applies it via `Y.applyUpdate(doc, bytes, this)`.

This works but is **always a full state transfer**, even if the client only missed a few seconds of updates.

### Y.js State Vector Exchange

Y.js has built-in differential sync using state vectors:

```javascript
// Client sends its current state vector to the server
const clientSV = Y.encodeStateVector(clientDoc);

// Server computes only the missing updates
const diff = Y.encodeStateAsUpdate(serverDoc, clientSV);

// Client applies the diff (much smaller than full state)
Y.applyUpdate(clientDoc, diff);
```

This is the protocol used by `y-websocket` and is significantly more efficient for reconnecting clients. A client that disconnected for 30 seconds might only need a few hundred bytes instead of the full 100 KB document.

### Recommendation: Implement State Vector Sync

Add a new action `sync` that accepts the client's state vector:

**Client side** (GatewayProvider):

```typescript
// On reconnect, send state vector instead of bare subscribe
requestSync(): void {
  const sv = Y.encodeStateVector(this.doc);
  this._sendMessage({
    service: 'crdt',
    action: 'sync',
    channel: this.channel,
    stateVector: toBase64(sv),
  });
}
```

**Server side** (CRDTService):

```javascript
async handleSync(clientId, { channel, stateVector }) {
  const state = this.channelStates.get(channel);
  if (!state) {
    // No in-memory state -- fall back to full snapshot
    return this.handleSubscribe(clientId, { channel });
  }
  
  const svBytes = Buffer.from(stateVector, 'base64');
  const diff = Y.encodeStateAsUpdate(state.ydoc, new Uint8Array(svBytes));
  
  this.sendToClient(clientId, {
    type: 'crdt:snapshot',
    channel,
    snapshot: Buffer.from(diff).toString('base64'),
    differential: true,
  });
}
```

**When to use which**:

- First connect (no local state): full subscribe flow (current behavior).
- Reconnect (client has existing Y.Doc): state vector sync (new).
- Client offline for days (server evicted channel from memory): full snapshot from DynamoDB (current behavior).

---

## 4. State Compaction

### What Is Compaction?

Y.js CRDTs grow monotonically -- every insert, delete, and format change adds to the internal operation log. Even after text is deleted, the tombstones remain. Over time, a document that currently contains 1 KB of visible content might have 500 KB of CRDT metadata from its edit history.

### Garbage Collection (`gc`)

Y.js has a built-in garbage collection flag (`gc: true` on `Y.Doc`). When enabled:

- Deleted content tombstones are removed during `encodeStateAsUpdate`.
- The resulting snapshot is smaller.
- **Trade-off**: GC'd documents cannot merge with peers that still hold the pre-GC state. If client A has GC'd state and client B has non-GC'd state from the same document, merging may produce inconsistencies.

### Current State

Both client and server use `gc: false`. This is the safe default for real-time collaboration -- it ensures any two peers can always merge cleanly regardless of when they last synced.

### When to Compact

Compaction (GC) is safe when **no peers hold un-GC'd state**. This means:

1. **All clients are disconnected** from the document.
2. **No other gateway nodes** hold an in-memory Y.Doc for the channel.
3. The compacted snapshot is written to storage as the new baseline.

### Recommendation: Compact on Last-Unsubscribe + Delay

```javascript
async handleUnsubscribe(clientId, { channel }) {
  // ... existing logic ...
  
  if (state.subscriberCount === 0 && state.operationsSinceSnapshot > 0) {
    // No more subscribers. Safe to compact after a grace period.
    setTimeout(async () => {
      const currentState = this.channelStates.get(channel);
      if (currentState && currentState.subscriberCount === 0) {
        // Create a GC'd copy for storage
        const gcDoc = new Y.Doc({ gc: true });
        const fullState = Y.encodeStateAsUpdate(currentState.ydoc);
        Y.applyUpdate(gcDoc, fullState);
        
        // Encode the compacted state
        const compacted = Y.encodeStateAsUpdate(gcDoc);
        gcDoc.destroy();
        
        // Write compacted snapshot
        const compressed = await gzip(Buffer.from(compacted));
        await this.dynamoClient.send(new PutItemCommand({ /* ... */ }));
        
        // Replace in-memory doc with compacted version for future hydration
        currentState.ydoc.destroy();
        currentState.ydoc = new Y.Doc({ gc: false }); // Back to gc:false for live use
        Y.applyUpdate(currentState.ydoc, compacted);
        
        this.logger.info(`Compacted snapshot for ${channel} (${fullState.byteLength} -> ${compacted.byteLength} bytes)`);
      }
    }, 60_000); // 60-second grace period
  }
}
```

### Expected Size Reduction

For a document with moderate edit history, compaction typically reduces state size by 40-70%. A 200 KB state might compact to 60-80 KB.

### Multi-Node Safety

In a multi-node deployment, the "subscriberCount === 0" check is only valid for the local node. Other nodes might still hold the document. To make compaction safe across nodes:

- Before compacting, check Redis for a channel subscriber count (e.g., via a `crdt:subscribers:{channel}` counter incremented/decremented atomically).
- Or, only compact during a scheduled maintenance window when all active documents are force-flushed.

---

## 5. Stale Document Handling

### Current State

- DynamoDB snapshots have a 7-day TTL (`ttl` attribute set to `now + 7 days`).
- Redis snapshot cache has a 1-hour TTL.
- Document metadata in Redis has no TTL (persists until explicit delete).
- In-memory Y.Docs are evicted when `subscriberCount` reaches 0 (on last unsubscribe).

### Problems

1. **7-day snapshot TTL is too aggressive**. If no one opens a document for 8 days, its CRDT state is gone. The document metadata still exists in Redis, so users see it in the list, but opening it yields an empty document. This is data loss.
2. **No lazy loading**. Every document's Y.Doc is fully loaded into memory on first subscribe. For a system with hundreds of documents, this works fine. For thousands, memory pressure becomes a concern.
3. **Metadata not persisted to DynamoDB**. If Redis goes down and restarts, all document metadata is lost. The CRDT snapshots survive in DynamoDB, but the document list, titles, and types are gone.

### Recommendations

**A. Remove or extend the DynamoDB TTL**

For active documents, remove TTL entirely. For archived documents, set a generous TTL (90 days or more). Implement explicit archival:

```javascript
// When archiving a document:
// 1. Write a final compacted snapshot with TTL = 90 days
// 2. Mark metadata as archived
// 3. Evict from in-memory state
```

DynamoDB storage is cheap ($0.25/GB/month). Even 10,000 documents at 50 KB each = 500 MB = $0.13/month.

**B. Persist document metadata to DynamoDB**

Add a second DynamoDB table (or use a different partition key prefix in the same table) for document metadata:

```
Table: document-metadata
  PK: documentId (string)
  Attributes: title, type, status, icon, description, createdBy, createdAt, updatedAt
```

On startup, hydrate the Redis `doc:list` and `doc:meta:*` keys from DynamoDB. This makes Redis a pure cache layer that can be rebuilt from DynamoDB at any time.

**C. Lazy loading with memory pressure eviction**

For documents not accessed in the last 30 minutes, evict the in-memory Y.Doc but keep the Redis cache warm:

```javascript
// Periodic cleanup (e.g., every 5 minutes)
for (const [channelId, state] of this.channelStates.entries()) {
  if (state.subscriberCount === 0 && state.lastAccessedAt < Date.now() - 30 * 60 * 1000) {
    await this.writeSnapshot(channelId); // Ensure persisted
    state.ydoc.destroy();
    this.channelStates.delete(channelId);
    this.logger.info(`Evicted idle Y.Doc for ${channelId}`);
  }
}
```

Add a `lastAccessedAt` timestamp to the channel state, updated on subscribe/update/getSnapshot.

---

## 6. Multi-Node Consistency

### Current Architecture

The message router uses Redis pub/sub for cross-node message delivery:

- Each channel has a Redis pub/sub channel: `websocket:route:{channel}`
- When a CRDT update arrives at Node A, it:
  1. Applies the update to Node A's in-memory Y.Doc
  2. Publishes via Redis pub/sub to all nodes
  3. Other nodes receive the update and forward it to their local WebSocket clients

### The Problem

**Each node maintains its own in-memory Y.Doc.** When Node A receives an update and publishes it via Redis, Node B forwards the raw update to its clients, but **Node B never applies the update to its own Y.Doc**. This means:

- Node B's in-memory Y.Doc diverges from Node A's.
- If a new client connects to Node B and subscribes to the same channel, they receive Node B's stale Y.Doc state.
- The client will eventually converge (because CRDT), but they'll have a temporarily incomplete view.

### Verification Needed

Check whether the Redis pub/sub handler on receiving nodes also applies CRDT updates to the local Y.Doc. Based on the code reviewed, the message router only forwards messages to local WebSocket clients -- it does not call back into `CRDTService.handleUpdate` for cross-node updates.

### Recommendation: Apply Cross-Node Updates to Local Y.Doc

When a node receives a CRDT update via Redis pub/sub (not from a local client), it should also apply that update to its local in-memory Y.Doc:

```javascript
// In message router's Redis message handler:
if (message.type === 'crdt:update' && message.channel) {
  // Forward to local WebSocket clients (existing behavior)
  this.deliverToLocalClients(message);
  
  // Also apply to local Y.Doc so it stays current
  const state = this.crdtService.channelStates.get(message.channel);
  if (state && state.ydoc) {
    const updateBytes = Buffer.from(message.update, 'base64');
    Y.applyUpdate(state.ydoc, new Uint8Array(updateBytes));
  }
}
```

### Alternative: Single-Writer Pattern

Instead of maintaining Y.Docs on every node, designate one node as the "owner" of each channel's Y.Doc (e.g., via consistent hashing of channel name). All CRDT updates for that channel are routed to the owner node, which is the only node that maintains the authoritative Y.Doc. Other nodes are pure relays.

This is more complex but eliminates multi-writer consistency concerns entirely. Not recommended for the current scale but worth considering if scaling beyond 3-4 gateway nodes.

---

## 7. Failure Modes

### A. DynamoDB Write Fails

**Current behavior**: `writeSnapshot` catches the error, logs it, and continues. The in-memory Y.Doc and Redis cache are unaffected. The `operationsSinceSnapshot` counter is NOT reset on failure (correct -- it will retry on the next trigger).

**Risk**: If DynamoDB is down for an extended period, only Redis cache and in-memory state protect against data loss. If the gateway also crashes during this window, data is lost.

**Mitigation**:
- The EventBridge path adds a layer of buffering (EventBridge retries for 24 hours by default).
- Add a dead-letter mechanism: if DynamoDB writes fail 3 times in a row for a channel, write the snapshot to a local file as a last resort.
- Monitor DynamoDB write failures as a high-severity alert.

### B. Redis Goes Down

**Current behavior**: `_isRedisAvailable()` checks `this.messageRouter.redisAvailable`. When Redis is unavailable:
- Snapshot cache reads return `null` (fall through to DynamoDB).
- Snapshot cache writes are skipped.
- Document metadata falls back to in-memory `docMetaFallback` Map.
- Cross-node pub/sub stops -- each node becomes isolated.

**Risk**: In multi-node deployment, nodes become isolated. Clients on different nodes can make conflicting edits. When Redis returns, these edits won't automatically merge -- the Y.Docs on different nodes have diverged.

**Mitigation**:
- On Redis recovery, each node should re-publish its current Y.Doc state to reconcile. Implement a "rejoin" protocol: each node publishes `encodeStateAsUpdate` for all active channels, and receiving nodes merge via `Y.applyUpdate`.
- Single-node deployments (ECS with 1 task) are unaffected by this scenario.

### C. Node Crashes Mid-Update

**Current behavior**: The in-memory Y.Doc is lost. On the next subscribe, the document is hydrated from Redis cache (up to 1 hour old) or DynamoDB (potentially minutes behind).

**Risk**: Any updates applied to the in-memory Y.Doc since the last Redis cache write or DynamoDB snapshot are lost. Since Redis cache is updated on every `handleUpdate` (non-blocking), the window is typically <1 second. The DynamoDB window can be up to 5 minutes.

**Mitigation**:
- The non-blocking Redis cache update on every `handleUpdate` is the best defense here. Verify that this write consistently succeeds (add metrics).
- Add the SIGTERM handler described in Section 2 for graceful shutdown during deployments.
- For true zero-data-loss, implement a Redis Streams (or similar) write-ahead log where every CRDT update is appended before being applied. On recovery, replay the stream from the last checkpoint. This adds latency (~1ms) and complexity, but guarantees durability. Only needed if the 0-5 second data loss window is unacceptable.

### D. Client Sends Corrupt Update

**Current behavior**: `Y.applyUpdate` will throw if the update bytes are malformed. The error is caught in `handleUpdate`'s try/catch, logged, and the client gets a generic error response. The in-memory Y.Doc is unaffected (Y.js validates before applying).

**Risk**: Low. Y.js is defensive about invalid updates. The main risk is a malicious client sending a valid but enormous update (e.g., 10 MB of text). This would bloat the Y.Doc and all downstream snapshots.

**Mitigation**: Add a size check on incoming updates:

```javascript
if (update.length > 1_000_000) { // 1MB base64 ~ 750KB binary
  this.sendError(clientId, 'Update payload too large');
  return;
}
```

### E. EventBridge / Lambda Pipeline Failure

**Current behavior**: If EventBridge rejects the event, it's logged but not retried. The in-memory Y.Doc and Redis cache remain valid, but DynamoDB never gets the snapshot.

**Risk**: If this failure is persistent, DynamoDB snapshots become stale. A full Redis flush + gateway restart would lose recent changes.

**Mitigation**:
- EventBridge has built-in retry and dead-letter queue support. Ensure the DLQ is configured and monitored.
- Consider the `DIRECT_DYNAMO_WRITE=true` path for production as well. The EventBridge indirection adds latency and failure modes without clear benefit for this use case (the Lambda just does a PutItem). Direct writes from the gateway are simpler and more reliable.

---

## Summary of Recommendations (Prioritized)

### High Priority (data durability)

1. **Persist document metadata to DynamoDB** -- Redis-only metadata is a single point of failure. Metadata loss means orphaned CRDT snapshots.
2. **Add SIGTERM flush handler** -- prevents data loss during rolling deploys.
3. **Remove or extend DynamoDB TTL** -- 7-day TTL silently destroys documents. Use 90+ days or no TTL.
4. **Verify cross-node Y.Doc sync** -- ensure Redis pub/sub updates are applied to each node's local Y.Doc, not just forwarded to WebSocket clients.

### Medium Priority (performance and efficiency)

5. **Implement state vector sync for reconnects** -- reduces bandwidth for reconnecting clients from full-document-size to delta-size.
6. **Add compaction on last-unsubscribe** -- reduces storage and hydration sizes by 40-70%.
7. **Add idle Y.Doc eviction** -- prevents memory growth from documents that were opened once and never revisited.
8. **Lower snapshot debounce to 2 seconds** -- tightens the data loss window.

### Low Priority (hardening)

9. **Add update payload size limit** -- prevents a single client from bloating documents.
10. **Add snapshot size monitoring/alerting** -- catches documents approaching the 400 KB DynamoDB limit.
11. **Consider direct DynamoDB writes in production** -- simpler than EventBridge pipeline, fewer failure modes.
12. **Implement Redis recovery reconciliation** -- nodes re-merge Y.Docs when Redis comes back online.
