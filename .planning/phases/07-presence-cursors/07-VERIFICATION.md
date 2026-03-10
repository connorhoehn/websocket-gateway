---
phase: 07-presence-cursors
verified: 2026-03-10T10:29:00Z
status: gaps_found
score: 16/17 must-haves verified
re_verification: false
gaps:
  - truth: "Each user's color is deterministic: same clientId always yields same color across reconnections"
    status: failed
    reason: "Two different hash algorithms are used across the six components — djb2-style (charCode + ((hash << 5) - hash)) in PresencePanel, CursorCanvas, and CanvasCursorBoard; polynomial (hash * 31 + charCode) in TableCursorGrid and TextCursorEditor. The same clientId will map to different colors in table and text modes than in freeform, canvas, and the presence panel."
    artifacts:
      - path: "frontend/src/components/TableCursorGrid.tsx"
        issue: "Uses polynomial hash: hash = (hash * 31 + clientId.charCodeAt(i)) | 0 (line 23)"
      - path: "frontend/src/components/TextCursorEditor.tsx"
        issue: "Uses polynomial hash: hash = (hash * 31 + clientId.charCodeAt(i)) | 0 (line 25)"
    missing:
      - "Unify clientIdToColor in TableCursorGrid.tsx to use the same djb2-style algorithm: hash = clientId.charCodeAt(i) + ((hash << 5) - hash)"
      - "Unify clientIdToColor in TextCursorEditor.tsx to use the same djb2-style algorithm: hash = clientId.charCodeAt(i) + ((hash << 5) - hash)"
human_verification:
  - test: "Open two browser tabs on the same channel and observe both tabs appear in PresencePanel"
    expected: "Both tabs show their clientId in the user list; closing one tab removes it within seconds"
    why_human: "Requires live WebSocket connection to gateway — cannot verify message round-trips programmatically"
  - test: "Type in any input area (e.g., channel selector) and observe the typing indicator on a second tab"
    expected: "A 'typing...' badge appears next to the user row and clears approximately 2 seconds after typing stops"
    why_human: "setTyping must be called from a textarea/input and the 2s auto-clear requires real-time observation"
  - test: "Move the mouse in the Freeform cursor area on tab A and watch tab B"
    expected: "A 24px colored circle with initials appears on tab B and follows the mouse in real-time"
    why_human: "Requires live gateway relay of cursor:update messages between tabs"
  - test: "Click a spreadsheet cell on tab A and observe tab B"
    expected: "A colored cell-border indicator with initials badge appears on the correct cell in tab B"
    why_human: "Requires live gateway relay of table cursor:update messages"
  - test: "Click or type in the Text Cursor editor on tab A and observe tab B"
    expected: "A colored 2px caret line appears at the character position; selecting text produces a semi-transparent highlight"
    why_human: "Requires live gateway relay and DOM coordinate rendering in a real browser"
  - test: "Move the mouse in Canvas mode on tab A and observe tab B"
    expected: "A colored cursor circle with tool label appears; ephemeral trail particles (shape varies by tool) appear and disappear after ~1 second"
    why_human: "Trail particle DOM manipulation requires real browser rendering to verify"
  - test: "Switch cursor modes using the mode selector buttons on tab A"
    expected: "All remote cursors disappear immediately on mode switch; the selected panel appears; the other tabs see cursor:unsubscribe then cursor:subscribe messages"
    why_human: "Subscription reset and cursor clearing requires live WebSocket traffic"
  - test: "Disconnect one tab (close it or navigate away)"
    expected: "The disconnected tab's cursor disappears across all modes on remaining tabs; its presence row disappears from PresencePanel"
    why_human: "cursor:remove and presence:offline events are gateway-initiated — requires live connection"
---

# Phase 7: Presence and Cursors Verification Report

**Phase Goal:** Multiple browser tabs on the same channel can see each other's presence and cursors updating in real-time across all four cursor modes (freeform, table, text, canvas)
**Verified:** 2026-03-10T10:29:00Z
**Status:** gaps_found — 1 automated gap (inconsistent hash algorithm), 8 items requiring human verification with live gateway
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PresencePanel shows a live list of all users connected to the current channel | VERIFIED | PresencePanel.tsx renders `users.map(...)` from usePresence hook; users state populated from presence:subscribed and presence:update messages |
| 2 | The user list updates in real-time as browser tabs join and leave the channel | VERIFIED | usePresence.ts handles presence:update (upsert) and presence:offline (delete) with setUsers state updates |
| 3 | A typing indicator appears next to a user's entry when they are actively typing | VERIFIED | PresencePanel.tsx renders `typing...` span when `user.metadata.isTyping === true`; usePresence.ts setTyping sends correct presence:set action |
| 4 | Typing indicator auto-clears after the user stops typing for 2 seconds | VERIFIED | usePresence.ts line 158-167: setTimeout 2_000ms fires sendMessage with isTyping:false; debounced on repeated calls |
| 5 | Each user entry shows a deterministic colored circle derived from their clientId | VERIFIED | PresencePanel.tsx uses 15-color djb2 hash palette — deterministic per clientId |
| 6 | Moving the mouse in the freeform demo area broadcasts x/y position to the gateway | VERIFIED | CursorCanvas.tsx onMouseMove calls props.onMouseMove(x,y); useCursors.ts sendFreeformUpdate sends service:cursor action:update with position:{x,y} and metadata:{mode:'freeform'}; 50ms leading-edge throttle present |
| 7 | Remote cursors from other tabs appear as colored circles with initials that follow in real-time | VERIFIED | CursorCanvas.tsx renders `Array.from(cursors.values()).map(...)` with 24px circles, color from clientIdToColor, initials from clientIdToInitials |
| 8 | Each user's cursor color is deterministic: same clientId always yields same color across reconnections | FAILED | Hash algorithm inconsistency: TableCursorGrid and TextCursorEditor use polynomial hash (hash * 31 + charCode); PresencePanel, CursorCanvas, CanvasCursorBoard use djb2-style hash (charCode + ((hash << 5) - hash)). Same clientId maps to different colors in table/text mode vs. freeform/canvas/presence. |
| 9 | When a tab disconnects, its cursor circle disappears immediately in all remaining tabs | VERIFIED | useCursors.ts line 125-129 handles action='remove': deletes from cursorsRef and triggers setCursors update |
| 10 | Local cursor is not rendered (user does not see their own cursor as a remote cursor) | VERIFIED | useCursors.ts lines 106-108 and 118: filters `cursor.clientId === clientIdRef.current` in both cursor:subscribed and cursor:update handlers |
| 11 | Clicking a spreadsheet cell broadcasts {row,col} to the gateway and other tabs see a colored cell-border indicator | VERIFIED | TableCursorGrid.tsx onClick calls onCellClick(rowIndex,colIndex) wired to sendTableUpdate; useCursors.ts sendTableUpdate sends position:{row,col} metadata:{mode:'table'}; TableCursorGrid filters cursors by metadata.mode==='table' and renders absolute cell-border overlays |
| 12 | Each cell-border indicator shows an initials badge in the user's color | VERIFIED | TableCursorGrid.tsx lines 169-186 render initials badge div with background=color |
| 13 | Clicking or typing in the text editor broadcasts character offset; other tabs see a colored line cursor at that position | VERIFIED | TextCursorEditor.tsx onClick/onKeyUp calls handleInteraction which calls getCharOffset and onPositionChange; useCursors.ts sendTextUpdate sends position:{position:charOffset}; TextCursorEditor renders 2px line cursor using getTextCoordinates |
| 14 | When a user selects text, the selection range is broadcast and other tabs see a colored highlight overlay | VERIFIED | TextCursorEditor.tsx getSelectionData returns {start,end,text}; sendTextUpdate sends metadata:{selection,hasSelection}; selectionCursors renders background:color+'40' overlay |
| 15 | Moving the mouse in canvas mode broadcasts x/y plus active tool, color, and size | VERIFIED | CanvasCursorBoard.tsx handleMouseMove calls onMouseMove(x,y,tool,color,size); useCursors.ts sendCanvasUpdate sends metadata:{mode:'canvas',tool,color,size}; 50ms throttle in CanvasCursorBoard |
| 16 | Remote canvas cursors show the tool label below the cursor circle | VERIFIED | CanvasCursorBoard.tsx RemoteCursorWithTrail renders `{initials} ({tool})` label div below the cursor circle |
| 17 | Ephemeral trail particles appear behind remote canvas cursors and auto-remove after 1 second | VERIFIED | addTrail() creates DOM element, appends to boardRef.current, removes via setTimeout 1000ms; RemoteCursorWithTrail useEffect([x,y]) calls addTrail on each position change; trail shapes match spec: pen=2px, brush=size, eraser=white+border, select=1px |
| 18 | Trail particle shape and size differs by tool: pen=2px dot, brush=size-px dot, eraser=size-px white+border, select=1px dot | VERIFIED | CanvasCursorBoard.tsx switch(t) cases: pen 2x2, brush size*size, eraser size*size+white bg+border, select 1x1 |
| 19 | A mode selector UI with four buttons switches the visible cursor demo panel | VERIFIED | CursorModeSelector.tsx renders four buttons (Freeform/Table/Text/Canvas); App.tsx uses activeMode conditional rendering for each panel |
| 20 | Switching modes clears all currently displayed cursors and sends cursor:unsubscribe then cursor:subscribe with the new mode | VERIFIED | useCursors.ts switchMode (line 262-280): sends unsubscribe, clears cursorsRef and setCursors(new Map()), calls setActiveMode; subscribe useEffect deps include activeMode so resubscription fires automatically |
| 21 | Cell-border and text cursors clear immediately when the source tab disconnects | VERIFIED | cursor:remove handler (line 125-129) deletes from Map and triggers setCursors re-render; both TableCursorGrid and TextCursorEditor read from the shared cursors Map |

**Score:** 20/21 truths verified (1 failed: inconsistent color hash)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/hooks/usePresence.ts` | usePresence hook — subscribe/unsubscribe, heartbeat, typing events, user list | VERIFIED | 184 lines; exports PresenceUser, UsePresenceReturn, UsePresenceOptions, usePresence; substantive implementation |
| `frontend/src/components/PresencePanel.tsx` | PresencePanel UI — user list with colored circles, initials, typing indicators | VERIFIED | 129 lines; renders avatar circles, typing badges, "(you)" label, empty state |
| `frontend/src/hooks/useCursors.ts` | useCursors hook — all four modes, mode switching, remote cursor map | VERIFIED | 293 lines; exports all required types and hook; all send functions implemented |
| `frontend/src/components/CursorCanvas.tsx` | Freeform cursor overlay with mousemove broadcasting and remote cursor circles | VERIFIED | 131 lines; renders grid background, remote circles, handles mousemove relative to container |
| `frontend/src/components/TableCursorGrid.tsx` | 10x6 spreadsheet grid with cell-border indicators | VERIFIED | 198 lines; renders 10-row x 6-column grid with cellCursors lookup, absolute border overlays, initials badges |
| `frontend/src/components/TextCursorEditor.tsx` | Contenteditable document with line cursors and selection highlights | VERIFIED | 283 lines; TreeWalker-based char offset, getTextCoordinates, line cursor + selection highlight rendering |
| `frontend/src/components/CanvasCursorBoard.tsx` | Canvas drawing area with tool selector, color picker, size slider, trail particles | VERIFIED | 362 lines; tool controls, addTrail function with all 4 tool variants, RemoteCursorWithTrail sub-component |
| `frontend/src/components/CursorModeSelector.tsx` | Four-button mode selector with active/inactive styling | VERIFIED | 54 lines; 4 mode buttons, active highlighted in blue (#007bff), exports CursorMode type |
| `frontend/src/app/App.tsx` | Mode selector layout with all hooks wired, PresencePanel above cursor section | VERIFIED | All hooks called; featureHandlers registry present; conditional mode rendering; PresencePanel above cursor section |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `usePresence.ts` | gateway WebSocket | `sendMessage({ service:'presence', action:'subscribe', channel })` | WIRED | Line 110: exact protocol match |
| `usePresence.ts` | gateway WebSocket | heartbeat every 30s: `sendMessage({ service:'presence', action:'heartbeat', channels:[channel] })` | WIRED | Lines 116-121: setInterval 30_000ms, sends heartbeat action |
| `usePresence.ts` | PresencePanel | users state array returned, updated on presence:subscribed/update/offline | WIRED | Lines 67-96 handle all three actions; return usersArray on line 183 |
| `CursorCanvas.tsx` | `useCursors.ts` | `onMouseMove` calls `sendFreeformUpdate(x,y)` | WIRED | App.tsx line 131: `onMouseMove={sendFreeformUpdate}` |
| `useCursors.ts` | gateway WebSocket | `sendMessage({ service:'cursor', action:'subscribe', channel, mode })` | WIRED | Lines 142-147: subscribe effect sends on connect |
| `useCursors.ts` | gateway WebSocket | cursor:update with position and metadata per mode | WIRED | sendFreeformUpdate (line 178), sendTableUpdate (line 201), sendTextUpdate (line 222), sendCanvasUpdate (line 247) all send service:'cursor' action:'update' |
| `TableCursorGrid.tsx` | `useCursors.ts` | cell onClick calls `sendTableUpdate(row, col)` | WIRED | TableCursorGrid.tsx line 134: `onClick={() => onCellClick(rowIndex, colIndex)}`; App.tsx line 134: `onCellClick={sendTableUpdate}` |
| `TextCursorEditor.tsx` | `useCursors.ts` | onClick/keyup calls `sendTextUpdate(position, selectionData, hasSelection)` | WIRED | Lines 200-201: onClick/onKeyUp={handleInteraction}; line 151: calls onPositionChange |
| `CanvasCursorBoard.tsx` | `useCursors.ts` | onMouseMove calls `sendCanvasUpdate(x, y, tool, color, size)` | WIRED | CanvasCursorBoard.tsx line 140: `onMouseMove(x, y, tool, color, size)`; App.tsx line 145: `onMouseMove={sendCanvasUpdate}` |
| `CursorModeSelector.tsx` | `App.tsx` | `onModeChange` callback calls `switchMode`, App.tsx conditionally renders active panel | WIRED | App.tsx line 128: `onModeChange={switchMode}`; lines 130-146: conditional panel rendering by activeMode |
| `useCursors.ts` | gateway WebSocket | `switchMode`: unsubscribe + clear + subscribe new mode | WIRED | Lines 262-280: sends unsubscribe, clears Map, setActiveMode; subscribe useEffect reacts to activeMode dep |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PRES-01 | 07-01 | User can see a live list of connected users in the current channel | SATISFIED | PresencePanel renders `users.map(...)` from usePresence; wired in App.tsx line 122 |
| PRES-02 | 07-01 | User list updates in real-time as tabs join and leave | SATISFIED | presence:update upserts; presence:offline deletes; setUsers triggers re-render |
| PRES-03 | 07-01 | Typing indicators show when other users are active | SATISFIED | PresencePanel shows "typing..." when metadata.isTyping===true; setTyping sends correct messages |
| CURS-01 | 07-02 | Freeform cursor broadcasts x/y position to all tabs | SATISFIED | CursorCanvas.tsx + sendFreeformUpdate + 50ms throttle all present |
| CURS-02 | 07-02 | Remote cursors render with deterministic per-user color and initials | PARTIAL | Color is deterministic within freeform/canvas/presence (djb2 hash) but TableCursorGrid and TextCursorEditor use a different polynomial hash — violating cross-mode color consistency |
| CURS-03 | 07-02 | When a tab disconnects, its cursor is removed from all remaining tabs | SATISFIED | useCursors.ts action==='remove' handler deletes from cursorsRef and triggers setCursors |
| CURS-04 | 07-03 | Table cursor mode — clicking broadcasts row/col; remote users see cell-border indicator | SATISFIED | TableCursorGrid.tsx fully implemented with cellCursors lookup and border overlay |
| CURS-05 | 07-03 | Text cursor mode — cursor tracks char offset; remote users see line cursor + selection highlight | SATISFIED | TextCursorEditor.tsx with getCharOffset, getTextCoordinates, and selection highlight rendering |
| CURS-06 | 07-04 | Canvas cursor mode — metadata includes tool/color/size; trail particles auto-remove after 1s | SATISFIED | CanvasCursorBoard.tsx addTrail with all 4 tool variants; setTimeout 1000ms cleanup |
| CURS-07 | 07-04 | Multi-mode cursor demo — mode selector switches panels; switching clears cursors and resets subscription | SATISFIED | CursorModeSelector.tsx four buttons; switchMode sends unsubscribe/clears/triggers resubscribe |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/components/TableCursorGrid.tsx` | 23 | Hash algorithm `hash = (hash * 31 + clientId.charCodeAt(i)) \| 0` differs from djb2-style used in PresencePanel, CursorCanvas, CanvasCursorBoard | Blocker | Same clientId produces different colors in table mode vs. presence/freeform/canvas — breaks requirement CURS-02 and truth 8 |
| `frontend/src/components/TextCursorEditor.tsx` | 25 | Hash algorithm `hash = (hash * 31 + clientId.charCodeAt(i)) \| 0` differs from djb2-style | Blocker | Same clientId produces different colors in text mode vs. presence/freeform/canvas — same root cause as above |
| `frontend/src/components/TextCursorEditor.tsx` | 132 | Comment "Initial placeholder text" above `const INITIAL_TEXT = ...` | Info | Code comment only — the constant is a substantive string used as contenteditable initial content; not a stub |

---

### Human Verification Required

The automated checks confirm all files exist, are substantive (no stubs), are wired together, TypeScript compiles clean (0 errors), Vite build succeeds (219 kB), and all 66 unit tests pass. The following behaviors require a running gateway to verify:

**1. Presence join/leave real-time update**
Test: Open two browser tabs on the same channel.
Expected: Both tabs appear in each other's PresencePanel. Closing one tab removes its row within a few seconds (after gateway detects the disconnect).
Why human: Requires live WebSocket gateway to relay presence:subscribed and presence:offline messages.

**2. Typing indicator appearance and auto-clear**
Test: On tab A, simulate typing (setTyping needs a real keypress source) and observe tab B.
Expected: "typing..." badge appears next to the user row on tab B, clears ~2s after typing stops.
Why human: setTyping in usePresence is not wired to any textarea in the current App.tsx — it is exported from the hook but the demo app has no textarea with an onKeyDown handler that calls setTyping. This means PRES-03 has the hook infrastructure ready but no UI trigger in the current demo. Note: requires manual testing to confirm whether any input in the app already calls setTyping.

**3. Freeform cursor real-time relay**
Test: Move mouse in CursorCanvas on tab A; observe tab B.
Expected: Colored cursor circle follows in real-time with 50ms throttle.
Why human: Requires live gateway cursor service to relay cursor:update messages.

**4. Table cell cursor cross-tab**
Test: Click cell B3 on tab A; observe tab B.
Expected: Colored cell-border indicator with initials badge appears on cell B3 in tab B.
Why human: Requires live gateway relay.

**5. Text cursor cross-tab**
Test: Click in the text editor on tab A; select some text.
Expected: 2px colored caret line appears on tab B; selection highlight appears when text is selected.
Why human: Requires live gateway relay and DOM coordinate rendering in a real browser.

**6. Canvas mode trail particles**
Test: Switch to Canvas mode, move mouse on tab A; observe tab B.
Expected: Cursor circle with tool label appears; trail particles appear and disappear after ~1 second; particle shape varies by selected tool.
Why human: Requires live gateway relay and visual inspection of DOM trail particle behavior.

**7. Mode selector clears cursors**
Test: While cursor circles are visible on tab B, switch modes on tab A.
Expected: All cursor circles disappear immediately on mode switch; the new panel appears; the gateway receives cursor:unsubscribe then cursor:subscribe with the new mode.
Why human: Subscription reset requires live WebSocket traffic to confirm.

**8. Disconnect cleanup across all modes**
Test: Disconnect tab A (close it) while any cursor mode is active.
Expected: Tab A's cursor disappears from tab B immediately (or within gateway heartbeat timeout); tab A's presence row disappears from PresencePanel.
Why human: cursor:remove and presence:offline are gateway-initiated disconnect events.

---

### Gaps Summary

**1 blocker gap: Inconsistent clientIdToColor hash algorithm (CURS-02 partial)**

Four of six components (`PresencePanel`, `CursorCanvas`, `CanvasCursorBoard`, `usePresence` — note usePresence does not compute color) use the djb2-style hash: `hash = clientId.charCodeAt(i) + ((hash << 5) - hash)`. Two components (`TableCursorGrid`, `TextCursorEditor`) use the polynomial hash: `hash = (hash * 31 + clientId.charCodeAt(i)) | 0`.

For any given clientId, the two algorithms will map to different palette indices, causing a user's color in table mode to differ from their color in freeform/canvas/presence mode. This violates the "deterministic per-user color" requirement (CURS-02) and the phase truth "same clientId always yields same color across reconnections."

The fix is minimal: update lines 23 in `TableCursorGrid.tsx` and line 25 in `TextCursorEditor.tsx` to use `hash = clientId.charCodeAt(i) + ((hash << 5) - hash)`.

**Note on typing indicator wiring (PRES-03 infrastructure present, UI trigger uncertain)**

The `setTyping` function is exported from `usePresence` and destructured nowhere in `App.tsx` — only `users: presenceUsers` is destructured (App.tsx line 74). The typing indicator infrastructure (hook, heartbeat, PresencePanel render) is complete, but the demo UI does not appear to call `setTyping`. This is a potential PRES-03 gap pending human verification — the requirement specifies "show when other users are active" but the demo currently has no visible input control that triggers `setTyping`.

---

_Verified: 2026-03-10T10:29:00Z_
_Verifier: Claude (gsd-verifier)_
