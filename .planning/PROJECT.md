# WebSocket Gateway - AWS Migration & Hardening

## What This Is

A distributed real-time WebSocket gateway for collaborative features (cursor tracking, presence, CRDT operations, and chat) that enables low-latency, high-frequency pub/sub for ephemeral data. Currently functional but needs security hardening and migration to AWS managed infrastructure to be production-ready.

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

### Active

<!-- Current milestone: Harden and deploy to AWS -->

- [ ] Add Cognito JWT authentication on WebSocket connect
- [ ] Implement per-client rate limiting
- [ ] Fix memory leak in presence service (unbounded Map growth)
- [ ] Fix memory leak in chat service (no TTL on channel history)
- [ ] Fix cursor service Redis fallback logic
- [ ] Deploy to ECS Fargate with auto-scaling
- [ ] Migrate to ElastiCache Redis (managed, HA)
- [ ] Add Application Load Balancer for WebSocket connections
- [ ] Integrate AWS IVS for persistent chat
- [ ] Add CRDT operation broadcasting support
- [ ] Implement periodic CRDT snapshots to DynamoDB (every 5min)
- [ ] Add CloudWatch monitoring and alerts

### Out of Scope

- Lambda for high-frequency pub/sub — Per-invocation cost makes this 100-1000x more expensive than self-hosted
- AppSync for cursor updates — $2/million real-time updates = $20k/month at scale vs $60/month self-hosted
- AWS IoT Core for cursor pub/sub — $1/million messages = $10k/month at scale
- Rewriting in serverless architecture — Current WebSocket approach is correct for this use case
- Mobile native apps — Web-first, mobile later

## Context

**Current State:**
- Working WebSocket gateway with good architectural patterns (distributed nodes, Redis coordination)
- Codebase analysis revealed critical security gaps (no auth/authz, no rate limiting)
- Memory leaks in presence and chat services from unbounded data structures
- Missing graceful degradation when Redis fails
- Running on development infrastructure, needs production hardening

**Use Cases:**
- Collaborative cursors (40 updates/sec per user)
- Presence tracking (who's online, typing indicators)
- CRDT operations for collaborative editing (spreadsheets, documents)
- Chat with persistence
- Ephemeral reactions/emojis

**Why AWS Migration:**
- Reduce ops burden with managed services (ElastiCache, ECS Fargate, IVS)
- Auto-scaling for variable load
- Monitoring and alerting via CloudWatch
- Keep low cost for high-frequency pub/sub

## Constraints

- **Cost**: Target $100-150/month total. High-frequency cursor updates (25-50ms) rule out per-message pricing (Lambda, AppSync, IoT Core)
- **Performance**: <50ms latency for cursor updates. WebSocket pub/sub required.
- **Tech Stack**: Keep existing WebSocket gateway (proven correct architecture). Add AWS infrastructure around it.
- **Compatibility**: Frontend is solid and works. Cannot break existing WebSocket protocol.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep custom WebSocket gateway vs Lambda/AppSync | Per-message pricing costs $10k-20k/month vs $60-80/month self-hosted for high-frequency pub/sub | — Pending |
| Use ECS Fargate for hosting | Auto-scaling, managed containers, no EC2 ops | — Pending |
| Use ElastiCache Redis | Managed Redis with HA, unlimited pub/sub messages for fixed cost (~$12/month) | — Pending |
| Use AWS IVS for persistent chat | Managed chat service tied to video streaming, offloads chat persistence | — Pending |
| Use Cognito for authentication | Solves auth/authz security gap, integrates with WebSocket gateway | — Pending |
| CRDT snapshots every 5min | Balance between data safety and DynamoDB write costs | — Pending |

---
*Last updated: 2026-03-02 after project initialization*
