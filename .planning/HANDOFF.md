# Session Handoff — 2026-04-12

## What was built
- **v3.0.0**: 5-phase collaboration platform (15 doc templates, version checkpointing, follow mode, presence, scalability)
- **v3.1.0**: 5-phase architecture refactoring (CRDT decomposition, React Context, in-memory rate limiter, observability)
- **v3.1.1**: WS stability + CRDT orchestrator wiring fixes

## Current State — What Works
- WebSocket connects and shows `state: connected` (green)
- Presence shows users in sidebar (Alice, Dave)
- Document editor: collaborative Y.js editing syncs between tabs
- Document presence: push-based via Redis pub/sub
- Follow mode: follows another user's section (after both tabs reload)
- Awareness: single writer pattern via `useAwarenessState` hook
- React Error Boundaries around editor, social, activity
- In-memory rate limiter (no more Redis traffic for rate limiting)

## Active Bug — `listDocuments` silently dropped
**Symptom:** Documents tab shows empty list. Console shows `[useDocuments] Sending listDocuments + getDocumentPresence` but server never receives `listDocuments`. `getDocumentPresence` arrives fine.

**Root cause hypothesis:** `sendMessage` silently drops messages when `wsRef.current.readyState !== OPEN`. Both messages are sent in the same `useEffect` with a 100ms delay + `sendMessageRef`, but `listDocuments` might still be dropped. The `getDocumentPresence` works because it's polled on a 10s interval later.

**Debug approach:**
1. Add `console.log` INSIDE `sendMessage` to see if it's actually calling `ws.send()` or silently dropping
2. If dropping: the WS isn't OPEN when the effect fires despite `connectionState === 'connected'`
3. Fix: either increase delay, or queue messages until WS is confirmed open

**Key files:**
- `frontend/src/hooks/useWebSocket.ts:224` — sendMessage function
- `frontend/src/hooks/useDocuments.ts:180` — the effect that sends listDocuments
- `src/services/crdt-service.js:223` — server-side listDocuments handler

## Other Known Issues
1. **`/api/rooms` 500** — social-api rooms endpoint failing (DynamoDB table may have wrong schema after pod restart; run `tilt trigger dynamodb-setup`)
2. **Chat Send button** — WS fix should have resolved this (connectionState reaches 'connected' now) but needs verification
3. **Reactions** — same as chat, should work now but needs testing

## Architecture After Refactoring
```
src/services/crdt-service.js (658 lines) — orchestrator
src/services/crdt/
  config.js                  — centralized constants
  DocumentMetadataService.js — document CRUD
  SnapshotManager.js         — persistence/versions
  AwarenessCoalescer.js      — 50ms batching
  DocumentPresenceService.js — presence map
  IdleEvictionManager.js     — Y.Doc eviction

frontend/src/contexts/       — WebSocket, Identity, Presence contexts
frontend/src/hooks/useAwarenessState.ts — single awareness writer
```

## How to Run
```bash
tilt up
# If tables are missing:
tilt trigger dynamodb-setup
# If gateway crashes:
kubectl logs -l app.kubernetes.io/component=gateway
# Rebuild after code changes:
tilt trigger wsg-websocket-gateway-gateway
```

## Tags
- `v3.0.0` — Feature build complete
- `v3.1.0` — Architecture refactoring complete
- `v3.1.1` — WS stability + orchestrator wiring fixes
