---
phase: 41-crdt-live-update-relay-fix
plan: "01"
subsystem: crdt-service
tags: [crdt, websocket, yjs, docker-compose, protocol-fix]
dependency_graph:
  requires: []
  provides: [CRDT-02, CRDT-03, MISS-A, MISS-B]
  affects: [frontend/src/hooks/useCRDT.ts, docker-compose.localstack.yml]
tech_stack:
  added: [yjs/mergeUpdates]
  patterns: [Y.js update merging, base64 binary relay]
key_files:
  created: []
  modified:
    - src/services/crdt-service.js
    - docker-compose.localstack.yml
decisions:
  - "[Phase 41-01]: broadcastBatch() now merges all batched operations via Y.mergeUpdates() into a single Uint8Array and sends {type:'crdt:update', channel, update:'<base64>'} — matching useCRDT.ts contract exactly"
  - "[Phase 41-01]: EVENT_BUS_NAME=social-events made explicit in social-api docker-compose environment block, eliminating implicit reliance on aws-clients.ts code fallback"
metrics:
  duration: 56s
  completed: "2026-03-19"
  tasks: 2
  files: 2
---

# Phase 41 Plan 01: CRDT Live Update Relay Fix Summary

**One-liner:** Fix broadcastBatch() protocol mismatch from {type:'crdt',action:'operations'} to {type:'crdt:update',update:'<base64>'} so real-time Y.js collaborative edits reach all connected clients without reconnect.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Fix broadcastBatch() to send crdt:update format | 3efffcc | src/services/crdt-service.js |
| 2 | Add EVENT_BUS_NAME to social-api in docker-compose | dca009b | docker-compose.localstack.yml |

## What Was Built

### Task 1: broadcastBatch() Protocol Fix

The root cause of MISS-B: `broadcastBatch()` was sending:
```js
{ type: 'crdt', action: 'operations', channel, operations: [...], timestamp: '...' }
```

But `useCRDT.ts` (line 84) checks `msg.type === 'crdt:update'` and reads `msg.update` as a base64 string. This mismatch meant all live collaborative edits were silently discarded — clients only saw each other's changes after reconnect (via the snapshot mechanism).

The fix:
1. Added `const { mergeUpdates } = require('yjs')` import
2. In `broadcastBatch()`, decode each batched operation's base64 update to a `Uint8Array`
3. If 1 operation, use its buffer directly; if multiple, merge via `mergeUpdates(buffers)`
4. Base64-encode the merged result
5. Send `{ type: 'crdt:update', channel, update: mergedBase64 }`

This exactly matches the `useCRDT.ts` consumer contract at lines 84-93.

### Task 2: EVENT_BUS_NAME docker-compose fix

Added `EVENT_BUS_NAME=social-events` to the social-api environment block in `docker-compose.localstack.yml`. This replicates the Phase 39 fix that was applied to websocket-gateway. The count of `EVENT_BUS_NAME=social-events` in the file is now 2 (one for each service).

## Decisions Made

- **mergeUpdates import**: Used named import `{ mergeUpdates }` from `yjs` directly rather than requiring the full `Y` namespace, keeping the import minimal and specific to what broadcastBatch needs.
- **Single-operation fast path**: When only one operation is in the batch, the buffer is used directly (no merge needed), avoiding unnecessary work.
- **No other methods changed**: `handleUpdate`, `batchOperation`, `writeSnapshot`, `handleSubscribe`, and all other methods are untouched per plan specification.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. `grep "type: 'crdt:update'" src/services/crdt-service.js` — match found in broadcastBatch
2. `grep -c "EVENT_BUS_NAME=social-events" docker-compose.localstack.yml` — returns `2` (one per service)
3. `grep "action: 'operations'" src/services/crdt-service.js` — no matches (old format removed)

## Self-Check: PASSED

- src/services/crdt-service.js: FOUND
- docker-compose.localstack.yml: FOUND
- Commit 3efffcc: FOUND
- Commit dca009b: FOUND
