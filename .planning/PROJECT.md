# WebSocket Gateway - AWS Migration & Hardening

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

### Active

<!-- v1.2: Frontend Layer -->

- [ ] React + Vite frontend app with WebSocket connection hook and status UI
- [ ] Reusable presence component showing live user list per channel
- [ ] Collaborative cursor canvas with real-time multi-tab cursor tracking
- [ ] Chat component with real-time messages and scrollback history
- [ ] Shared CRDT document editor syncing across tabs via Y.js
- [ ] Ephemeral reactions overlay with emoji animations
- [ ] Developer event log and error display panel
- [ ] Local dev auth helper for generating Cognito JWT tokens

### Out of Scope

- Lambda for high-frequency pub/sub — Per-invocation cost makes this 100-1000x more expensive than self-hosted
- AppSync for cursor updates — $2/million real-time updates = $20k/month at scale vs $60/month self-hosted
- AWS IoT Core for cursor pub/sub — $1/million messages = $10k/month at scale
- Rewriting in serverless architecture — Current WebSocket approach is correct for this use case
- Mobile native apps — Web-first, mobile later

## Context

**Current State (v1.0 - Shipped 2026-03-03):**
- Production-ready WebSocket gateway deployed on AWS ECS Fargate
- 21,838 lines of code (TypeScript, JavaScript)
- Security hardened: JWT auth, channel authz, rate limiting, memory leak fixes
- AWS infrastructure: ECS Fargate, ElastiCache Redis Multi-AZ, ALB with TLS
- Full observability: CloudWatch metrics, structured logging, alarms, dashboard
- CRDT support: 10ms batched operations, DynamoDB snapshots with 7-day TTL
- Cost target achieved: ~$100-150/month vs $10k-20k/month with Lambda/AppSync

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

## Current Milestone: v1.2 Frontend Layer

**Goal:** Build a React + Vite developer toolbox that exercises every gateway feature (presence, cursors, chat, CRDT, reactions) with reusable hooks/components and full in-UI error visibility.

**Target features:**
- WebSocket connection hook with status, reconnect, and error display
- Presence panel (live user list per channel)
- Collaborative cursor canvas (multi-tab real-time tracking)
- Chat panel with history
- Shared CRDT document editor (Y.js)
- Ephemeral reactions overlay
- Developer event log panel

---
*Last updated: 2026-03-03 after v1.2 milestone started*
