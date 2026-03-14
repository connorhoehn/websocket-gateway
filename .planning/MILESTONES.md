# Milestones

## v1.4 UI Polish & Feature Completeness (Shipped: 2026-03-14)

**Phases completed:** 5 phases, 7 plans, 4 tasks

**Key accomplishments:**
- (none recorded)

---

## v1.3 User Auth & Identity (Shipped: 2026-03-11)

**Phases completed:** 4 phases (11-14), 8 plans

**Key accomplishments:**
- useAuth hook (TDD): Cognito USER_PASSWORD_AUTH, session restore, proactive token refresh 2min before expiry, BroadcastChannel multi-tab sync
- LoginForm/SignupForm pure presentational components + App.tsx auth gating with real Cognito JWT
- identity.ts utility: identityToColor/identityToInitials replacing 4 duplicate implementations across components
- DisplayName propagation (given_name → email prefix) through presence, cursors, and chat metadata
- CLI tooling: create-test-user.sh + list-test-users.sh for Cognito user management
- AUTH-09 + PRES-03 gap closure: token-refresh-triggered reconnect + typing indicator broadcast wired end-to-end

---

## v1.2 Frontend Layer (Shipped: 2026-03-10)

**Phases completed:** 5 phases (6-10), 13 plans

**Key accomplishments:**
- React + Vite + TypeScript dev client with useWebSocket hook, connection status UI, channel switching
- usePresence + PresencePanel: live user list with heartbeat-based online detection and typing indicators
- useCursors with all 4 modes (freeform, table, text, canvas) plus multi-mode selector UI
- useChat + ChatPanel with scrollback history (last 100 messages per channel)
- useCRDT + SharedTextEditor: Y.js document sync with DynamoDB snapshot restore on reconnect
- useReactions ephemeral emoji overlay, EventLog, ErrorPanel, and disconnect/reconnect dev tools

---

## v1.1 Enhanced Reliability (Shipped: 2026-03-03)

**Phases completed:** 1 phases, 4 plans, 2 tasks

**Key accomplishments:**
- Redis graceful degradation with local cache fallback - services survive Redis outages
- WebSocket session token reconnection with 24hr expiry and subscription restoration
- AWS IVS Chat integration with Lambda-based content moderation (optional feature)
- Comprehensive IVS deployment documentation and migration tooling

---

## v1.0 MVP - Production-Ready WebSocket Gateway (Shipped: 2026-03-03)

**Phases completed:** 4 phases, 13 plans, 9 tasks

**Key accomplishments:**
- Cognito JWT authentication with RS256 verification and channel-level authorization
- AWS ECS Fargate deployment with cost-optimized VPC endpoints ($29/mo vs $32/mo NAT)
- ElastiCache Redis Multi-AZ cluster and Application Load Balancer with TLS
- CloudWatch custom metrics (connections, throughput, P95 latency) with JSON-structured logging
- CRDT operation broadcasting with 10ms batching and DynamoDB snapshot persistence

---
