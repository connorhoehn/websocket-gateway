---
phase: 07-presence-cursors
plan: 03
subsystem: ui
tags: [react, typescript, websocket, cursors, contenteditable, table-grid]

# Dependency graph
requires:
  - phase: 07-02
    provides: useCursors hook with freeform mode, CursorCanvas component, onMessage handler registry

provides:
  - useCursors extended with sendTableUpdate(row, col) and sendTextUpdate(position, selectionData, hasSelection)
  - TextSelectionData interface exported from useCursors.ts
  - TableCursorGrid component: 10x6 spreadsheet grid with colored cell-border indicators and initials badges
  - TextCursorEditor component: contenteditable document with line cursors and selection highlights
  - App.tsx wired with both components below CursorCanvas section

affects: [07-04, future cursor modes, CURS-04, CURS-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cellCursors Map lookup pattern: group remote cursors by 'row,col' key for O(1) cell render"
    - "TreeWalker char-offset positioning: walk text nodes to find DOM coordinates for text cursor rendering"
    - "Additive hook extension: sendTableUpdate and sendTextUpdate add to UseCursorsReturn without touching message handler"

key-files:
  created:
    - frontend/src/components/TableCursorGrid.tsx
    - frontend/src/components/TextCursorEditor.tsx
  modified:
    - frontend/src/hooks/useCursors.ts
    - frontend/src/app/App.tsx

key-decisions:
  - "No throttle on sendTableUpdate/sendTextUpdate — table clicks and key events are already low frequency, throttle would hurt UX"
  - "getTextCoordinates falls back to {top:0,left:0,height:18} on DOM exceptions — prevents crash on edge cases in contenteditable"
  - "Selection highlight uses single bounding box (start to end) — approximate for multi-line; exact multi-rect rendering deferred"
  - "cellCursors lookup built per render from the shared cursors Map — no additional state, filtering at render time"

patterns-established:
  - "Mode-filtered rendering: components filter shared cursors Map by metadata.mode at render time — single Map, multiple views"
  - "clientIdToColor/clientIdToInitials duplicated per component — utility extraction deferred to Phase 7 completion"

requirements-completed: [CURS-04, CURS-05]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 07 Plan 03: Table and Text Cursor Modes Summary

**Table cell-border cursors (CURS-04) and text character-offset cursors with selection highlights (CURS-05) implemented via TableCursorGrid and TextCursorEditor components using the shared useCursors Map**

## Performance

- **Duration:** 3 min (175s)
- **Started:** 2026-03-10T14:14:48Z
- **Completed:** 2026-03-10T14:17:43Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended useCursors hook with sendTableUpdate(row, col) and sendTextUpdate(position, selectionData, hasSelection) — both use channelRef/connectionStateRef for stable callbacks
- TableCursorGrid renders a 10x6 spreadsheet with colored cell-border overlays and floating initials badges; multiple remote cursors on same cell stack with slight opacity decrease
- TextCursorEditor renders a contenteditable document; remote cursors shown as 2px colored caret lines with initials labels; selections shown as semi-transparent color highlights
- Both components filter the shared cursors Map by metadata.mode — no extra state or plumbing required
- App.tsx wired with Table Cursors and Text Cursors sections below the existing Freeform Cursors section

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend useCursors with sendTableUpdate and sendTextUpdate** - `41495d6` (feat)
2. **Task 2: Build TableCursorGrid and TextCursorEditor, wire into App.tsx** - `2c05a0c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `frontend/src/hooks/useCursors.ts` - Added TextSelectionData interface, sendTableUpdate, sendTextUpdate; extended UseCursorsReturn
- `frontend/src/components/TableCursorGrid.tsx` - 10x6 spreadsheet grid with remote cursor cell-border indicators and initials badges
- `frontend/src/components/TextCursorEditor.tsx` - Contenteditable document with TreeWalker-based char-offset positioning, line cursors, and selection highlights
- `frontend/src/app/App.tsx` - Imports TableCursorGrid and TextCursorEditor, destructures new send functions, renders both sections

## Decisions Made
- No throttle on sendTableUpdate/sendTextUpdate — table clicks and key events are already low frequency, throttle would hurt UX rather than help
- getTextCoordinates falls back gracefully on DOM exceptions — prevents crashes in contenteditable edge cases (empty doc, unmounted node)
- Selection highlight uses single bounding box (start to end position) — multi-line exact selection rendering deferred as out of scope
- cellCursors lookup Map built per render from the shared cursors Map — no additional state layer needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript checks and Vite build passed cleanly on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CURS-04 and CURS-05 requirements complete
- Phase 07-04 (canvas drawing cursors) can build on same useCursors pattern: add sendCanvasUpdate, build CanvasCursorBoard component
- Color helpers duplicated across PresencePanel, TableCursorGrid, TextCursorEditor, CursorCanvas — utility extraction ready when Phase 7 completes

## Self-Check: PASSED

All created files confirmed on disk. All task commits confirmed in git log.

---
*Phase: 07-presence-cursors*
*Completed: 2026-03-10*
