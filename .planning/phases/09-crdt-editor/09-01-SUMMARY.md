---
phase: 09-crdt-editor
plan: "01"
subsystem: frontend-crdt
tags: [crdt, yjs, react-hook, tdd, websocket]
dependency_graph:
  requires: [useWebSocket, GatewayMessage]
  provides: [useCRDT, UseCRDTOptions, UseCRDTReturn]
  affects: [SharedTextEditor (09-02)]
tech_stack:
  added: [yjs]
  patterns: [useRef-stable-closures, separate-subscribe-from-handler, Y.Doc-reset-on-subscribe]
key_files:
  created:
    - frontend/src/hooks/useCRDT.ts
    - frontend/src/hooks/__tests__/useCRDT.test.ts
  modified:
    - frontend/package.json
    - frontend/package-lock.json
decisions:
  - "useCRDT separates onMessage handler effect from subscribe effect — handler survives channel changes without teardown (same reasoning as useChat)"
  - "Y.Doc destroyed and recreated on each subscribe — prevents stale state from previous channel or session leaking into new subscription"
  - "ytext.observe() registered after every doc reset — observer always tracks the current doc instance"
  - "applyLocalEdit stable useCallback with empty deps — all values (channel, sendMessage) accessed via refs, consistent with send() in useChat"
  - "encodeStateAsUpdate (full state) sent on applyLocalEdit — gateway can serve as cumulative snapshot, matching Phase 04-01 buffer strategy"
metrics:
  duration: 132s
  completed: "2026-03-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 09 Plan 01: useCRDT Hook (TDD) Summary

**One-liner:** useCRDT hook with Y.js doc sync — subscribe/unsubscribe, crdt:snapshot restore, crdt:update merge, and applyLocalEdit broadcasting base64 full-state updates to the gateway.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED  | Failing useCRDT tests (14 test cases) | 5ae9171 | frontend/src/hooks/__tests__/useCRDT.test.ts |
| GREEN | useCRDT implementation | fc187f7 | frontend/src/hooks/useCRDT.ts |

## What Was Built

### `frontend/src/hooks/useCRDT.ts`

React hook that provides the data layer for the SharedTextEditor (Plan 09-02). Key behaviors:

- **Subscribe/unsubscribe:** On `connectionState === 'connected'` + channel set, sends `{ service: 'crdt', action: 'subscribe', channel }`. Sends unsubscribe on cleanup. Uses `sendMessageRef` for stable access.
- **Y.Doc reset on subscribe:** On each new subscription, the old Y.Doc is destroyed and a fresh one created. This prevents stale state from a previous channel or reconnection session.
- **crdt:snapshot handler:** Receives base64 cumulative Y.js state from the server (DynamoDB snapshot), applies it with `applyUpdate()`, updates content state.
- **crdt:update handler:** Receives base64 Y.js binary update from remote clients, applies with `applyUpdate()`. Y.js performs automatic CRDT merge.
- **applyLocalEdit(newText):** Performs `transact(delete+insert)` on the Y.Doc, encodes full state as base64 update, sends to gateway. Triggers `setContent` via `ytext.observe`.
- **Channel filtering:** `currentChannelRef.current` in the handler ensures stale closures never process messages for the wrong channel.

### `frontend/src/hooks/__tests__/useCRDT.test.ts`

14 test cases following the `useChat.test.ts` pattern:
- Subscribe when connected, not when disconnected/connecting
- crdt:snapshot restores content + handles missing/empty snapshot
- crdt:update applies update to doc content
- Channel filter: ignores updates for different channel
- applyLocalEdit: sends gateway message with base64 update field, updates content state, handles empty string (clears doc)
- Channel change: clears content, unsubscribes from old, subscribes to new
- Unmount: sends unsubscribe
- Return shape: content is string, applyLocalEdit is function

## Decisions Made

1. **Separate onMessage from subscribe effect** — handler registered once, survives channel changes without teardown. Matches `useChat` architectural decision.

2. **Y.Doc destroy + recreate on subscribe** — ensures no state bleed across channel switches or reconnections. Observer re-registered on fresh doc instance.

3. **ytext.observe() for reactive content** — fires after any local or remote Y.Doc update, keeps `content` state in sync without extra useState calls.

4. **encodeStateAsUpdate (full state) on applyLocalEdit** — sends cumulative state rather than delta. Gateway can store as snapshot, consistent with Phase 04-01 DynamoDB buffer strategy.

5. **Stable applyLocalEdit via empty-dep useCallback + refs** — same pattern as `send()` in useChat, prevents unnecessary re-renders in consuming components.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All 14 useCRDT tests: PASSED
- Full suite (94 tests across 6 files): PASSED
- TypeScript `--noEmit`: no errors
- yjs confirmed installed and importable

## Self-Check: PASSED
- `frontend/src/hooks/useCRDT.ts` — FOUND
- `frontend/src/hooks/__tests__/useCRDT.test.ts` — FOUND
- commit `5ae9171` (RED) — FOUND
- commit `fc187f7` (GREEN) — FOUND
