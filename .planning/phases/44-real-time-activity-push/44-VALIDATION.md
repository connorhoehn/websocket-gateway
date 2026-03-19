---
phase: 44
slug: real-time-activity-push
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) / manual integration tests |
| **Config file** | frontend/vite.config.ts |
| **Quick run command** | `cd frontend && npm run typecheck` |
| **Full suite command** | `cd frontend && npm run build` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run typecheck`
- **After every plan wave:** Run `cd frontend && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 1 | real-time UX | file-check | `test -f src/services/activity-service.js` | ❌ W0 | ⬜ pending |
| 44-01-02 | 01 | 1 | real-time UX | grep | `grep "activity:" src/validators/message-validator.js` | ✅ | ⬜ pending |
| 44-01-03 | 01 | 1 | ALOG-02 | file-check | `test -f lambdas/activity-log/src/index.ts` | ✅ | ⬜ pending |
| 44-02-01 | 02 | 2 | real-time UX | file-check | `test -f frontend/src/hooks/useActivityFeed.ts` | ❌ W0 | ⬜ pending |
| 44-02-02 | 02 | 2 | real-time UX | typecheck | `cd frontend && npm run typecheck` | ✅ | ⬜ pending |
| 44-02-03 | 02 | 2 | real-time UX | grep | `grep "useActivityFeed" frontend/src/components/ActivityPanel.tsx` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/activity-service.js` — stub for gateway activity service
- [ ] `frontend/src/hooks/useActivityFeed.ts` — stub for real-time hook

*Wave 0 stubs are minimal — just file creation with correct exports. The real implementations happen in the plan tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Activity feed appends within 2s of event | real-time UX | Requires running LocalStack + gateway + simulation | Start all services, trigger a social event, observe ActivityPanel updating |
| No duplicate events on reconnect | real-time UX | Requires WebSocket disconnect simulation | Subscribe, disconnect, reconnect, verify no dupes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
