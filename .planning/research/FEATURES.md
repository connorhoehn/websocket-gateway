# Feature Research

**Domain:** Production WebSocket Collaboration Gateway
**Researched:** 2026-03-02
**Confidence:** MEDIUM (based on industry patterns, existing codebase analysis, and AWS service capabilities)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users expect in any production WebSocket system. Missing these = system is not production-ready.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Authentication** | Industry standard for any API. Prevents unauthorized access. | MEDIUM | JWT validation on WebSocket handshake. Already planned: Cognito integration. Critical for security. |
| **Authorization** | Users need channel-level access control. Can't let anyone join any channel. | MEDIUM | Channel permission validation before subscribe/publish. Depends on authentication. |
| **Rate Limiting** | Prevents abuse and ensures fair resource usage. Required for production. | MEDIUM | Per-client message/sec limits. Current gap: no rate limiting at all. |
| **Connection State Recovery** | Clients expect to reconnect without losing state (esp. mobile). | HIGH | Session token + state persistence. Current gap: new clientId on reconnect. |
| **Graceful Degradation** | System continues operating when dependencies fail (Redis down). | MEDIUM | Partial: Redis retry exists. Missing: Redis fallback for cursor service (identified bug). |
| **Health Checks** | Load balancers need /health endpoint to route traffic correctly. | LOW | HTTP endpoint returning 200 if server ready. Missing: not implemented. |
| **Structured Logging** | Ops teams need queryable logs for debugging distributed systems. | LOW | Partial: Logger exists. Missing: structured JSON output, correlation IDs. |
| **Metrics & Monitoring** | Cannot operate production without visibility into system behavior. | MEDIUM | CloudWatch metrics: connections, messages/sec, errors, latency. Missing entirely. |
| **Alerts** | Ops need notifications when system degrades (high error rate, latency). | MEDIUM | CloudWatch alarms on critical metrics. Missing entirely. |
| **TLS/SSL** | WebSocket connections over wss:// required for production. Plaintext ws:// unacceptable. | LOW | Handled by ALB. Current: NLB doesn't terminate TLS (architecture gap). |
| **Input Validation** | Prevent injection attacks and malformed data crashes. | LOW | Partial: services validate. Missing: schema validation at routing layer. |
| **Error Handling** | Clients need meaningful error responses, not generic failures. | LOW | Partial: services send errors. Missing: error codes, standardized format. |
| **Message Size Limits** | Prevent memory exhaustion from large payloads. | LOW | Missing: no max message size enforced. |
| **Connection Limits** | Prevent resource exhaustion from connection floods. | LOW | Missing: no per-IP or global connection limits. |
| **CORS Configuration** | Web clients need CORS headers for cross-origin WebSocket connections. | LOW | Missing: not implemented. |

### Differentiators (Competitive Advantage)

Features that set this system apart. Not required for launch, but provide value over alternatives.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-Region Active-Active** | Ultra-low latency by routing to nearest region. High availability across regions. | HIGH | Requires cross-region Redis replication, global routing (Route 53), conflict resolution. Overkill for v1. |
| **Message Replay** | Clients can request message history after reconnect (offline sync). | MEDIUM | Requires persistent message queue (Redis Streams or SQS). Chat service has limited in-memory history (100 msgs). |
| **Presence Enrichment** | Rich presence data (typing indicators, away status, custom states). | LOW | Current: basic online/offline. Enhancement: add metadata fields. |
| **Cursor Replay** | Show historical cursor trails (where users clicked/moved). | LOW | Current: real-time only. Enhancement: persist to DynamoDB for playback. |
| **CRDT Conflict Resolution** | Automatic merge of concurrent edits in collaborative documents. | HIGH | Requires CRDT library (Yjs, Automerge), snapshot management, operation log. Mentioned in PROJECT.md as planned. |
| **Custom Service Plugins** | Users can add domain-specific services without modifying core gateway. | MEDIUM | Service registry pattern. Current: hardcoded services in server.js (identified as gap). |
| **WebRTC Signaling** | Enable P2P video/audio alongside WebSocket data channels. | MEDIUM | Coordinate ICE candidates, SDP offers. Not in current scope. |
| **Message Compression** | Reduce bandwidth for high-frequency updates (cursor positions). | LOW | Per-message compression (gzip, brotli) or protocol-level (permessage-deflate). |
| **Geographic Routing** | Route clients to nearest node based on latency, not just round-robin. | MEDIUM | Requires latency-based DNS (Route 53 geolocation) + health checks. |
| **Dead Letter Queue** | Failed message deliveries go to DLQ for analysis/retry. | MEDIUM | Requires SQS DLQ. Useful for debugging message loss. |
| **Custom Metrics SDK** | Client-side SDK auto-reports connection quality metrics. | LOW | Client sends periodic metrics via WebSocket. Backend aggregates to CloudWatch. |
| **API Gateway Compatibility** | Expose HTTP API alongside WebSocket for REST fallback. | MEDIUM | API Gateway REST + Lambda for non-realtime operations. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems or scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Message Persistence in WebSocket Gateway** | "We need message history" | WebSocket gateway should be ephemeral. Persistence adds complexity, state, and cost. Mixing concerns. | Use dedicated services: AWS IVS for chat (already planned), DynamoDB for CRDT snapshots (already planned). Gateway only routes real-time. |
| **Per-Message Encryption** | "Messages should be encrypted at rest and in transit" | TLS already encrypts in transit. At-rest encryption belongs in storage layer (DynamoDB, S3), not gateway. Adds CPU overhead. | Use TLS for transport. Enable encryption in storage services. Gateway doesn't store data. |
| **Complex Authentication Logic** | "We need custom auth per channel type" | Auth logic in gateway couples it to business rules. Hard to test, hard to change. | Validate JWT claims (simple rules). Push complex authz to separate service or API Gateway authorizer. |
| **Full Message Ordering Guarantees** | "Messages must arrive in exact order" | Distributed systems can't guarantee global ordering without massive coordination overhead (single writer, locks). | Provide per-channel ordering (already done via Redis pub/sub). Use CRDTs for eventual consistency (planned). |
| **Exactly-Once Delivery** | "Every message must arrive exactly once" | Requires distributed transactions, ack/nack protocols, idempotency tracking. Massive complexity. WebSocket is at-most-once. | Implement at-least-once delivery with idempotency keys. Let clients dedupe. |
| **User Management** | "Gateway should manage users" | User management is a separate domain. Don't rebuild Cognito. | Use Cognito for users (already planned). Gateway only validates tokens. |
| **Real-Time Analytics in Gateway** | "Show live dashboards of messages" | Analytics adds CPU/memory overhead. Gateway should route, not analyze. | Stream events to Kinesis/Firehose. Analyze in separate service (Lambda, EMR). |
| **Serverless Gateway (Lambda)** | "Why not use Lambda for WebSocket?" | High-frequency pub/sub (cursor 40 updates/sec) costs $10k-20k/month with Lambda vs $60/month self-hosted. Per-invocation pricing wrong model. | Keep custom WebSocket gateway. Use Lambda for low-frequency HTTP endpoints. |

## Feature Dependencies

```
Authentication (Cognito JWT)
    └──requires──> TLS/SSL (wss://)
    └──enables──> Authorization (channel permissions)
                      └──enables──> Rate Limiting (per-user quotas)

Health Checks
    └──enables──> Load Balancing (ALB health-based routing)
                      └──enables──> Auto-Scaling (ECS target tracking)

Metrics & Monitoring
    └──enables──> Alerts (CloudWatch alarms)
                      └──enables──> Auto-Scaling (scale on metrics)

Connection State Recovery
    └──requires──> Authentication (identify returning client)
    └──requires──> State Persistence (Redis or DynamoDB)

CRDT Operations
    └──requires──> Message Ordering (per-channel)
    └──requires──> Snapshot Persistence (DynamoDB, planned)
    └──enhances──> Connection State Recovery (sync from snapshot)

Message Replay
    └──requires──> Message Persistence (Redis Streams or SQS)
    └──conflicts──> Ephemeral-Only Model (current architecture)
```

### Dependency Notes

- **Authentication before Authorization**: Can't validate channel permissions without knowing who the user is.
- **Health Checks critical for ALB**: Without /health endpoint, ALB can't detect failed nodes and will route traffic to dead instances.
- **Metrics enable Alerts and Auto-Scaling**: Cannot scale or alert without visibility into system load.
- **CRDT requires Snapshot Persistence**: Already planned in PROJECT.md as "periodic CRDT snapshots to DynamoDB every 5min."
- **Message Replay conflicts with current model**: Current architecture is ephemeral (in-memory history only). Adding replay requires architectural shift to persistent queue.

## MVP Definition

### Launch With (v1 - Production Hardening)

Minimum features needed for production deployment on AWS. Aligned with "Active" requirements in PROJECT.md.

- [ ] **Authentication** - Cognito JWT validation on WebSocket connect (closes security gap)
- [ ] **Authorization** - Channel-level permission validation (closes security gap)
- [ ] **Rate Limiting** - Per-client message/sec throttling (closes security gap)
- [ ] **TLS/SSL** - Switch from NLB to ALB for TLS termination (production requirement)
- [ ] **Health Checks** - /health endpoint for ALB (operational requirement)
- [ ] **Metrics** - CloudWatch metrics for connections, messages, errors, latency (observability requirement)
- [ ] **Alerts** - CloudWatch alarms for error rate, connection failures, high latency (operational requirement)
- [ ] **Input Validation** - Schema validation at message routing layer (security hardening)
- [ ] **Error Handling** - Standardized error codes and format (developer experience)
- [ ] **Connection Limits** - Per-IP and global connection caps (DoS protection)
- [ ] **Memory Leak Fixes** - Fix presence and chat service unbounded growth (identified bugs)
- [ ] **Redis Fallback** - Fix cursor service Redis fallback logic (identified bug)
- [ ] **ECS Fargate Deployment** - Auto-scaling container deployment (infrastructure requirement)
- [ ] **ElastiCache Redis** - Managed Redis with HA (infrastructure requirement)

**Rationale**: These features close all critical security gaps identified in CONCERNS.md and provide minimum operational capabilities for AWS production deployment.

### Add After Validation (v1.x - Enhanced Reliability)

Features to add once core is stable and initial users validate the system.

- [ ] **Connection State Recovery** - Session tokens + Redis state persistence (improves mobile UX)
- [ ] **Message Size Limits** - Enforce max payload size (additional DoS protection)
- [ ] **Structured Logging** - JSON logs with correlation IDs (improves debugging)
- [ ] **CORS Configuration** - Support web clients from different origins (expands client support)
- [ ] **Graceful Shutdown** - Improved shutdown coordination (already partially implemented, needs testing)
- [ ] **Message Compression** - Reduce bandwidth for high-frequency updates (cost optimization)
- [ ] **Dead Letter Queue** - Capture failed deliveries (debugging tool)

**Rationale**: Nice-to-have reliability and operational improvements that aren't blockers for initial launch.

### Future Consideration (v2+ - Advanced Features)

Features to defer until product-market fit is established and scale demands them.

- [ ] **CRDT Conflict Resolution** - Mentioned in PROJECT.md, but HIGH complexity. Defer until collaborative editing use case validated.
- [ ] **Message Replay** - Requires architecture change (persistent queue). Wait until users request offline sync.
- [ ] **Multi-Region Active-Active** - Only needed at significant scale (thousands of users across continents).
- [ ] **Custom Service Plugins** - Only valuable if external developers want to extend system.
- [ ] **WebRTC Signaling** - Out of scope unless video/audio features requested.
- [ ] **Geographic Routing** - Optimization for latency. Measure before building.
- [ ] **API Gateway Compatibility** - Only if REST fallback needed (most WebSocket clients don't need it).

**Rationale**: High complexity or unclear value. Build when proven necessary, not speculatively.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Phase |
|---------|------------|---------------------|----------|-------|
| Authentication | HIGH | MEDIUM | P1 | v1 |
| Authorization | HIGH | MEDIUM | P1 | v1 |
| Rate Limiting | HIGH | MEDIUM | P1 | v1 |
| TLS/SSL (ALB) | HIGH | LOW | P1 | v1 |
| Health Checks | HIGH | LOW | P1 | v1 |
| Metrics | HIGH | MEDIUM | P1 | v1 |
| Alerts | HIGH | MEDIUM | P1 | v1 |
| Memory Leak Fixes | HIGH | MEDIUM | P1 | v1 |
| Redis Fallback Fix | MEDIUM | LOW | P1 | v1 |
| Input Validation | HIGH | LOW | P1 | v1 |
| Error Handling | MEDIUM | LOW | P1 | v1 |
| Connection Limits | HIGH | LOW | P1 | v1 |
| ECS Deployment | HIGH | MEDIUM | P1 | v1 |
| ElastiCache Redis | HIGH | LOW | P1 | v1 |
| Connection State Recovery | MEDIUM | HIGH | P2 | v1.x |
| Message Size Limits | MEDIUM | LOW | P2 | v1.x |
| Structured Logging | MEDIUM | LOW | P2 | v1.x |
| CORS | MEDIUM | LOW | P2 | v1.x |
| Message Compression | LOW | LOW | P2 | v1.x |
| Dead Letter Queue | LOW | MEDIUM | P2 | v1.x |
| CRDT Operations | HIGH | HIGH | P3 | v2+ |
| Message Replay | MEDIUM | HIGH | P3 | v2+ |
| Multi-Region | LOW | HIGH | P3 | v2+ |
| Custom Plugins | LOW | MEDIUM | P3 | v2+ |
| WebRTC Signaling | LOW | MEDIUM | P3 | v2+ |

**Priority key:**
- **P1**: Must have for production launch (security, monitoring, infrastructure)
- **P2**: Should have for better UX and ops, add incrementally
- **P3**: Nice to have, defer until validated need

## Security Features (Prioritized Given Current Gaps)

Based on CONCERNS.md security audit, these gaps must be closed for production:

### Critical (Block Production Launch)

1. **Authentication (Cognito JWT)**
   - Validate JWT on WebSocket connect handshake
   - Reject connections without valid token
   - Extract user identity from JWT claims
   - **Complexity**: MEDIUM (integration with Cognito, token validation logic)
   - **Dependencies**: Cognito user pool (can use existing or create new)

2. **Authorization (Channel Permissions)**
   - Validate user can subscribe to requested channel
   - Validate user can publish to channel
   - Permission model: channel name patterns (e.g., `user:123:*` only accessible by user 123)
   - **Complexity**: MEDIUM (permission logic, claim validation)
   - **Dependencies**: Authentication (need user identity)

3. **Rate Limiting (Per-Client)**
   - Track messages per second per client
   - Reject messages exceeding threshold (e.g., 100 msg/sec)
   - Throttle or disconnect abusive clients
   - **Complexity**: MEDIUM (token bucket algorithm, per-client state)
   - **Dependencies**: Client identification (via clientId or JWT sub claim)

4. **Input Validation (Schema Validation)**
   - Validate message structure before routing (JSON schema)
   - Validate field types, lengths, required fields
   - Reject malformed messages with clear error
   - **Complexity**: LOW (use ajv or joi library)
   - **Dependencies**: None

5. **TLS/SSL (ALB Termination)**
   - Switch from NLB to ALB
   - ALB terminates TLS, forwards plain TCP to ECS
   - Enforce wss:// only, reject ws://
   - **Complexity**: LOW (CDK infrastructure change)
   - **Dependencies**: ACM certificate for domain

### Important (Add Soon After Launch)

6. **Connection Limits (DoS Protection)**
   - Max connections per IP address (e.g., 10 connections)
   - Global max connections (scale limit)
   - Reject new connections when limit reached
   - **Complexity**: LOW (counter in Redis)

7. **Message Size Limits**
   - Max message size (e.g., 64KB)
   - Reject oversized messages
   - **Complexity**: LOW (check payload length)

8. **Redis Authentication**
   - ElastiCache with AUTH token
   - TLS for Redis connections
   - **Complexity**: LOW (CDK config + connection string)

9. **ClientId Security**
   - Use crypto.randomUUID() instead of Date.now() + randomBytes
   - Make clientId unpredictable
   - **Complexity**: LOW (one-line change, identified in CONCERNS.md)

### Monitoring (Operational Security)

10. **Audit Logging**
    - Log authentication attempts (success/failure)
    - Log authorization decisions (allow/deny)
    - Log rate limit violations
    - **Complexity**: LOW (add log statements)

11. **Security Metrics**
    - CloudWatch metrics: auth failures, authz denials, rate limit hits
    - Alert on spike in failures (potential attack)
    - **Complexity**: LOW (custom metrics)

## Monitoring & Observability Features

Operational requirements for production AWS deployment:

### Metrics (CloudWatch Custom Metrics)

| Metric | Unit | Alarm Threshold | Purpose |
|--------|------|-----------------|---------|
| `websocket.connections.active` | Count | < 1 (alert if zero) | Ensure service is accepting connections |
| `websocket.connections.total` | Count | > 10000 (capacity) | Track scale, trigger auto-scaling |
| `websocket.messages.received` | Count/Second | Baseline deviation | Detect traffic anomalies |
| `websocket.messages.sent` | Count/Second | Baseline deviation | Detect broadcast storms |
| `websocket.errors.rate` | Count/Second | > 10/sec | Detect systemic failures |
| `websocket.latency.p99` | Milliseconds | > 100ms | Ensure <50ms target for cursor updates |
| `websocket.redis.errors` | Count | > 1 (any error) | Critical dependency failure |
| `websocket.auth.failures` | Count/Minute | > 50/min | Potential attack |
| `websocket.ratelimit.hits` | Count/Minute | > 100/min | Abuse or misconfigured client |
| `service.chat.messages` | Count/Second | - | Business metric |
| `service.presence.heartbeats` | Count/Second | - | Business metric |
| `service.cursor.updates` | Count/Second | > 1000/sec (expected) | Validate high-frequency use case |

### Logs (CloudWatch Logs)

**Log Groups:**
- `/aws/ecs/websocket-gateway/application` - Application logs
- `/aws/ecs/websocket-gateway/errors` - Error-level only
- `/aws/ecs/websocket-gateway/audit` - Security events (auth/authz)

**Log Format:**
- Structured JSON for queryability
- Fields: timestamp, level, service, nodeId, clientId, action, message, metadata
- Correlation IDs for tracing requests across services

### Dashboards (CloudWatch Dashboard)

**System Health Dashboard:**
- Active connections (gauge)
- Message throughput (line chart)
- Error rate (line chart)
- P50/P99 latency (line chart)
- Redis connection status (binary indicator)

**Service-Specific Dashboard:**
- Chat messages/sec
- Presence heartbeats/sec
- Cursor updates/sec
- Reaction events/sec

### Alarms (CloudWatch Alarms)

**Critical (Page On-Call):**
- No active connections for > 5 minutes
- Error rate > 10/sec for > 2 minutes
- Redis connection failures

**Warning (Slack Notification):**
- P99 latency > 100ms for > 5 minutes
- Auth failure rate > 50/min for > 2 minutes
- Rate limit hits > 100/min for > 5 minutes

**Info (Email):**
- Approaching connection capacity (> 8000 connections)

## Reliability & Resilience Features

### Current State (Partial Implementation)

**Existing:**
- Redis retry with exponential backoff (5 attempts, server.js lines 84-143)
- Graceful shutdown on SIGTERM/SIGINT (closes connections, deregisters node)
- Distributed architecture (multi-node, no single point of failure)
- Channel subscription cleanup on disconnect

**Gaps:**
- Redis fallback incomplete (cursor service bug, CONCERNS.md line 45-49)
- Memory leaks in presence/chat (unbounded Maps, CONCERNS.md)
- No connection recovery (new clientId on reconnect, CONCERNS.md line 230-234)

### Required Improvements (v1)

1. **Fix Redis Fallback Logic**
   - Cursor service: use local storage when Redis fails, query local storage on read
   - Test: simulate Redis failure mid-operation
   - **Complexity**: LOW (identified bug fix)

2. **Fix Memory Leaks**
   - Presence service: add TTL to clientPresence Map, remove on timeout
   - Chat service: add channel TTL, evict stale history
   - **Complexity**: MEDIUM (refactor cleanup logic)

3. **Health Check Endpoint**
   - HTTP GET /health returns 200 if server ready
   - Check: WebSocket server running, Redis connected
   - ALB uses this for target health
   - **Complexity**: LOW (simple HTTP handler)

4. **Circuit Breaker for Redis**
   - If Redis fails repeatedly, stop retrying for cooldown period
   - Prevents cascading failures
   - **Complexity**: MEDIUM (circuit breaker pattern)

### Future Enhancements (v1.x)

5. **Connection State Recovery**
   - Client includes session token in reconnect
   - Server resumes session (same clientId, channel subscriptions)
   - Replay missed messages from buffer
   - **Complexity**: HIGH (state persistence, replay logic)

6. **Message Buffering**
   - Buffer messages when client temporarily disconnected
   - Deliver on reconnect (within time window)
   - **Complexity**: MEDIUM (requires persistent queue)

7. **Multi-AZ Deployment**
   - ECS tasks across multiple AZs
   - ElastiCache Multi-AZ with automatic failover
   - **Complexity**: LOW (CDK configuration)

8. **Auto-Scaling**
   - ECS target tracking on CPU/memory or custom metric (connections)
   - Scale out when connections > 80% capacity
   - Scale in when connections < 30% capacity
   - **Complexity**: LOW (CDK auto-scaling config)

## Operational Features (AWS Integration)

### Deployment

- **Infrastructure as Code**: CDK stacks (already implemented, needs updates for ALB)
- **Container Deployment**: ECS Fargate (planned, PROJECT.md)
- **Blue/Green Deployments**: ECS deployment circuit breaker
- **Rollback**: Automatic rollback on health check failures

### Cost Management

- **ElastiCache**: cache.t3.micro (~$12/month) sufficient for < 10k connections
- **ECS Fargate**: 0.25 vCPU, 0.5 GB RAM per task (~$10/month per task)
- **ALB**: $16/month base + $0.008/LCU-hour (depends on traffic)
- **Data Transfer**: $0.09/GB out (cursor updates: ~1GB/month per 100 active users)
- **Target**: $100-150/month total (PROJECT.md constraint)

### Compliance & Governance

- **CloudTrail**: Log all infrastructure changes
- **VPC**: Private subnets for ECS, security groups for Redis
- **IAM**: Least-privilege task roles
- **Secrets Manager**: Store Redis AUTH token (if needed)

## Competitor Feature Analysis

Since web search unavailable, analysis based on industry knowledge of production WebSocket systems:

| Feature | Pusher (SaaS) | Ably (SaaS) | Socket.IO (OSS) | Our Approach |
|---------|---------------|-------------|-----------------|--------------|
| Authentication | API keys, JWT | Token auth | Custom hooks | Cognito JWT (AWS-native) |
| Authorization | Channel permissions | Capability tokens | Middleware | Channel name patterns |
| Rate Limiting | Per-connection | Per-account | None (DIY) | Per-client token bucket |
| Message Persistence | 24h history | Message history API | Redis adapter | AWS IVS for chat (offload) |
| Presence | Built-in | Presence API | Built-in | Custom (already implemented) |
| Auto-Scaling | Managed (SaaS) | Managed (SaaS) | Manual | ECS auto-scaling |
| Monitoring | Dashboard | Dashboard | Prometheus/Grafana | CloudWatch native |
| Pricing Model | Per-connection + messages | Per-message | Self-hosted (free) | Self-hosted ($100-150/month) |
| Multi-Region | Global (automatic) | Global (automatic) | Manual | Single-region (v1), multi-region (v2+) |
| Connection Recovery | Automatic | Automatic | Built-in | Manual (v1.x) |
| WebRTC Support | No | No | No | Not planned |

**Differentiator vs SaaS:** Cost. Pusher/Ably charge per-message, making high-frequency cursor updates (40/sec) prohibitively expensive ($10k-20k/month). Our self-hosted approach: $100-150/month.

**Trade-off:** SaaS providers handle ops (scaling, monitoring, global deployments). We build that ourselves, but gain cost control and customization.

## Sources

### Project Context (HIGH Confidence)
- `.planning/PROJECT.md` - Project requirements and constraints
- `.planning/codebase/CONCERNS.md` - Security gaps and known bugs
- `.planning/codebase/ARCHITECTURE.md` - Current system architecture
- `README.md` - Existing features and deployment

### Industry Knowledge (MEDIUM Confidence)
- WebSocket security best practices: JWT authentication, TLS, rate limiting (standard industry practices)
- AWS production deployment patterns: health checks, CloudWatch metrics, ALB, ECS Fargate (AWS Well-Architected Framework)
- Distributed systems patterns: circuit breakers, graceful degradation, retry with backoff (standard patterns)
- SaaS WebSocket pricing: Pusher, Ably pricing models (public pricing pages, 2024-2025 data)

### Limitations
- No web search available to verify 2026 current best practices
- Competitor analysis based on 2024-2025 knowledge (may be outdated)
- CloudWatch metrics/alarms based on AWS documentation (as of 2025 knowledge cutoff)
- CRDT libraries (Yjs, Automerge) based on 2024 ecosystem

**Note**: Given security gaps identified in CONCERNS.md, prioritization heavily favors security and operational features for v1. Advanced collaboration features (CRDT, multi-region) deferred to v2+ until production stability proven.

---
*Feature research for: Production WebSocket Collaboration Gateway*
*Researched: 2026-03-02*
