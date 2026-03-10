# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- 🚧 **v1.2 Frontend Layer** — Phases 6-10 (in progress)

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
- [ ] **Phase 7: Presence & Cursors** - usePresence + PresencePanel, useCursors with all 4 modes (freeform, table, text, canvas) + multi-mode selector UI
- [ ] **Phase 8: Chat** - useChat hook + ChatPanel with scrollback history
- [ ] **Phase 9: CRDT Editor** - useCRDT + shared text editor with Y.js + snapshot restore
- [ ] **Phase 10: Reactions & Dev Tools** - useReactions + overlay, EventLog, ErrorPanel, disconnect/reconnect control

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
**Plans**: TBD

Plans:
- [ ] 09-01: useCRDT hook — Y.js integration, CRDT op broadcast, snapshot restore on connect
- [ ] 09-02: Shared text editor component wired to useCRDT

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
**Plans**: TBD

Plans:
- [ ] 10-01: useReactions hook + ephemeral reactions overlay with animations
- [ ] 10-02: EventLog panel (all WS messages) and ErrorPanel (code + message + timestamp)
- [ ] 10-03: Disconnect/reconnect control wired to useWebSocket

## Progress

**Execution Order:** Phases execute in numeric order: 6 → 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 13/13 | Complete | 2026-03-03 |
| 5 | v1.1 | 4/4 | Complete | 2026-03-03 |
| 6. Foundation | 3/3 | Complete   | 2026-03-04 | - |
| 7. Presence & Cursors | 1/4 | In Progress|  | - |
| 8. Chat | v1.2 | 0/2 | Not started | - |
| 9. CRDT Editor | v1.2 | 0/2 | Not started | - |
| 10. Reactions & Dev Tools | v1.2 | 0/3 | Not started | - |
