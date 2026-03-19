---
phase: 43
slug: transactional-outbox
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest |
| **Config file** | jest.config.js (per Lambda package) |
| **Quick run command** | `npm test -- --testPathPattern=outbox` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=outbox`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 43-01-01 | 01 | 1 | ALOG-01 | infra | `diff infra/bootstrap.sh` | ✅ | ⬜ pending |
| 43-01-02 | 01 | 1 | ALOG-01 | unit | `npm test -- --testPathPattern=follow` | ✅ | ⬜ pending |
| 43-01-03 | 01 | 1 | ALOG-01 | unit | `npm test -- --testPathPattern=room-members` | ✅ | ⬜ pending |
| 43-01-04 | 01 | 1 | ALOG-01 | unit | `npm test -- --testPathPattern=posts` | ✅ | ⬜ pending |
| 43-01-05 | 01 | 1 | ALOG-01 | unit | `npm test -- --testPathPattern=reactions` | ✅ | ⬜ pending |
| 43-02-01 | 02 | 2 | event durability | unit | `npm test -- --testPathPattern=outbox-relay` | ❌ W0 | ⬜ pending |
| 43-02-02 | 02 | 2 | event durability | integration | `npm test -- --testPathPattern=outbox-relay` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lambdas/outbox-relay/src/__tests__/outbox-relay.test.ts` — unit test stubs for relay Lambda
- [ ] `lambdas/outbox-relay/src/__tests__/outbox-relay.integration.test.ts` — integration test stubs

*Wave 0 is the outbox relay Lambda creation itself (plan 43-02 task 1).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TransactWrite atomicity under crash | ALOG-01 | Cannot simulate mid-write crash in unit tests | Kill process mid-write; verify both records absent or both present |
| At-least-once retry on Lambda failure | event durability | Requires DynamoDB + SQS LocalStack orchestration | Inject error in relay; verify record stays UNPROCESSED; re-invoke; verify SQS message |
| No double-delivery to SQS | event durability | Requires state inspection across invocations | Run relay twice; verify SQS has exactly 1 message per outbox record |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
