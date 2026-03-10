---
phase: 07-presence-cursors
plan: 02
subsystem: ui
tags: [react, websocket, cursors, hooks, vite, typescript, tdd, vitest]

# Dependency graph
requires:
  - phase: 06-foundation
    provides: useWebSocket hook with sendMessage/onMessage contract; App.tsx shell; featureHandlers registry (from 07-01)

provides:
  - useCursors hook (freeform mode) — subscribe/unsubscribe, cursor:update broadcast with 50ms throttle, remote cursor map
  - CursorCanvas component — 600x300 grid overlay with colored cursor circles
  - featureHandlers registry pattern in App.tsx (established by 07-01, used/extended here)

affects:
  - 07-03 (table cursors — extends useCursors with sendTableUpdate)
  - 07-04 (canvas/text cursors — extends useCursors with sendCanvasUpdate/sendTextUpdate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Leading-edge 50ms throttle via useRef timer for mousemove rate-limiting
    - Ref-based cursor store (cursorsRef) to avoid re-renders on every mouse pixel
    - featureHandlers registry in App.tsx for multi-hook message routing
    - clientIdToColor deterministic hash (15-color palette) for cursor identity

key-files:
  created:
    - frontend/src/hooks/useCursors.ts
    - frontend/src/components/CursorCanvas.tsx
    - frontend/src/hooks/__tests__/useCursors.test.ts
  modified:
    - frontend/src/app/App.tsx

key-decisions:
  - "useCursors uses leading-edge throttle (not trailing): first mousemove fires immediately, subsequent calls within 50ms are dropped"
  - "cursorsRef stores authoritative state; setCursors only called to trigger re-render — avoids per-pixel re-renders"
  - "channelRef and clientIdRef track latest values so message handler closure reads fresh values without teardown"
  - "CursorCanvas uses cursor: none CSS to hide native cursor inside the demo area"
  - "App.tsx wires useCursors below usePresence using the same featureHandlers registry already established by 07-01"

patterns-established:
  - "Ref-based side-channel state: use useRef for authoritative data store, useState only for render triggering"
  - "Feature hook onMessage registration: hooks push/filter handlers into featureHandlers.current ref in App.tsx"
  - "Additive hook design: useCursors returns only freeform methods now; future plans add sendTableUpdate etc. without refactor"

requirements-completed: [CURS-01, CURS-02, CURS-03]

# Metrics
duration: 4min
completed: 2026-03-10
---

# Phase 7 Plan 02: Freeform Cursors Summary

**useCursors hook with 50ms-throttled mousemove broadcast and CursorCanvas component rendering live remote cursor circles from 15-color deterministic palette**

## Performance

- **Duration:** 4 min 6s
- **Started:** 2026-03-10T14:08:12Z
- **Completed:** 2026-03-10T14:12:18Z
- **Tasks:** 2 (TDD: RED + GREEN + verify for Task 1; feat for Task 2)
- **Files modified:** 4

## Accomplishments

- useCursors hook subscribes on connect, unsubscribes on channel switch/unmount, filters own clientId from all remote cursor operations
- sendFreeformUpdate leads-edge throttles at 50ms, guards on connectionState, broadcasts cursor:update with position and freeform metadata
- CursorCanvas renders 600x300 grid overlay, computes mouse x/y relative to container, shows 24px colored circles with deterministic initials
- All 66 tests pass (useCursors: 13, usePresence: 17, useWebSocket: 18+18); TypeScript clean; Vite build succeeds

## Task Commits

Each task was committed atomically:

1. **TDD RED — useCursors failing tests** - `a053e8f` (test)
2. **Task 1: useCursors hook (freeform mode)** - `b1bf4b8` (feat)
3. **Task 2: CursorCanvas + App.tsx wiring** - `f5fe015` (feat)

_Note: TDD tasks have two commits — test (RED) then feat (GREEN)_

## Files Created/Modified

- `frontend/src/hooks/useCursors.ts` — useCursors hook with subscribe/unsubscribe, cursor map, sendFreeformUpdate throttle
- `frontend/src/components/CursorCanvas.tsx` — Freeform cursor overlay with grid background and remote cursor circles
- `frontend/src/hooks/__tests__/useCursors.test.ts` — 13 tests covering all hook behaviors
- `frontend/src/app/App.tsx` — Added useCursors, CursorCanvas imports; wired cursor hook and rendered canvas below PresencePanel

## Decisions Made

- Leading-edge throttle over trailing-edge: first call fires immediately (feels responsive), subsequent drops within 50ms window reduce server load
- cursorsRef stores the Map; setState only triggers re-render — avoids reconciling a new Map on every pixel if many remote cursors exist
- channelRef and clientIdRef: message handler closures read these refs so they always see current values without needing to re-register on every change
- `cursor: none` on CursorCanvas hides the native cursor inside the demo area to avoid visual conflict with the simulated cursor circles
- App.tsx already had featureHandlers registry from 07-01; 07-02 simply wires useCursors into the same pattern

## Deviations from Plan

None — plan executed exactly as written. App.tsx already had the featureHandlers registry from 07-01, so the "create it if missing" fallback was not needed.

## Issues Encountered

None.

## Next Phase Readiness

- useCursors hook is designed additively: 07-03 can add `sendTableUpdate` to UseCursorsReturn without breaking 07-02 callers
- CursorCanvas positions cursors by x/y from `cursor.position` — compatible with all future cursor modes
- featureHandlers registry in App.tsx ready for 07-03 (table), 07-04 (canvas/text) hooks

---
*Phase: 07-presence-cursors*
*Completed: 2026-03-10*
