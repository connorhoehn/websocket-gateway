---
phase: 12-identity-integration
plan: "01"
subsystem: frontend-hooks
tags: [identity, displayName, presence, cursors, chat, auth]
dependency_graph:
  requires: [11-auth-foundation]
  provides: [displayName-in-all-hooks]
  affects: [usePresence, useCursors, useChat, App.tsx]
tech_stack:
  added: []
  patterns: [ref-sync-pattern, JWT-decode-atob, displayName-propagation]
key_files:
  created:
    - frontend/src/utils/identity.ts
  modified:
    - frontend/src/hooks/usePresence.ts
    - frontend/src/hooks/useCursors.ts
    - frontend/src/hooks/useChat.ts
    - frontend/src/app/App.tsx
decisions:
  - "identity.ts keeps COLOR_PALETTE private (no export) — consumer components import identityToColor, not the palette directly"
  - "decodeDisplayName as module-level pure function in App.tsx (not hook) — no reactivity overhead, easily unit-testable"
  - "displayNameRef pattern mirrors existing sendMessageRef/currentChannelRef — consistent with established hook patterns"
  - "ChatMessage.displayName is optional — backwards compatible with messages sent before Phase 12"
  - "identityToInitials handles empty string with '?' sentinel — avoids blank initials in UI edge cases"
metrics:
  duration: 194s
  completed: "2026-03-11"
  tasks: 2
  files: 5
---

# Phase 12 Plan 01: Identity Integration — displayName Propagation Summary

**One-liner:** JWT-decoded displayName flows from App.tsx through usePresence/useCursors/useChat via displayNameRef pattern, with a shared identity.ts utility providing stable color-hashing and initials parsing.

## What Was Built

### Task 1 — `frontend/src/utils/identity.ts` (commit `71004d5`)

New shared identity utility with two exports:

- **`identityToColor(identifier: string): string`** — djb2 hash over identifier (email preferred) mapped to a 15-color palette. Identical algorithm to the existing `clientIdToColor` helpers in cursor components, ensuring color consistency across the migration.

- **`identityToInitials(displayName: string): string`** — Parses a human display name into a 2-char uppercase abbreviation: "Jane Doe" → "JD", "jane" → "JA", "j" → "J", "" → "?". Handles multi-word names by taking first char of first and last words.

### Task 2 — Hook updates + App.tsx wiring (commit `6fa0821`)

**`usePresence.ts`:**
- Added `displayName: string` to `UsePresenceOptions`
- Added `displayNameRef` (mirrors prop via useEffect — same pattern as `sendMessageRef`)
- Heartbeat payload now includes `metadata: { displayName, isTyping: false }`
- `setTyping()` includes `metadata: { displayName, isTyping }` in both the immediate set and the auto-clear timeout

**`useCursors.ts`:**
- Added `displayName: string` to `UseCursorsOptions`
- Added `displayNameRef` with useEffect sync
- All four send functions updated:
  - `sendFreeformUpdate`: `metadata: { mode: 'freeform', displayName }`
  - `sendTableUpdate`: `metadata: { mode: 'table', displayName }`
  - `sendTextUpdate`: `metadata: { mode: 'text', selection, hasSelection, displayName }`
  - `sendCanvasUpdate`: `metadata: { mode: 'canvas', tool, color, size, displayName }`

**`useChat.ts`:**
- Added `displayName: string` to `UseChatOptions`
- Added `displayName?: string` to `ChatMessage` interface (optional for backwards compatibility)
- Added `displayNameRef` with useEffect sync
- `send()` includes `data: { displayName }` in outbound payload
- History handler extracts `m.data?.displayName` when building ChatMessage from server history
- Real-time handler extracts `msg.data?.displayName` from incoming messages

**`App.tsx`:**
- Added `decodeDisplayName(idToken, email)` module-level pure function: parses JWT payload (`atob(token.split('.')[1])`) for `given_name`, falls back to email prefix, then `'anonymous'`
- `GatewayDemo` derives `displayName` once: `decodeDisplayName(config.cognitoToken ?? null, auth.email)`
- `displayName` passed to `usePresence`, `useCursors`, `useChat`
- Removed `void chatMessages; void sendChat;` suppressions (Plan 02 will wire ChatPanel)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

```
cd frontend && npx tsc --noEmit   # exits 0, zero errors
grep -n "displayName" frontend/src/utils/identity.ts          # exports present
grep -n "displayName" frontend/src/hooks/usePresence.ts       # metadata includes displayName
grep -n "displayName" frontend/src/hooks/useCursors.ts        # all 4 send* include displayName
grep -n "displayName" frontend/src/hooks/useChat.ts           # send + ChatMessage.displayName
grep -n "displayName|decodeDisplayName" frontend/src/app/App.tsx  # decode present, passed to hooks
```

All checks pass.

## Self-Check: PASSED

- [x] `frontend/src/utils/identity.ts` exists
- [x] `frontend/src/hooks/usePresence.ts` updated (displayNameRef + metadata)
- [x] `frontend/src/hooks/useCursors.ts` updated (displayNameRef + all 4 send*)
- [x] `frontend/src/hooks/useChat.ts` updated (ChatMessage.displayName + send payload)
- [x] `frontend/src/app/App.tsx` updated (decodeDisplayName + hook wiring)
- [x] Commit `71004d5` exists (Task 1)
- [x] Commit `6fa0821` exists (Task 2)
- [x] TypeScript: zero compilation errors
