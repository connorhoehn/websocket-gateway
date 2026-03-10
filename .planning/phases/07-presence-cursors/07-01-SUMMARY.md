---
phase: 07-presence-cursors
plan: "01"
subsystem: frontend-presence
tags: [presence, react-hooks, real-time, tdd]
dependency_graph:
  requires: [06-02, 06-03]
  provides: [usePresence-hook, PresencePanel-component]
  affects: [App.tsx, feature-hook-registry]
tech_stack:
  added: []
  patterns: [feature-hook-registry, onMessage-registrar, TDD-red-green]
key_files:
  created:
    - frontend/src/hooks/usePresence.ts
    - frontend/src/components/PresencePanel.tsx
    - frontend/src/hooks/__tests__/usePresence.test.ts
  modified:
    - frontend/src/app/App.tsx
decisions:
  - "featureHandlers useRef registry in App.tsx routes all inbound messages to feature hooks before appending to dev log"
  - "usePresence uses sendMessageRef and currentChannelRef to keep setTyping and heartbeat callbacks stable without re-renders"
  - "PresencePanel duplicates clientIdToColor/clientIdToInitials helpers — plan explicitly notes utility file sharing deferred to Phase 7 completion"
  - "onMessage registrar uses push/filter pattern (not WeakRef) — handlers are stable useCallback refs"
metrics:
  duration: 212s
  tasks_completed: 2
  files_created: 3
  files_modified: 1
  completed_date: "2026-03-10"
---

# Phase 7 Plan 1: Presence Hook and Panel Summary

**One-liner:** usePresence hook with 30s heartbeat, subscribe/unsubscribe lifecycle, and PresencePanel UI showing live user list with deterministic color-hash avatar circles and typing indicators.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Build usePresence hook (TDD) | 0b0d628 | usePresence.ts, usePresence.test.ts |
| 2 | Build PresencePanel + wire into App.tsx | b17143e | PresencePanel.tsx, App.tsx |

## What Was Built

### usePresence hook (`frontend/src/hooks/usePresence.ts`)

- Subscribes to the gateway presence service when `connectionState === 'connected'` and `currentChannel` is non-empty
- Sends heartbeat every 30 seconds via `setInterval`; interval is cleared on channel change or unmount
- Processes three inbound message types: `presence:subscribed` (initialize list), `presence:update` (upsert by clientId), `presence:offline` (delete by clientId)
- `setTyping(true/false)` sends correct `service: 'presence', action: 'set'` messages; setTyping(true) schedules a 2s auto-clear timer (debounced on repeated calls)
- Channel switch: unsubscribes from old channel, clears user list, subscribes to new channel
- Uses `sendMessageRef` and `currentChannelRef` to keep `setTyping` callback stable (no re-renders)

### PresencePanel component (`frontend/src/components/PresencePanel.tsx`)

- Header: "Users in channel (N)"
- Per-user row: 20x20px color circle with initials, clientId (truncated to 12 chars), "(you)" badge for self, "typing..." italic badge when `metadata.isTyping === true`
- Color derived deterministically from clientId using 15-color palette hash
- Empty state: "No other users connected"
- Inline styles only, monospace font inherited

### App.tsx updates (`frontend/src/app/App.tsx`)

- Added `featureHandlers` useRef registry — `onMessage` from useWebSocket fans out to all registered feature hook handlers
- `onMessage` registrar function (push/filter) passed to feature hooks — stable closure over the ref
- `usePresence` called with `sendMessage`, `onMessage`, `currentChannel`, `connectionState`
- `<PresencePanel users={presenceUsers} currentClientId={clientId} />` rendered above live message log

## Verification Results

- `npx tsc -b --noEmit`: 0 errors
- `npx vite build --outDir /tmp/vite-build-07-01`: build succeeded (204.63 kB JS, 391ms)
- `npx vitest run usePresence.test.ts`: 17/17 tests passed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test file used require() try/catch pattern incompatible with vitest module loading**
- **Found during:** Task 1 GREEN verification
- **Issue:** Test file used a `try/catch require()` at module scope (to allow RED phase to "not crash" before implementation existed). After implementation, vitest cached the `null` result and the `beforeEach` re-require path also failed with "Cannot find module" because vitest resolves requires differently than Node CJS.
- **Fix:** Converted to static `import { usePresence } from '../usePresence'` — clean and correct now that the implementation exists.
- **Files modified:** `frontend/src/hooks/__tests__/usePresence.test.ts`

**2. [Rule 1 - Bug] TypeScript error on vi.fn() mock type in test**
- **Found during:** Task 1 TypeScript verification
- **Issue:** `vi.fn()` returns `Mock<Procedure | Constructable>` which is not directly assignable to `(msg: Record<string, unknown>) => void` per TypeScript strict checking.
- **Fix:** Added `as unknown as ((msg: Record<string, unknown>) => void) & ReturnType<typeof vi.fn>` cast in `makePresenceOptions`.
- **Files modified:** `frontend/src/hooks/__tests__/usePresence.test.ts`
- **Commit:** 0b0d628

## Self-Check: PASSED

All files present, all commits verified:
- frontend/src/hooks/usePresence.ts: FOUND
- frontend/src/components/PresencePanel.tsx: FOUND
- frontend/src/hooks/__tests__/usePresence.test.ts: FOUND
- Commit 6902ba0 (RED tests): FOUND
- Commit 0b0d628 (GREEN implementation): FOUND
- Commit b17143e (Task 2 PresencePanel + App.tsx): FOUND
