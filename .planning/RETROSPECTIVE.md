# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP - Production-Ready WebSocket Gateway

**Shipped:** 2026-03-03
**Phases:** 4 | **Plans:** 13 | **Duration:** 3 days (March 1-3, 2026)

### What Was Built
- Security layer: Cognito JWT authentication with channel-level authorization, rate limiting, and memory leak fixes
- AWS infrastructure: ECS Fargate deployment with cost-optimized VPC endpoints, ElastiCache Redis Multi-AZ, ALB with TLS
- Observability: CloudWatch custom metrics (connections, throughput, P95 latency), JSON-structured logging with correlation IDs, alarms, and dashboard
- CRDT support: 10ms batch-optimized operation broadcasting, DynamoDB snapshot persistence with 7-day TTL

### What Worked
- TDD approach: All plans used red-green-refactor cycles, catching issues early
- Cost optimization: VPC endpoints vs NAT Gateway saved $3/mo while maintaining functionality
- Batching strategy: 10ms CRDT operation batching reduced Redis message volume by 70%
- Fail-open observability: Metrics and logging failures never impacted application availability
- Cache-aside pattern: Local-first cursor service ensured availability during Redis intermittency

### What Was Inefficient
- No milestone audit: Proceeded without running `/gsd:audit-milestone` to verify requirements coverage
- Codebase created from scratch: Started with functional gateway but no version control history for first 8 months
- Test coverage gaps: Some integration tests missing (manual verification required for Cognito JWT flow)

### Patterns Established
- Histogram-based P95 latency: 5 buckets provide accurate percentiles without storing all values
- Structured decision logging: All architectural decisions captured in PROJECT.md with rationale and outcomes
- Phase-level summaries: Each plan includes detailed SUMMARY.md with one-liner, decisions, and metrics
- Cost-conscious AWS choices: On-demand DynamoDB, Graviton2 Redis, minimal Fargate sizing

### Key Lessons
1. **Batch for efficiency**: 10ms batching reduced Redis load by 70% while staying under 50ms latency budget
2. **Fail-open observability**: Never let metrics/logging failures impact application reliability
3. **Cost optimization pays off**: VPC endpoints, Graviton2, and on-demand billing hit $100-150/mo target vs $10k+ serverless
4. **TDD prevents rework**: Red-green-refactor caught edge cases early, reducing debugging time
5. **Cache-aside for resilience**: Local-first writes with Redis sync prevented failures during Redis intermittency

### Cost Observations
- Model mix: 100% Sonnet (yolo mode, no opus/haiku usage tracked)
- Development timeline: 3 days intensive sprint (73 commits)
- Infrastructure cost target: $100-150/mo achieved vs $10k-20k/mo with Lambda/AppSync

---

## Milestone: v1.2 — Frontend Layer

**Shipped:** 2026-03-10
**Phases:** 6-10 (5 phases) | **Plans:** 13

### What Was Built
- React + Vite + TypeScript dev client with useWebSocket hook, connection status, channel switching
- usePresence + PresencePanel (live user list, typing indicators)
- useCursors with all 4 modes: freeform, table, text, canvas — plus multi-mode selector
- useChat + ChatPanel with scrollback history (last 100 messages)
- useCRDT + SharedTextEditor with Y.js document sync and DynamoDB snapshot restore
- useReactions + ephemeral emoji overlay; EventLog, ErrorPanel, disconnect/reconnect dev tools

### What Worked
- Ref-sync pattern (sendMessageRef, currentChannelRef): stable callbacks without re-renders — became the established hook convention for all v1.2+ hooks
- featureHandlers registry in App.tsx: routes inbound messages to feature hooks without prop-drilling
- Separate handler vs subscribe effects: handler survives channel changes without teardown
- Leading-edge 50ms throttle on cursor updates: responsive UX without server flood
- Incremental phase structure: each phase built on the last cleanly

### What Was Inefficient
- Phase 7 audit found CURS-02 color-hash gap (not caught in verification) — required Phase 12 to fully resolve
- Typing indicator display-side was verified but broadcast-side (setTyping) was never tested end-to-end — gap found by v1.3 audit
- Duplicate color/initials helpers across 4 components — resolved in v1.3 identity.ts, but should have been shared from Phase 7

### Patterns Established
- useRef for WS instance (not useState) — WebSocket reconnects must not cause re-renders
- sessionTokenRef mirrors sessionToken state — close handler reads sync value (state is async)
- Mode-filtered rendering: single cursors Map, components filter by metadata.mode at render time
- ERROR_CODE_DESCRIPTIONS exported from ErrorDisplay.tsx for ErrorPanel reuse without duplication

### Key Lessons
1. **Verify broadcast, not just display**: typing indicators displayed correctly but the broadcast path was unverified — test the full round-trip
2. **Share identity primitives early**: 4 duplicate color/initials helpers created tech debt; a shared utility should be built at first use
3. **Ref-sync pattern**: closures in WS handlers need refs for fresh values — establish this pattern at project start

---

## Milestone: v1.3 — User Auth & Identity

**Shipped:** 2026-03-11
**Phases:** 11-14 (4 phases) | **Plans:** 8

### What Was Built
- useAuth hook (TDD): Cognito USER_PASSWORD_AUTH, session restore, sign-in/sign-up/sign-out, proactive token refresh 2 min before expiry, BroadcastChannel multi-tab sync
- LoginForm + SignupForm components: pure presentational, auth state via props only
- App.tsx auth gating: login/signup → authenticated gateway connection with real Cognito JWT
- identity.ts utility: identityToColor + identityToInitials replacing 4 duplicate implementations
- DisplayName propagation through all hooks (usePresence, useCursors, useChat) via metadata
- ChatPanel with message attribution (displayName as author label)
- AUTH-09 gap closure: GatewayDemo detects cognitoToken change and calls reconnect()
- PRES-03 gap closure: setTyping wired through App.tsx → ChatPanel with 2s debounce
- scripts/create-test-user.sh + list-test-users.sh for CLI Cognito user management

### What Worked
- TDD for useAuth: vi.fn(function(){}) for class constructor mocks — caught subtle async edge cases upfront
- Milestone audit before archiving: `/gsd:audit-milestone` found AUTH-09 and PRES-03 gaps that would have shipped broken
- Pure presentational auth components: no internal hook calls — testable without mocks, consistent with useWebSocket pattern
- Module-level scheduleTokenRefresh: testable in isolation, no hook overhead
- Keeping token reconnect in GatewayDemo (not useWebSocket): preserved hook's stable [] lifecycle

### What Was Inefficient
- AUTH-09 gap: token refresh logic worked but reconnect wiring was missed in Phase 13 — required Phase 14 to close. A dedicated integration test for the full refresh → reconnect flow would have caught this
- PRES-03 gap: setTyping was orphaned in App.tsx destructuring — simple oversight, would have been caught by any manual test of the typing indicator
- Stale AUTH-11 checkbox: implementation existed but checkbox was `[ ]` — minor but indicates traceability table isn't always kept live during execution

### Patterns Established
- prevTokenRef skips spurious mount trigger: when watching a prop for changes, always initialize ref to current value
- onTyping debounce timer in ChatPanel: component owns its own timer cleanup on unmount
- admin SUPPRESS + --permanent for test user creation: bypasses force-change-password flow
- Milestone audit as mandatory gate before archiving: caught 2 real gaps in v1.3

### Key Lessons
1. **Audit before archiving**: `/gsd:audit-milestone` is worth running — it found two real gaps that would have shipped broken
2. **Test the wiring, not just the unit**: each piece of AUTH-09 worked in isolation; the integration (refresh → reconnect) was the gap
3. **Traceability table needs live updates**: checkbox drift (AUTH-11) causes false confidence — update during execution, not after
4. **prevTokenRef pattern**: when a useEffect needs to ignore the initial render, initialize the ref to the current prop value

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Duration | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 3 days | 4 | TDD for all plans, structured decision logging |
| v1.2 | 7 days | 5 | featureHandlers registry, ref-sync pattern established |
| v1.3 | 1 day | 4 | Milestone audit gate added, identity consolidation |

### Cumulative Quality

| Milestone | Plans | Lines of Code | Audit |
|-----------|-------|---------------|-------|
| v1.0 | 13 | 21,838 | n/a |
| v1.2 | 13 | ~28,000 est | n/a |
| v1.3 | 8 | ~28,600 (6,733 frontend) | 35/37 → 37/37 after Phase 14 |

### Top Lessons (Verified Across Milestones)

1. TDD prevents rework and catches unit-level edge cases early
2. Cost-conscious AWS choices enable self-hosted at 100x lower cost than serverless
3. Fail-open observability ensures monitoring never impacts reliability
4. **Audit integration, not just units** — each milestone revealed integration gaps that unit tests missed
5. **Share primitives early** — duplicate helpers create drift; extract at first duplication
