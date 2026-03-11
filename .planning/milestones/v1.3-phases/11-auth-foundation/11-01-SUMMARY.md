---
phase: 11-auth-foundation
plan: 01
subsystem: auth
tags: [cognito, react, hooks, tdd, vitest, localStorage, jwt]

# Dependency graph
requires: []
provides:
  - "useAuth hook with full Cognito USER_PASSWORD_AUTH lifecycle"
  - "AuthState and UseAuthReturn TypeScript interfaces"
  - "Session restore on mount via CognitoUserPool.getCurrentUser + getSession"
  - "signIn / signOut / signUp methods with localStorage persistence"
affects:
  - 11-02-LoginForm
  - 11-03-App.tsx-auth-gating

# Tech tracking
tech-stack:
  added: []  # amazon-cognito-identity-js was already in package.json
  patterns:
    - "useMemo for stable CognitoUserPool instance (avoids re-instantiation on every render)"
    - "useCallback for signIn/signUp/signOut (stable references, minimal re-renders)"
    - "useState with full AuthState object (single setState call per transition)"
    - "vi.fn(function() { return mock; }) for class constructor mocks in Vitest"

key-files:
  created:
    - frontend/src/hooks/useAuth.ts
    - frontend/src/hooks/__tests__/useAuth.test.ts
  modified: []

key-decisions:
  - "useMemo for CognitoUserPool (not useState or module-level singleton) — stable per hook instance, testable via vi.mock"
  - "signIn returns Promise<void> wrapping callback-style Cognito API — enables async/await at call sites and proper act() wrapping in tests"
  - "signUp auto-signs in on success by calling signIn(email, password) — single state transition to authenticated"
  - "vi.fn(function() { return mock; }) for CognitoUserPool/CognitoUser mocks — arrow functions cannot be used as constructors with new"
  - "Three localStorage keys: auth_id_token, auth_refresh_token, auth_email — signOut removes all three"

patterns-established:
  - "Cognito mock pattern: vi.fn(function() { return mockInstance; }) for class constructors"
  - "Promise-wrapping Cognito callbacks: allows await at call sites and act() in tests"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: 4min
completed: 2026-03-11
---

# Phase 11 Plan 01: useAuth — Cognito Auth Hook Summary

**React hook for full Cognito USER_PASSWORD_AUTH lifecycle: session restore, sign-in, sign-up, sign-out with localStorage persistence and 12-test TDD coverage**

## Performance

- **Duration:** 3 min 37 sec
- **Started:** 2026-03-11T03:08:06Z
- **Completed:** 2026-03-11T03:11:43Z
- **Tasks:** 2 (RED + GREEN TDD phases)
- **Files modified:** 2

## Accomplishments

- `useAuth` hook with complete Cognito auth lifecycle via `amazon-cognito-identity-js`
- Exported `AuthState` and `UseAuthReturn` TypeScript interfaces matching downstream plan contracts (11-02, 11-03)
- 12 tests covering session restore (4 cases), signIn (3 cases), signOut (2 cases), signUp (2 cases), interface shape (1 case)
- 119 total tests passing with zero regressions

## Task Commits

Each task was committed atomically:

1. **RED: Failing test suite** - `f880d83` (test)
2. **GREEN: useAuth implementation** - `3b2f635` (feat)

_TDD plan: test commit first, then implementation commit_

## Files Created/Modified

- `frontend/src/hooks/__tests__/useAuth.test.ts` — 12-case TDD test suite with full Cognito mock via vi.mock
- `frontend/src/hooks/useAuth.ts` — useAuth hook exporting AuthState, UseAuthReturn, and useAuth()

## Final UseAuthReturn Interface

```typescript
export interface AuthState {
  status: 'loading' | 'unauthenticated' | 'authenticated';
  idToken: string | null;   // Cognito ID token — pass this to useWebSocket as JWT
  email: string | null;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

export function useAuth(): UseAuthReturn
```

## Decisions Made

- **useMemo for CognitoUserPool**: Used `useMemo` (not module-level singleton or `useState`) so the pool is stable per hook instance and can be properly reset via `vi.mock` in tests.
- **Promise-wrapped signIn/signUp**: The Cognito SDK uses callbacks; wrapping in `Promise<void>` allows async/await at call sites and proper `act()` wrapping in Vitest.
- **signUp auto-signs in**: On successful signup, `signIn(email, password)` is called immediately — single state transition to `authenticated` without requiring a separate login step.
- **Three localStorage keys**: `auth_id_token`, `auth_refresh_token`, `auth_email` — all three removed on signOut.
- **Constructor mock syntax**: `vi.fn(function() { return mockInstance; })` required for Cognito class mocks — arrow functions cannot be used as constructors with `new`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CognitoUserPool instantiation using useCallback instead of useMemo**
- **Found during:** GREEN phase (tests immediately failing)
- **Issue:** Initial implementation used `useCallback(() => createUserPool(), [])()` — calling `useCallback` returns a function, not the result; calling it inline was semantically wrong and caused "not a constructor" error
- **Fix:** Replaced with `useMemo(() => new CognitoUserPool({...}), [])` — correct React pattern for memoizing an object instance
- **Files modified:** `frontend/src/hooks/useAuth.ts`
- **Verification:** All 12 tests pass
- **Committed in:** `3b2f635` (GREEN phase commit)

**2. [Rule 1 - Bug] Fixed vi.mock class constructor mocks using arrow functions**
- **Found during:** GREEN phase (all 12 tests failing with "not a constructor")
- **Issue:** Test used `vi.fn().mockImplementation(() => mockUserPool)` — arrow functions cannot be called with `new`; Vitest propagates the arrow function as-is which breaks constructor invocation
- **Fix:** Changed to `vi.fn(function() { return mockUserPool; })` — regular function works as constructor with `new`
- **Files modified:** `frontend/src/hooks/__tests__/useAuth.test.ts`
- **Verification:** All 12 tests pass
- **Committed in:** `3b2f635` (GREEN phase commit, test file updated together with implementation)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep. The mock fix is a standard Vitest pattern that the plan's skeleton didn't account for.

## Issues Encountered

- `vi.fn().mockImplementation(() => ...)` with arrow functions cannot be used as constructors — standard Vitest limitation for class mocks. Fixed with `vi.fn(function() { return ...; })` pattern.

## Test Coverage

| Test Case | Requirement |
|-----------|-------------|
| resolves to unauthenticated when no stored user exists | AUTH-01 |
| resolves to authenticated when stored session is valid | AUTH-01 |
| resolves to unauthenticated when stored session is invalid | AUTH-01 |
| resolves to unauthenticated when getSession returns an error | AUTH-01 |
| signIn sets status='authenticated' and idToken on success | AUTH-02 |
| signIn sets error on failure (wrong password) | AUTH-02 |
| signIn with newPasswordRequired sets error message | AUTH-02 |
| signOut sets status='unauthenticated' and clears idToken and email | AUTH-03 |
| signOut clears localStorage keys | AUTH-03 |
| signUp calls userPool.signUp and auto-signs in on success | AUTH-04, AUTH-05 |
| signUp sets error when userPool.signUp fails | AUTH-04 |
| exposes the correct shape from useAuth() | AUTH-02, AUTH-03, AUTH-04 |

## User Setup Required

Real Cognito credentials are needed for manual end-to-end testing (not for unit tests):
- `VITE_COGNITO_USER_POOL_ID`: `us-east-1_1cBzDswEa` (already provisioned)
- `VITE_COGNITO_CLIENT_ID`: `4bcsu1t495schc9fi25ompnv9j` (already provisioned)

No additional manual configuration required for the unit test suite.

## Next Phase Readiness

- `useAuth` hook is fully implemented and tested — ready for 11-02 (LoginForm) and 11-03 (App.tsx gating)
- `UseAuthReturn` interface is stable and matches the contracts both downstream plans consume
- `idToken` is the Cognito ID token ready to pass to `useWebSocket` as JWT
- No blockers

---
*Phase: 11-auth-foundation*
*Completed: 2026-03-11*

## Self-Check: PASSED

- FOUND: `frontend/src/hooks/useAuth.ts`
- FOUND: `frontend/src/hooks/__tests__/useAuth.test.ts`
- FOUND: `.planning/phases/11-auth-foundation/11-01-SUMMARY.md`
- FOUND commit: `f880d83` (test: RED phase)
- FOUND commit: `3b2f635` (feat: GREEN phase)
- FOUND commit: `3a652e0` (docs: metadata)
