# WebSocket Gateway - AWS Migration & Hardening

## Current Milestone: v1.5 Production Hardening

**Goal:** Fix reliability issues, resource leaks, and observability gaps that will break under production load or multi-node failure scenarios.

**Target fixes:**
- Error handling: catch all unhandled promise rejections, track metrics health, propagate correlation IDs
- Connection resilience: atomic subscription restore with rollback, guaranteed disconnect cleanup, secure JWT transport
- Broadcast: non-blocking batched sends, per-channel sequence numbers for ordering
- Resource management: bounded session store, race-safe presence cleanup, timer lifecycle tracking
- Validation & telemetry: metadata size limits, reconnection metrics

## What This Is

A production-ready distributed real-time WebSocket gateway deployed on AWS ECS Fargate. Provides secure, monitored pub/sub for collaborative features (cursor tracking, presence, CRDT operations, and chat) with <50ms latency at low cost ($100-150/mo).

## Core Value

Provide low-cost, high-frequency pub/sub (<50ms latency) for ephemeral real-time collaboration data where per-message pricing models (Lambda, AppSync) would be cost-prohibitive at scale.

## Requirements

### Validated

<!-- Existing capabilities from codebase -->

- ✓ WebSocket server with distributed node coordination — existing
- ✓ Presence tracking service (heartbeats, online status) — existing
- ✓ Cursor position broadcasting (25-50ms updates) — existing
- ✓ Chat service with message history — existing
- ✓ Reaction service (ephemeral emoji broadcasts) — existing
- ✓ Redis pub/sub integration for node coordination — existing

<!-- Phase 01: Security Hardening -->

- ✓ Cognito JWT authentication on WebSocket connect — v1.0
- ✓ Per-client rate limiting (100 msgs/sec, 40/sec cursor) — v1.0
- ✓ Memory leak prevention in presence service — v1.0
- ✓ Memory leak prevention in chat service — v1.0
- ✓ Cursor service Redis fallback with cache-aside pattern — v1.0
- ✓ Message validation (schema, size limits, channel format) — v1.0
- ✓ Connection limits (per-IP and global) — v1.0
- ✓ Channel-level authorization — v1.0

<!-- Phase 02: AWS Infrastructure Foundation -->

- ✓ Deploy to ECS Fargate with auto-scaling — v1.0
- ✓ Migrate to ElastiCache Redis (managed, HA) — v1.0
- ✓ Add Application Load Balancer for WebSocket connections — v1.0
- ✓ VPC with cost-optimized endpoints (no NAT gateway) — v1.0

<!-- Phase 03: Monitoring & Observability -->

- ✓ CloudWatch custom metrics (connections, throughput, P95 latency) — v1.0
- ✓ JSON-structured logging with correlation IDs — v1.0
- ✓ CloudWatch alarms and dashboard — v1.0
- ✓ Standardized error codes — v1.0

<!-- Phase 04: CRDT Support -->

- ✓ CRDT operation broadcasting with 10ms batching — v1.0
- ✓ DynamoDB table for CRDT snapshots with 7-day TTL — v1.0
- ✓ Periodic snapshot persistence (time/operation/disconnect triggers) — v1.0
- ✓ Snapshot retrieval for client reconnection — v1.0

<!-- Phase 05: Enhanced Reliability -->

- ✓ Redis graceful degradation with local cache fallback — v1.1
- ✓ WebSocket session token reconnection with subscription restoration — v1.1
- ✓ AWS IVS Chat integration with Lambda-based moderation (optional) — v1.1
- ✓ IVS Chat deployment documentation and migration tooling — v1.1

<!-- v1.2: Frontend Layer (Phases 6-10) -->

- ✓ React + Vite frontend app with useWebSocket hook and connection status UI — v1.2
- ✓ Reusable presence panel showing live user list and typing indicators — v1.2
- ✓ Collaborative cursor canvas with real-time multi-tab cursor tracking — v1.2
- ✓ Chat component with real-time messages and scrollback history — v1.2
- ✓ Shared CRDT document editor syncing across tabs via Y.js — v1.2
- ✓ Ephemeral reactions overlay with emoji animations — v1.2
- ✓ Developer event log and error display panel — v1.2

<!-- Phase 11: Auth Foundation (v1.3) -->

- ✓ Cognito auth hook (useAuth) with session restore, sign-in/up/out lifecycle — v1.3
- ✓ Login/signup UI components (LoginForm, SignupForm) — v1.3
- ✓ App.tsx auth gating — gateway connection requires valid Cognito session — v1.3

<!-- Phase 12: Identity Integration (v1.3) -->

- ✓ Shared identity utility (identityToColor/identityToInitials) consolidating 4 duplicate implementations — v1.3
- ✓ Real display name (given_name → email prefix) propagated through presence, cursors, and chat metadata — v1.3
- ✓ ChatPanel component with message attribution (displayName as author label) — v1.3

<!-- Phase 11-14: Auth & Identity (v1.3) -->

- ✓ Cognito auth hook (useAuth) with session restore, sign-in/up/out lifecycle — v1.3
- ✓ Login/signup UI components (LoginForm, SignupForm) — v1.3
- ✓ App.tsx auth gating — gateway connection requires valid Cognito session — v1.3
- ✓ Shared identity utility (identityToColor/identityToInitials) consolidating 4 duplicate implementations — v1.3
- ✓ Real display name (given_name → email prefix) propagated through presence, cursors, and chat metadata — v1.3
- ✓ ChatPanel component with message attribution (displayName as author label) — v1.3
- ✓ Auto token refresh (proactive, 2 min before expiry) + BroadcastChannel multi-tab session sync — v1.3
- ✓ Graceful token expiry handling — sign-out with session-expired message — v1.3
- ✓ CLI tooling: create-test-user.sh + list-test-users.sh for Cognito user management — v1.3
- ✓ Silent token refresh triggers gateway reconnect with updated JWT — v1.3
- ✓ Local user typing indicator broadcast wired end-to-end — v1.3

### Active

<!-- v1.4: UI Polish & Feature Completeness -->

- [ ] Remove all HTML test clients and standalone SDK files from repo — v1.4
- [ ] React app renders all collaborative features in a clean, production-quality layout — v1.4
- [ ] Reaction overlay supports 12 emoji types with distinct CSS animations — v1.4
- [ ] EventLog split into per-service tabs (chat, presence, cursors, reactions, system) — v1.4
- [ ] Typing indicator visibly displayed in chat and presence panels — v1.4

### Out of Scope

- Lambda for high-frequency pub/sub — Per-invocation cost makes this 100-1000x more expensive than self-hosted
- AppSync for cursor updates — $2/million real-time updates = $20k/month at scale vs $60/month self-hosted
- AWS IoT Core for cursor pub/sub — $1/million messages = $10k/month at scale
- Rewriting in serverless architecture — Current WebSocket approach is correct for this use case
- Mobile native apps — Web-first, mobile later

## Context

**Current State (v1.3 - Shipped 2026-03-11):**
- Production-ready WebSocket gateway + authenticated React frontend
- ~6,733 lines frontend TypeScript/React; 21,838+ lines total (TypeScript, JavaScript)
- Full Cognito auth: sign-in/up/out, session restore, auto token refresh, multi-tab sync
- Real user identity: display names from Cognito claims flow through presence, cursors, chat
- All collaborative features work end-to-end with real Cognito users (not mock tokens)
- CLI multi-user test tooling: create-test-user.sh, list-test-users.sh
- Cost target maintained: ~$100-150/month

**Use Cases:**
- Collaborative cursors (40 updates/sec per user, <50ms latency)
- Presence tracking (heartbeats, online status, typing indicators)
- CRDT operations for collaborative editing (Y.js document sync)
- Chat with LRU-cached history (100 messages/channel)
- Ephemeral reactions/emojis

**Architecture Highlights:**
- Distributed nodes coordinated via Redis pub/sub
- Cache-aside pattern for Redis resilience
- 10ms CRDT operation batching reduces Redis message volume by 70%
- Histogram-based P95 latency tracking
- Fail-open observability (metrics/logging never break app)

## Constraints

- **Cost**: Target $100-150/month total. High-frequency cursor updates (25-50ms) rule out per-message pricing (Lambda, AppSync, IoT Core)
- **Performance**: <50ms latency for cursor updates. WebSocket pub/sub required.
- **Tech Stack**: Keep existing WebSocket gateway (proven correct architecture). Add AWS infrastructure around it.
- **Compatibility**: Frontend is solid and works. Cannot break existing WebSocket protocol.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep custom WebSocket gateway vs Lambda/AppSync | Per-message pricing costs $10k-20k/month vs $60-80/month self-hosted for high-frequency pub/sub | ✅ v1.0: Self-hosted on Fargate, hitting cost targets |
| Use ECS Fargate for hosting | Auto-scaling, managed containers, no EC2 ops | ✅ v1.0: 0.25 vCPU, 0.5GB RAM tasks, auto-scales on CPU |
| Use ElastiCache Redis | Managed Redis with HA, unlimited pub/sub messages for fixed cost (~$12/month) | ✅ v1.0: cache.t4g.micro Multi-AZ, ~$12/mo |
| VPC endpoints instead of NAT Gateway | Cost optimization: $29/mo vs $32/mo NAT | ✅ v1.0: 4 interface + 1 gateway endpoint |
| Use Cognito for authentication | Solves auth/authz security gap, integrates with WebSocket gateway | ✅ v1.0: JWT validation with JWKS caching, channel-level authz |
| CRDT snapshots with triggers | Balance data safety with DynamoDB costs | ✅ v1.0: Time (5min), operation count (100), disconnect triggers, 7-day TTL |
| 10ms CRDT operation batching | Reduce Redis load while staying under 50ms latency budget | ✅ v1.0: 70% message reduction, <50ms total latency |
| Histogram-based P95 latency | Accurate percentiles without storing all values | ✅ v1.0: 5 buckets (0-10, 10-50, 50-100, 100-500, 500+) |
| Use jsonwebtoken + jwks-rsa for JWT validation | Industry standard libraries (50M+ downloads/week), battle-tested | ✅ v1.0: Implemented with RS256 verification |
| Rate limiting before authentication | Saves resources during DDoS by rejecting before auth overhead | ✅ v1.0: Connection limits checked first, then auth, then rate limits |
| LRU cache for chat history | Automatic eviction without manual TTL management | ✅ v1.0: 100 messages/channel with lru-cache library |
| Cache-aside pattern for cursor service | Ensures availability during Redis intermittency | ✅ v1.0: Local-first writes, Redis sync with fallback |
| AWS IVS for persistent chat | Managed chat service tied to video streaming, offloads chat persistence | — Deferred: Evaluate in v2 based on user needs |
| useMemo for CognitoUserPool in useAuth | Stable per hook instance, avoids re-instantiation on each render, testable via vi.mock | ✅ v1.3 Phase 11: pattern adopted for all Cognito hooks |
| Pure presentational auth components (LoginForm/SignupForm) | Auth state flows in via props — no internal hook calls, testable without mocks, reusable | ✅ v1.3 Phase 11: consistent with useWebSocket pattern |
| cognitoToken flows at runtime from useAuth.idToken to useWebSocket config | Removes static VITE_COGNITO_TOKEN env dependency; gateway receives real JWT session token | ✅ v1.3 Phase 11: VITE_COGNITO_TOKEN guard removed from gateway.ts |
| displayName propagated via metadata (no server changes) | metadata field already flows through gateway unchanged; client embeds displayName avoiding server-side modifications | ✅ v1.3 Phase 12: all hooks send displayName in metadata |
| Shared identity.ts utility replaces 4 duplicate helper sets | Single source of truth for color/initials prevents drift across components | ✅ v1.3 Phase 12: identityToColor/identityToInitials in utils/ |
| JWT decoded client-side for given_name (no library) | Pure atob split avoids dependencies; given_name → email prefix → 'anonymous' priority | ✅ v1.3 Phase 12: decodeDisplayName() in App.tsx |
| scheduleTokenRefresh as module-level pure function | Testable independently, no hook re-render cost | ✅ v1.3 Phase 13: timerRef + broadcastChannel via useRef |
| admin-create-user SUPPRESS + admin-set-user-password --permanent | Bypasses force-change-password; users sign in immediately after creation | ✅ v1.3 Phase 13: create-test-user.sh adopted pattern |
| Token reconnect in GatewayDemo (not useWebSocket) | Keeps useWebSocket lifecycle stable with [] deps; callers own token lifecycle | ✅ v1.3 Phase 14: prevTokenRef + reconnect() on cognitoToken change |
| setTyping wired via onTyping prop to ChatPanel | Clean prop threading; 2s debounce + clear-on-send; ChatPanel manages its own timer | ✅ v1.3 Phase 14: typing indicator broadcast end-to-end |

---
*Last updated: 2026-03-11 after v1.3 (User Auth & Identity)*
