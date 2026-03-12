# Requirements: WebSocket Gateway

**Defined:** 2026-03-12
**Core Value:** Provide low-cost, high-frequency pub/sub (<50ms latency) for ephemeral real-time collaboration data where per-message pricing models (Lambda, AppSync) would be cost-prohibitive at scale.

## v1.4 Requirements

### Cleanup

- [x] **CLEAN-01**: Repo is free of HTML test clients (`test/clients/*.html`) and standalone SDK files (`websocket-gateway-sdk.js`, `.css`)
- [x] **CLEAN-02**: `frontend/dist/` is gitignored and not committed to the repo
- [x] **CLEAN-03**: Empty placeholder file (`test-client-sdk.html`) is deleted

### Layout & UI

- [x] **UI-01**: App renders a clean, structured layout with distinct sections for each feature (chat, presence, cursors, reactions, CRDT) — not a stacked dev-panel dump
- [x] **UI-02**: Auth screens (login/signup) are clean and production-quality
- [x] **UI-03**: Connection status and channel selector are integrated cleanly into the layout (not floating UI elements)
- [x] **UI-04**: All collaborative feature components are reusable (no App.tsx-specific coupling preventing reuse elsewhere)

### Reactions

- [x] **REACT-01**: ReactionsOverlay supports all 12 emoji types: ❤️ 😂 👍 👎 😮 😢 😡 🎉 🔥 ⚡ 💯 🚀
- [x] **REACT-02**: Each emoji type has a distinct CSS animation (pulse, shake, bounce, confetti, flicker, fly-up, spin, etc.)
- [x] **REACT-03**: ReactionButtons displays all 12 emojis in a clean picker grid

### Presence & Typing

- [ ] **PRES-01**: Typing indicator is visibly displayed in the chat panel (e.g. "Alice is typing…")
- [ ] **PRES-02**: Typing indicator is also reflected in the presence/user list panel

### Dev Tools

- [ ] **DEV-01**: EventLog is split into per-service tabs: Chat / Presence / Cursors / Reactions / System
- [ ] **DEV-02**: Each service tab shows only its own messages with correct timestamps
- [ ] **DEV-03**: Disconnect/reconnect controls remain accessible in the dev tools section

## Future Requirements

### SDK

- **SDK-01**: Standalone JavaScript/TypeScript SDK that wraps the WebSocket protocol — distributable as npm package
- **SDK-02**: SDK exposes typed event emitters for each service (chat, presence, cursors, reactions, CRDT)
- **SDK-03**: SDK works in both browser and Node.js environments

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile native apps | Web-first, mobile later |
| Lambda/AppSync pub/sub | Per-message pricing cost-prohibitive at scale |
| Video/audio calling | Out of domain for this gateway |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLEAN-01 | Phase 15 | Complete |
| CLEAN-02 | Phase 15 | Complete |
| CLEAN-03 | Phase 15 | Complete |
| UI-01 | Phase 17 | Complete |
| UI-02 | Phase 17 | Complete |
| UI-03 | Phase 17 | Complete |
| UI-04 | Phase 17 | Complete |
| REACT-01 | Phase 16 | Complete |
| REACT-02 | Phase 16 | Complete |
| REACT-03 | Phase 16 | Complete |
| PRES-01 | Phase 18 | Pending |
| PRES-02 | Phase 18 | Pending |
| DEV-01 | Phase 19 | Pending |
| DEV-02 | Phase 19 | Pending |
| DEV-03 | Phase 19 | Pending |

**Coverage:**
- v1.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — traceability populated after roadmap creation*
