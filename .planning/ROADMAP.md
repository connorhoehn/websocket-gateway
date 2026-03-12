# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- ✅ **v1.2 Frontend Layer** — Phases 6-10 (shipped 2026-03-10)
- ✅ **v1.3 User Auth & Identity** — Phases 11-14 (shipped 2026-03-11)
- 🚧 **v1.4 UI Polish & Feature Completeness** — Phases 15-19 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP - Production-Ready WebSocket Gateway (Phases 1-4) — SHIPPED 2026-03-03</summary>

See: `.planning/milestones/v1.0-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.1 Enhanced Reliability (Phase 5) — SHIPPED 2026-03-03</summary>

See: `.planning/milestones/v1.1-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.2 Frontend Layer (Phases 6-10) — SHIPPED 2026-03-10</summary>

- [x] Phase 6: Foundation — React+Vite scaffold, useWebSocket hook, connection status UI (3/3 plans) — completed 2026-03-04
- [x] Phase 7: Presence & Cursors — usePresence + PresencePanel, useCursors all 4 modes (4/4 plans) — completed 2026-03-10
- [x] Phase 8: Chat — useChat hook + ChatPanel with scrollback history (1/1 plan) — completed 2026-03-10
- [x] Phase 9: CRDT Editor — useCRDT + SharedTextEditor with Y.js + snapshot restore (2/2 plans) — completed 2026-03-10
- [x] Phase 10: Reactions & Dev Tools — useReactions + overlay, EventLog, ErrorPanel, disconnect/reconnect (3/3 plans) — completed 2026-03-10

See: `.planning/milestones/v1.2-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.3 User Auth & Identity (Phases 11-14) — SHIPPED 2026-03-11</summary>

- [x] Phase 11: Auth Foundation — useAuth hook (TDD), LoginForm/SignupForm, App.tsx auth gating (3/3 plans) — completed 2026-03-11
- [x] Phase 12: Identity Integration — identity.ts utility, displayName propagation, ChatPanel attribution (2/2 plans) — completed 2026-03-11
- [x] Phase 13: Session Management — token refresh, multi-tab sync, create/list-test-users.sh scripts (2/2 plans) — completed 2026-03-11
- [x] Phase 14: Gap Closure — AUTH-09 token reconnect, PRES-03 typing wiring (1/1 plan) — completed 2026-03-11

See: `.planning/milestones/v1.3-ROADMAP.md` for full details

</details>

### 🚧 v1.4 UI Polish & Feature Completeness (In Progress)

**Milestone Goal:** Replace HTML test clients with a polished, production-quality React app — all features real, clean reusable components, HTML artifacts deleted.

- [x] **Phase 15: Cleanup** - Delete HTML test clients, SDK files, and stale build artifacts from the repo (completed 2026-03-12)
- [x] **Phase 16: Reaction Animations** - Port 12-emoji type system with distinct CSS animations into ReactionsOverlay and ReactionButtons (completed 2026-03-12)
- [x] **Phase 17: UI Layout & Polish** - Restructure app into a clean, production-quality layout with integrated navigation (completed 2026-03-12)
- [x] **Phase 18: Typing Indicators & Presence Polish** - Surface typing state visibly in both chat panel and presence list (completed 2026-03-12)
- [ ] **Phase 19: Per-Service Dev Tools** - Split EventLog into tabbed per-service view; keep disconnect/reconnect accessible

## Phase Details

### Phase 15: Cleanup
**Goal**: The repo contains no HTML test clients, standalone SDK files, or committed build artifacts — only source code
**Depends on**: Phase 14 (v1.3 complete)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. `test/clients/*.html` files and `websocket-gateway-sdk.js`/`.css` files are deleted from the repo and git history shows them removed
  2. `frontend/dist/` does not appear in `git status` — it is gitignored and not tracked
  3. `test-client-sdk.html` placeholder file is gone from the repo root
**Plans**: 1 plan

Plans:
- [ ] 15-01-PLAN.md — Remove tracked HTML test clients and SDK artifacts, confirm frontend/dist/ is gitignored

### Phase 16: Reaction Animations
**Goal**: Users can trigger any of 12 emoji reactions that each fly across the overlay with a visually distinct animation
**Depends on**: Phase 15
**Requirements**: REACT-01, REACT-02, REACT-03
**Success Criteria** (what must be TRUE):
  1. Clicking any of the 12 emoji types (❤️ 😂 👍 👎 😮 😢 😡 🎉 🔥 ⚡ 💯 🚀) in ReactionButtons sends a reaction
  2. Each emoji type plays a distinct CSS animation (no two types share the same animation style)
  3. Reactions from all connected users appear in ReactionsOverlay and disappear after their animation completes
  4. ReactionButtons renders all 12 emojis in a clean picker grid (not a list or single button)
**Plans**: 1 plan

Plans:
- [ ] 16-01-PLAN.md — Upgrade ReactionButtons to 12-emoji grid + add 12 distinct per-emoji animations to ReactionsOverlay

### Phase 17: UI Layout & Polish
**Goal**: The authenticated app renders a structured, production-quality layout where each collaborative feature occupies a distinct section and all components are reusable
**Depends on**: Phase 15
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. The app layout has clearly distinct sections for chat, presence, cursors, reactions, and CRDT — not a vertical stack of dev panels
  2. Auth screens (login and signup) look production-quality with consistent styling and no dev-panel aesthetic
  3. Connection status and channel selector are integrated into the layout (header, sidebar, or nav) — not floating or appended at the bottom
  4. All collaborative feature components can be imported and used outside App.tsx without code changes (no hardcoded App.tsx dependencies)
**Plans**: 2 plans

Plans:
- [ ] 17-01-PLAN.md — Create AppLayout.tsx: 2-column layout with header (connection/channel/user), sidebar (presence), and distinct main sections
- [ ] 17-02-PLAN.md — Wire AppLayout into App.tsx GatewayDemo + polish LoginForm and SignupForm auth screens

### Phase 18: Typing Indicators & Presence Polish
**Goal**: Users can see who is currently typing in both the chat panel and the presence list, using the typing state already broadcast by v1.3
**Depends on**: Phase 17
**Requirements**: PRES-01, PRES-02
**Success Criteria** (what must be TRUE):
  1. When another user is typing in the chat input, a visible indicator (e.g. "Alice is typing...") appears in the chat panel before the message list
  2. When a user is typing, their entry in the presence/user list panel also reflects their typing state (e.g. a visual indicator or label change)
**Plans**: 1 plan

Plans:
- [x] 18-01-PLAN.md — Add typingUsers prop to ChatPanel and derive/pass it from AppLayout using presenceUsers (completed 2026-03-12)

### Phase 19: Per-Service Dev Tools
**Goal**: Developers can inspect real-time events per service using a tabbed EventLog, with disconnect/reconnect controls remaining accessible
**Depends on**: Phase 17
**Requirements**: DEV-01, DEV-02, DEV-03
**Success Criteria** (what must be TRUE):
  1. The EventLog UI has five tabs: Chat, Presence, Cursors, Reactions, System — each selectable independently
  2. Each tab shows only events for its service, with correct timestamps, and no cross-service noise
  3. Disconnect and Reconnect controls are visible and functional within the dev tools section (not moved to an unrelated area)
**Plans**: TBD

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 13/13 | Complete | 2026-03-03 |
| 5 | v1.1 | 4/4 | Complete | 2026-03-03 |
| 6. Foundation | v1.2 | 3/3 | Complete | 2026-03-04 |
| 7. Presence & Cursors | v1.2 | 4/4 | Complete | 2026-03-10 |
| 8. Chat | v1.2 | 1/1 | Complete | 2026-03-10 |
| 9. CRDT Editor | v1.2 | 2/2 | Complete | 2026-03-10 |
| 10. Reactions & Dev Tools | v1.2 | 3/3 | Complete | 2026-03-10 |
| 11. Auth Foundation | v1.3 | 3/3 | Complete | 2026-03-11 |
| 12. Identity Integration | v1.3 | 2/2 | Complete | 2026-03-11 |
| 13. Session Management | v1.3 | 2/2 | Complete | 2026-03-11 |
| 14. Gap Closure | v1.3 | 1/1 | Complete | 2026-03-11 |
| 15. Cleanup | v1.4 | 1/1 | Complete | 2026-03-12 |
| 16. Reaction Animations | v1.4 | 1/1 | Complete | 2026-03-12 |
| 17. UI Layout & Polish | v1.4 | 2/2 | Complete | 2026-03-12 |
| 18. Typing Indicators & Presence Polish | v1.4 | 1/1 | Complete | 2026-03-12 |
| 19. Per-Service Dev Tools | v1.4 | 0/TBD | Not started | - |
