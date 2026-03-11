# Phase 13: Session Management & Multi-user Tooling - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Auto-refresh Cognito tokens before expiry, handle refresh failure gracefully (sign out + session-expired message),
sync auth state across browser tabs, and provide bash scripts for creating and listing Cognito test users.
CRDT, presence, cursors, and chat features are not modified — only auth lifecycle and dev tooling.

</domain>

<decisions>
## Implementation Decisions

### Token refresh mechanism
- Use Cognito SDK's `cognitoUser.refreshSession(refreshToken, callback)` — avoids manual JWT introspection
- Trigger: decode the ID token's `exp` claim on mount/token-change, set a `setTimeout` to fire 2 minutes before expiry
- On refresh success: update `idToken` state → `useWebSocket` picks up new token via `config` prop change → reconnects automatically
- On refresh failure: transition to `'unauthenticated'` with session-expired error message
- Clear refresh timer on sign-out and component unmount

### Multi-tab session sync
- Use `BroadcastChannel` API (`channel: 'auth'`) — modern, purpose-built for cross-tab messaging
- Two events to broadcast:
  1. `{ type: 'TOKEN_REFRESHED', idToken }` — other tabs update their idToken state without re-authenticating
  2. `{ type: 'SIGNED_OUT' }` — other tabs transition to unauthenticated and clear localStorage
- Each tab's `useAuth` listens on the same BroadcastChannel and handles both events
- Fallback: none needed (BroadcastChannel is supported by all modern browsers the app targets)

### Session expiry UX (AUTH-10)
- Reuse existing login form — no new overlay or banner component needed
- On refresh failure: `setState({ status: 'unauthenticated', idToken: null, email: null, error: 'Your session has expired. Please sign in again.' })`
- Login form already renders `auth.error` as an error message — no UI changes required
- Sign-out is called to clean up localStorage before setting state

### Test user scripts (AUTH-11)
- `scripts/create-test-user.sh EMAIL PASSWORD [--name "First Last"]`
  - Uses `aws cognito-idp admin-create-user` (no email verification step)
  - Then `aws cognito-idp admin-set-user-password --permanent` (skips force-change-password)
  - If `--name` provided: sets `given_name` attribute via `admin-update-user-attributes`
  - Reads pool config from `.env.real` (matching existing script convention)
  - Output: simple success/failure with email + final status
- `scripts/list-test-users.sh`
  - Uses `aws cognito-idp list-users` with JSON output piped through node for table formatting
  - Columns: Email | Status | Created | given_name
  - Reads from `.env.real` for pool config

### Claude's Discretion
- Exact BroadcastChannel event schema beyond the two listed types
- Whether to use `setInterval` vs `setTimeout` chain for refresh scheduling (prefer setTimeout, re-scheduled after each refresh)
- Timer jitter to avoid thundering herd if many tabs refresh simultaneously

</decisions>

<specifics>
## Specific Ideas

- `STORAGE_REFRESH_TOKEN` is already saved to localStorage in Phase 11 signIn — use this as the refresh token source
- `cognitoToken` already flows: `useAuth.idToken` → `useWebSocket.config.cognitoToken` → gateway JWT — no changes needed in useWebSocket for the reconnect to work when idToken updates
- The `useWebSocket` hook reacts to `config` prop changes (established in Phase 6) — updating idToken in auth state propagates automatically without an explicit reconnect call

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useAuth.ts`: `STORAGE_REFRESH_TOKEN` constant already defined and stored on signIn — ready to use for `refreshSession`
- `useAuth.ts`: `signOut()` already clears localStorage and resets state — call this on refresh failure
- `userPool.getCurrentUser()` → `cognitoUser.refreshSession(refreshToken, callback)` — standard Cognito SDK pattern, no new libraries
- Existing scripts (`refresh-dev-token.sh`, `start-real.sh`): use `.env.real` via `get_env()` helper function — replicate this pattern in new scripts

### Established Patterns
- `useMemo` for CognitoUserPool instance (Phase 11) — stable reference, accessible to refresh timer
- `useEffect` cleanup with returned function — use for clearing refresh timer on unmount
- `useCallback` for auth functions — keep `refresh` as a callback if exposed
- Inline styles only (no CSS modules) — not relevant for auth hook, but scripts follow existing bash conventions

### Integration Points
- `useAuth.ts` → add refresh timer in mount effect alongside session restore
- `useAuth.ts` → add BroadcastChannel listener effect for cross-tab sync
- `App.tsx` → no changes needed; `auth.idToken` and `auth.error` already flow correctly
- `scripts/` directory → add `create-test-user.sh` and `list-test-users.sh` alongside existing scripts
- `.env.real` → already has `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` — no new env vars needed

</code_context>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-session-management-multi-user-tooling*
*Context gathered: 2026-03-11*
