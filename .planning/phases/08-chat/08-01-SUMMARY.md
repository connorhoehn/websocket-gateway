---
phase: 08-chat
plan: 01
subsystem: frontend-hooks
tags: [chat, tdd, websocket, hook, react]
dependency_graph:
  requires:
    - useWebSocket (sendMessage, onMessage, currentChannel, connectionState)
    - types/gateway.ts (ConnectionState, GatewayMessage)
  provides:
    - useChat hook (subscribe, send, history load, real-time receive)
    - ChatMessage type
    - UseChatOptions type
    - UseChatReturn type
  affects:
    - ChatPanel component (08-02, consumes useChat)
tech_stack:
  added: []
  patterns:
    - sendMessageRef + currentChannelRef stable-ref pattern (mirrors usePresence)
    - Separate onMessage effect from subscribe effect (handler survives channel changes)
    - useCallback with empty deps, all values accessed via refs
key_files:
  created:
    - frontend/src/hooks/useChat.ts
    - frontend/src/hooks/__tests__/useChat.test.ts
  modified: []
decisions:
  - useChat separates onMessage handler effect from subscribe effect so the message handler persists across channel changes without teardown
  - Channel filter in handler uses currentChannelRef.current (not closure value) to always read the freshest channel
  - setMessages([]) on both subscribe (entering channel) and unsubscribe cleanup (exiting channel) — two clear points ensure no stale messages across channel transitions
  - send() stable useCallback with empty deps, accesses all values via refs — consistent with setTyping pattern in usePresence
metrics:
  duration: 83s
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 8 Plan 01: useChat Hook Summary

**One-liner:** React useChat hook with TDD — chat:history/message handlers, subscribe/unsubscribe lifecycle, stable send() callback using sendMessageRef/currentChannelRef pattern.

## Tasks Completed

| Task | Type | Description | Commit |
|------|------|-------------|--------|
| RED | TDD | Write 14 failing tests covering all useChat behaviors | b0ab549 |
| GREEN | TDD | Implement useChat.ts — all 14 tests pass | 04573ba |

## What Was Built

`useChat.ts` — a React hook that:

1. **Subscribes** to the gateway chat service on connect (`connectionState === 'connected'`), sends `{ service: 'chat', action: 'subscribe', channel }`.
2. **Unsubscribes** on channel change or unmount, sends `{ service: 'chat', action: 'unsubscribe', channel }`.
3. **Clears messages** on channel transition (both on subscribe entry and unsubscribe cleanup).
4. **Loads history** — handles `chat:history` events, replaces `messages` state with the full history array in chronological order.
5. **Receives real-time messages** — handles `chat:message` events, appends to `messages` array.
6. **Filters by channel** — both `chat:history` and `chat:message` events are ignored if their `channel` field doesn't match `currentChannelRef.current`.
7. **send(content)** — emits `{ service: 'chat', action: 'message', channel, content }` using stable refs; no-op protection is inherited from `useWebSocket.sendMessage`.

## Test Coverage (14 tests, all GREEN)

- subscribe on connect (3 cases: connected, disconnected, connecting)
- chat:history populates messages array, handles empty array
- chat:message appends to messages, ignores wrong channel
- send() emits correct protocol message, allows empty string
- channel change: unsubscribes old, subscribes new, clears messages
- unsubscribe on unmount
- return shape: messages array + send function, starts empty

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `frontend/src/hooks/useChat.ts` — FOUND
- [x] `frontend/src/hooks/__tests__/useChat.test.ts` — FOUND
- [x] Commit b0ab549 (RED) — FOUND
- [x] Commit 04573ba (GREEN) — FOUND
- [x] 14/14 tests pass
- [x] TypeScript: no errors (`npx tsc --noEmit` clean)
