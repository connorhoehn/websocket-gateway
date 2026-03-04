---
phase: 06-foundation
plan: 02
subsystem: ui
tags: [react, typescript, websocket, hooks, vitest, tdd]

# Dependency graph
requires:
  - 06-01  # GatewayConfig, ConnectionState, GatewayMessage, GatewayError, SessionMessage types
provides:
  - useWebSocket hook at frontend/src/hooks/useWebSocket.ts
  - UseWebSocketOptions and UseWebSocketReturn types
  - Vitest test infrastructure for frontend hooks
affects: [06-03, 07, 08, 09, 10]

# Tech tracking
tech-stack:
  added: [vitest, "@testing-library/react", "@testing-library/user-event", jsdom, "@vitest/ui"]
  patterns:
    - "useRef for WebSocket instance and retry counter (avoids re-renders)"
    - "sessionTokenRef pattern: dual useState+useRef to sync async state into sync WS handlers"
    - "Exponential backoff via 1000 * 2^retryCount ms delay, MAX_RETRIES=5"
    - "defineConfig from vitest/config (not vite) to type-check test config"

key-files:
  created:
    - frontend/src/hooks/useWebSocket.ts
    - frontend/src/hooks/__tests__/useWebSocket.test.ts
  modified:
    - frontend/vite.config.ts
    - frontend/package.json

key-decisions:
  - "useRef for ws instance (not useState) — WebSocket reconnects must not cause re-renders"
  - "sessionTokenRef mirrors sessionToken state — WS close handler reads sync value (state is async)"
  - "switchChannel does NOT send subscribe messages — feature hooks (usePresence, useChat) own that concern"
  - "disconnect() saturates retryCount to MAX_RETRIES before closing, preventing onclose from scheduling a retry"
  - "defineConfig imported from vitest/config so TypeScript accepts the test: {} config block in vite.config.ts"

# Metrics
duration: 167s
completed: 2026-03-04
---

# Phase 6 Plan 02: useWebSocket Hook Summary

**useWebSocket hook with JWT auth URL building, session token storage, 5-retry exponential backoff reconnection, switchChannel, sendMessage, and full Vitest TDD coverage (18 tests)**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-04T01:57:56Z
- **Completed:** 2026-03-04T02:01:03Z
- **Tasks:** 1 (TDD: RED + GREEN phases)
- **Files modified:** 4

## Accomplishments

- Installed Vitest + jsdom + @testing-library/react and wired into vite.config.ts
- Wrote 18 failing tests covering all hook behaviours (TDD RED)
- Implemented `frontend/src/hooks/useWebSocket.ts` with full connection lifecycle management
- All 18 tests pass; `npm run build` exits 0 with no TypeScript errors

## Task Commits

Each TDD phase was committed atomically:

1. **TDD RED: Failing tests for useWebSocket** - `b1069a8` (test)
2. **TDD GREEN: useWebSocket hook implementation** - `b99b1f1` (feat)

## Files Created/Modified

- `frontend/src/hooks/useWebSocket.ts` - Core WebSocket hook: connect, reconnect, session, switchChannel, sendMessage, disconnect, cleanup
- `frontend/src/hooks/__tests__/useWebSocket.test.ts` - 18 Vitest tests with MockWebSocket, fake timers, @testing-library/react renderHook
- `frontend/vite.config.ts` - Added test: { globals, environment: jsdom }; switched to defineConfig from vitest/config
- `frontend/package.json` - Added vitest devDependencies; added "test" and "test:watch" scripts

## Key Implementation Details

### URL building

```typescript
function buildUrl(config: GatewayConfig, sessionToken: string | null): string {
  const url = new URL(config.wsUrl);
  url.searchParams.set('token', config.cognitoToken);
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
  return url.toString();
}
```

### Session token ref pattern

`sessionToken` lives in React state (for re-renders) AND in `sessionTokenRef` (for sync access inside WebSocket close handler). The ref is kept in sync via `useEffect`.

### Reconnect backoff

```
delay = 1000 * 2^retryCount  →  1s, 2s, 4s, 8s, 16s
After 5 retries: connectionState = 'disconnected'
```

### switchChannel concern boundary

`switchChannel()` only updates `currentChannel` state. It does NOT send subscribe messages. Feature hooks (usePresence, useChat) observe `currentChannel` and own their own subscribe/unsubscribe messaging.

## Decisions Made

- `useRef` for WebSocket instance — reconnect must not cause re-render cascades
- `sessionTokenRef` mirrors `sessionToken` state — WebSocket `onclose` callback must read a synchronous value; React state is async
- `switchChannel` does not send subscribe messages — keeps `useWebSocket` concern-pure; feature hooks own channel subscription protocol
- `disconnect()` saturates `retryCountRef` to `MAX_RETRIES` before calling `ws.close()` so `onclose` does not schedule another retry
- Used `defineConfig` from `vitest/config` (not `vite`) — Vite's `defineConfig` doesn't know the `test` property; vitest's version adds those types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion for reconnect state was inaccurate**
- **Found during:** TDD GREEN (first test run)
- **Issue:** Test expected `connectionState === 'reconnecting'` after `vi.advanceTimersByTime(1100)`, but at that point the reconnect timer has already fired and called `connect()`, setting state to `'connecting'`. The correct sequence is: close → `'reconnecting'` → (1s timer fires) → `'connecting'` (new WS created).
- **Fix:** Updated test assertion to expect `'connecting'` after timer advance; verified the second WebSocket URL still contains `sessionToken=`.
- **Files modified:** `frontend/src/hooks/__tests__/useWebSocket.test.ts`
- **Committed in:** `b99b1f1`

**2. [Rule 3 - Blocking] TypeScript error on vite.config.ts test block**
- **Found during:** TDD GREEN (`npm run build`)
- **Issue:** `defineConfig` from `vite` does not type-check the `test: {}` block. TypeScript error: `'test' does not exist in type 'UserConfigExport'`.
- **Fix:** Switched import to `defineConfig` from `vitest/config` which extends Vite's config type with the test-runner properties.
- **Files modified:** `frontend/vite.config.ts`
- **Committed in:** `b99b1f1`

---

**Total deviations:** 2 auto-fixed (1 test accuracy fix, 1 TypeScript config fix)
**Impact on plan:** Minimal — no scope creep. Both fixes were required to reach a passing build.

## Issues Encountered

None blocking. Two auto-fixed deviations documented above.

## User Setup Required

None — hook is a pure TypeScript/React file, no external service required.

## Next Phase Readiness

- Plan 03 (ConnectionStatus + ErrorDisplay UI components) can import `useWebSocket` and `UseWebSocketReturn` directly
- Feature hooks in Phase 07+ compose on top of this hook by calling `sendMessage` and subscribing via `onMessage`
- No blockers

## Self-Check: PASSED

- FOUND: `frontend/src/hooks/useWebSocket.ts`
- FOUND: `frontend/src/hooks/__tests__/useWebSocket.test.ts`
- FOUND: `.planning/phases/06-foundation/06-02-SUMMARY.md`
- FOUND: commit `b1069a8` (test - RED phase)
- FOUND: commit `b99b1f1` (feat - GREEN phase)
- Build: `npm run build` exits 0
- Tests: 18/18 passing

---
*Phase: 06-foundation*
*Completed: 2026-03-04*
