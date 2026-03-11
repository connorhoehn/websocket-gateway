# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- ✅ **v1.2 Frontend Layer** — Phases 6-10 (shipped 2026-03-10)
- ✅ **v1.3 User Auth & Identity** — Phases 11-14 (shipped 2026-03-11)

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

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14

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
