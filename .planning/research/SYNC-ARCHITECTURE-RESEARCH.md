# Real-Time Document Sync Architecture - Research

**Researched:** 2026-04-11
**Domain:** Y.js CRDT sync over custom WebSocket gateway
**Confidence:** HIGH (protocol spec is stable; patterns verified against official sources)

## Summary

The Y.js sync protocol is a well-defined binary protocol with three message types (SyncStep1, SyncStep2, Update) implemented in the `y-protocols` package. The existing `crdt-service.js` implements a simplified **Option C** (server-managed Y.js state) but skips the proper sync handshake -- it concatenates raw update buffers instead of maintaining a server-side Y.Doc per channel. This means reconnecting clients get a snapshot blob, but there is no state-vector-based differential sync.

The recommended architecture is **Option C done properly**: the gateway maintains a server-side Y.Doc per active channel, uses the y-protocols sync handshake on subscribe, and relays incremental updates. This is what Hocuspocus does, and the existing gateway already has 80% of the plumbing (channel subscriptions, Redis pub/sub, DynamoDB persistence, operation batching).

**Primary recommendation:** Add `y-protocols` to server dependencies, maintain a Y.Doc per channel in the CRDT service, implement the standard sync handshake (SyncStep1/SyncStep2) on subscribe, and send incremental Y.js updates (not full doc state) from clients.

---

## Architecture Decision: A vs B vs C

### Option A: Browser-to-Browser (WebRTC via y-webrtc)

| Pro | Con |
|-----|-----|
| No server load for sync | No persistence without separate mechanism |
| Lowest latency (direct) | Unreliable behind corporate NATs/firewalls |
| | No server-side authority for read-only enforcement |
| | Cannot replay events or audit |
| | Requires STUN/TURN infrastructure |

**Verdict: REJECT.** The existing gateway already handles multi-instance routing via Redis. WebRTC adds complexity without benefit and breaks the server-authority model needed for permissions.

### Option B: Gateway as Dumb Pipe (relay binary blobs)

| Pro | Con |
|-----|-----|
| Simple server (no Y.js parsing) | Cannot generate snapshots server-side |
| Low server memory | Cannot enforce read-only (server doesn't understand content) |
| | Reconnecting client needs full state from a peer, not DB |
| | No server-side mergeUpdates for efficient persistence |
| | Multi-instance: blobs forwarded blindly, no dedup |

**Verdict: REJECT.** Cannot support database persistence, read-only mode, or efficient reconnection without understanding the protocol.

### Option C: Server Manages Y.Doc (current approach, needs improvement)

| Pro | Con |
|-----|-----|
| Server can persist snapshots | Memory cost: ~one Y.Doc per active channel |
| Server can enforce read-only | Y.js must be a server dependency |
| Efficient reconnect via state vector diff | Slightly more complex server code |
| Server-side mergeUpdates for compact persistence | |
| Works perfectly with existing Redis pub/sub | |

**Verdict: USE THIS.** The existing `crdt-service.js` already does this partially. Complete the implementation with proper y-protocols sync handshake.

---

## Current Implementation Gaps

### What `crdt-service.js` Does Now
1. Accepts base64-encoded Y.js updates from clients
2. Concatenates raw update buffers into `currentSnapshot` (Buffer.concat)
3. Batches operations (10ms window) and merges with `mergeUpdates()` before broadcast
4. Persists snapshots to DynamoDB via EventBridge every 50 ops or 5 minutes
5. On subscribe, retrieves latest snapshot from DynamoDB and pushes to client

### What's Missing
1. **No server-side Y.Doc** -- `currentSnapshot` is a raw buffer concatenation, not a proper Y.Doc. `mergeUpdates` works on the broadcast batch, but the accumulated snapshot is just `Buffer.concat`, which is NOT the same as applying updates to a Y.Doc.
2. **No sync handshake** -- Client subscribes, gets a snapshot blob. No SyncStep1/SyncStep2 exchange. If the client already has partial state (e.g., from IndexedDB), it re-downloads everything.
3. **Client sends full doc state** -- `useCRDT.ts` calls `encodeStateAsUpdate(ydoc)` (full state) on every edit, not incremental updates. This is bandwidth-wasteful.
4. **No awareness protocol** -- Cursor positions are handled by a separate cursor service, not Y.js awareness.
5. **`yjs` not in server package.json** -- `crdt-service.js` requires `yjs` but it's not listed as a dependency.
6. **Test mismatch** -- Tests assert `{type: 'crdt', action: 'operations'}` format but code now sends `{type: 'crdt:update', update: base64}`. Tests are stale.

---

## Y.js Sync Protocol v1 (from y-protocols)

### Message Types (Binary)

| ID | Name | Payload | Direction |
|----|------|---------|-----------|
| 0 | SyncStep1 | `stateVector` (Uint8Array) | Client -> Server |
| 1 | SyncStep2 | `update` (Uint8Array) -- missing ops | Server -> Client |
| 2 | Update | `update` (Uint8Array) -- incremental | Bidirectional |

### Sync Handshake (Client-Server)

```
Client                          Server
  |                               |
  |--- SyncStep1(clientSV) ------>|  "Here's what I have"
  |                               |
  |<-- SyncStep2(missingOps) -----|  "Here's what you're missing"
  |<-- SyncStep1(serverSV) -------|  "What do I need from you?"
  |                               |
  |--- SyncStep2(missingOps) ---->|  "Here's what you're missing"
  |                               |
  |=== Update messages flow ======|  Bidirectional incremental updates
```

### Key Functions from `y-protocols/sync`

```javascript
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

// Server: on client connect, initiate sync
function onClientSubscribe(ydoc, sendToClient) {
  const encoder = encoding.createEncoder()
  syncProtocol.writeSyncStep1(encoder, ydoc)  // Writes server's state vector
  sendToClient(encoding.toUint8Array(encoder))
}

// Server: handle incoming sync message from client
function onSyncMessage(message, ydoc, sendToClient) {
  const decoder = decoding.createDecoder(new Uint8Array(message))
  const encoder = encoding.createEncoder()
  const messageType = syncProtocol.readSyncMessage(decoder, encoder, ydoc, 'remote-origin')
  // readSyncMessage returns the message type (0, 1, or 2)
  // If it was SyncStep1, encoder now contains the SyncStep2 response
  if (encoding.length(encoder) > 0) {
    sendToClient(encoding.toUint8Array(encoder))
  }
}

// Server: forward local Y.Doc updates to connected clients
ydoc.on('update', (update, origin) => {
  if (origin !== 'remote-origin') return  // Don't echo back
  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, update)
  broadcastToChannel(encoding.toUint8Array(encoder))
})
```

**Confidence: HIGH** -- These are the exact functions from y-protocols, verified against official GitHub source and DeepWiki documentation.

---

## Awareness Protocol

### Overview
Awareness is a separate CRDT that tracks ephemeral per-client state (cursor position, user name, online status). It's NOT part of the sync protocol -- it's a parallel channel.

### Key API (from `y-protocols/awareness`)

```javascript
import { Awareness } from 'y-protocols/awareness'
import * as awarenessProtocol from 'y-protocols/awareness'

// Create awareness instance (one per Y.Doc)
const awareness = new Awareness(ydoc)

// Set local state (cursor, user info)
awareness.setLocalState({
  cursor: { index: 5, length: 0 },
  user: { name: 'Alice', color: '#ff0000' }
})

// Listen for changes and broadcast
awareness.on('update', ({ added, updated, removed }) => {
  const changedClients = added.concat(updated).concat(removed)
  const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
  broadcastToChannel(encodedUpdate)  // Send to all peers
})

// Apply remote awareness update
awarenessProtocol.applyAwarenessUpdate(awareness, encodedUpdate, 'remote')

// On client disconnect, remove their awareness
awarenessProtocol.removeAwarenessStates(awareness, [clientId], 'disconnect')

// Get all states
awareness.getStates()  // Map<clientId, stateObject>
```

### Relevance to This Project
The existing cursor service handles cursor positions independently of Y.js awareness. Two options:

1. **Keep separate** (RECOMMENDED for now) -- Cursor service already works, has throttling, and integrates with the message router. No need to change.
2. **Migrate to awareness** (future) -- Would unify cursor/presence into Y.js awareness, reducing protocol surface area. But requires rewriting cursor hooks.

**Confidence: HIGH** -- API from official Yjs docs.

---

## Document Loading from Database on First Connection

### Current Approach (crdt-service.js)
1. Client sends `{service: 'crdt', action: 'subscribe', channel}`
2. Server queries DynamoDB for latest snapshot (gzip-compressed binary)
3. Server decompresses and sends as base64 `crdt:snapshot` message
4. Client applies snapshot to fresh Y.Doc

### Problems
- **No state vector exchange** -- Client may already have partial state (from previous session, IndexedDB). It gets the full snapshot anyway.
- **Snapshot may be stale** -- Snapshot written every 50 ops or 5 min. Up to 49 ops or 5 min of edits can be lost between snapshot and real-time.
- **No reconciliation** -- After snapshot, there's a gap between snapshot timestamp and "now". Updates that arrived at the server after the snapshot was written but before the client connected are lost.

### Correct Approach
1. Client subscribes, server loads Y.Doc from DynamoDB snapshot (if exists)
2. Server applies any buffered updates since last snapshot to the Y.Doc
3. Client sends SyncStep1 (its state vector -- empty for new client, populated if reconnecting)
4. Server responds with SyncStep2 (differential update from server Y.Doc based on client's state vector)
5. Server sends SyncStep1 (its state vector) to get any updates client has that server doesn't
6. Client responds with SyncStep2

This handles:
- Fresh client: gets everything (SV is empty, so diff = full doc)
- Reconnecting client: gets only what it missed
- Client with offline edits: server gets those edits too

**Confidence: HIGH** -- This is the standard y-protocols pattern.

---

## Debouncing Updates for Database Persistence

### Current Approach
- Snapshot triggered after 50 operations OR every 5 minutes (periodic timer)
- Snapshot also written when last subscriber leaves a channel
- Persistence via EventBridge -> Lambda -> DynamoDB

### Hocuspocus Pattern (Reference)
- `onStoreDocument` hook has built-in debounce (default: 2 seconds)
- Saves the entire Y.Doc as binary (Uint8Array), NOT JSON
- After debounce, encodes full doc state and writes to storage

### Recommended Approach for This Project

The current approach is reasonable but has a critical flaw: `currentSnapshot` is `Buffer.concat` of raw updates, not a proper Y.Doc encoding. Fix:

```javascript
// Instead of Buffer.concat:
const ydoc = this.channelDocs.get(channelId)
const snapshot = Y.encodeStateAsUpdate(ydoc)  // Proper Y.js binary
const compressed = await gzip(Buffer.from(snapshot))
```

Debounce strategy should be:
1. **Operation count threshold**: 50 ops (current, keep)
2. **Time-based**: 2-5 minutes (current 5min is fine)
3. **On last disconnect**: Write immediately (current, keep)
4. **Debounce within threshold**: Don't write on every op. The 50-op threshold already handles this.

**CRITICAL**: Store as Y.js binary (Uint8Array from `encodeStateAsUpdate`), NEVER as JSON. The Hocuspocus docs explicitly warn: "Do not be tempted to store the Y.Doc as JSON and recreate it as YJS binary when the user connects. This will cause issues with merging of updates and content will duplicate on new connections."

**Confidence: HIGH** -- Pattern from Hocuspocus official docs, verified.

---

## Stale Document Scenarios

### The Problem
1. User A and B are editing. Snapshot written at T=0.
2. Users make 30 more edits (ops 1-30). No snapshot yet (threshold is 50).
3. User C connects. Server retrieves snapshot from T=0.
4. User C is missing ops 1-30.

### The Solution (Server-Side Y.Doc)
If the server maintains a Y.Doc in memory for each active channel:
- The Y.Doc has ALL updates (including ops 1-30 that haven't been persisted yet)
- When User C connects, the sync handshake gives them the full current state, not just the last snapshot
- The DynamoDB snapshot is only a cold-start recovery mechanism, not the source of truth

### Server Y.Doc Lifecycle

```
Channel has no active clients:
  -> Y.Doc not in memory
  -> State only in DynamoDB snapshot

First client subscribes:
  -> Load snapshot from DynamoDB into new Y.Doc
  -> Y.Doc becomes source of truth
  -> Sync handshake with client

More clients subscribe:
  -> Sync handshake against in-memory Y.Doc (fast, no DB read)

Last client unsubscribes:
  -> Write final snapshot to DynamoDB
  -> Destroy Y.Doc (free memory)
  -> After grace period (e.g., 30s) to handle quick reconnects
```

### Multi-Instance Consideration
With multiple gateway instances behind a load balancer:
- Each instance may have its own Y.Doc for the same channel
- Redis pub/sub already relays updates between instances
- Y.js CRDT guarantees convergence -- both server Y.Docs will converge
- Snapshots should only be written by one instance (use Redis lock or consistent assignment)

**Confidence: HIGH** -- Standard Hocuspocus/y-websocket pattern.

---

## Conflict Resolution: Database vs Live Updates

### Non-Problem with CRDTs
Y.js updates are commutative and idempotent:
- **Commutative**: Order of application doesn't matter
- **Idempotent**: Applying the same update twice has no additional effect

This means:
- Loading a snapshot and then applying live updates = correct state
- Applying live updates and then loading a snapshot = correct state
- Applying the same update 5 times = same as applying it once

### The Real Danger: JSON Serialization
If you store the document as JSON and reconstruct a Y.Doc from JSON on load, you CREATE NEW Y.js operations. When these merge with the existing Y.Doc state from other clients, content duplicates.

**Rule**: Always store and load as Y.js binary (`encodeStateAsUpdate` / `applyUpdate`). Never serialize to JSON for persistence.

### Practical Reconciliation Flow

```javascript
// Server: Load doc from DB, then accept live updates
async function loadOrCreateDoc(channelId) {
  const ydoc = new Y.Doc()
  
  // 1. Load from DynamoDB
  const snapshot = await retrieveLatestSnapshot(channelId)
  if (snapshot) {
    Y.applyUpdate(ydoc, snapshot)  // idempotent -- safe
  }
  
  // 2. Doc is now ready. Any live updates from clients will be
  //    applied via the sync protocol. Y.js handles merge automatically.
  return ydoc
}
```

**Confidence: HIGH** -- This is a fundamental Y.js guarantee.

---

## Read-Only Mode (One-Way Sync)

### Approach: Server-Side Filtering

Y.js does not have built-in read-only mode. The recommended approach (from Kevin Jahns / dmonad) is server-side message filtering.

```javascript
// Server: for read-only clients, only send updates, never accept them
function handleSyncMessage(clientId, message, ydoc) {
  const isReadOnly = getClientPermission(clientId) === 'read'
  
  if (isReadOnly) {
    // Only allow SyncStep1 (client asking for data) -- message[1] === 0
    // Block SyncStep2 (client sending data) -- message[1] === 1
    // Block Update (client sending changes) -- message[1] === 2
    const decoder = decoding.createDecoder(new Uint8Array(message))
    const messageType = decoding.readVarUint(decoder)  // sync message type (0)
    const syncType = decoding.readVarUint(decoder)      // sync step type
    
    if (syncType !== 0) {  // Only allow SyncStep1
      return  // Silently drop write attempts
    }
  }
  
  // Process normally
  const decoder = decoding.createDecoder(new Uint8Array(message))
  const encoder = encoding.createEncoder()
  syncProtocol.readSyncMessage(decoder, encoder, ydoc, clientId)
  // ... send response
}
```

### Simpler Approach for This Gateway

Since the gateway already has authorization middleware (`checkChannelPermission`), the simplest approach:

1. On subscribe, tag the client as `read` or `write` based on permissions
2. Accept `subscribe` from read-only clients (they get the sync handshake and real-time updates)
3. Reject `update` action from read-only clients with an error response
4. Client-side: disable editor input when in read-only mode

This is simpler than protocol-level filtering because the gateway uses JSON messages (not raw binary y-protocols), so filtering at the action level is natural.

**Confidence: MEDIUM** -- Approach from Kevin Jahns (y-protocols author), but implementation details are project-specific.

---

## Standard Stack

### Required Additions (Server)

| Package | Version | Purpose |
|---------|---------|---------|
| `yjs` | 13.6.30 | Server-side Y.Doc management (already used but not in package.json) |
| `y-protocols` | 1.0.7 | Sync protocol (SyncStep1/SyncStep2/Update) and awareness encoding |
| `lib0` | 0.2.117 | Binary encoding/decoding (dependency of y-protocols, used directly for encoder/decoder) |

### Already Present (Frontend)

| Package | Version | Purpose |
|---------|---------|---------|
| `yjs` | ^13.6.29 | Client-side Y.Doc (in frontend/package.json) |

### Installation

```bash
# Server dependencies
cd /Users/connorhoehn/Projects/websocker_gateway
npm install yjs y-protocols lib0

# Frontend (already has yjs, add y-protocols for sync)
cd frontend
npm install y-protocols lib0
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Sync protocol encoding | Custom binary message format | `y-protocols/sync` (writeSyncStep1, readSyncMessage, etc.) |
| State vector computation | Manual tracking of "what client has" | `Y.encodeStateVector(ydoc)` |
| Differential updates | Diffing snapshots manually | `Y.encodeStateAsUpdate(ydoc, remoteStateVector)` |
| Update merging | Buffer.concat of raw updates | `Y.mergeUpdates(updates)` (already used for broadcast, but NOT for snapshot accumulation) |
| Awareness encoding | Custom presence protocol | `y-protocols/awareness` (if migrating from cursor service) |

---

## Common Pitfalls

### Pitfall 1: Buffer.concat Instead of Y.Doc Apply
**What goes wrong:** Raw buffer concatenation produces an ever-growing blob that includes duplicate operations. `encodeStateAsUpdate` on a proper Y.Doc produces a compact representation.
**Current status:** `crdt-service.js` line 175 does `Buffer.concat` for `currentSnapshot`. This works for relay but produces bloated snapshots.
**Fix:** Maintain a Y.Doc, apply updates to it, and use `encodeStateAsUpdate(ydoc)` for persistence.

### Pitfall 2: Sending Full Doc State on Every Edit
**What goes wrong:** `useCRDT.ts` line 169 calls `encodeStateAsUpdate(ydoc)` (full state) on every keystroke. For a 100KB document, every keystroke sends 100KB.
**Fix:** Use the `ydoc.on('update', (update) => ...)` event which provides only the incremental delta (typically < 100 bytes for a keystroke).

### Pitfall 3: JSON Serialization for Persistence
**What goes wrong:** Storing Y.Doc as JSON and reconstructing causes content duplication on merge.
**Prevention:** Always persist as Y.js binary (`encodeStateAsUpdate` result). The current DynamoDB storage uses binary, which is correct.

### Pitfall 4: Missing Grace Period on Last Disconnect
**What goes wrong:** Server writes snapshot and destroys Y.Doc when last client disconnects. If client reconnects within seconds (e.g., page refresh), server must reload from DB.
**Fix:** Keep Y.Doc in memory for 30-60 seconds after last disconnect before evicting.

### Pitfall 5: Multi-Instance Snapshot Write Conflicts
**What goes wrong:** Two gateway instances both think they should write the snapshot for the same channel. DynamoDB write with a stale snapshot overwrites a fresher one.
**Fix:** Use `encodeStateAsUpdate` (which is deterministic for the same state) and compare timestamps. Or use Redis-based leader election per channel.

### Pitfall 6: Awareness State Leak on Disconnect
**What goes wrong:** Client disconnects but their awareness state (cursor position, "online" status) persists in other clients' view.
**Fix:** Call `removeAwarenessStates(awareness, [clientId])` on disconnect. Y.js awareness has a 30-second timeout by default, but explicit removal is better UX.

---

## Code Examples

### Server-Side Sync Handler (Recommended Refactor of crdt-service.js)

```javascript
const Y = require('yjs')
const syncProtocol = require('y-protocols/sync')
const encoding = require('lib0/encoding')
const decoding = require('lib0/decoding')

class CRDTService {
  constructor(messageRouter, logger) {
    this.channelDocs = new Map()  // channelId -> Y.Doc
    // ... existing constructor
  }

  async getOrCreateDoc(channelId) {
    let ydoc = this.channelDocs.get(channelId)
    if (ydoc) return ydoc

    ydoc = new Y.Doc()
    
    // Load from DynamoDB
    const snapshot = await this.retrieveLatestSnapshot(channelId)
    if (snapshot.data) {
      const bytes = Buffer.from(snapshot.data, 'base64')
      Y.applyUpdate(ydoc, bytes)
    }

    // Listen for updates to relay via Redis pub/sub
    ydoc.on('update', (update, origin) => {
      if (origin === 'remote') return  // Don't echo
      // Broadcast to other instances via Redis
    })

    this.channelDocs.set(channelId, ydoc)
    return ydoc
  }

  async handleSubscribe(clientId, { channel }) {
    // ... authorization checks (existing) ...
    
    const ydoc = await this.getOrCreateDoc(channel)
    
    // Send SyncStep1 from server to client
    const encoder = encoding.createEncoder()
    syncProtocol.writeSyncStep1(encoder, ydoc)
    this.sendToClient(clientId, {
      type: 'crdt:sync',
      channel,
      message: Buffer.from(encoding.toUint8Array(encoder)).toString('base64')
    })
  }

  async handleSync(clientId, { channel, message }) {
    const ydoc = await this.getOrCreateDoc(channel)
    const decoder = decoding.createDecoder(Buffer.from(message, 'base64'))
    const encoder = encoding.createEncoder()
    
    syncProtocol.readSyncMessage(decoder, encoder, ydoc, clientId)
    
    if (encoding.length(encoder) > 0) {
      this.sendToClient(clientId, {
        type: 'crdt:sync',
        channel,
        message: Buffer.from(encoding.toUint8Array(encoder)).toString('base64')
      })
    }
  }
}
```

### Client-Side Incremental Updates (Recommended Fix for useCRDT.ts)

```typescript
// Instead of sending full doc state on every edit:
// OLD (wasteful):
const update = encodeStateAsUpdate(ydoc.current)
sendMessage({ service: 'crdt', action: 'update', channel, update: btoa(update) })

// NEW (incremental):
ydoc.current.on('update', (update: Uint8Array, origin: any) => {
  if (origin === 'remote') return  // Don't echo remote updates back
  const b64 = Buffer.from(update).toString('base64')
  sendMessageRef.current({
    service: 'crdt',
    action: 'update',
    channel: currentChannelRef.current,
    update: b64,
  })
})
```

---

## Hocuspocus Patterns (Extractable, Not As Dependency)

Hocuspocus is a full Y.js server framework. We do NOT want it as a dependency (the gateway is its own server). But its architecture validates our approach:

| Hocuspocus Pattern | Our Equivalent |
|-------------------|----------------|
| Server-side Y.Doc per document | `channelDocs` Map in CRDTService |
| `onLoadDocument` hook | `getOrCreateDoc()` loading from DynamoDB |
| `onStoreDocument` with debounce | EventBridge -> Lambda persistence (50 ops / 5 min) |
| Redis extension for multi-instance | Existing Redis pub/sub message routing |
| `onConnect` auth hook | Existing `checkChannelPermission` middleware |
| Awareness via Redis | Could use existing cursor service or add awareness relay |

Hocuspocus's multi-instance pattern: worker nodes sync via Redis pub/sub, single manager writes to storage. Our equivalent: any gateway instance accepts updates, Redis relays to all, EventBridge persistence is already decoupled.

---

## Migration Path (Incremental)

### Phase 1: Fix Server-Side Y.Doc (minimal change)
1. Add `yjs` to server package.json
2. Replace `Buffer.concat` snapshot accumulation with proper Y.Doc per channel
3. Use `encodeStateAsUpdate(ydoc)` for snapshot persistence
4. Keep existing JSON message format for now

### Phase 2: Add Sync Protocol
1. Add `y-protocols` and `lib0` to server and frontend
2. Add `sync` action to CRDT service that handles binary sync messages (base64-encoded)
3. On subscribe, server initiates sync handshake instead of pushing raw snapshot
4. Client sends incremental updates (not full state)

### Phase 3: Read-Only Mode
1. Add permission flag to subscribe response
2. Server rejects `update` from read-only clients
3. Client disables editor when read-only

### Phase 4: Awareness (optional)
1. Add awareness relay to CRDT service
2. Migrate cursor service to awareness protocol
3. Unify presence/cursor into single awareness state

---

## Open Questions

1. **Memory budget for server-side Y.Docs**: How many concurrent channels will have active editors? Each Y.Doc is ~few KB to few MB depending on document size. With 512 CPU / 1024 MB ECS tasks, budget for Y.Doc memory.

2. **Multi-instance snapshot write coordination**: When two instances both have the same channel's Y.Doc, which one writes the snapshot? Options: (a) both write (Y.js binary is deterministic for same state -- safe but wasteful), (b) Redis-based leader election per channel, (c) only write on last disconnect.

3. **Should binary sync messages be a new message type or reuse existing?**: Current format is JSON `{type, channel, update}`. Binary sync messages could be: (a) base64-encoded inside JSON (easy, current pattern), (b) raw binary WebSocket frames (efficient but requires binary frame support in gateway).

4. **Grace period for Y.Doc eviction**: How long to keep Y.Doc in memory after last client disconnects? 30s seems reasonable for page refreshes. Need to balance memory vs DynamoDB read latency.

---

## Sources

### Primary (HIGH confidence)
- [y-protocols PROTOCOL.md](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md) -- Binary protocol specification
- [y-protocols sync.js DeepWiki](https://deepwiki.com/yjs/y-protocols/2.1-sync-protocol) -- Sync function API reference
- [Yjs Awareness API](https://docs.yjs.dev/api/about-awareness) -- Awareness protocol official docs
- [Hocuspocus Persistence Guide](https://tiptap.dev/docs/hocuspocus/guides/persistence) -- Server-side persistence patterns
- [Hocuspocus Redis Extension](https://github.com/ueberdosis/hocuspocus/blob/main/docs/server/extensions/redis.md) -- Multi-instance scaling

### Secondary (MEDIUM confidence)
- [Yjs Community: Read-only sync](https://discuss.yjs.dev/t/read-only-or-one-way-only-sync/135) -- Kevin Jahns' guidance on read-only
- [Yjs Community: Server-side persistence](https://discuss.yjs.dev/t/how-to-implement-data-persistence-on-the-server-side/259) -- Debounce and incremental persistence
- [Yjs Community: Custom provider](https://discuss.yjs.dev/t/how-to-implement-a-custom-yjs-provider/2152) -- Custom provider pitfalls

### Verified Package Versions (npm registry, 2026-04-11)
- yjs: 13.6.30
- y-protocols: 1.0.7
- lib0: 0.2.117
