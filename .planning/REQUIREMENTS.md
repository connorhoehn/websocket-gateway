# Requirements: WebSocket Gateway Frontend Layer

**Defined:** 2026-03-03
**Milestones:** v1.2 Frontend Layer, v1.3 User Auth & Identity
**Core Value:** Provide low-cost, high-frequency pub/sub (<50ms latency) for ephemeral real-time collaboration data where per-message pricing models would be cost-prohibitive at scale.

## v1.2 Requirements

### Connection & Auth

- [x] **CONN-01**: User can connect to the WebSocket gateway using a Cognito JWT configured via `.env`
- [x] **CONN-02**: UI displays connection status (connecting / connected / disconnected / reconnecting)
- [x] **CONN-03**: UI automatically reconnects using session token on disconnect
- [x] **CONN-04**: Connection errors display inline with error code and human-readable message
- [x] **CONN-05**: User can switch channels without reloading the page

### Presence

- [x] **PRES-01**: User can see a live list of connected users in the current channel
- [x] **PRES-02**: User list updates in real-time as tabs join and leave
- [x] **PRES-03**: Typing indicators show when other users are active in the channel

### Cursors

- [x] **CURS-01**: Freeform cursor broadcasts x/y position to all tabs on the same channel in real-time
- [x] **CURS-02**: Remote cursors render with a deterministic per-user color (derived from clientId) and user-initials label
- [x] **CURS-03**: When a tab disconnects, its cursor is removed from all remaining tabs immediately
- [x] **CURS-04**: Table cursor mode — clicking a grid cell broadcasts row/col position; remote users see a colored cell-border indicator with initials badge
- [x] **CURS-05**: Text cursor mode — cursor tracks character offset in a shared document; remote users see a colored line cursor + selection highlight when text is selected
- [x] **CURS-06**: Canvas cursor mode — cursor metadata includes active drawing tool (brush/pen/eraser/select), color, and size; remote cursors show tool label + ephemeral trail particles that auto-remove after 1 second
- [x] **CURS-07**: Multi-mode cursor demo — a mode selector switches between freeform, table, text, and canvas cursor panels; switching clears all active cursors and resets subscription state

### Chat

- [x] **CHAT-01**: User can send text messages to the current channel
- [x] **CHAT-02**: Last 100 messages load from history on join
- [x] **CHAT-03**: New messages from other tabs appear in real-time

### CRDT

- [x] **CRDT-01**: User can edit a shared text document that syncs across tabs in real-time
- [x] **CRDT-02**: Concurrent edits from multiple tabs merge correctly using Y.js
- [x] **CRDT-03**: Document state restores from DynamoDB snapshot on reconnect

### Reactions

- [x] **REAC-01**: User can send an emoji reaction that broadcasts to the channel
- [x] **REAC-02**: Incoming reactions appear ephemerally with an animation

### Dev Tools

- [x] **DEV-01**: Real-time event log shows all WebSocket messages sent and received
- [x] **DEV-02**: Error panel displays error code, message, and timestamp
- [x] **DEV-03**: User can manually trigger disconnect/reconnect to test recovery flow

---

## v1.3 Requirements

### Auth Foundation

- [x] **AUTH-01**: User can sign in with email + password via Cognito USER_PASSWORD_AUTH — no .env token required
- [x] **AUTH-02**: Unauthenticated visit shows a login form; successful login connects to the gateway with the real Cognito JWT
- [x] **AUTH-03**: Session persists across page reloads via localStorage token storage — no re-login required
- [x] **AUTH-04**: A sign-out button disconnects from the gateway, clears all tokens, and returns to the login form
- [x] **AUTH-05**: Signing in as two different Cognito users in separate browser windows shows both as distinct users in the presence panel simultaneously

### Identity Integration

- [ ] **AUTH-06**: Presence panel displays each user's display name (Cognito `given_name` or email prefix) instead of raw clientId
- [ ] **AUTH-07**: Cursor badges in all four modes show initials derived from the user's display name (e.g. "JD" for "Jane Doe"), consistent across reconnections
- [ ] **AUTH-08**: Chat messages (Phase 8) show the sender's display name as the author attribute

### Session Management & Multi-user Tooling

- [ ] **AUTH-09**: Access token auto-refreshes silently before expiry; gateway reconnects with the new token without user intervention
- [ ] **AUTH-10**: If token refresh fails, user is signed out and redirected to login with a clear session-expired message
- [ ] **AUTH-11**: `scripts/create-test-user.sh` creates a Cognito user with a given email + temp password in one command; `scripts/list-test-users.sh` lists all pool users

---

## Future Requirements

### Enhancements

- Multi-room support (join multiple channels simultaneously)
- Avatar / profile picture from Cognito or gravatar
- Chat message reactions (emoji on specific messages)
- Cursor history trails
- User role / permissions (admin vs regular — affects channel access)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Marketplace distribution | Internal template/skills library only |
| Mobile responsive design | Desktop developer toolbox, multi-tab workflow |
| Real-time video/audio | Out of gateway scope |
| Message persistence beyond gateway | DynamoDB snapshots handle CRDT; chat history is in-memory LRU |
| OAuth / social login (Google, GitHub) | Cognito USER_PASSWORD_AUTH is sufficient for dev toolbox |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 6 | Complete |
| CONN-02 | Phase 6 | Complete |
| CONN-03 | Phase 6 | Complete |
| CONN-04 | Phase 6 | Complete |
| CONN-05 | Phase 6 | Complete |
| PRES-01 | Phase 7 | Complete |
| PRES-02 | Phase 7 | Complete |
| PRES-03 | Phase 7 | Complete |
| CURS-01 | Phase 7 | Complete |
| CURS-02 | Phase 7 | Complete |
| CURS-03 | Phase 7 | Complete |
| CURS-04 | Phase 7 | Complete |
| CURS-05 | Phase 7 | Complete |
| CURS-06 | Phase 7 | Complete |
| CURS-07 | Phase 7 | Complete |
| CHAT-01 | Phase 8 | Complete |
| CHAT-02 | Phase 8 | Complete |
| CHAT-03 | Phase 8 | Complete |
| CRDT-01 | Phase 9 | Complete |
| CRDT-02 | Phase 9 | Complete |
| CRDT-03 | Phase 9 | Complete |
| REAC-01 | Phase 10 | Complete |
| REAC-02 | Phase 10 | Complete |
| DEV-01 | Phase 10 | Complete |
| DEV-02 | Phase 10 | Complete |
| DEV-03 | Phase 10 | Complete |
| AUTH-01 | Phase 11 | Complete |
| AUTH-02 | Phase 11 | Complete |
| AUTH-03 | Phase 11 | Complete |
| AUTH-04 | Phase 11 | Complete |
| AUTH-05 | Phase 11 | Complete |
| AUTH-06 | Phase 12 | Pending |
| AUTH-07 | Phase 12 | Pending |
| AUTH-08 | Phase 12 | Pending |
| AUTH-09 | Phase 13 | Pending |
| AUTH-10 | Phase 13 | Pending |
| AUTH-11 | Phase 13 | Pending |

**Coverage:**
- v1.2 requirements: 26 total, 26 mapped ✓
- v1.3 requirements: 11 total, 11 mapped ✓
- Total: 37 requirements, 0 unmapped ✓

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-10 — added v1.3 User Auth & Identity requirements (AUTH-01 through AUTH-11)*
