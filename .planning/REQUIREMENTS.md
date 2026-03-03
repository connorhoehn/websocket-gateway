# Requirements: WebSocket Gateway Frontend Layer

**Defined:** 2026-03-03
**Milestone:** v1.2 Frontend Layer
**Core Value:** Provide low-cost, high-frequency pub/sub (<50ms latency) for ephemeral real-time collaboration data where per-message pricing models would be cost-prohibitive at scale.

## v1.2 Requirements

### Connection & Auth

- [ ] **CONN-01**: User can connect to the WebSocket gateway using a Cognito JWT configured via `.env`
- [ ] **CONN-02**: UI displays connection status (connecting / connected / disconnected / reconnecting)
- [ ] **CONN-03**: UI automatically reconnects using session token on disconnect
- [ ] **CONN-04**: Connection errors display inline with error code and human-readable message
- [ ] **CONN-05**: User can switch channels without reloading the page

### Presence

- [ ] **PRES-01**: User can see a live list of connected users in the current channel
- [ ] **PRES-02**: User list updates in real-time as tabs join and leave
- [ ] **PRES-03**: Typing indicators show when other users are active in the channel

### Cursors

- [ ] **CURS-01**: User's cursor broadcasts to other tabs in real-time on a shared canvas
- [ ] **CURS-02**: Other users' cursors render with per-user color and label
- [ ] **CURS-03**: Cursors fade out when a tab disconnects

### Chat

- [ ] **CHAT-01**: User can send text messages to the current channel
- [ ] **CHAT-02**: Last 100 messages load from history on join
- [ ] **CHAT-03**: New messages from other tabs appear in real-time

### CRDT

- [ ] **CRDT-01**: User can edit a shared text document that syncs across tabs in real-time
- [ ] **CRDT-02**: Concurrent edits from multiple tabs merge correctly using Y.js
- [ ] **CRDT-03**: Document state restores from DynamoDB snapshot on reconnect

### Reactions

- [ ] **REAC-01**: User can send an emoji reaction that broadcasts to the channel
- [ ] **REAC-02**: Incoming reactions appear ephemerally with an animation

### Dev Tools

- [ ] **DEV-01**: Real-time event log shows all WebSocket messages sent and received
- [ ] **DEV-02**: Error panel displays error code, message, and timestamp
- [ ] **DEV-03**: User can manually trigger disconnect/reconnect to test recovery flow

## Future Requirements

### Enhancements

- Multi-room support (join multiple channels simultaneously)
- User avatar/display name configuration
- Chat message reactions (emoji on specific messages)
- Cursor history trails

## Out of Scope

| Feature | Reason |
|---------|--------|
| User signup/registration flow | Personal dev toolbox — single user with Cognito JWT via env |
| Marketplace distribution | Internal template/skills library only |
| Mobile responsive design | Desktop developer toolbox, multi-tab workflow |
| Real-time video/audio | Out of gateway scope |
| Message persistence beyond gateway | DynamoDB snapshots handle CRDT; chat history is in-memory LRU |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 6 | Pending |
| CONN-02 | Phase 6 | Pending |
| CONN-03 | Phase 6 | Pending |
| CONN-04 | Phase 6 | Pending |
| CONN-05 | Phase 6 | Pending |
| PRES-01 | Phase 7 | Pending |
| PRES-02 | Phase 7 | Pending |
| PRES-03 | Phase 7 | Pending |
| CURS-01 | Phase 7 | Pending |
| CURS-02 | Phase 7 | Pending |
| CURS-03 | Phase 7 | Pending |
| CHAT-01 | Phase 8 | Pending |
| CHAT-02 | Phase 8 | Pending |
| CHAT-03 | Phase 8 | Pending |
| CRDT-01 | Phase 9 | Pending |
| CRDT-02 | Phase 9 | Pending |
| CRDT-03 | Phase 9 | Pending |
| REAC-01 | Phase 10 | Pending |
| REAC-02 | Phase 10 | Pending |
| DEV-01 | Phase 10 | Pending |
| DEV-02 | Phase 10 | Pending |
| DEV-03 | Phase 10 | Pending |

**Coverage:**
- v1.2 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after initial definition*
