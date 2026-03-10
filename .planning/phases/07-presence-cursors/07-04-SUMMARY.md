---
phase: 07-presence-cursors
plan: "04"
subsystem: ui
tags: [react, typescript, websocket, cursors, canvas, trail-particles, mode-selector]

# Dependency graph
requires:
  - phase: 07-02
    provides: useCursors hook with freeform mode, CursorCanvas component
  - phase: 07-03
    provides: useCursors extended with sendTableUpdate/sendTextUpdate, TableCursorGrid, TextCursorEditor

provides:
  - CursorMode type (freeform | table | text | canvas) and CanvasTool type
  - useCursors finalized: sendCanvasUpdate, switchMode, activeMode exported
  - CanvasCursorBoard with tool/color/size controls, trail particles, remote cursor labels
  - CursorModeSelector with four mode buttons and active/inactive styling
  - App.tsx mode-selector layout replacing always-on multi-panel layout

affects: [08-crdt-sync, 09-ivs-chat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Trail particles added imperatively via DOM appendChild/removeChild + setTimeout — avoids React re-renders on every mousemove"
    - "RemoteCursorWithTrail sub-component uses useEffect([x, y]) to fire addTrail on each position change without prop callback"
    - "switchMode unsubscribes → clears cursors → setActiveMode; subscribe useEffect reacts to activeMode dep change for resubscription"
    - "50ms leading-edge throttle in CanvasCursorBoard (broadcast) while trail particles fire on every event (visual feedback)"

key-files:
  created:
    - frontend/src/components/CanvasCursorBoard.tsx
    - frontend/src/components/CursorModeSelector.tsx
  modified:
    - frontend/src/hooks/useCursors.ts
    - frontend/src/app/App.tsx

key-decisions:
  - "Trail particles appended via DOM imperatively (not React state) to avoid per-pixel re-renders during fast mouse movement"
  - "RemoteCursorWithTrail sub-component with useEffect([x,y]) fires trail on each remote cursor position update"
  - "switchMode implementation: unsubscribe first, then clear cursors, then setActiveMode — subscribe useEffect handles the new subscription"
  - "No throttle on canvas sendCanvasUpdate in hook — component owns 50ms throttle, consistent with table/text pattern"
  - "CursorModeSelector re-exports CursorMode type for consumers that import from the component"

patterns-established:
  - "Imperative DOM manipulation for high-frequency visuals (trail particles) co-exists with declarative React rendering"
  - "Mode-selector layout: single cursor section with CursorModeSelector + conditional panel renders replaces always-on multi-panel"

requirements-completed: [CURS-06, CURS-07]

# Metrics
duration: 4min
completed: 2026-03-10
---

# Phase 07 Plan 04: Canvas Cursor Mode and Multi-Mode Selector Summary

**Canvas cursor board with tool/color/size metadata, ephemeral trail particles per tool type, and a four-button mode selector that clears cursors and resets subscription on switch**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-10T14:19:53Z
- **Completed:** 2026-03-10T14:23:17Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended useCursors hook with `sendCanvasUpdate` (tool/color/size in metadata), `switchMode` (unsubscribe/clear/resubscribe), and `activeMode` state — finalizing the hook for all four cursor modes
- Built `CanvasCursorBoard` with tool selector, color picker, size slider, trail particles by tool type (pen=2px dot, brush=size dot, eraser=white+border, select=1px dot) auto-removing after 1000ms, and remote cursor circles with tool label below
- Built `CursorModeSelector` four-button component (Freeform/Table/Text/Canvas) with blue active highlighting; wired into App.tsx replacing the always-on multi-panel layout with a mode-conditional single panel

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend useCursors with canvas mode and switchMode** - `411b99c` (feat)
2. **Task 2: Build CanvasCursorBoard, CursorModeSelector, rewire App.tsx** - `e4f4f31` (feat)

## Files Created/Modified

- `frontend/src/hooks/useCursors.ts` - Added CursorMode, CanvasTool types; sendCanvasUpdate, switchMode, activeMode; activeMode added to subscribe useEffect deps
- `frontend/src/components/CanvasCursorBoard.tsx` - Canvas board with tool controls, trail particles (imperative DOM), remote cursor circles with tool labels
- `frontend/src/components/CursorModeSelector.tsx` - Four mode buttons with active/inactive styles, exports CursorMode type
- `frontend/src/app/App.tsx` - Mode-selector layout: CursorModeSelector + conditional panel, switchMode wired from useCursors

## Decisions Made

- Trail particles appended via `document.createElement` + `board.appendChild` + `setTimeout(removeChild, 1000)` rather than React state — this avoids per-pixel React re-renders during fast mouse movement
- `RemoteCursorWithTrail` sub-component with `useEffect([x, y])` fires `addTrail` imperatively on each remote cursor position update, cleanly separating the trail side-effect from the cursor render
- `switchMode` unsubscribes first, then clears cursors, then calls `setActiveMode` — the subscribe `useEffect` fires when `activeMode` changes and handles the new subscription automatically, avoiding duplicate subscribe/unsubscribe calls
- `sendCanvasUpdate` in the hook has no internal throttle — `CanvasCursorBoard` owns the 50ms leading-edge throttle on broadcast, consistent with how table/text modes handle their own send frequency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 07 (Presence + Cursors) complete: all 9 success criteria satisfied
  - Presence: user joins/leaves, heartbeat, typing indicator, PresencePanel
  - Cursors: freeform (CursorCanvas), table (TableCursorGrid), text (TextCursorEditor), canvas (CanvasCursorBoard)
  - Mode selector: CursorModeSelector clears cursors and resets subscription on switch
  - Disconnect cleanup: cursor:remove on disconnect handled by gateway
  - Deterministic color: clientIdToColor (djb2 hash, 15-color palette)
- Ready for Phase 08 (CRDT sync) — useCRDT hook, Y.js integration

---
*Phase: 07-presence-cursors*
*Completed: 2026-03-10*
