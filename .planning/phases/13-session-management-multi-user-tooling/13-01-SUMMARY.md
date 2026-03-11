---
phase: 13-session-management-multi-user-tooling
plan: 01
subsystem: auth
tags: [cognito, jwt, token-refresh, broadcast-channel, multi-tab, react-hooks, vitest, tdd]

# Dependency graph
requires:
  - phase: 11-auth-foundation
    provides: useAuth hook with sign-in/sign-up/sign-out, Cognito USER_PASSWORD_AUTH integration
  - phase: 12-identity-integration
    provides: identity.ts, display name patterns used across hooks
provides:
  - proactive token refresh 2 minutes before Cognito ID token expiry
  - BroadcastChannel('auth') multi-tab sync for TOKEN_REFRESHED and SIGNED_OUT events
  - scheduleTokenRefresh helper function in useAuth.ts
  - 8 new TDD tests covering refresh success, failure, timer cleanup, and cross-tab sync
affects: [14-future-phases, useWebSocket-reconnect-on-idToken-change]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - timerRef + useRef pattern for mutable timer handles without re-renders
    - broadcastChannel.current ref for cross-tab communication lifecycle tied to hook mount/unmount
    - scheduleTokenRefresh pure helper function (module-level) for testable timer scheduling logic
    - doRefresh useCallback with dependency on userPool and signOut for stable closure
    - TDD RED commit then GREEN commit for behavior-driven implementation

key-files:
  created: []
  modified:
    - frontend/src/hooks/useAuth.ts
    - frontend/src/hooks/__tests__/useAuth.test.ts

key-decisions:
  - "scheduleTokenRefresh is a module-level pure function (not inside hook) — testable independently, no hook re-render cost"
  - "timerRef and broadcastChannel use useRef not useState — mutations do not trigger re-renders"
  - "doRefresh defined with useCallback before BroadcastChannel effect — allows stable reference in timer callback"
  - "signOut clears timer before broadcasting SIGNED_OUT — ensures this tab and others reach consistent unauthenticated state"
  - "Re-schedule next refresh inside refreshSession onSuccess — chains indefinitely without additional effects"

patterns-established:
  - "timerRef pattern: useRef for imperative timer handles, clear in signOut and useEffect cleanup"
  - "BroadcastChannel ref pattern: open on mount, close on unmount, onmessage handler updates state via setState functional updater"

requirements-completed: [AUTH-09, AUTH-10]

# Metrics
duration: 1min
completed: 2026-03-11
---

# Phase 13 Plan 01: Session Management — Token Refresh and Multi-Tab Sync Summary

**Proactive Cognito ID token refresh via setTimeout (2 min early) with BroadcastChannel multi-tab sync — keeps the gateway connection live for the full token lifetime without user re-login**

## Performance

- **Duration:** 1 min (continuation — RED phase pre-committed, GREEN committed now)
- **Started:** 2026-03-11T18:58:47Z
- **Completed:** 2026-03-11T18:59:08Z
- **Tasks:** 2 (TDD RED + TDD GREEN)
- **Files modified:** 2

## Accomplishments
- Added `scheduleTokenRefresh` helper that decodes JWT exp, computes delay (exp - 2min), and returns a timer handle
- Added `doRefresh` callback that calls `cognitoUser.refreshSession`, updates `idToken` state, broadcasts `TOKEN_REFRESHED`, and re-schedules the next refresh
- Added BroadcastChannel('auth') effect: handles `TOKEN_REFRESHED` (update idToken) and `SIGNED_OUT` (clear state + localStorage) from other tabs
- Wired timer scheduling into session restore and `signIn` onSuccess paths
- `signOut` now clears the pending timer and broadcasts `SIGNED_OUT` before clearing state
- All 20 useAuth tests pass (12 original + 8 new); full suite of 127 tests has no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for token refresh and multi-tab sync** - `a8feadb` (test)
2. **Task 2 (GREEN): Implement token refresh and multi-tab sync in useAuth** - `1ab2bcc` (feat)

_Note: RED commit was made in prior session; GREEN committed during this execution._

## Files Created/Modified
- `frontend/src/hooks/useAuth.ts` - Added scheduleTokenRefresh, doRefresh, BroadcastChannel effect, timerRef, broadcastChannel refs; wired into session restore and signIn
- `frontend/src/hooks/__tests__/useAuth.test.ts` - 8 new tests: schedules timer, refresh success, refresh failure, clears on signOut, clears on unmount, no timer when unauthenticated, TOKEN_REFRESHED cross-tab, SIGNED_OUT cross-tab

## Decisions Made
- `scheduleTokenRefresh` is module-level (not inside hook) — keeps it a pure function, easily testable without hook setup
- `timerRef` and `broadcastChannel` use `useRef` — mutations do not cause re-renders
- `doRefresh` defined with `useCallback` before the BroadcastChannel effect so the timer closure captures a stable reference
- `signOut` clears timer before broadcasting `SIGNED_OUT` — this tab and other tabs reach consistent unauthenticated state
- Re-schedule inside `refreshSession` `onSuccess` callback — chains indefinitely without additional effects or lifecycle complexity

## Deviations from Plan

None - plan executed exactly as written. Implementation was already partially in progress (RED commit existed); GREEN implementation matched the plan spec precisely.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Token refresh and multi-tab sync complete; useAuth.ts is production-ready for Cognito session management
- `idToken` state updates on refresh, which automatically triggers `useWebSocket` reconnect via `config.cognitoToken` dependency
- Ready for Phase 13 remaining plans (multi-user tooling, session observability)

---
*Phase: 13-session-management-multi-user-tooling*
*Completed: 2026-03-11*
