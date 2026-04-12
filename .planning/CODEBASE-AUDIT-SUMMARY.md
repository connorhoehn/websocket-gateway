# Codebase Audit Summary

> Synthesized from 10 parallel analysis agents (2026-04-12)
> 12 documents produced in `.planning/codebase/`

---

## Critical Bugs (Fix Immediately)

| # | Bug | File | Impact |
|---|-----|------|--------|
| 1 | `onClientDisconnect` never decrements `subscriberCount` | crdt-service.js | Y.Doc eviction never fires, memory grows unbounded |
| 2 | `channelSequences` Map grows unbounded | message-router.js | Memory leak proportional to message volume |
| 3 | SessionService LRU TTL is `NaN` (referenced before assignment) | session-service.js | Session caching broken, every lookup hits Redis |
| 4 | Cursor/Chat `onClientDisconnect()` never called (server calls `handleDisconnect()`) | cursor-service.js, chat-service.js | Stale cursors and typing indicators persist |
| 5 | `_broadcastDocumentPresence` only broadcasts to local node | crdt-service.js | Cross-node document presence broken in multi-replica |
| 6 | Health check always returns 200 even when Redis is down | server.js | K8s routes traffic to broken pods |
| 7 | DynamoDB schema drift — 3 different schemas for crdt-snapshots | Tiltfile, LocalStack, CDK | Silent data loss, queries fail |

## Architecture Debt (Refactor Priority)

### P0: CRDT Service God Object
`crdt-service.js` is **1,943 lines with 40+ methods and 8 responsibilities.** This is the root cause of most bugs — parallel agents patched it independently, creating inconsistencies.

**Recommended decomposition (9 modules):**
```
src/services/crdt/
  CRDTOrchestrator.js    — action dispatch, ~150 lines
  DocumentStore.js       — DynamoDB CRUD for doc metadata
  SnapshotManager.js     — write/read/restore snapshots
  VersionManager.js      — named versions, version listing
  ChannelStateManager.js — Y.Doc lifecycle, subscriber tracking
  AwarenessCoalescer.js  — awareness batching + broadcast
  DocumentPresence.js    — presence map, push broadcast
  IdleEvictionManager.js — idle timer, eviction logic
  CrossNodeSync.js       — remote update application
```

### P1: Frontend God Components
- `AppLayout` takes **43 props** — needs React Context
- `ReaderMode.tsx` is **993 lines** — needs splitting
- `DocumentEditorPage.tsx` is **835 lines** — extract follow mode, section focus, activity handlers
- **4 independent awareness state writers** (the root cause of the currentSectionId bug)
- **Zero error boundaries** — any crash kills the entire app

### P2: No Data Access Layer
Both gateway and social-api make raw DynamoDB SDK calls inline:
- Gateway: manual `{ S: value }` attribute marshalling
- Social-API: `docClient` calls in every route handler
- Redis access patterns duplicated across 4 files

**Fix:** Extract `DocumentRepository`, `SnapshotRepository`, `ProfileRepository` etc.

### P3: Message Bus Fragility
- `onMessage` registrar in App.tsx is **not memoized** (new function every render)
- One throwing handler in the message bus skips all subsequent handlers
- No handler isolation or error boundaries

## Scaling Bottlenecks (By User Count)

| Users | What Breaks | Redis ops/sec | Fix |
|-------|-------------|---------------|-----|
| 50 | Comfortable | ~575 | — |
| 100 | Disconnect O(N*M) scan | ~6,750 | Local channel subscriber counter |
| 200 | Memory ceiling (512Mi) | ~13,500 | Increase pod limits, Y.Doc eviction |
| 500 | Event loop saturation | ~34,000 | In-memory rate limiter, worker threads |
| 1000 | Redis throughput | ~65,000+ | In-memory rate limiter eliminates 90% |

**Top 3 immediate wins:**
1. **In-memory rate limiter** — eliminates 60-90% of Redis ops (biggest single improvement)
2. **Channel-to-clients reverse index** — fixes O(N) broadcast scan
3. **Fix subscriber count decrement** — enables Y.Doc eviction, stops memory leak

## Code Quality Issues

- **380+ lines dead code**: websocket-manager.js, ivs-chat-service.js (never imported)
- **25+ magic numbers**: timeouts, intervals, limits scattered with no central config
- **Missing auth**: `clearDocument`, `deleteDocument`, `restoreSnapshot` have no authorization checks
- **4 full-table Scans** in social-api (will break at scale)
- **No CI/CD pipeline**, no automated tests, CloudWatch alarms reference metrics nobody emits

## Recommended Refactoring Phases

### Phase R1: Critical Bug Fixes (1 session)
- Fix subscriber count decrement
- Fix disconnect handler naming (handleDisconnect → onClientDisconnect)
- Fix health check to return 503 when Redis is down
- Fix channelSequences memory leak
- Fix SessionService TTL NaN

### Phase R2: CRDT Service Decomposition (2-3 sessions)
- Extract 9 focused modules from crdt-service.js
- Add proper data access layer
- Centralize config constants

### Phase R3: Frontend Architecture (2 sessions)
- Add React Context for WebSocket/presence/identity (replace 43-prop drilling)
- Add error boundaries around doc editor, social panel, activity
- Consolidate awareness state management (single writer pattern)
- Memoize onMessage registrar

### Phase R4: Scaling Prep (1-2 sessions)
- In-memory rate limiter
- Fix cross-node document presence (use Redis pub/sub instead of local broadcast)
- Add channel-to-clients reverse index
- Remove dead code, centralize config

### Phase R5: Operational Maturity (1 session)
- Unify DynamoDB schemas across environments
- Fix health checks
- Add CI/CD pipeline skeleton
- Add basic integration tests
