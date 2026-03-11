# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- 🚧 **v1.2 Frontend Layer** — Phases 6-10 (in progress)
- ⬜ **v1.3 User Auth & Identity** — Phases 11-13 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP - Production-Ready WebSocket Gateway (Phases 1-4) — SHIPPED 2026-03-03</summary>

See: `.planning/milestones/v1.0-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.1 Enhanced Reliability (Phase 5) — SHIPPED 2026-03-03</summary>

- [x] Phase 5: Enhanced Reliability (Optional) (4/4 plans) — completed 2026-03-03

**Delivered:**
- Redis graceful degradation with local cache fallback
- WebSocket session token reconnection
- AWS IVS Chat integration with Lambda moderation (optional)
- IVS deployment docs and migration tooling

See: `.planning/milestones/v1.1-ROADMAP.md` for full details

</details>

### 🚧 v1.2 Frontend Layer (In Progress)

**Milestone Goal:** Build a React + Vite developer toolbox that exercises every gateway feature (presence, cursors, chat, CRDT, reactions) with reusable hooks/components and full in-UI error visibility.

**Stack:** React + Vite + TypeScript. Hooks in `frontend/src/hooks/`, components in `frontend/src/components/`, demo app in `frontend/src/app/`.

## Phase Checklist

- [x] **Phase 6: Foundation** - React+Vite scaffold, useWebSocket hook, auth config, connection status UI (completed 2026-03-04)
- [x] **Phase 7: Presence & Cursors** - usePresence + PresencePanel, useCursors with all 4 modes (freeform, table, text, canvas) + multi-mode selector UI (completed 2026-03-10)
- [x] **Phase 8: Chat** - useChat hook + ChatPanel with scrollback history (completed 2026-03-10)
- [x] **Phase 9: CRDT Editor** - useCRDT + shared text editor with Y.js + snapshot restore (completed 2026-03-10)
- [x] **Phase 10: Reactions & Dev Tools** - useReactions + overlay, EventLog, ErrorPanel, disconnect/reconnect control (completed 2026-03-10)

## Phase Details

### Phase 6: Foundation
**Goal**: Developers can connect to the gateway from a running React app, see live connection status, and switch channels without a page reload
**Depends on**: Nothing (first v1.2 phase; requires v1.0/v1.1 gateway running)
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05
**Success Criteria** (what must be TRUE):
  1. Opening the app connects to the gateway using a Cognito JWT from `.env` — no manual token entry required
  2. A status indicator visibly transitions through connecting / connected / disconnected / reconnecting states as the connection changes
  3. When the connection drops, the app automatically reconnects using the stored session token without user intervention
  4. Connection errors appear inline with their error code and a human-readable description
  5. Selecting a different channel updates the subscription without reloading the page
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — React+Vite+TypeScript scaffold with env-driven auth config (CONN-01)
- [ ] 06-02-PLAN.md — useWebSocket hook: connect, session token, auto-reconnect, channel switching (CONN-01, CONN-03, CONN-05)
- [ ] 06-03-PLAN.md — Connection status UI, error display, channel selector wired to useWebSocket (CONN-02, CONN-04, CONN-05)

### Phase 7: Presence & Cursors
**Goal**: Multiple browser tabs on the same channel can see each other's presence and cursors updating in real-time across all four cursor modes (freeform, table, text, canvas)
**Depends on**: Phase 6
**Requirements**: PRES-01, PRES-02, PRES-03, CURS-01, CURS-02, CURS-03, CURS-04, CURS-05, CURS-06, CURS-07
**Success Criteria** (what must be TRUE):
  1. A panel shows a live list of all users connected to the current channel, updating as tabs join or leave
  2. Typing indicators appear in the presence panel when another tab is actively typing
  3. Moving the mouse in freeform mode broadcasts x/y position; remote cursors appear as colored circles with initials that follow in real-time
  4. Clicking a spreadsheet cell in table mode broadcasts row/col; remote users see a colored cell-border indicator on the correct cell
  5. Clicking or selecting text in text mode broadcasts character offset and selection range; remote users see a colored line cursor and selection highlight in the shared document
  6. Moving the mouse in canvas mode broadcasts x/y plus active tool, color, and size; remote cursors show tool label and ephemeral trail particles matching the tool type
  7. A mode selector switches between the four cursor panels; switching clears all displayed cursors
  8. When a tab disconnects, its cursor disappears immediately across all modes in all remaining tabs
  9. Each user's color is consistent across reconnections (deterministically derived from clientId)
**Plans**: 4 plans

Plans:
- [ ] 07-01-PLAN.md — usePresence hook + PresencePanel component (user list + typing indicators) (PRES-01, PRES-02, PRES-03)
- [ ] 07-02-PLAN.md — useCursors hook (freeform mode) + CursorCanvas component — broadcast, per-user color, disconnect cleanup (CURS-01, CURS-02, CURS-03)
- [ ] 07-03-PLAN.md — Table cursor mode + Text cursor mode extensions on useCursors (CURS-04, CURS-05)
- [ ] 07-04-PLAN.md — Canvas cursor mode (tool/color/size metadata + trail particles) + multi-mode selector UI (CURS-06, CURS-07)

### Phase 8: Chat
**Goal**: Users in the same channel can exchange text messages in real-time and see the last 100 messages when they join
**Depends on**: Phase 6
**Requirements**: CHAT-01, CHAT-02, CHAT-03
**Success Criteria** (what must be TRUE):
  1. Typing a message and pressing send delivers it to all connected tabs in the same channel
  2. Joining a channel loads the last 100 messages from history before the live feed begins
  3. Messages sent from other tabs appear in real-time in the chat panel without any manual refresh
**Plans**: TBD

Plans:
- [ ] 08-01: useChat hook — send, history load on join, real-time receive
- [ ] 08-02: ChatPanel component with input, message list, and scrollback

### Phase 9: CRDT Editor
**Goal**: Multiple tabs can edit a shared text document simultaneously with automatic conflict-free merging, and the document state survives a disconnect/reconnect cycle
**Depends on**: Phase 6
**Requirements**: CRDT-01, CRDT-02, CRDT-03
**Success Criteria** (what must be TRUE):
  1. Typing in the shared editor on one tab immediately appears in the same document on all other connected tabs
  2. When two tabs type concurrently at different positions, both edits appear correctly merged in all tabs with no data loss
  3. After disconnecting and reconnecting, the document content matches the last-known state from the DynamoDB snapshot
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — useCRDT hook — Y.js integration, CRDT op broadcast, snapshot restore on connect (CRDT-01, CRDT-02, CRDT-03)
- [ ] 09-02-PLAN.md — Shared text editor component wired to useCRDT (CRDT-01, CRDT-02, CRDT-03)

### Phase 10: Reactions & Dev Tools
**Goal**: Users can send ephemeral emoji reactions that animate for all channel members, and developers can observe every WebSocket event, error, and connection state in dedicated panels
**Depends on**: Phase 6
**Requirements**: REAC-01, REAC-02, DEV-01, DEV-02, DEV-03
**Success Criteria** (what must be TRUE):
  1. Clicking an emoji button sends a reaction that triggers an animated overlay on all connected tabs
  2. Incoming reactions play a brief animation and disappear automatically — they do not accumulate in a persistent list
  3. The event log panel shows every WebSocket message sent and received, in order, with timestamps
  4. The error panel displays each error's code, human-readable message, and timestamp
  5. Clicking disconnect drops the connection and clicking reconnect restores it, allowing the full recovery flow to be observed end-to-end
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — useReactions hook (TDD) + ReactionsOverlay + ReactionButtons (REAC-01, REAC-02)
- [ ] 10-02-PLAN.md — EventLog panel (all WS messages) and ErrorPanel (code + message + timestamp) (DEV-01, DEV-02)
- [ ] 10-03-PLAN.md — Disconnect/reconnect control wired to useWebSocket + human-verify checkpoint (DEV-03)

### 🚧 v1.3 User Auth & Identity (Planned)

**Milestone Goal:** Real Cognito users can sign in to the demo app with email + password, and their identity (display name, email) flows through all gateway features — presence, cursors, chat — so multiple distinct users can collaborate with proper attribution.

**Cognito Infrastructure:** User Pool `us-east-1_1cBzDswEa`, Client `4bcsu1t495schc9fi25ompnv9j` (USER_PASSWORD_AUTH, no secret) — already provisioned in v1.0.

**Stack:** React + Vite + TypeScript. Auth via `amazon-cognito-identity-js` (direct Cognito API, no Amplify). Hooks in `frontend/src/hooks/`, components in `frontend/src/components/`.

## Phase Checklist (v1.3)

- [x] **Phase 11: Auth Foundation** - Login/signup forms, Cognito USER_PASSWORD_AUTH flow, JWT token storage, gateway connects with real user JWT (completed 2026-03-11)
- [x] **Phase 12: Identity Integration** - User claims (name/email) replace clientId throughout presence, cursors, chat, CRDT attribution (completed 2026-03-11)
- [x] **Phase 13: Session Management** - Auto token refresh, logout flow, multi-tab session sync, test-user tooling (completed 2026-03-11)

## Phase Details (v1.3)

### Phase 11: Auth Foundation
**Goal**: A user can sign in with email + password via Cognito and the gateway connects using their real JWT — no .env token required
**Depends on**: Phase 6 (useWebSocket)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. Visiting the app unauthenticated shows a login form (email + password)
  2. Entering valid Cognito credentials signs the user in and connects to the gateway using their JWT
  3. Signing in as two different Cognito users in separate browser windows shows both as distinct users in the presence panel
  4. Refreshing the page restores the session without re-entering credentials (localStorage token persistence)
  5. A sign-out button disconnects from the gateway, clears tokens, and returns to the login form
**Plans**: 3 plans

Plans:
- [ ] 11-01-PLAN.md — useAuth hook (TDD) — Cognito USER_PASSWORD_AUTH, token storage, session restore, logout (AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05)
- [ ] 11-02-PLAN.md — LoginForm + SignupForm components wired to useAuth (AUTH-01, AUTH-02)
- [ ] 11-03-PLAN.md — Integrate useAuth into App.tsx — gate gateway connection on auth state, pass real JWT to useWebSocket (AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05)

### Phase 12: Identity Integration
**Goal**: Every gateway feature displays the authenticated user's real name/email — presence shows names, cursor labels show initials from name, chat messages are attributed
**Depends on**: Phase 11
**Requirements**: AUTH-06, AUTH-07, AUTH-08
**Success Criteria** (what must be TRUE):
  1. The presence panel shows each connected user's display name (from Cognito given_name or email) instead of truncated clientId
  2. Cursor badges show initials derived from the user's display name (e.g. "JD" for "Jane Doe") consistently across all four cursor modes
  3. Chat messages (Phase 8) show the sender's display name as the author
  4. The same user signing in on two different browsers shows the same name and color in all panels
**Plans**: 2 plans

Plans:
- [ ] 12-01-PLAN.md — identity.ts utility + hook updates (usePresence/useCursors/useChat displayName propagation) + App.tsx JWT decode (AUTH-06, AUTH-07, AUTH-08)
- [ ] 12-02-PLAN.md — Display components (PresencePanel, all 4 cursor components) refactored to identity.ts + ChatPanel with attribution (AUTH-06, AUTH-07, AUTH-08)

### Phase 13: Session Management & Multi-user Tooling
**Goal**: Sessions auto-refresh, multiple test users can be managed from the CLI, and the app handles token expiry gracefully
**Depends on**: Phase 11
**Requirements**: AUTH-09, AUTH-10, AUTH-11
**Success Criteria** (what must be TRUE):
  1. A Cognito access token expiring mid-session triggers a silent refresh; the gateway reconnects with the new token without user intervention
  2. A `scripts/create-test-user.sh` script creates a Cognito user with a given email + temp password in one command
  3. A `scripts/list-test-users.sh` script lists all users in the pool with their status
  4. If token refresh fails (refresh token also expired), the user is signed out and redirected to login with a clear message
**Plans**: 2 plans

Plans:
- [ ] 13-01-PLAN.md — Token refresh (proactive setTimeout at 2 min before exp) + BroadcastChannel multi-tab sync in useAuth (AUTH-09, AUTH-10)
- [ ] 13-02-PLAN.md — scripts/create-test-user.sh + scripts/list-test-users.sh CLI tooling (AUTH-11)

## Progress

**Execution Order:** Phases execute in numeric order: 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 13/13 | Complete | 2026-03-03 |
| 5 | v1.1 | 4/4 | Complete | 2026-03-03 |
| 6. Foundation | v1.2 | 3/3 | Complete | 2026-03-04 |
| 7. Presence & Cursors | v1.2 | 4/4 | Complete | 2026-03-10 |
| 8. Chat | 1/1 | Complete   | 2026-03-10 | - |
| 9. CRDT Editor | 2/2 | Complete   | 2026-03-10 | - |
| 10. Reactions & Dev Tools | 3/3 | Complete    | 2026-03-10 | - |
| 11. Auth Foundation | 3/3 | Complete    | 2026-03-11 | - |
| 12. Identity Integration | 2/2 | Complete    | 2026-03-11 | - |
| 13. Session Management | 2/2 | Complete    | 2026-03-11 | - |
