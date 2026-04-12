# CRDT Service Decomposition Analysis

**File:** `src/services/crdt-service.js`
**Date:** 2026-04-12

---

## 1. Size

- **1,943 lines** (including blank lines and comments)
- **~40 meaningful methods** (excluding inline callbacks and clearTimeout calls)
- Constructor alone is **127 lines** (lines 19-127), performing 12+ distinct setup tasks

---

## 2. Distinct Responsibilities

The file contains **8 unrelated responsibilities** crammed into one class:

| # | Responsibility | Lines (approx) | Methods |
|---|---|---|---|
| A | **CRDT sync orchestration** (subscribe/update/unsubscribe, Y.Doc lifecycle) | ~250 | `handleSubscribe`, `handleUpdate`, `handleUnsubscribe`, `handleAction` |
| B | **Snapshot persistence** (DynamoDB write/read, gzip, EventBridge publish) | ~200 | `writeSnapshot`, `retrieveLatestSnapshot`, `writePeriodicSnapshots`, `_computeTtl` |
| C | **Redis snapshot caching** (hot-cache read/write, availability check) | ~60 | `_saveSnapshotToRedis`, `_getSnapshotFromRedis`, `_isRedisAvailable` |
| D | **Version history** (list/get/restore/save named snapshots) | ~320 | `handleListSnapshots`, `handleGetSnapshotAtVersion`, `handleRestoreSnapshot`, `handleSaveVersion`, `handleClearDocument` |
| E | **Document metadata CRUD** (create/list/delete/update documents) | ~260 | `handleListDocuments`, `handleCreateDocument`, `handleDeleteDocument`, `handleUpdateDocumentMeta` |
| F | **Document metadata DynamoDB persistence** | ~100 | `_persistDocumentMeta`, `_loadDocumentMetaFromDynamo`, `_loadAllDocumentsFromDynamo`, `_dynamoItemToDocument`, `_deleteDocumentMetaFromDynamo`, `_ensureDocumentsTable` |
| G | **Document presence tracking** (push-based, per-channel user maps) | ~180 | `handleGetDocumentPresence`, `_addToDocumentPresence`, `_removeFromDocumentPresence`, `_removeClientFromAllDocPresence`, `_broadcastDocumentPresence` |
| H | **Awareness coalescing** (50ms batching of ephemeral cursor/selection state) | ~100 | `handleAwareness`, `_flushAwarenessBatch` |
| I | **Operation batching** (10ms merge window for CRDT updates) | ~60 | `batchOperation`, `broadcastBatch` |
| J | **Idle eviction** (10-min Y.Doc memory reclaim) | ~60 | `_startIdleEviction`, `_cancelIdleEviction` |
| K | **Debounced snapshot scheduling** | ~20 | `_scheduleDebouncedSnapshot` |
| L | **Shutdown/lifecycle** | ~60 | `_registerShutdownHandlers`, `shutdown`, `handleDisconnect`, `onClientDisconnect` |

---

## 3. Proposed Decomposition

```
src/services/crdt/
  index.js                     -- Re-exports CRDTService (backward compat)
  CRDTService.js               -- Thin orchestrator: handleAction router, constructor wiring
                                  Delegates to sub-modules. ~150 lines.

  YDocManager.js               -- Y.Doc lifecycle: create, hydrate, evict, destroy
                                  Owns channelStates Map, idle eviction timers.
                                  Methods: getOrCreateDoc, hydrateDoc, evictDoc,
                                  startIdleEviction, cancelIdleEviction

  SnapshotStore.js             -- DynamoDB + gzip snapshot persistence
                                  Methods: writeSnapshot, retrieveLatest, getAtVersion,
                                  listSnapshots, computeTtl, ensureTable

  SnapshotCache.js             -- Redis hot-cache layer (thin wrapper)
                                  Methods: save, get, isAvailable
                                  ~60 lines, could even be inlined into SnapshotStore

  VersionHistoryHandler.js     -- Version history actions (list/get/restore/save/clear)
                                  Uses SnapshotStore + YDocManager

  DocumentMetadataService.js   -- Document CRUD (create/list/delete/update)
                                  Owns Redis doc:meta + doc:list keys, DynamoDB documents table,
                                  in-memory fallback

  DocumentPresenceTracker.js   -- Push-based presence (documentPresenceMap, clientDocChannels)
                                  Methods: add, remove, removeClient, broadcast,
                                  handleGetDocumentPresence

  AwarenessCoalescer.js        -- 50ms awareness batch + flush
                                  Methods: buffer, flush

  OperationBatcher.js          -- 10ms CRDT update batch + broadcast
                                  Methods: batch, broadcastBatch

  DebouncedSnapshotScheduler.js -- Debounce timer management (tiny, could live in YDocManager)
```

**Estimated effort:** Each extracted module is 60-200 lines. The orchestrator (`CRDTService.js`) shrinks to ~150 lines of wiring and the `handleAction` switch.

---

## 4. Duplicated Logic

### 4a. Channel state initialization (copy-pasted 4 times)
The pattern below appears in `handleSubscribe` (line 448), `handleUpdate` (line 546), `handleRestoreSnapshot` (line 1158), and `handleClearDocument` (line 1222):
```js
state = {
    ydoc: new Y.Doc(),
    operationsSinceSnapshot: 0,
    subscriberCount: 0
};
this.channelStates.set(channel, state);
```
Should be a single `_getOrCreateChannelState(channel)` method.

### 4b. DynamoDB snapshot query boilerplate (3 times)
`retrieveLatestSnapshot`, `handleGetSnapshotAtVersion`, and `handleRestoreSnapshot` all build nearly identical `QueryCommand` objects with the same `ExpressionAttributeNames` and decompression logic. The only difference is the key condition (latest vs. exact timestamp).

### 4c. Presence deduplication by userId (2 times)
Both `handleGetDocumentPresence` (line 1603) and `_broadcastDocumentPresence` (line 1749) contain identical "deduplicate by userId, prefer non-idle" logic. Should be a shared `_deduplicatePresence(usersMap)` helper.

### 4d. Authorization check boilerplate (2 times)
`handleSubscribe` and `handleGetSnapshot` both have the same try/catch pattern for `checkChannelPermission`. Other handlers that should check auth (e.g., `handleUpdate`, `handleRestoreSnapshot`) do not, which is inconsistent.

### 4e. Table name resolution
`process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots'` appears 4 times despite being stored in `this.snapshotsTableName`. Three usages ignore the instance variable.

---

## 5. Bugs, Race Conditions, and Edge Cases

### BUG (Critical): Partition key mismatch in `writeSnapshot`
**Line 933:** The direct DynamoDB write path uses `channelId` as the attribute name:
```js
channelId: { S: channelId },
```
But the table is created (line 140) and queried (lines 776, 1019, 1075, 1131) using `documentId` as the partition key:
```js
KeyConditionExpression: 'documentId = :docId'
```
**Impact:** In the `DIRECT_DYNAMO_WRITE=true` path (local dev), snapshots are written with a `channelId` attribute instead of `documentId`. All subsequent reads via `retrieveLatestSnapshot`, `handleListSnapshots`, `handleGetSnapshotAtVersion`, and `handleRestoreSnapshot` will return zero results because they query on `documentId`. This means:
- Documents appear empty on reconnect in local dev
- Version history is always empty in local dev
- Restore operations fail silently

### BUG (Medium): `subscriberCount` can go negative / stale
- `handleUnsubscribe` decrements `subscriberCount` (line 594) but there is no guard against a client calling unsubscribe without having subscribed, or calling it twice.
- The clamping to 0 (line 599) masks the accounting error rather than fixing it.
- If a client disconnects without explicitly unsubscribing, `onClientDisconnect` only cleans up presence -- it does NOT decrement `subscriberCount`. Over time, subscriber counts will only grow, preventing idle eviction from ever triggering.

### RACE CONDITION (Medium): Concurrent `writeSnapshot` calls
- `writeSnapshot` is called from: debounced timer, periodic timer, `handleUpdate` (>50 ops), `handleUnsubscribe`, `handleRestoreSnapshot`, `handleClearDocument`, `handleSaveVersion`, and shutdown handlers.
- Multiple callers can invoke `writeSnapshot` concurrently for the same channel. The method reads `state.operationsSinceSnapshot`, does async work (gzip + DynamoDB/EventBridge), then sets it to 0. If two calls overlap:
  - Both read operationsSinceSnapshot > 0
  - Both encode the Y.Doc state (likely identical)
  - Both write to DynamoDB (wasteful but not corrupting)
  - Both set operationsSinceSnapshot = 0
  - Any operations that arrived between the encode and the reset are silently lost from the counter
- Fix: Use a per-channel mutex or a "writing" flag to serialize snapshot writes.

### RACE CONDITION (Low): Y.Doc replacement in `handleRestoreSnapshot` / `handleClearDocument`
- Both methods do `state.ydoc.destroy()` then `state.ydoc = freshDoc`. If a concurrent `handleUpdate` is mid-flight (between reading `state` and calling `Y.applyUpdate`), it will apply the update to a destroyed Y.Doc or the stale reference.
- Similarly, the cross-node sync interceptor (line 98) reads `state.ydoc` without any synchronization.

### EDGE CASE: Shutdown flushes snapshots sequentially in `shutdown()` (line 1914-1926)
The shutdown method iterates `snapshotDebounceTimers` and awaits `writeSnapshot` one at a time. Meanwhile, `_registerShutdownHandlers` (line 187) does `Promise.allSettled` for parallel flush. The two paths can run concurrently on SIGTERM, causing double-writes. The `shutdown()` path should use parallel writes and coordinate with the signal handler.

### EDGE CASE: `handleAwareness` backfill calls `_addToDocumentPresence` which calls `_broadcastDocumentPresence`
Every awareness heartbeat from a client that somehow missed the presence map triggers a full broadcast to all local clients. Under load with many clients, this could cause a broadcast storm.

### EDGE CASE: In-memory fallback for document metadata is never hydrated from DynamoDB
If Redis is unavailable at startup, `docMetaFallback` starts empty. There is no code path to populate it from DynamoDB (the hydration logic at line 1353 only runs inside the Redis-available branch). Documents created before a Redis failure are invisible.

---

## 6. Recommended Refactoring Priority

### Phase 1 -- Fix bugs (immediate, same file)
1. **Fix partition key mismatch** in `writeSnapshot` line 933: change `channelId` to `documentId`
2. **Fix subscriber count leak**: decrement `subscriberCount` in `onClientDisconnect` for all channels the client was subscribed to
3. **Deduplicate table name**: replace all `process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots'` with `this.snapshotsTableName`

### Phase 2 -- Extract low-risk, high-value modules
4. **Extract `DocumentMetadataService`** -- completely independent concern, no shared state with CRDT sync. ~260 lines removed. Includes DynamoDB persistence helpers.
5. **Extract `DocumentPresenceTracker`** -- self-contained Maps, only dependency is `messageRouter.broadcastToLocalClients`. ~180 lines removed.

### Phase 3 -- Extract persistence layer
6. **Extract `SnapshotStore`** (DynamoDB + gzip) and `SnapshotCache`** (Redis) -- shared by version history and CRDT sync. Add per-channel write mutex here.
7. **Extract `VersionHistoryHandler`** -- uses SnapshotStore, thin handler methods.

### Phase 4 -- Extract sync internals
8. **Extract `OperationBatcher`** and **`AwarenessCoalescer`** -- small, self-contained timer-based modules.
9. **Extract `YDocManager`** -- owns channelStates, idle eviction, debounced snapshots. Uses SnapshotStore.

### Phase 5 -- Clean up orchestrator
10. **Slim `CRDTService`** to ~150 lines: constructor wiring, `handleAction` dispatch, `shutdown`, and lifecycle hooks.

### What NOT to do
- Do not attempt all phases in one PR. Each phase should be a separate, reviewable PR.
- Do not change the WebSocket message format or `handleAction` switch -- external clients depend on it.
- Do not introduce a DI framework. Plain constructor injection (already used) is sufficient.
