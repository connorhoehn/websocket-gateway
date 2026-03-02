# Requirements: WebSocket Gateway - AWS Migration & Hardening

**Defined:** 2026-03-02
**Core Value:** Provide low-cost, high-frequency pub/sub (<50ms latency) for ephemeral real-time collaboration data

## v1 Requirements

Requirements for production-ready AWS deployment. Each maps to roadmap phases.

### Security (Critical - Blocks Production)

- [x] **SEC-01**: User authentication via Cognito JWT validation on WebSocket connect
- [x] **SEC-02**: Channel-level authorization (verify user can subscribe to requested channel)
- [x] **SEC-03**: Per-client rate limiting (100 msgs/sec general, 40/sec for cursor updates)
- [x] **SEC-04**: Input validation and schema validation at message routing layer
- [ ] **SEC-05**: TLS/SSL termination for wss:// connections (via ALB)
- [x] **SEC-06**: Message size limits to prevent memory exhaustion
- [x] **SEC-07**: Connection limits (per-IP and global) to prevent connection floods
- [x] **SEC-08**: CORS configuration for cross-origin WebSocket connections

### AWS Infrastructure Deployment

- [x] **INFRA-01**: Deploy WebSocket server to ECS Fargate with Docker containers
- [ ] **INFRA-02**: Configure Application Load Balancer with sticky sessions and 300s idle timeout
- [x] **INFRA-03**: Migrate to ElastiCache Redis (Multi-AZ, automatic failover)
- [ ] **INFRA-04**: Set up VPC with isolated subnets and VPC endpoints (no NAT gateway)
- [ ] **INFRA-05**: Configure ECS auto-scaling based on connection count (5000/task threshold)
- [ ] **INFRA-06**: Implement graceful shutdown and connection draining (30s deregistration delay)
- [ ] **INFRA-07**: Add health check HTTP endpoint for ALB routing
- [ ] **INFRA-08**: Configure server-side ping/pong to keep connections alive

### Monitoring & Observability

- [ ] **MON-01**: Emit CloudWatch custom metrics (connection count, messages/sec, latency)
- [ ] **MON-02**: Configure structured logging with JSON format and correlation IDs
- [ ] **MON-03**: Set up CloudWatch alarms for critical metrics (error rate, memory, connections)
- [ ] **MON-04**: Create CloudWatch dashboard for real-time system visibility
- [ ] **MON-05**: Add error codes and standardized error response format

### Reliability & Resilience

- [x] **REL-01**: Fix memory leak in presence service (unbounded clientPresence Map growth)
- [x] **REL-02**: Fix memory leak in chat service (no TTL on channelHistory Map)
- [x] **REL-03**: Fix cursor service Redis fallback logic (queries only Redis, not local storage)
- [ ] **REL-04**: Implement graceful Redis degradation (local cache during outage)
- [ ] **REL-05**: Add connection state recovery (session token + reconnection with same clientId)

### Persistent State (CRDT Support)

- [ ] **PERSIST-01**: Add DynamoDB table for CRDT snapshots with TTL
- [ ] **PERSIST-02**: Implement CRDT operation broadcasting via existing Redis pub/sub
- [ ] **PERSIST-03**: Implement periodic CRDT snapshot writes to DynamoDB (every 5 minutes)
- [ ] **PERSIST-04**: Add CRDT snapshot retrieval on client reconnection

### AWS IVS Chat Integration (Optional)

- [ ] **IVS-01**: Integrate AWS IVS Chat service for persistent chat with moderation
- [ ] **IVS-02**: Configure IVS Chat webhooks for message events
- [ ] **IVS-03**: Migrate chat persistence from in-memory to IVS backend

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Collaboration

- **COLLAB-01**: Message replay (clients request message history after reconnect)
- **COLLAB-02**: Presence enrichment (typing indicators, custom status, away detection)
- **COLLAB-03**: Cursor replay (show historical cursor trails)
- **COLLAB-04**: Message compression (gzip/brotli for high-frequency updates)

### Advanced Scaling

- **SCALE-01**: Multi-region active-active deployment with cross-region Redis replication
- **SCALE-02**: Geographic routing (Route 53 latency-based DNS)
- **SCALE-03**: Dead letter queue for failed message deliveries
- **SCALE-04**: Custom service plugin system (dynamic service loading)

### Developer Experience

- **DEV-01**: WebRTC signaling support for P2P video/audio
- **DEV-02**: Client SDK with auto-reporting of connection quality metrics
- **DEV-03**: API Gateway HTTP REST fallback for non-realtime operations

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Lambda/AppSync for cursor updates | Per-message pricing costs $10k-20k/month vs $60/month self-hosted at scale |
| AWS IoT Core for pub/sub | $1/million messages = $10k/month vs unlimited Redis pub/sub for $82/month |
| Message persistence in WebSocket gateway | Mixing concerns; use dedicated services (IVS for chat, DynamoDB for snapshots) |
| Exactly-once delivery guarantees | Requires distributed transactions; massive complexity for marginal benefit |
| Complex authentication logic in gateway | Auth belongs in separate service; gateway only validates JWT claims |
| User management in gateway | Don't rebuild Cognito; use managed service for users |
| Real-time analytics in gateway | Analytics adds overhead; stream to Kinesis/Firehose for separate processing |
| Mobile native apps | Web-first; mobile apps deferred to v2+ |
| EC2 instance management | Use ECS Fargate for Docker consistency and no instance ops |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 2 | Pending |
| SEC-06 | Phase 1 | Complete |
| SEC-07 | Phase 1 | Complete |
| SEC-08 | Phase 1 | Complete |
| INFRA-01 | Phase 2 | Complete |
| INFRA-02 | Phase 2 | Pending |
| INFRA-03 | Phase 2 | Complete |
| INFRA-04 | Phase 2 | Pending |
| INFRA-05 | Phase 2 | Pending |
| INFRA-06 | Phase 2 | Pending |
| INFRA-07 | Phase 2 | Pending |
| INFRA-08 | Phase 2 | Pending |
| MON-01 | Phase 3 | Pending |
| MON-02 | Phase 3 | Pending |
| MON-03 | Phase 3 | Pending |
| MON-04 | Phase 3 | Pending |
| MON-05 | Phase 3 | Pending |
| REL-01 | Phase 1 | Complete |
| REL-02 | Phase 1 | Complete |
| REL-03 | Phase 1 | Complete |
| REL-04 | Phase 5 | Pending |
| REL-05 | Phase 5 | Pending |
| PERSIST-01 | Phase 4 | Pending |
| PERSIST-02 | Phase 4 | Pending |
| PERSIST-03 | Phase 4 | Pending |
| PERSIST-04 | Phase 4 | Pending |
| IVS-01 | Phase 5 | Pending (Optional) |
| IVS-02 | Phase 5 | Pending (Optional) |
| IVS-03 | Phase 5 | Pending (Optional) |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31/31
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after roadmap creation*
