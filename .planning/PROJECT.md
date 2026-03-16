# WebSocket Gateway — Social Platform

## Current Milestone: v2.0 Social Platform

**Goal:** Add a full social layer on top of the existing real-time gateway — user profiles, follow/friend graph, groups, rooms (standalone + group + DM), posts, threaded comments, and likes with attribution — all keyed on Cognito `sub` for referential integrity and reuse across other apps.

**Target features:**
- Social profiles: Cognito-backed user profiles with bio and avatar
- Social graph: follow (asymmetric) + mutual follow = friends
- Groups: user-created spaces with membership, roles, and visibility
- Rooms: standalone rooms, group sub-rooms, and DM rooms between mutual friends — all persisted in DynamoDB and mapped to WebSocket channels
- Posts & threaded comments: text posts in rooms with nested comment threading
- Reactions & likes: emoji reactions + like attribution (who liked, unlike support)
- Real-time social events: new posts, comments, and likes broadcast via WebSocket to room members

**Architecture:**
- New `social-api` Express service (separate CDK stack) with REST endpoints
- New DynamoDB tables with Cognito `sub` as FK — designed for cross-app reuse
- Existing WebSocket gateway extended with social event types for real-time delivery

## What This Is

A real-time collaborative platform combining a production WebSocket gateway with a full social layer. The gateway provides low-cost, high-frequency pub/sub for real-time events; the social API provides persistent social graph, group/room management, and content storage — all tightly coupled to AWS Cognito for identity and referential integrity.

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

<!-- v1.4: UI Polish & Feature Completeness -->

- ✓ Remove all HTML test clients and standalone SDK files from repo — v1.4
- ✓ React app renders all collaborative features in a clean, production-quality layout — v1.4
- ✓ Reaction overlay supports 12 emoji types with distinct CSS animations — v1.4
- ✓ EventLog split into per-service tabs (chat, presence, cursors, reactions, system) — v1.4
- ✓ Typing indicator visibly displayed in chat and presence panels — v1.4

### Active

<!-- v2.0: Social Platform -->

- [ ] Social profiles with display name, bio, avatar URL backed by Cognito sub — v2.0
- [ ] Follow/unfollow users; mutual follows create friend relationship — v2.0
- [ ] Groups with membership, roles (owner/admin/member), and visibility — v2.0
- [ ] Rooms (standalone, group sub-room, DM) persisted in DynamoDB keyed on Cognito sub — v2.0
- [ ] Text posts in rooms with edit/delete — v2.0
- [ ] Threaded comments (nested replies) on posts — v2.0
- [ ] Likes with attribution (who liked, unlike support) on posts and comments — v2.0
- [ ] Real-time broadcast of social events to room members via WebSocket — v2.0

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
*Last updated: 2026-03-16 after v2.0 (Social Platform) milestone start*
