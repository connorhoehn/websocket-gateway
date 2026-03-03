# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- 📋 **v1.1 Enhanced Reliability** — Phase 5 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP - Production-Ready WebSocket Gateway (Phases 1-4) — SHIPPED 2026-03-03</summary>

- [x] Phase 1: Security Hardening (3/3 plans) — completed 2026-03-02
- [x] Phase 2: AWS Infrastructure Foundation (4/4 plans) — completed 2026-03-02
- [x] Phase 3: Monitoring & Observability (3/3 plans) — completed 2026-03-03
- [x] Phase 4: Persistent State & CRDT Support (3/3 plans) — completed 2026-03-03

**Delivered:**
- Cognito JWT authentication with channel-level authorization
- AWS ECS Fargate deployment with cost-optimized VPC endpoints
- ElastiCache Redis Multi-AZ and Application Load Balancer with TLS
- CloudWatch metrics, structured logging, alarms, and dashboard
- CRDT operation broadcasting with DynamoDB snapshot persistence

See: `.planning/milestones/v1.0-ROADMAP.md` for full details

</details>

### 📋 v1.1 Enhanced Reliability (Planned)

- [ ] **Phase 5: Enhanced Reliability (Optional)** - Connection state recovery and IVS chat integration

**Goal**: Improved user experience through connection state recovery and optional IVS chat integration

**Depends on**: Phase 4

**Requirements**: REL-04, REL-05, IVS-01, IVS-02, IVS-03

**Success Criteria**:
1. Server gracefully degrades to local cache when Redis becomes unavailable (no connection drops)
2. Clients can reconnect with session token and restore previous subscription state
3. AWS IVS Chat service handles persistent chat messages with moderation capabilities (if opted in)
4. IVS Chat webhooks forward message events to WebSocket clients via pub/sub (if opted in)
5. Chat persistence migrates from in-memory channelHistory to IVS backend (if opted in)

**Plans**: TBD (use `/gsd:plan-phase 5`)

## Progress

**Overall:** 4/5 phases complete (80%)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Security Hardening | v1.0 | 3/3 | Complete | 2026-03-02 |
| 2. AWS Infrastructure Foundation | v1.0 | 4/4 | Complete | 2026-03-02 |
| 3. Monitoring & Observability | v1.0 | 3/3 | Complete | 2026-03-03 |
| 4. Persistent State & CRDT Support | v1.0 | 3/3 | Complete | 2026-03-03 |
| 5. Enhanced Reliability (Optional) | v1.1 | 0/TBD | Not started | - |

---

**Next Steps:**
- `/gsd:new-milestone` to define v1.1 requirements
- `/gsd:plan-phase 5` to create execution plans for Phase 5
