---
phase: 11-auth-foundation
plan: "03"
subsystem: frontend-auth
tags: [auth, cognito, react, app-shell, jwt]
dependency_graph:
  requires:
    - "11-01 (useAuth hook)"
    - "11-02 (LoginForm, SignupForm)"
  provides:
    - "Auth-gated App.tsx — renders login/signup when unauthenticated, gateway demo when authenticated"
    - "Updated gateway.ts — VITE_COGNITO_TOKEN no longer required"
    - "Updated .env.example — Cognito pool/client vars documented, token marked optional"
  affects:
    - "frontend/src/app/App.tsx"
    - "frontend/src/config/gateway.ts"
    - "frontend/.env.example"
tech_stack:
  added: []
  patterns:
    - "Auth-state branching: loading / unauthenticated / authenticated render gates in App()"
    - "Config spreading: { ...config, cognitoToken: auth.idToken! } passes runtime JWT to useWebSocket"
    - "Component prop forwarding: auth passed as prop to GatewayDemo to surface email + signOut"
key_files:
  created: []
  modified:
    - frontend/src/app/App.tsx
    - frontend/src/config/gateway.ts
    - frontend/.env.example
decisions:
  - "cognitoToken flows: Cognito → useAuth.idToken → authenticatedConfig spread → useWebSocket.config.cognitoToken → buildUrl() query param"
  - "VITE_COGNITO_TOKEN guard removed — token is now injected at runtime by useAuth, not read from env at startup"
  - "GatewayDemo receives auth prop so signOut and email are accessible in the header without prop-drilling through hooks"
  - "showSignup state lives in App() (not GatewayDemo) — it only applies while unauthenticated"
metrics:
  duration: 105s
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_modified: 3
---

# Phase 11 Plan 03: Auth Foundation — App.tsx Gating Summary

**One-liner:** Auth-gated App.tsx passes Cognito ID token from useAuth directly to useWebSocket, removing the static VITE_COGNITO_TOKEN env dependency.

## What Was Built

### Task 1: Loosen gateway config and update env.example

**frontend/src/config/gateway.ts** — Removed the `if (!cognitoToken) throw` guard. `cognitoToken` now defaults to empty string `''` when `VITE_COGNITO_TOKEN` is absent from env. The `wsUrl` guard remains — that var is still required. This unblocks App startup without a static token; the live token is injected by callers at runtime.

**frontend/.env.example** — Added `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID` at the top (fixed pool values, already provisioned). Updated `VITE_COGNITO_TOKEN` comment to "OPTIONAL (legacy) — only needed when bypassing the login form for local dev." Force-added via `git add -f` per Phase 06-01 decision (root .gitignore has `.env.*` pattern).

### Task 2: Rewrite App.tsx to gate on auth state

**frontend/src/app/App.tsx** — Added auth-gating layer wrapping the existing GatewayDemo content:

1. `useAuth()` called at App top level; `showSignup` state toggles between LoginForm and SignupForm.
2. Three render branches:
   - `auth.status === 'loading'` → "Restoring session..." div (session restore in progress)
   - `auth.status === 'unauthenticated'` → LoginForm or SignupForm based on `showSignup`
   - `auth.status === 'authenticated'` → calls `getGatewayConfig()`, spreads `auth.idToken!` into `cognitoToken`, renders `GatewayDemo`
3. `GatewayDemo` updated to accept `auth: UseAuthReturn` prop.
4. Sign Out button added in a flex-row header alongside the app title, showing `auth.email`.
5. All existing feature hook wiring (usePresence, useCursors, useCRDT, useChat, useReactions, loggedSendMessage, EventLog, ErrorPanel, etc.) preserved exactly.

## cognitoToken Flow

```
Cognito User Pool
      ↓  (authenticateUser callback)
useAuth.ts → state.idToken = session.getIdToken().getJwtToken()
      ↓  (auth.status === 'authenticated')
App.tsx → authenticatedConfig = { ...config, cognitoToken: auth.idToken! }
      ↓  (config prop)
GatewayDemo → useWebSocket({ config: authenticatedConfig })
      ↓  (inside buildUrl())
useWebSocket.ts → url.searchParams.set('token', config.cognitoToken)
      ↓
WebSocket connection URL: wss://gateway?token=<ID_TOKEN>
```

The env var `VITE_COGNITO_TOKEN` is bypassed entirely when using the login form. It remains only for legacy local-dev token bypass.

## Verification Results

**TypeScript compile:** Zero errors after both tasks.

**Full test suite (119 tests / 8 files):**
```
✓ useWebSocket.test.js  (18 tests)
✓ useWebSocket.test.ts  (18 tests)
✓ useChat.test.ts       (14 tests)
✓ useReactions.test.ts  (13 tests)
✓ usePresence.test.ts   (17 tests)
✓ useCursors.test.ts    (13 tests)
✓ useAuth.test.ts       (12 tests)
✓ useCRDT.test.ts       (14 tests)
Test Files: 8 passed | Tests: 119 passed
```

**Env example vars:**
```
VITE_COGNITO_USER_POOL_ID=us-east-1_1cBzDswEa   ✓
VITE_COGNITO_CLIENT_ID=4bcsu1t495schc9fi25ompnv9j ✓
```

**Human checkpoint:** Auto-approved (--auto flag, auto_advance: true in config).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `frontend/src/app/App.tsx` — modified (auth-gated, SignOut button, GatewayDemo auth prop)
- `frontend/src/config/gateway.ts` — modified (VITE_COGNITO_TOKEN guard removed)
- `frontend/.env.example` — modified (Cognito pool/client vars added, token marked optional)
- Task 1 commit: 772fbc3
- Task 2 commit: 4d2b6a5
