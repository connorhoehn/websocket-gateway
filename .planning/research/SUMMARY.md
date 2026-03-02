# Project Research Summary

**Project:** WebSocket Gateway - AWS Migration & Hardening
**Domain:** Production WebSocket Infrastructure for Real-Time Collaboration
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

This is a production WebSocket gateway designed for high-frequency real-time collaboration features (cursor tracking at 40 updates/sec, presence, chat, reactions) that needs hardening and migration to AWS. The current implementation is architecturally sound—using ECS Fargate for compute, ElastiCache Redis for pub/sub coordination, and Network Load Balancer for connections—but has critical security gaps that block production deployment.

Research confirms the stack is cost-optimized for this use case: self-hosted WebSocket on ECS costs $100-150/month versus $10k-20k/month for per-message pricing models like Lambda + API Gateway or AWS IoT Core. The primary focus should be closing security gaps (authentication, authorization, rate limiting) and fixing known memory leaks before scaling concerns. The architecture follows industry-standard patterns for distributed WebSocket systems with Redis pub/sub for node coordination.

The critical path to production is security hardening first, infrastructure refinement second, then operational maturity. Attempting to scale or add advanced features (CRDT, multi-region) before fixing authentication and memory leaks would be putting lipstick on a fundamentally insecure system. The good news: most gaps have clear, well-documented solutions that can be implemented incrementally.

## Key Findings

### Recommended Stack

The research validates the current technology choices and identifies specific gaps. ECS Fargate with Node.js 20 LTS provides the right compute model for long-lived WebSocket connections (versus Lambda which costs 100-1000x more for high-frequency pub/sub). ElastiCache Redis pub/sub is the standard approach for distributed coordination, handling 100k+ messages/sec at fixed cost. The primary stack additions needed are Cognito for authentication and DynamoDB for CRDT snapshots.

**Core technologies:**
- **ECS Fargate** (0.5 vCPU, 1GB RAM): Container orchestration for WebSocket servers — standard for stateful applications needing auto-scaling without EC2 ops
- **ElastiCache Redis** (r7g.medium, Multi-AZ): Pub/sub message bus for distributed nodes — fixed cost regardless of message volume, handles high-frequency updates
- **Network Load Balancer**: WebSocket connection termination — Layer 4 performance, though ALB should be evaluated for TLS termination and health checks
- **AWS Cognito**: JWT authentication — managed user auth, integrates with WebSocket handshake validation
- **DynamoDB**: CRDT snapshot persistence — serverless, pay-per-request, perfect for periodic snapshots every 5 minutes

**Critical version requirements:**
- Node.js 20 LTS (current in Dockerfile)
- Redis 7.x (ElastiCache)
- aws-cdk 2.195.0 (infrastructure)

**Cost estimate:** $150-180/month for production with HA, within project constraints

### Expected Features

Security and operational features are table stakes—users expect production systems to have authentication, rate limiting, and monitoring. The current implementation focuses correctly on real-time ephemeral features but lacks the security wrapper needed for production deployment.

**Must have (table stakes):**
- Authentication (Cognito JWT validation) — industry standard, currently missing
- Authorization (channel-level permissions) — prevents data leakage, currently missing
- Rate limiting (per-client throttling) — prevents abuse and DoS, currently missing
- Health checks (/health endpoint) — required for ALB routing, currently missing
- Metrics & monitoring — operational requirement, currently missing
- TLS/SSL (wss://) — security requirement, needs ALB configuration
- Memory leak fixes — known issues in presence and chat services

**Should have (competitive):**
- Connection state recovery — improves mobile UX during network transitions
- Message compression — reduces bandwidth costs for high-frequency cursor updates
- Structured logging with correlation IDs — improves debugging distributed issues
- Dead letter queue — captures failed deliveries for analysis

**Defer (v2+):**
- CRDT conflict resolution — high complexity, wait until collaborative editing validated
- Message replay/offline sync — requires architectural shift to persistent queue
- Multi-region active-active — only needed at significant scale (thousands of users)
- Custom service plugins — only valuable if external developers extend system

**Anti-features to avoid:**
- Per-message encryption in gateway — belongs in storage layer, adds CPU overhead
- Full message ordering guarantees — requires massive coordination, use CRDTs instead
- Exactly-once delivery — impossible in distributed WebSocket, implement idempotency instead

### Architecture Approach

The architecture follows distributed WebSocket patterns with Redis as the coordination layer. Multiple ECS Fargate tasks run stateless WebSocket servers, coordinating through Redis pub/sub for cross-node message delivery. This scales horizontally while maintaining message ordering per-channel.

**Major components:**
1. **Load Balancer (ALB)** — TLS termination, sticky sessions, health checks; currently uses NLB which needs evaluation for production
2. **WebSocket Nodes (ECS Fargate)** — Connection handling, authentication, message routing; scales to 5-10k connections per task
3. **Pub/Sub Coordination (ElastiCache Redis)** — Inter-node messaging, node discovery, ephemeral state; handles 100k+ msgs/sec on r7g instances
4. **Authentication (Cognito)** — JWT validation on WebSocket connect; needs to be implemented
5. **Persistent Storage (DynamoDB)** — CRDT snapshots every 5 minutes, optional chat history; needs schema design and implementation

**Data flow pattern:**
Client → ALB (sticky session) → ECS Task → Redis pub/sub → All subscribed nodes → Local WebSocket clients

**Scaling bottlenecks in order:**
1. WebSocket connection capacity (10k connections/task) — scale horizontally
2. Redis pub/sub throughput (1M msgs/sec) — scale vertically
3. ALB connection rate (500/sec) — pre-warm or use multiple ALBs
4. DynamoDB write throttling (4k WCU) — switch to provisioned capacity

### Critical Pitfalls

Research identified 8 critical pitfalls, with the top 3 blocking production deployment:

1. **Missing authentication on WebSocket connect** — Anyone can connect and access all real-time data. Fix: Implement Cognito JWT validation before WebSocket upgrade completes. Extract token from query params, validate signature/expiration, reject invalid connections with 401.

2. **No per-client rate limiting** — Single malicious client can spam thousands of msgs/sec, exhausting resources. Fix: Implement token bucket rate limiter (100 msgs/sec general, 40 msgs/sec cursors), track in-memory per clientId, send backpressure signals.

3. **Memory leaks in presence and chat services** — Unbounded Map growth causes OOM crashes after hours/days. Fix: Add TTL cleanup for presence (90 sec timeout), implement LRU eviction for chat history (max 1000 channels, 1 hour TTL).

4. **ALB idle timeout too short** — Default 60-second timeout disconnects idle clients. Fix: Configure ALB idle timeout to 300 seconds, implement server-side WebSocket pings every 30 seconds.

5. **No connection draining on ECS deployment** — Task termination drops active connections. Fix: Implement graceful shutdown (SIGTERM handler), set deregistration delay to 120 seconds, notify clients 30 seconds before shutdown.

## Implications for Roadmap

Based on research, suggested phase structure prioritizes security gaps before infrastructure scaling:

### Phase 1: Security Hardening
**Rationale:** Cannot deploy to AWS without authentication, authorization, and rate limiting. These are blockers identified in CONCERNS.md and confirmed by research as industry-standard requirements.

**Delivers:** Production-ready security posture
- Cognito User Pool and JWT validation on WebSocket connect
- Channel-level authorization checks
- Per-client rate limiting (token bucket algorithm)
- Input validation with schema enforcement
- Memory leak fixes (presence TTL, chat LRU eviction)
- Cursor service Redis fallback bug fix

**Addresses:** Authentication (table stakes), Authorization (table stakes), Rate Limiting (table stakes), Memory Leaks (known bugs)

**Avoids:** Pitfall #1 (missing auth), Pitfall #2 (no rate limiting), Pitfall #3 (memory leaks), Pitfall #7 (no authorization)

**Research flag:** Standard patterns — Cognito integration well-documented, rate limiting patterns clear. No additional research needed.

---

### Phase 2: AWS Infrastructure Foundation
**Rationale:** Security must exist before exposing to internet. Once secured, deploy infrastructure with production-grade configuration (Multi-AZ, health checks, graceful shutdown).

**Delivers:** Production AWS deployment
- CDK updates: ALB with sticky sessions and TLS termination
- ElastiCache Redis r7g.medium with Multi-AZ replication
- ECS Fargate with proper task sizing (0.5 vCPU, 1GB RAM)
- VPC configuration with private subnets and VPC endpoints
- Health check endpoint (/health) for ALB target groups
- Graceful shutdown implementation (SIGTERM handling)
- Connection draining configuration (120s deregistration delay)

**Uses:** ECS Fargate (compute), ElastiCache Redis (pub/sub), ALB (load balancing), VPC endpoints (cost optimization)

**Implements:** Load Balancing Layer, Compute Layer, State Management Layer (from ARCHITECTURE.md)

**Avoids:** Pitfall #4 (ALB timeout), Pitfall #5 (no draining), Pitfall #6 (single-AZ Redis)

**Research flag:** Standard AWS patterns — ECS Fargate WebSocket deployment well-documented. No additional research needed.

---

### Phase 3: Persistent State & Monitoring
**Rationale:** Core infrastructure running securely. Now add observability and persistence for operational maturity and feature completion (CRDT snapshots).

**Delivers:** Operational visibility and data persistence
- DynamoDB tables (crdt-snapshots with TTL, optional chat-messages)
- CloudWatch custom metrics (connection count, message rate, latency)
- CloudWatch alarms (memory >80%, connection failures, authz denials)
- Structured JSON logging with correlation IDs
- CloudWatch dashboard for real-time visibility
- Periodic CRDT snapshot writes (every 5 minutes)
- ECS autoscaling policies based on connection count (not CPU)

**Uses:** DynamoDB (persistent storage), CloudWatch (monitoring)

**Implements:** Monitoring layer, CRDT Store (from ARCHITECTURE.md)

**Avoids:** Pitfall #8 (incorrect autoscaling metrics)

**Research flag:** DynamoDB schema design straightforward. CloudWatch metrics patterns standard. No additional research needed.

---

### Phase 4: Enhanced Reliability (Optional v1.x)
**Rationale:** Core system stable in production. Add nice-to-have reliability improvements based on user feedback and operational experience.

**Delivers:** Improved user experience
- Connection state recovery (session tokens, state persistence)
- Message size limits (64KB enforcement)
- CORS configuration for web clients
- Message compression (reduce bandwidth costs)
- Circuit breaker for Redis (prevent cascading failures)
- Enhanced error handling (standardized error codes)

**Addresses:** Connection State Recovery (should-have), Message Compression (should-have)

**Research flag:** Some patterns need validation during implementation (session token design, compression strategy). Consider `/gsd:research-phase` if complexity emerges.

---

### Phase Ordering Rationale

- **Security before infrastructure:** Authentication/authorization must exist before exposing WebSocket endpoint to internet via ALB
- **Infrastructure before monitoring:** Can't monitor what isn't deployed; need running system to observe
- **Monitoring before optimization:** Must measure before optimizing (autoscaling, compression, caching)
- **Reliability enhancements last:** Nice-to-have features that depend on stable production baseline

**Dependency chain:**
```
Phase 1 (Auth/Security)
  └─> Phase 2 (AWS Deploy)
      └─> Phase 3 (Monitoring/Persistence)
          └─> Phase 4 (Enhancements)
```

**Grouping rationale:**
- Phase 1 groups all security gaps identified in CONCERNS.md (auth, authz, rate limiting, memory leaks)
- Phase 2 groups all AWS-specific infrastructure (ECS, Redis, ALB, VPC)
- Phase 3 groups all observability and persistence (CloudWatch, DynamoDB)
- Phase 4 groups all optional improvements (can defer based on production feedback)

**Pitfall avoidance:**
- Phase 1 addresses 4 of 8 critical pitfalls (auth, rate limiting, memory leaks, authorization)
- Phase 2 addresses 3 of 8 critical pitfalls (ALB timeout, draining, Redis HA)
- Phase 3 addresses 1 of 8 critical pitfalls (autoscaling metrics)
- All critical pitfalls resolved by end of Phase 3

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Cognito JWT validation, rate limiting, memory leak fixes — all well-documented patterns
- **Phase 2:** ECS Fargate WebSocket deployment, ElastiCache Redis Multi-AZ — standard AWS patterns
- **Phase 3:** CloudWatch metrics/alarms, DynamoDB schema design — documented AWS observability patterns

**Phases potentially needing deeper research:**
- **Phase 4:** Connection state recovery session token design may need research if implementing custom protocol (versus standard WebSocket subprotocol)
- **Future (v2+):** CRDT library selection (Yjs vs Automerge) and integration would benefit from `/gsd:research-phase`
- **Future (v2+):** Multi-region active-active would require deep research on cross-region Redis replication and conflict resolution

**Overall:** All recommended phases (1-3) use standard, well-documented patterns. Additional research only needed for deferred advanced features.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | ECS Fargate + Redis pub/sub is standard WebSocket pattern. Cost analysis validated against AWS pricing. Current codebase already implements this architecture. |
| Features | MEDIUM | Table stakes features confirmed via industry patterns. Anti-features identified from PROJECT.md concerns. Some competitive features based on training knowledge of SaaS WebSocket providers (may be outdated). |
| Architecture | HIGH | CDK infrastructure exists and follows AWS best practices. Component responsibilities align with distributed WebSocket patterns. Scaling bottlenecks identified through capacity calculations. |
| Pitfalls | HIGH | Top 3 pitfalls directly from CONCERNS.md codebase analysis. AWS-specific pitfalls (ALB timeout, ECS draining) from AWS documentation. Memory leak evidence in source code. |

**Overall confidence:** HIGH

Research is grounded in existing codebase analysis, AWS documentation, and established distributed systems patterns. The stack is already implemented; research validates approach and identifies specific gaps to address.

### Gaps to Address

Gaps that need resolution during planning/implementation:

- **CRDT snapshot frequency:** 5 minutes is reasonable default, but optimal frequency depends on document size and change rate. Monitor DynamoDB write costs in production and adjust.

- **Connection capacity per task:** Research assumes 5-10k connections per Fargate task (0.5 vCPU, 1GB RAM). Load testing required to validate actual capacity under realistic message rates.

- **ALB vs NLB decision:** Current stack uses NLB. Research recommends evaluating ALB for TLS termination and sticky sessions. Both work for WebSocket; trade-offs are latency (<1ms NLB) vs features (health checks, WAF integration on ALB).

- **IVS Chat vs DynamoDB for persistent chat:** PROJECT.md mentions AWS IVS integration. Research identifies this as optional based on moderation requirements. Decision needed: offload chat to IVS ($1/million msgs + moderation) or persist to DynamoDB ($1.25/million writes, no moderation)?

- **Redis instance sizing:** Research recommends r7g.medium for production, but actual sizing depends on connection count and message throughput. Start with t3.micro ($12/month) in staging, monitor CPU/memory, size up as needed.

- **Rate limit thresholds:** Research suggests 100 msgs/sec general, 40 msgs/sec cursors. Actual limits should be tuned based on legitimate use patterns observed in production.

## Sources

### Primary (HIGH confidence)
- **Existing codebase analysis** — src/server.js, src/core/message-router.js, src/core/node-manager.js, src/services/* (current implementation)
- **.planning/codebase/CONCERNS.md** — Documented security gaps, known bugs, memory leak evidence
- **.planning/PROJECT.md** — Project requirements, cost constraints ($100-150/month)
- **lib/*.ts CDK infrastructure** — Current AWS stack configuration (NLB, ECS Fargate, ElastiCache Redis)
- **AWS service documentation** — ECS Fargate, ElastiCache Redis, ALB/NLB, Cognito, DynamoDB pricing and capabilities

### Secondary (MEDIUM confidence)
- **AWS WebSocket deployment patterns** — Training knowledge of ECS Fargate for WebSocket servers (as of 2025)
- **Redis pub/sub performance** — Documented throughput characteristics (100k+ msgs/sec on r7g instances)
- **Cognito JWT validation patterns** — Standard OAuth/OIDC integration with WebSocket handshake
- **Cost comparisons** — Lambda + API Gateway vs self-hosted calculated from AWS pricing calculator (actual costs vary by usage)

### Tertiary (LOW confidence)
- **SaaS WebSocket provider pricing** — Pusher/Ably pricing models from 2024-2025 public pricing pages (may be outdated)
- **IVS Chat integration complexity** — Service documented but integration patterns based on training knowledge
- **CloudFront WebSocket support** — Mentioned as preview feature in 2025, may not be GA in 2026

### Limitations
- **No web search available:** Could not verify 2026 current best practices or recent AWS service updates
- **Training cutoff January 2025:** Recommendations based on 2024-2025 AWS ecosystem
- **CRDT library ecosystem:** Yjs/Automerge recommendations from 2024 knowledge (may have evolved)

---
*Research completed: 2026-03-02*
*Ready for roadmap: Yes*
*Next step: Requirements definition with roadmapper agent*
