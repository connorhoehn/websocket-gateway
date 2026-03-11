---
phase: 14
plan: 01
title: Auth & Presence Gap Closure
status: complete
requirements: [AUTH-09, PRES-03]
completed: 2026-03-11
files_changed: 3
---

# Summary: Plan 14-01

## What Was Done

Closed two gaps identified by v1.3 milestone audit.

### AUTH-09: Token refresh reconnect

**`frontend/src/app/App.tsx`** — added `useEffect` in `GatewayDemo` watching `config.cognitoToken`:
- `prevTokenRef` tracks the last-seen token to skip the initial mount
- When token changes and `connectionState === 'connected'`, calls `reconnect()`
- `reconnect()` closes the existing socket and opens a new one; `buildUrl()` picks up `config.cognitoToken` from the updated `config` (via `connect` useCallback dep chain)

### PRES-03: Typing indicator broadcast

**`frontend/src/app/App.tsx`** — destructured `setTyping` from `usePresence`; passed as `onTyping={setTyping}` to `ChatPanel`.

**`frontend/src/components/ChatPanel.tsx`**:
- Added `onTyping?: (isTyping: boolean) => void` to `ChatPanelProps`
- `handleKeyDown`: calls `onTyping(true)`, resets 2s debounce timer to `onTyping(false)` on idle
- `handleSend`: clears timer, calls `onTyping(false)` before `onSend`
- Unmount cleanup clears the timer

## Decisions

- Token reconnect lives in `GatewayDemo` (not `useWebSocket`) — keeps the hook's lifecycle effect stable with `[]` deps; callers handle token lifecycle
- `prevTokenRef` skips mount to avoid spurious reconnect on initial render
- 2s typing debounce matches common UX convention; chosen to balance responsiveness vs. heartbeat frequency

## Verification

- `tsc --noEmit` passes clean
- AUTH-09 closes: gateway reconnects with updated JWT after silent token refresh
- PRES-03 closes: local user typing state broadcast correctly; all remote tabs show indicator
