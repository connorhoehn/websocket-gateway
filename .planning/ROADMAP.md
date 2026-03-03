# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Overview

This roadmap transforms a functional WebSocket gateway into a production-ready AWS deployment. The journey prioritizes security hardening first (authentication, authorization, rate limiting, memory leak fixes), then AWS infrastructure deployment (ECS Fargate, ElastiCache, ALB), followed by operational maturity (monitoring, CRDT snapshots), and optional reliability enhancements. Each phase delivers a coherent, verifiable capability that unblocks the next phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4, 5): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security Hardening** - Implement authentication, authorization, rate limiting, and fix critical memory leaks
- [ ] **Phase 2: AWS Infrastructure Foundation** - Deploy to ECS Fargate with ElastiCache Redis, ALB, and production VPC
- [x] **Phase 3: Monitoring & Observability** - Add CloudWatch metrics, alarms, structured logging, and dashboard (completed 2026-03-03)
- [ ] **Phase 4: Persistent State & CRDT Support** - Implement DynamoDB snapshots and CRDT operation broadcasting
- [ ] **Phase 5: Enhanced Reliability (Optional)** - Connection state recovery, IVS chat integration, and reliability improvements

## Phase Details

### Phase 1: Security Hardening
**Goal**: Production-ready security posture with authentication, authorization, rate limiting, and no memory leaks
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-06, SEC-07, SEC-08, REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):
  1. Unauthenticated WebSocket connection attempts are rejected with 401 Unauthorized
  2. Users can only subscribe to channels they have permission to access
  3. Clients sending more than 100 msgs/sec (or 40/sec for cursors) receive backpressure signals
  4. Invalid messages (wrong schema, oversized payloads) are rejected with clear error codes
  5. Presence service runs for 24+ hours without memory growth (clientPresence Map has TTL cleanup)
  6. Chat service runs for 24+ hours without memory growth (channelHistory has LRU eviction)
  7. Cursor service falls back to local storage when Redis is unavailable
**Plans**: TBD

Plans:
- [ ] (To be created by plan-phase)

### Phase 2: AWS Infrastructure Foundation
**Goal**: Production AWS deployment with managed services, auto-scaling, and high availability
**Depends on**: Phase 1
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, SEC-05
**Success Criteria** (what must be TRUE):
  1. WebSocket server containers run on ECS Fargate with 0.5 vCPU and 1GB RAM
  2. Application Load Balancer terminates TLS and routes wss:// connections with sticky sessions
  3. ElastiCache Redis Multi-AZ cluster handles pub/sub coordination with automatic failover
  4. VPC isolates resources with private subnets and VPC endpoints (no NAT gateway)
  5. ECS auto-scales tasks based on connection count (target: 5000 connections per task)
  6. Health check endpoint (/health) returns 200 OK when server is ready
  7. Server receives SIGTERM and drains connections gracefully within 30 seconds
  8. ALB idle timeout is 300 seconds and server sends WebSocket pings every 30 seconds
**Plans**: TBD

Plans:
- [ ] (To be created by plan-phase)

### Phase 3: Monitoring & Observability
**Goal**: Operational visibility via CloudWatch metrics, alarms, structured logging, and real-time dashboard
**Depends on**: Phase 2
**Requirements**: MON-01, MON-02, MON-03, MON-04, MON-05
**Success Criteria** (what must be TRUE):
  1. CloudWatch receives custom metrics for connection count, messages/sec, and P95 latency every 60 seconds
  2. All log entries use JSON format with correlationId, timestamp, level, and message fields
  3. CloudWatch alarms trigger SNS notifications when memory exceeds 80%, connection failures spike, or authorization denials occur
  4. CloudWatch dashboard displays real-time graphs for connections, message throughput, error rates, and Redis health
  5. Error responses include standardized error codes (AUTH_FAILED, RATE_LIMIT_EXCEEDED, INVALID_MESSAGE, etc.)
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — CloudWatch metrics emission and JSON-structured logging
- [ ] 03-02-PLAN.md — CloudWatch alarms with SNS notifications for critical metrics
- [ ] 03-03-PLAN.md — CloudWatch dashboard and standardized error codes

### Phase 4: Persistent State & CRDT Support
**Goal**: CRDT operation broadcasting and periodic snapshot persistence to DynamoDB
**Depends on**: Phase 2
**Requirements**: PERSIST-01, PERSIST-02, PERSIST-03, PERSIST-04
**Success Criteria** (what must be TRUE):
  1. DynamoDB table crdt-snapshots exists with TTL attribute and on-demand billing
  2. CRDT operations broadcast to subscribed clients via existing Redis pub/sub within <50ms
  3. CRDT snapshots write to DynamoDB every 5 minutes with document ID, timestamp, and snapshot payload
  4. Clients reconnecting after disconnect can retrieve latest CRDT snapshot from DynamoDB
**Plans**: 3 plans

Plans:
- [ ] 04-01-PLAN.md — DynamoDB table setup and CRDT operation broadcasting
- [ ] 04-02-PLAN.md — Snapshot persistence with time/operation/disconnect triggers
- [ ] 04-03-PLAN.md — Snapshot retrieval for client reconnection

### Phase 5: Enhanced Reliability (Optional)
**Goal**: Improved user experience through connection state recovery and optional IVS chat integration
**Depends on**: Phase 3
**Requirements**: REL-04, REL-05, IVS-01, IVS-02, IVS-03
**Success Criteria** (what must be TRUE):
  1. Server gracefully degrades to local cache when Redis becomes unavailable (no connection drops)
  2. Clients can reconnect with session token and restore previous subscription state
  3. AWS IVS Chat service handles persistent chat messages with moderation capabilities (if opted in)
  4. IVS Chat webhooks forward message events to WebSocket clients via pub/sub (if opted in)
  5. Chat persistence migrates from in-memory channelHistory to IVS backend (if opted in)
**Plans**: TBD

Plans:
- [ ] (To be created by plan-phase)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Hardening | 0/TBD | Not started | - |
| 2. AWS Infrastructure Foundation | 0/TBD | Not started | - |
| 3. Monitoring & Observability | 3/3 | Complete   | 2026-03-03 |
| 4. Persistent State & CRDT Support | 0/TBD | Not started | - |
| 5. Enhanced Reliability (Optional) | 0/TBD | Not started | - |
