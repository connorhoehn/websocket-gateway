---
phase: 11-auth-foundation
verified: 2026-03-10T23:22:00Z
status: human_needed
score: 15/15 must-haves verified
re_verification: false
human_verification:
  - test: "Unauthenticated visit shows LoginForm"
    expected: "Visiting http://localhost:5173 without prior login shows the email + password Sign In form, not the gateway demo"
    why_human: "Cannot exercise browser navigation or visual rendering programmatically"
  - test: "Signing in with valid Cognito credentials connects to gateway"
    expected: "After entering real credentials and clicking Sign In, connection status reaches 'connected' and user email appears in the header"
    why_human: "Requires real Cognito user credentials and a live gateway endpoint"
  - test: "Page refresh restores session without re-login"
    expected: "Refreshing the browser while authenticated skips the login form and loads the gateway demo directly"
    why_human: "Requires browser state across page loads — cannot verify with unit tests"
  - test: "Sign Out disconnects gateway and returns to login form"
    expected: "Clicking 'Sign Out' changes connection state to 'disconnected' and shows the login form; refreshing still shows login"
    why_human: "Requires live WebSocket connection and browser interaction to observe disconnect behavior"
  - test: "Two different Cognito users appear as distinct entries in presence panel"
    expected: "Opening a second browser window signed in as a different user shows two distinct clientIds in the presence list simultaneously"
    why_human: "Requires two real Cognito accounts, a live gateway, and multi-window browser session"
---

# Phase 11: Auth Foundation Verification Report

**Phase Goal:** Implement Cognito authentication foundation — useAuth hook, LoginForm/SignupForm UI, and App.tsx auth gating so the gateway connection requires a valid Cognito session.
**Verified:** 2026-03-10T23:22:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

#### From Plan 11-01 (useAuth hook)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After mount, if localStorage has a valid Cognito session, status resolves to 'authenticated' without user action | VERIFIED | `useAuth.ts` lines 65-96: `useEffect` calls `userPool.getCurrentUser()` → `getSession()` → sets status='authenticated' with idToken + email. Test: "resolves to authenticated when stored session is valid" passes. |
| 2 | Calling signIn with valid credentials sets status='authenticated' and populates idToken + email | VERIFIED | `useAuth.ts` lines 101-144: `signIn` calls `authenticateUser` with `onSuccess` callback that sets `{status:'authenticated', idToken, email}` and writes localStorage. Test: "signIn sets status='authenticated' and idToken on success" passes. |
| 3 | Calling signIn with invalid credentials sets error and leaves status='unauthenticated' | VERIFIED | `useAuth.ts` lines 122-130: `onFailure` sets `{status:'unauthenticated', error: err.message}`. Test: "signIn sets error on failure (wrong password)" passes. |
| 4 | Calling signOut clears idToken, email, and localStorage keys, and sets status='unauthenticated' | VERIFIED | `useAuth.ts` lines 173-184: `signOut` calls `localStorage.removeItem` for all 3 keys then sets `{status:'unauthenticated', idToken:null, email:null}`. Tests: "signOut sets status='unauthenticated'" and "signOut clears localStorage keys" both pass. |
| 5 | Calling signUp with a new email + password succeeds and auto-signs in | VERIFIED | `useAuth.ts` lines 148-169: `signUp` calls `userPool.signUp()` then on success calls `signIn(email, password)`. Test: "signUp calls userPool.signUp and auto-signs in on success" passes (status becomes 'authenticated'). |
| 6 | idToken is the Cognito ID token (not access token) — ready to pass to the gateway | VERIFIED | `useAuth.ts` line 87 (session restore) and line 109 (signIn): both use `session.getIdToken().getJwtToken()` — the ID token, not `getAccessToken()`. The field is named `idToken` in the exported `AuthState` interface. |

#### From Plan 11-02 (LoginForm / SignupForm)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | LoginForm renders an email field, a password field, and a submit button | VERIFIED | `LoginForm.tsx` lines 51-90: `input type="email"`, `input type="password"`, `button type="submit"` all present with proper labels. |
| 8 | LoginForm calls signIn(email, password) on submit and shows an inline error if auth.error is set | VERIFIED | `LoginForm.tsx` line 19: `onSignIn(email, password)` called in `handleSubmit`. Lines 69-71: `{error !== null && (<p ...>{error}</p>)}` renders error inline. |
| 9 | SignupForm renders an email field, a password field, and a submit button | VERIFIED | `SignupForm.tsx` lines 60-108: email input, password input, confirm-password input, and "Create Account" submit button all present. |
| 10 | SignupForm calls signUp(email, password) on submit and shows an inline error if auth.error is set | VERIFIED | `SignupForm.tsx` line 26: `onSignUp(email, password)` called after password match check. Lines 87-89: `{displayedError !== null && (<p ...>{displayedError}</p>)}` where `displayedError = localError ?? error`. |
| 11 | Both forms show a loading/disabled state while status === 'loading' | VERIFIED | Both components define `const isLoading = status === 'loading'` and apply `disabled={isLoading}` to all inputs and submit button, plus change button text to "Signing in..." / "Creating account...". |
| 12 | Both components are pure — they receive auth state as props, no internal hook calls | VERIFIED | `LoginForm.tsx` imports only `useState` (for local email/password fields). `SignupForm.tsx` imports only `useState` (for email/password/confirmPassword/localError). Neither imports or calls `useAuth`. |

#### From Plan 11-03 (App.tsx auth gating)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 13 | Visiting the app unauthenticated shows the LoginForm | VERIFIED (code) / NEEDS HUMAN (runtime) | `App.tsx` line 47-62: `if (auth.status === 'unauthenticated')` renders `<LoginForm ...>` by default (showSignup=false). Code path is correct. Runtime behavior needs human test. |
| 14 | The gateway connects using auth.idToken — not VITE_COGNITO_TOKEN from env | VERIFIED | `App.tsx` line 83: `const authenticatedConfig = { ...config, cognitoToken: auth.idToken! }`. `gateway.ts` line 16: `VITE_COGNITO_TOKEN` defaults to `''` (no throw). The spread ensures runtime idToken overrides any env value. |
| 15 | Refreshing the page while authenticated restores the session without re-entering credentials | VERIFIED (code) / NEEDS HUMAN (runtime) | `useAuth.ts` lines 65-96: session restore `useEffect` runs on mount, reads from CognitoUserPool's internal localStorage state, sets `status='authenticated'` if valid. localStorage keys `auth_id_token`, `auth_refresh_token`, `auth_email` are written on signIn. Runtime behavior needs human test. |

**Score:** 15/15 truths verified at code level. 5 truths need human validation for runtime/browser behavior.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/hooks/useAuth.ts` | UseAuthReturn interface + useAuth hook | VERIFIED | 195 lines. Exports `AuthState`, `UseAuthReturn`, `useAuth()`. All three lifecycle methods implemented substantively. |
| `frontend/src/hooks/__tests__/useAuth.test.ts` | Full TDD test suite, min 8 tests | VERIFIED | 339 lines, 12 test cases across 5 describe blocks. Covers session restore (4), signIn (3), signOut (2), signUp (2), interface shape (1). |
| `frontend/src/components/LoginForm.tsx` | Login UI — email + password + submit + error display | VERIFIED | 113 lines. Exports `LoginForm` and `LoginFormProps`. Full form with loading states, error display, signup toggle. |
| `frontend/src/components/SignupForm.tsx` | Signup UI — email + password + submit + error display | VERIFIED | 131 lines. Exports `SignupForm` and `SignupFormProps`. Full form with confirm-password, client-side validation, loading states, login toggle. |
| `frontend/src/app/App.tsx` | Auth-gated app shell with loading/unauth/auth rendering branches | VERIFIED | 309 lines. Three render branches (`loading`, `unauthenticated`, `authenticated`). Sign Out button in header with `auth.email`. |
| `frontend/src/config/gateway.ts` | Updated getGatewayConfig() — VITE_COGNITO_TOKEN optional | VERIFIED | 26 lines. `cognitoToken` defaults to `''` via `?? ''`. No throw for absent token. `wsUrl` guard retained. |
| `frontend/.env.example` | Updated env example with Cognito pool/client vars | VERIFIED | `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID` present at top. `VITE_COGNITO_TOKEN` marked "OPTIONAL (legacy)". |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `frontend/src/hooks/useAuth.ts` | `amazon-cognito-identity-js` | `CognitoUserPool / CognitoUser / AuthenticationDetails` | WIRED | Line 6-13: imports `CognitoUserPool`, `CognitoUser`, `AuthenticationDetails`, `CognitoUserAttribute`. Line 56: `new CognitoUserPool({...})` instantiated in `useMemo`. |
| `frontend/src/hooks/useAuth.ts` | `localStorage` | `getItem/setItem/removeItem` | WIRED | Lines 111-113: `localStorage.setItem` for all 3 keys on signIn. Lines 175-177: `localStorage.removeItem` for all 3 keys on signOut. Pattern `localStorage.setItem.*auth_id_token` confirmed (via `STORAGE_ID_TOKEN` constant = `'auth_id_token'`). |
| `frontend/src/app/App.tsx` | `frontend/src/hooks/useAuth.ts` | `useAuth()` call at App top level | WIRED | Line 3: `import { useAuth }`. Line 34: `const auth = useAuth()`. Pattern `const auth = useAuth` confirmed. |
| `frontend/src/app/App.tsx` | `frontend/src/hooks/useWebSocket.ts` | `auth.idToken` passed into `config.cognitoToken` | WIRED | Line 83: `const authenticatedConfig = { ...config, cognitoToken: auth.idToken! }`. Line 85: `<GatewayDemo config={authenticatedConfig} ...>`. Pattern `cognitoToken.*auth\.idToken` confirmed. |
| `frontend/src/app/App.tsx` | `frontend/src/components/LoginForm.tsx` | rendered when `auth.status === 'unauthenticated'` | WIRED | Lines 47-62: `if (auth.status === 'unauthenticated')` block renders `<LoginForm ...>`. Pattern confirmed. |
| `frontend/src/components/LoginForm.tsx` | `UseAuthReturn.signIn` | `onSignIn` prop | WIRED | Interface `LoginFormProps.onSignIn: (email, password) => Promise<void>`. Line 19: `onSignIn(email, password)` called in `handleSubmit`. |
| `frontend/src/components/SignupForm.tsx` | `UseAuthReturn.signUp` | `onSignUp` prop | WIRED | Interface `SignupFormProps.onSignUp: (email, password) => Promise<void>`. Line 26: `onSignUp(email, password)` called in `handleSubmit`. |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| AUTH-01 | 11-01, 11-03 | User can sign in with email + password via Cognito USER_PASSWORD_AUTH — no .env token required | SATISFIED | `useAuth.ts` implements `signIn` via `authenticateUser`. `gateway.ts` no longer throws on absent `VITE_COGNITO_TOKEN`. 4 session-restore tests + 3 signIn tests pass. |
| AUTH-02 | 11-01, 11-02, 11-03 | Unauthenticated visit shows a login form; successful login connects to the gateway with the real Cognito JWT | SATISFIED (code) / NEEDS HUMAN (runtime) | `App.tsx` renders `<LoginForm>` when `auth.status === 'unauthenticated'`. `authenticatedConfig.cognitoToken = auth.idToken!` passes live JWT to `useWebSocket`. Runtime connection needs human test. |
| AUTH-03 | 11-01, 11-03 | Session persists across page reloads via localStorage token storage — no re-login required | SATISFIED (code) / NEEDS HUMAN (runtime) | `useAuth.ts` session-restore `useEffect` on mount reads from Cognito's localStorage pool. `signIn` writes `auth_id_token`, `auth_refresh_token`, `auth_email`. Runtime page-refresh behavior needs human test. |
| AUTH-04 | 11-01, 11-03 | Sign-out button disconnects from gateway, clears all tokens, returns to login form | SATISFIED (code) / NEEDS HUMAN (runtime) | `signOut` removes all 3 localStorage keys and sets `status='unauthenticated'`. `App.tsx` renders `<LoginForm>` when unauthenticated. Sign Out button in GatewayDemo header calls `auth.signOut`. Live disconnect behavior needs human test. |
| AUTH-05 | 11-01, 11-03 | Signing in as two different Cognito users in separate browser windows shows both as distinct users in the presence panel | SATISFIED (code) / NEEDS HUMAN (runtime) | Each `useAuth` instance is independent per browser session. `auth.idToken` passed to `useWebSocket` creates distinct WebSocket connections with distinct Cognito identities. Presence behavior with two real users needs human test. |

**Orphaned requirements check:** REQUIREMENTS.md maps AUTH-01 through AUTH-05 to Phase 11. All 5 are claimed across plans 11-01, 11-02, 11-03. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `LoginForm.tsx` | 55, 64 | `placeholder="..."` | Info | HTML input `placeholder` attributes — not stub code, correct UX pattern |
| `SignupForm.tsx` | 64, 73, 82 | `placeholder="..."` | Info | HTML input `placeholder` attributes — not stub code, correct UX pattern |

No blockers or warnings. The "placeholder" matches are legitimate HTML form input placeholder text, not stub implementations.

---

### Human Verification Required

#### 1. Unauthenticated State

**Test:** Start the frontend (`cd frontend && npm run dev`) with `VITE_WS_URL` set and `VITE_COGNITO_TOKEN` absent or blank. Visit http://localhost:5173.
**Expected:** The login form appears (email field, password field, "Sign In" button). The gateway demo is not shown.
**Why human:** Visual rendering and navigation flow cannot be verified programmatically.

#### 2. Sign In with Real Cognito Credentials

**Test:** Enter a valid Cognito email + password for the pool `us-east-1_1cBzDswEa` and click "Sign In".
**Expected:** Connection status transitions to "connected". The user's email appears in the top-right header next to "Sign Out".
**Why human:** Requires real Cognito credentials and a live gateway endpoint.

#### 3. Session Persistence on Refresh

**Test:** While authenticated (after Step 2), refresh the page (Cmd+R / F5).
**Expected:** The gateway demo loads directly without showing the login form. Connection reaches "connected" again.
**Why human:** Requires browser state across page loads — unit tests cannot simulate this.

#### 4. Sign Out Flow

**Test:** Click "Sign Out" in the header.
**Expected:** Connection status changes to "disconnected". The login form appears. Refreshing the page still shows the login form (tokens cleared from localStorage).
**Why human:** Live WebSocket disconnect behavior and browser state after navigation require human observation.

#### 5. Multi-User Presence (Two Browser Windows)

**Test:** Open a second browser window (or incognito tab) at http://localhost:5173. Sign in as a DIFFERENT Cognito user.
**Expected:** Both windows show two distinct entries in the Presence panel, each with a different clientId / identity.
**Why human:** Requires two real Cognito accounts, a live gateway, and a multi-window browser session.

---

### Commit Verification

All documented commits verified in git history:

| Commit | Description |
|--------|-------------|
| `f880d83` | test(11-01): add failing useAuth tests (RED phase) |
| `3b2f635` | feat(11-01): implement useAuth hook (GREEN phase) |
| `f959974` | feat(11-02): add LoginForm component |
| `010cf11` | feat(11-02): add SignupForm component |
| `772fbc3` | feat(11-03): loosen gateway config and update env.example |
| `4d2b6a5` | feat(11-03): gate App.tsx on auth state with useAuth |

---

### Test Suite Results

Verified by running `npm test` against the actual codebase:

```
Test Files  8 passed (8)
      Tests  119 passed (119)
   Duration  550ms
```

`npx tsc --noEmit` — zero TypeScript errors.

---

### Summary

Phase 11 has strong code-level implementation across all three plans. Every artifact exists with substantive content. All key wiring links are connected. The 12-test TDD suite for `useAuth` covers all required behaviors. `LoginForm` and `SignupForm` are pure presentational components with correct prop interfaces. `App.tsx` correctly gates on `auth.status` with three distinct render branches. The `cognitoToken` flows correctly: Cognito → `useAuth.idToken` → `authenticatedConfig` spread → `useWebSocket.config.cognitoToken` → WebSocket URL query param.

The only remaining items are runtime browser behaviors (5 human verification tests) that require real Cognito credentials and a live gateway. These are expected for a human-checkpoint plan (11-03 explicitly declared `type: execute` with a `checkpoint:human-verify` gate).

---

_Verified: 2026-03-10T23:22:00Z_
_Verifier: Claude (gsd-verifier)_
