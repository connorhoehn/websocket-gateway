# Refactoring Execution Plan

> Goal: Fix all critical bugs, decompose god objects, enable scaling to 1,000+ users
> Estimated: 5 phases, 18 agents total, executed in order

---

## Phase R1: Critical Bug Fixes (4 agents, parallel)

**Why first:** These are data loss, memory leaks, and broken features. Everything else builds on a stable foundation.

### Agent 1: Server Lifecycle Bugs
- Fix `subscriberCount` never decremented in `onClientDisconnect` (memory leak)
- Fix disconnect handler naming: server.js calls `handleDisconnect()` but cursor-service/chat-service define `onClientDisconnect()` — normalize to one name
- Fix `channelSequences` Map leak in message-router.js — add cleanup on channel empty
- Fix SessionService LRU TTL `NaN` (line 20 reference before assignment)
- Files: `crdt-service.js`, `server.js`, `cursor-service.js`, `chat-service.js`, `message-router.js`, `session-service.js`

### Agent 2: Health Check + Cross-Node Presence
- Fix health check to return 503 when Redis is disconnected
- Fix `_broadcastDocumentPresence` to use Redis pub/sub instead of local-only broadcast
- Fix `writeSnapshot` key name consistency (channelId vs documentId)
- Files: `server.js`, `crdt-service.js`

### Agent 3: DynamoDB Schema Unification
- Audit all table schemas across Tiltfile, CDK, LocalStack bootstrap
- Create single source of truth: `infra/dynamodb-schemas.json`
- Update Tiltfile to read from schema file
- Remove duplicate/conflicting table definitions
- Files: `Tiltfile`, `cdk/`, any bootstrap scripts

### Agent 4: Frontend Stability
- Add React Error Boundaries around: document editor, social panel, activity panel, chat
- Memoize `onMessage` registrar in App.tsx (`useCallback`)
- Add try/catch isolation in message handler loop (one bad handler can't kill others)
- Wrap handler registration with error isolation
- Files: `App.tsx`, new `ErrorBoundary.tsx`

---

## Phase R2: CRDT Service Decomposition (3 agents, parallel)

**Why second:** The 1,943-line god object is the root cause of most bugs. Decomposing it makes everything else easier.

### Agent 5: Extract DocumentMetadataService + SnapshotManager
- Move document CRUD (create, list, delete, updateMeta) to `DocumentMetadataService`
- Move snapshot write/read/restore/version logic to `SnapshotManager`
- Extract DynamoDB access into `DocumentRepository` and `SnapshotRepository`
- Create shared config module for table names, TTLs, thresholds
- Files: new `src/services/crdt/DocumentMetadataService.js`, `SnapshotManager.js`, `src/repositories/`

### Agent 6: Extract AwarenessCoalescer + DocumentPresence
- Move awareness batching (50ms window) to `AwarenessCoalescer`
- Move presence map tracking + broadcast to `DocumentPresenceService`
- Move idle eviction to `IdleEvictionManager`
- Files: new `src/services/crdt/AwarenessCoalescer.js`, `DocumentPresenceService.js`, `IdleEvictionManager.js`

### Agent 7: Slim CRDTService Orchestrator + Cross-Node Sync
- Reduce crdt-service.js to ~200-line orchestrator that delegates to extracted modules
- Clean up `handleAction` dispatch
- Extract cross-node sync interceptor to its own module
- Wire all extracted services together in server.js
- Files: `crdt-service.js` (rewrite), `server.js`

---

## Phase R3: Frontend Architecture (3 agents, parallel)

**Why third:** Reduces prop drilling, fixes awareness conflicts, makes UI maintainable.

### Agent 8: React Context Providers
- Create `WebSocketContext` (connectionState, sendMessage, onMessage)
- Create `IdentityContext` (userId, displayName, color, email)
- Create `PresenceContext` (presenceUsers, currentClientId)
- Refactor AppLayout from 43 props to consuming contexts
- Refactor GatewayDemo to provide contexts instead of drilling
- Files: new `src/contexts/`, `App.tsx`, `AppLayout.tsx`

### Agent 9: Awareness State Consolidation
- Create single `useAwarenessState` hook that owns ALL awareness writes
- Remove awareness writes from: TiptapEditor, DocumentEditorPage (2 places), useCollaborativeDoc idle effect
- All components read awareness via the hook, write via a single `updateAwareness()` function
- This prevents the field-overwriting bugs we debugged
- Files: new `useAwarenessState.ts`, `TiptapEditor.tsx`, `DocumentEditorPage.tsx`, `useCollaborativeDoc.ts`

### Agent 10: Component Decomposition
- Split `ReaderMode.tsx` (993 lines) into: ReaderHeader, ReaderSection, ReaderSummary
- Split `DocumentEditorPage.tsx` (835 lines) into: extract FollowMode, SectionFocusManager, DocumentActions
- Extract document header into self-contained component with context consumption
- Files: `ReaderMode.tsx`, `DocumentEditorPage.tsx`, `DocumentHeader.tsx`

---

## Phase R4: Scaling & Performance (4 agents, parallel)

**Why fourth:** With clean architecture, scaling changes are surgical not scary.

### Agent 11: In-Memory Rate Limiter
- Replace Redis-backed rate limiter with in-memory sliding window
- Eliminates 60-90% of all Redis traffic (~65K ops/sec at 1,000 users)
- Keep per-client counters in a Map with automatic cleanup on disconnect
- No cross-node coordination needed (rate limits are per-connection)
- Files: `src/middleware/rate-limiter.js`

### Agent 12: Channel Subscription Optimization
- Add `channelToClients` reverse index in NodeManager (Map<channel, Set<clientId>>)
- Replace O(N) broadcast scan with O(1) lookup
- Fix O(N*M) `unsubscribeClientFromChannel` during pod drains
- Add local subscriber counter (eliminates Redis SMEMBERS on every publish)
- Files: `src/core/node-manager.js`, `src/core/message-router.js`

### Agent 13: Social-API Data Layer
- Extract `Repository` base class with DynamoDB helpers
- Create: `ProfileRepository`, `RoomRepository`, `GroupRepository`, `PostRepository`
- Replace 4 full-table Scans with GSI queries
- Deduplicate membership-gate logic into middleware
- Files: new `social-api/src/repositories/`, all route files

### Agent 14: Frontend Performance
- Add React.lazy + Suspense for document editor (Tiptap/Y.js are heavy)
- Add React.lazy for social panel, activity panel
- Extract design tokens from inline styles (colors, spacing, fonts)
- Suppress tiptap collaboration/undo-redo warning (known compat issue)
- Files: `AppLayout.tsx`, new `src/styles/tokens.ts`, route-level splits

---

## Phase R5: Operational Maturity (4 agents, parallel)

### Agent 15: Configuration Centralization
- Extract all magic numbers to `src/config/constants.js`
- 25+ hardcoded values: timeouts, intervals, limits, batch sizes
- Environment variable documentation
- Files: new `src/config/constants.js`, all services

### Agent 16: Dead Code Removal + Auth Gaps
- Remove: `websocket-manager.js`, `ivs-chat-service.js`, disabled cursor Redis paths
- Add authorization to: `clearDocument`, `deleteDocument`, `restoreSnapshot`
- Add input validation on all CRDT mutation endpoints
- Files: dead files, `crdt-service.js`

### Agent 17: Observability
- Add structured request/response logging for all service actions
- Add metrics emission for: connections, messages/sec, Y.Doc count, memory usage
- Fix CloudWatch alarm metric references
- Add Grafana dashboard template
- Files: services, `src/utils/metrics.js`

### Agent 18: CI/CD + Testing Skeleton
- GitHub Actions workflow: lint, typecheck, build, deploy
- Basic integration test: connect WS, send chat, verify broadcast
- Basic CRDT test: create doc, edit, verify sync
- Dockerfile improvements: multi-stage builds, non-root user, .dockerignore
- Files: `.github/workflows/`, `test/`, Dockerfiles

---

## Execution Summary

| Phase | Agents | Parallel? | Prereqs |
|-------|--------|-----------|---------|
| R1: Bug Fixes | 4 | Yes | None |
| R2: CRDT Decomposition | 3 | Yes | R1 |
| R3: Frontend Architecture | 3 | Yes | R1 |
| R4: Scaling & Performance | 4 | Yes | R2 |
| R5: Operational Maturity | 4 | Yes | R2, R3 |
| **Total** | **18** | R2+R3 parallel, R4+R5 parallel | |

## Impact After Completion

- **Bugs:** 7 critical bugs fixed
- **CRDT service:** 1,943 lines → 9 modules averaging 150 lines
- **Frontend:** 43-prop drilling → 3 React Contexts, zero awareness conflicts
- **Scaling:** Comfortable to 1,000+ users (from ~200)
- **Redis ops:** ~65K/sec → ~5K/sec at 1,000 users
- **Memory:** Y.Doc eviction actually works, no unbounded maps
- **Reliability:** Error boundaries, health checks, graceful shutdown
- **Maintainability:** Data access layer, centralized config, dead code removed
