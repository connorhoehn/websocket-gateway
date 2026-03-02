# Architecture Research: AWS WebSocket Gateway Deployment

**Domain:** Real-time WebSocket gateway for collaborative features
**Researched:** 2026-03-02
**Confidence:** MEDIUM (Based on AWS architectural patterns, existing CDK infrastructure, and domain expertise)

## Recommended Production Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                         Internet / Clients                          │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ WSS (TLS termination)
                       ↓
┌────────────────────────────────────────────────────────────────────┐
│           Application Load Balancer (WebSocket-aware)               │
│  • Sticky sessions (required for WebSocket affinity)                │
│  • Health checks on HTTP /health endpoint                           │
│  • Connection draining (graceful shutdown support)                  │
│  • TLS/SSL certificate management                                   │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ Target group routing
                       ↓
┌────────────────────────────────────────────────────────────────────┐
│                    ECS Fargate (WebSocket Nodes)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   Node 1    │  │   Node 2    │  │   Node 3    │  (auto-scaling)│
│  │             │  │             │  │             │                 │
│  │ • Connect   │  │ • Connect   │  │ • Connect   │                 │
│  │ • Auth      │  │ • Auth      │  │ • Auth      │                 │
│  │ • Services  │  │ • Services  │  │ • Services  │                 │
│  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘                │
│        │                 │                 │                        │
│        └─────────────────┴─────────────────┘                        │
└───────────────────────┬─┬───────────────┬─────────────────────────┘
                        │ │               │
        ┌───────────────┘ │               └──────────────────┐
        │                 │                                   │
        ↓                 ↓                                   ↓
┌──────────────┐  ┌─────────────────┐          ┌────────────────────┐
│ElastiCache   │  │   Cognito       │          │    DynamoDB        │
│Redis Cluster │  │   User Pools    │          │                    │
│              │  │                 │          │ • CRDT snapshots   │
│• Pub/Sub     │  │ • JWT auth      │          │ • Presence state   │
│• Node coord  │  │ • Token refresh │          │ • Chat history     │
│• Ephemeral   │  │                 │          │                    │
└──────────────┘  └─────────────────┘          └────────────────────┘
        ↑                                                ↑
        │                                                │
        └───────────────────────┐       ┌───────────────┘
                                │       │
                        ┌───────┴───────┴────────┐
                        │   AWS IVS Chat         │
                        │   (Optional)           │
                        │                        │
                        │ • Persistent chat      │
                        │ • Moderation           │
                        │ • Chat replays         │
                        └────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation | AWS Service Mapping |
|-----------|----------------|------------------------|---------------------|
| **Load Balancer** | WebSocket connection termination, TLS, sticky routing | ALB with target_type=ip, stickiness enabled | Application Load Balancer |
| **WebSocket Nodes** | Connection handling, auth validation, message routing | Node.js containers (existing src/server.js) | ECS Fargate tasks |
| **Node Manager** | Node discovery, heartbeat, graceful shutdown | Existing src/core/node-manager.js | Application code |
| **Message Router** | Pub/sub routing, inter-node communication | Existing src/core/message-router.js | Application code |
| **Redis Cluster** | Pub/sub channels, node coordination, ephemeral state | ElastiCache Redis (cluster mode disabled) | ElastiCache for Redis |
| **Auth Provider** | JWT token validation, user identity | Cognito User Pools integration | Amazon Cognito |
| **CRDT Store** | Periodic snapshots of CRDT state | DynamoDB with TTL for cleanup | DynamoDB |
| **Chat Persistence** | Optional persistent chat with moderation | IVS Chat API integration | Amazon IVS |
| **Monitoring** | Metrics, logs, alarms | CloudWatch integration | CloudWatch |

## Detailed Architecture

### 1. Load Balancing Layer

**Application Load Balancer (ALB) for WebSocket**

The existing CDK code uses a **Network Load Balancer (NLB)** (see lib/fargate-service.ts), but for production WebSocket deployments with authentication and health checks, an **Application Load Balancer (ALB)** is recommended.

**Key ALB Configuration for WebSocket:**
- **Sticky sessions (session affinity)**: Required - WebSocket connections must route to the same target
  - Use `stickiness.enabled = true` with `stickiness.duration` of 1 day (86400 seconds)
  - Cookie-based stickiness (`lb_cookie`) works for initial HTTP upgrade
- **Idle timeout**: Set to maximum (4000 seconds / ~66 minutes) to support long-lived connections
- **Health checks**: HTTP endpoint (e.g., `/health`) not WebSocket upgrade attempts
- **Target type**: `ip` mode for Fargate awsvpc networking
- **Connection draining**: Enable with 300-second timeout for graceful shutdown

**Why ALB over NLB:**
- ALB supports WebSocket upgrade from HTTP/1.1 (existing NLB works but ALB is more feature-rich)
- ALB provides application-layer health checks and request routing
- ALB integrates with WAF for DDoS protection and rate limiting
- NLB is Layer 4 (TCP) - simpler but less control. Current setup works but lacks application insights.

**Current State:** CDK uses NLB (lib/fargate-service.ts line 75-88). This works for basic WebSocket but lacks sticky session configuration and health check sophistication.

**Recommendation:** Migrate to ALB or enhance NLB configuration with stickiness at target group level.

**Confidence:** HIGH (WebSocket ALB support is well-documented AWS pattern)

---

### 2. Compute Layer (ECS Fargate)

**WebSocket Node Architecture**

Each Fargate task runs the existing Node.js WebSocket server (src/server.js) with:
- **Task CPU/Memory**: Start with 0.5 vCPU / 1 GB, scale based on connection count
- **Connections per task**: Target 5,000-10,000 concurrent connections per task (Node.js can handle this)
- **Task networking**: awsvpc mode (required for Fargate)
- **Security groups**: Allow inbound 8080 from ALB, outbound 6379 to Redis, 443 to AWS APIs

**Auto-Scaling Strategy:**
- **Primary metric**: Custom CloudWatch metric for active WebSocket connections
  - Each node publishes connection count to CloudWatch every 60 seconds
  - Target: 7,000 connections per task (70% of 10K capacity)
- **Secondary metric**: CPU utilization (target: 70%)
- **Scale-out**: Fast (30 second cooldown) - add capacity quickly for spikes
- **Scale-in**: Slow (300 second cooldown + connection draining) - avoid disconnecting users

**Graceful Shutdown:**
Existing code handles SIGTERM (src/server.js lines 234-259). ECS Fargate sends SIGTERM on scale-in/deploy:
1. Stop accepting new connections
2. Send close message to existing clients (code 1001 "going away")
3. Wait for clients to disconnect (max 30 seconds)
4. Deregister from Redis
5. Exit process

**Connection Draining:**
- ALB draining: 300 seconds (5 minutes) - gives clients time to reconnect
- ECS stop timeout: 120 seconds (2 minutes) - Fargate waits before SIGKILL

**Current State:** CDK defines task with 0.5 vCPU / 1 GB (lib/task-definition.ts). Runs in isolated subnets (lib/fargate-service.ts line 69-71). Graceful shutdown implemented in application code.

**Recommendation:** Add auto-scaling policies based on custom connection count metric. Implement CloudWatch metric publishing in src/server.js.

**Confidence:** HIGH (ECS Fargate WebSocket patterns are well-established)

---

### 3. State Management Layer

#### ElastiCache Redis (Pub/Sub and Coordination)

**Current Configuration (lib/redis.ts):**
- **Node type**: cache.t3.micro (minimal - good for dev/test)
- **Replication**: 1 primary + 1 replica (automaticFailoverEnabled: true)
- **Cluster mode**: Disabled (numNodeGroups: 1)
- **Engine**: Redis 7.x (implicit from CDK)

**Production Recommendations:**
- **Node type**: cache.r7g.large (13.07 GB memory, $0.226/hour = ~$164/month)
  - Need memory for connection tracking (10K connections × 3 nodes × metadata = ~50 MB)
  - Pub/sub uses memory for message queues (ephemeral, but need headroom)
- **Replication**: 1 primary + 2 replicas (better HA, read scaling)
- **Cluster mode**: Keep disabled - pub/sub works better in non-cluster mode
  - Cluster mode requires clients to handle redirects (MOVED/ASK responses)
  - Pub/sub in cluster mode has limitations (messages published to specific shards)
  - Current application assumes single Redis endpoint (src/core/node-manager.js)
- **Backup**: Automatic backups disabled (all data is ephemeral - node registrations, pub/sub)
- **Multi-AZ**: Enabled (automatic with replication)

**Redis Data Patterns:**
```
websocket:nodes                          # SET of active node IDs (for discovery)
websocket:node:{nodeId}:info             # HASH of node metadata (ip, port, started_at)
websocket:node:{nodeId}:heartbeat        # STRING timestamp (TTL 60 seconds)
websocket:client:{clientId}:node         # STRING node ID (TTL 5 minutes - cleanup)
websocket:channel:{channel}:nodes        # SET of nodes with clients on channel
websocket:channel:{channel}:clients      # SET of client IDs (local to each node)

# Pub/Sub channels (ephemeral, not stored)
websocket:route:{channel}                # Messages to all clients on channel
websocket:direct:{nodeId}                # Direct messages to specific node
```

**Pub/Sub Performance:**
- Redis pub/sub has no message limits (not stored, immediate delivery)
- Supports millions of messages/second on r7g.large instances
- Perfect for high-frequency cursor updates (25-50ms = 20-40 messages/sec per user)

**Failover Behavior:**
- Automatic failover: 30-60 seconds to promote replica to primary
- Existing application code handles Redis disconnection (src/server.js lines 84-143)
- Falls back to standalone mode (local-only message delivery)

**Current State:** Redis configured but not required (ENABLE_REDIS env var, lib/websocket-gateway-stack.ts line 16-22). Cluster mode disabled, minimal instance size.

**Recommendation:** Production deploy needs larger instance (r7g.large), keep cluster mode disabled, use existing replication group configuration.

**Confidence:** HIGH (ElastiCache Redis pub/sub patterns are well-understood)

---

#### DynamoDB (Persistent State)

**Use Cases in This Architecture:**
1. **CRDT Snapshots**: Periodic save points for collaborative document state (every 5 minutes)
2. **Chat History**: Optional persistence if not using IVS Chat
3. **Presence State**: Optional long-term presence logs for analytics

**Recommended Schema:**

**Table 1: CRDT Snapshots**
```
TableName: crdt-snapshots
PartitionKey: documentId (String)
SortKey: timestamp (Number) - Unix timestamp in milliseconds
Attributes:
  - documentId: String (partition key)
  - timestamp: Number (sort key)
  - snapshotData: Binary (compressed CRDT state)
  - nodeId: String (which node created snapshot)
  - version: Number (CRDT version/vector clock)
  - ttl: Number (expire after 30 days)
GSI: None needed for simple retrieval
Capacity: On-demand (unpredictable snapshot writes)
TTL: Enabled on 'ttl' attribute
```

**Table 2: Chat History (if not using IVS)**
```
TableName: chat-messages
PartitionKey: channelId (String)
SortKey: messageId (String) - ULID or timestamp-based
Attributes:
  - channelId: String
  - messageId: String
  - userId: String
  - content: String
  - timestamp: Number
  - messageType: String (text, reaction, system)
  - ttl: Number (expire after 90 days)
GSI: userId-timestamp-index (for user message history)
Capacity: On-demand
TTL: Enabled
```

**Table 3: Presence Events (Analytics)**
```
TableName: presence-events
PartitionKey: date (String) - YYYY-MM-DD
SortKey: eventId (String) - timestamp#userId
Attributes:
  - date: String (partition key)
  - eventId: String (sort key)
  - userId: String
  - channelId: String
  - event: String (join, leave, online, away)
  - timestamp: Number
  - ttl: Number (expire after 30 days)
Capacity: On-demand
TTL: Enabled
```

**Cost Estimation:**
- CRDT snapshots: 5-minute intervals × 100 documents = ~30K writes/day = $0.04/day = $1.20/month
- Chat messages: 1M messages/month × $1.25 per million writes = $1.25/month
- Storage: 1 GB stored (assuming 1KB per message × 1M messages) = $0.25/month
- **Total DynamoDB**: ~$3-5/month

**Current State:** No DynamoDB tables defined in CDK yet. Chat service has in-memory history (src/services/chat-service.js lines 91-113).

**Recommendation:** Add DynamoDB tables for CRDT snapshots and optional chat persistence. Implement periodic snapshot writes in cursor/CRDT service.

**Confidence:** MEDIUM (DynamoDB patterns are standard, but CRDT snapshot frequency is application-specific)

---

### 4. Authentication & Authorization Layer

**Amazon Cognito Integration**

**Current State:** No authentication (PROJECT.md line 28 identifies this as critical security gap).

**Recommended Integration Pattern:**

**WebSocket Connection Auth:**
```javascript
// Client-side: Include JWT in WebSocket connection
const token = await auth.getIdToken(); // From Cognito SDK
const ws = new WebSocket(`wss://api.example.com?token=${token}`);
```

**Server-side validation (add to src/server.js):**
```javascript
// On WebSocket upgrade request
const url = new URL(request.url, 'ws://localhost');
const token = url.searchParams.get('token');

// Validate JWT token
const decoded = await validateCognitoToken(token);
// decoded contains: sub (user ID), email, custom claims

// Store user context with connection
client.userId = decoded.sub;
client.email = decoded.email;
```

**Cognito Configuration:**
- **User Pool**: Standard user pool with email/password or social providers
- **App Client**: Generate client ID/secret for application
- **JWT expiration**: 1 hour (access token), 30 days (refresh token)
- **Custom attributes**: Add tenantId, permissions as custom claims (for multi-tenancy)

**Token Validation:**
- Download Cognito JWKS (JSON Web Key Set) on server startup
- Cache JWKS for 24 hours (refresh periodically)
- Verify JWT signature, issuer, audience, expiration
- Library: Use `jsonwebtoken` npm package or AWS SDK

**Rate Limiting (Additional Security):**
After auth, implement per-user rate limits:
- Track message count per user per minute (in-memory Map)
- Limit: 100 messages/minute per user (prevents spam/abuse)
- Return error message if exceeded, don't disconnect (graceful degradation)

**Current State:** No auth implemented. Client IP tracked (src/server.js line 177) but not validated.

**Recommendation:** Implement Cognito JWT validation on WebSocket connect. Add rate limiting per userId after auth.

**Confidence:** HIGH (Cognito JWT validation is well-documented pattern)

---

### 5. Optional: AWS IVS Chat Integration

**What is AWS IVS Chat?**
- Managed chat service designed for live video streams
- Provides persistent message history, moderation, and chat replay
- REST API and WebSocket interface
- Pricing: $0.10 per 1000 messages + $0.20 per 1000 connections/hour

**Integration Pattern:**
- Use custom WebSocket gateway for ephemeral features (cursor, presence, reactions)
- Use IVS Chat for persistent chat features
- Route chat messages from custom gateway to IVS Chat API
- Clients connect to both: custom WebSocket (cursor/presence) + IVS Chat WebSocket (chat)

**When to Use IVS Chat:**
- Need message moderation features (profanity filters, banned users)
- Need chat replay for archived video streams
- Need compliance/audit logs for chat messages
- Budget allows ($20-50/month for moderate usage)

**When NOT to Use IVS Chat:**
- Chat is ephemeral (no replay needed)
- Low message volume (< 10K messages/day) - DynamoDB cheaper
- Budget-constrained (IVS adds $20-50/month minimum)

**Current State:** Not implemented. Chat service is custom (src/services/chat-service.js).

**Recommendation:** Evaluate IVS Chat if moderation or replay features are needed. Otherwise, DynamoDB persistence is sufficient and cheaper.

**Confidence:** MEDIUM (IVS Chat is documented, but integration complexity is application-specific)

---

## Data Flow Patterns

### Connection Flow

```
1. Client connects to ALB
   ↓
2. ALB routes to ECS Fargate task (sticky session)
   ↓
3. HTTP upgrade to WebSocket
   ↓
4. Server validates Cognito JWT token
   ↓ (if valid)
5. NodeManager registers clientId → nodeId in Redis
   ↓
6. MessageRouter adds client to localClients Map
   ↓
7. Send welcome message to client
   { type: "welcome", nodeId: "abc123", services: ["chat", "presence", "cursor"] }
```

### Message Broadcast Flow (Channel)

```
1. Client sends: { service: "chat", action: "send", channel: "lobby", message: "Hello" }
   ↓
2. Server routes to ChatService.handleAction()
   ↓
3. ChatService validates and creates message object
   ↓
4. ChatService calls MessageRouter.sendToChannel("lobby", messageData)
   ↓
5. MessageRouter queries NodeManager.getNodesForChannel("lobby")
   ↓ (returns [node1, node2, node3])
6. MessageRouter publishes to Redis: PUBLISH websocket:route:lobby {messageData}
   ↓
7. All nodes subscribed to redis:websocket:route:lobby receive message
   ↓
8. Each node's handleChannelMessage() checks if it has local clients on "lobby"
   ↓ (if yes)
9. MessageRouter.broadcastToLocalChannel() sends to each WebSocket client
   ↓
10. Client receives: { service: "chat", action: "message", channel: "lobby", ... }
```

### CRDT Snapshot Flow (Periodic)

```
1. Timer triggers every 5 minutes (in cursor/CRDT service)
   ↓
2. Service checks if CRDT has changes since last snapshot
   ↓ (if yes)
3. Serialize CRDT state to binary format (compress with zstd/gzip)
   ↓
4. Write to DynamoDB:
   PutItem({
     TableName: "crdt-snapshots",
     Item: {
       documentId: "doc-123",
       timestamp: Date.now(),
       snapshotData: compressedBinary,
       version: crdtVersion,
       ttl: Date.now() + 30days
     }
   })
   ↓
5. Log snapshot creation (CloudWatch Logs)
   ↓
6. Clean up old snapshots (DynamoDB TTL handles automatically)
```

### Failover Flow (Node Failure)

```
1. Node crashes or loses Redis connection
   ↓
2. Redis heartbeat expires (60 seconds)
   ↓
3. Other nodes detect missing heartbeat
   ↓
4. NodeManager removes failed node from active nodes set
   ↓
5. Client WebSocket connections on failed node disconnect
   ↓
6. Clients auto-reconnect to ALB (sticky session assigns to new node)
   ↓
7. New node registers client → nodeId mapping
   ↓
8. Client rejoins channels (sends rejoin messages)
   ↓
9. Service state reconstructed from Redis/DynamoDB
```

---

## Scaling Considerations

### Horizontal Scaling

| Scale | Architecture Adjustments | Cost Estimate |
|-------|--------------------------|---------------|
| **0-1K users** | 1 Fargate task (0.5 vCPU / 1 GB), cache.t3.micro Redis | $30-40/month |
| **1K-10K users** | 2-3 Fargate tasks, cache.r7g.large Redis, DynamoDB on-demand | $100-150/month (target) |
| **10K-100K users** | 5-10 Fargate tasks, cache.r7g.xlarge Redis, consider DynamoDB provisioned capacity | $300-500/month |
| **100K+ users** | 10+ Fargate tasks, cache.r7g.2xlarge Redis cluster, Application Auto Scaling aggressive | $1,000+/month |

### Scaling Priorities (What Breaks First)

**First Bottleneck: WebSocket Connection Capacity (10K connections)**
- **Symptom**: New connections rejected, tasks at max CPU
- **Solution**: Scale out Fargate tasks (target: 7K connections per task)
- **Metric**: Custom CloudWatch metric for active connections per task
- **Auto-scaling**: Add 1 task when avg connections > 7K, remove when < 5K

**Second Bottleneck: Redis Pub/Sub Throughput (1M messages/second)**
- **Symptom**: Message delivery latency increases, Redis CPU high
- **Solution**: Scale up Redis instance size (r7g.large → r7g.xlarge → r7g.2xlarge)
- **Metric**: Redis CPU > 70%, network throughput > 80%
- **Note**: Cannot horizontally scale pub/sub easily (cluster mode limitations)

**Third Bottleneck: ALB Connection Limits (500 connections/sec)**
- **Symptom**: Connection establishment slow, ALB throttling
- **Solution**: Pre-warm ALB (contact AWS support) or use multiple ALBs
- **Metric**: ALB TargetConnectionCount, ConnectionCount metrics

**Fourth Bottleneck: DynamoDB Write Throttling (4,000 WCU)**
- **Symptom**: CRDT snapshots failing, chat message writes rejected
- **Solution**: Switch from on-demand to provisioned capacity, increase WCU
- **Metric**: DynamoDB ThrottledRequests, ConsumedWriteCapacityUnits

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Cognito** | JWT validation on WebSocket connect | Validate token in query param or Sec-WebSocket-Protocol header |
| **IVS Chat** | Optional - REST API for message persistence | Alternative to DynamoDB for chat |
| **CloudWatch** | SDK integration for custom metrics | Publish connection count, message rate, service stats |
| **DynamoDB** | AWS SDK for snapshot writes | Use batch writes for efficiency (max 25 items) |
| **ElastiCache Redis** | ioredis client library | Existing integration (src/core/node-manager.js, message-router.js) |

### Internal Service Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Server ↔ Services** | Direct method calls (in-process) | ChatService, PresenceService, CursorService, ReactionService |
| **Server ↔ MessageRouter** | Direct method calls | sendToChannel(), sendToClient(), broadcastToLocalChannel() |
| **MessageRouter ↔ NodeManager** | Direct method calls | getNodesForChannel(), registerClient() |
| **NodeManager ↔ Redis** | ioredis pub/sub + commands | Pub: node discovery, Sub: heartbeat, commands: registration |
| **MessageRouter ↔ Redis** | ioredis pub/sub | Pub: channel messages, Sub: receive routed messages |
| **Services ↔ DynamoDB** | AWS SDK v3 | Write snapshots, chat history (async, non-blocking) |

---

## Build Order and Dependencies

### Phase 1: Infrastructure Foundation (Week 1)
**Dependencies:** None
**Deliverables:**
- Migrate CDK from NLB to ALB with sticky sessions
- Configure ALB health checks on `/health` endpoint
- Update security groups for ALB → ECS traffic
- Deploy ElastiCache Redis with r7g.large instance
- Create VPC endpoints for ECR, CloudWatch Logs (reduce NAT costs)

**Why First:** Infrastructure must exist before application changes. ALB configuration affects connection behavior.

---

### Phase 2: Authentication (Week 2)
**Dependencies:** Phase 1 (ALB deployed)
**Deliverables:**
- Create Cognito User Pool and App Client
- Implement JWT validation on WebSocket connect (src/server.js)
- Add token parsing from query param or header
- Test with Cognito test users
- Implement per-user rate limiting (100 messages/minute)

**Why Second:** Authentication gates access. Must be in place before exposing to production traffic.

---

### Phase 3: Persistent State (Week 3)
**Dependencies:** Phase 1 (infrastructure), Phase 2 (auth for user IDs)
**Deliverables:**
- Create DynamoDB tables (crdt-snapshots, chat-messages)
- Implement periodic CRDT snapshot writes (every 5 minutes)
- Add chat message persistence (optional, based on IVS decision)
- Implement DynamoDB TTL for automatic cleanup
- Add error handling for DynamoDB throttling

**Why Third:** Persistence depends on auth (user IDs). Not blocking for core WebSocket functionality.

---

### Phase 4: Monitoring and Auto-Scaling (Week 4)
**Dependencies:** Phase 1-3 (all infrastructure and core features)
**Deliverables:**
- Publish custom CloudWatch metrics (connection count, message rate)
- Create CloudWatch alarms (high CPU, Redis failover, connection threshold)
- Configure ECS auto-scaling policies (target: 7K connections per task)
- Implement CloudWatch Logs for structured logging
- Create CloudWatch dashboard for operational visibility

**Why Fourth:** Monitoring and scaling depend on stable application. Observe before optimizing.

---

### Phase 5: Memory Leak Fixes (Week 5)
**Dependencies:** Phase 4 (monitoring to validate fixes)
**Deliverables:**
- Fix presence service memory leak (unbounded Map growth)
  - Add TTL cleanup for inactive clients (5-minute timeout)
  - Implement periodic Map cleanup (every 60 seconds)
- Fix chat service memory leak (unbounded history)
  - Limit in-memory history to 100 messages per channel
  - Implement LRU eviction or circular buffer
- Fix cursor service Redis fallback logic
  - Add retry logic for Redis reconnection
  - Implement exponential backoff (5, 10, 30, 60 seconds)
- Load test to validate fixes (hold 10K connections for 24 hours)

**Why Fifth:** Memory leaks require monitoring to validate fixes. Not blocking for initial launch.

---

### Phase 6: IVS Chat Integration (Optional - Week 6)
**Dependencies:** Phase 1-5 (all core features stable)
**Deliverables:**
- Evaluate IVS Chat vs DynamoDB for persistent chat
- If IVS: Integrate REST API for message persistence
- If IVS: Configure moderation rules and banned users
- If IVS: Add chat replay functionality for archived streams
- Update client SDK to support both WebSocket endpoints

**Why Last:** Optional feature. Adds complexity and cost. Validate need with users first.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Using API Gateway WebSocket API

**What people do:** Use AWS API Gateway WebSocket API instead of self-hosted ALB + Fargate
**Why it's wrong:** API Gateway WebSocket has limits that don't fit high-frequency pub/sub:
- Connection limit: 10,000 concurrent connections per AWS account per region
- Message size: 128 KB max (compressed CRDT states may exceed this)
- Idle timeout: 10 minutes max (forces frequent reconnections)
- Cost: $1 per million messages + $0.25 per million connection minutes
  - For 10K users × 40 cursor updates/sec = 400K msg/sec = $34M/million = $1,500/hour
- Latency: API Gateway adds 10-20ms latency vs direct WebSocket

**Do this instead:** Use Application Load Balancer + ECS Fargate + self-hosted WebSocket server (existing architecture). Cost: $60-80/month for same workload.

---

### Anti-Pattern 2: Redis Cluster Mode for Pub/Sub

**What people do:** Enable Redis cluster mode (multiple node groups) for scalability
**Why it's wrong:** Redis cluster mode has pub/sub limitations:
- Pub/sub messages only broadcast within the same shard (hash slot)
- Clients must connect to all shards and subscribe to each (complex)
- Message delivery not guaranteed across shards (split-brain scenarios)
- No performance benefit for pub/sub (all nodes receive all messages anyway)

**Do this instead:** Use Redis replication group with cluster mode disabled (existing configuration in lib/redis.ts). Scale vertically (larger instance size) instead of horizontally.

---

### Anti-Pattern 3: Storing Ephemeral Data in DynamoDB

**What people do:** Write every cursor position update or presence heartbeat to DynamoDB
**Why it's wrong:**
- DynamoDB cost: $1.25 per million writes
- Cursor updates: 10K users × 40 updates/sec = 400K/sec = 35B writes/day = $43,750/day
- Presence heartbeats: 10K users × 1 heartbeat/30sec = 28M/day = $35/day
- No value - ephemeral data doesn't need persistence

**Do this instead:** Use Redis for ephemeral data (pub/sub, heartbeats). Only write to DynamoDB for periodic snapshots (CRDT every 5 minutes, chat messages on send).

---

### Anti-Pattern 4: No Connection Draining on Deploy

**What people do:** Deploy new ECS tasks without connection draining, immediately kill old tasks
**Why it's wrong:**
- All WebSocket clients disconnect abruptly (poor UX)
- Clients flood ALB with reconnection attempts (thundering herd)
- Lost messages in flight (chat messages sent during cutover)

**Do this instead:** Implement graceful shutdown sequence:
1. ECS sends SIGTERM to task (existing code handles in src/server.js)
2. Task stops accepting new connections
3. Task sends WebSocket close message (code 1001) to clients
4. Wait 30 seconds for clients to disconnect gracefully
5. ALB drains connections (300 second timeout)
6. Task exits cleanly

---

### Anti-Pattern 5: No Rate Limiting

**What people do:** Accept unlimited messages from clients (trust clients)
**Why it's wrong:**
- Malicious client can flood server with messages (DoS)
- Bug in client code can create infinite loop (accidental DoS)
- Costs explode (Redis bandwidth, DynamoDB writes)

**Do this instead:** Implement per-user rate limiting after authentication:
- Track message count per userId per minute (in-memory Map)
- Limit: 100 messages/minute per user (adjustable)
- Return error message if exceeded (don't disconnect - graceful degradation)
- Log rate limit violations to CloudWatch (detect abuse patterns)

---

## Cost Estimation (Target: $100-150/month for 1K-10K users)

### Infrastructure Costs

| Component | Configuration | Monthly Cost | Notes |
|-----------|---------------|--------------|-------|
| **ECS Fargate** | 2-3 tasks × 0.5 vCPU × 1 GB × 730 hours | $30-45 | $0.04048/vCPU-hour + $0.004445/GB-hour |
| **ElastiCache Redis** | r7g.large (13 GB) × 1 primary + 1 replica | $164 | 2 nodes × $0.226/hour × 730 hours |
| **Application Load Balancer** | 1 ALB + ~100 GB/month data | $25 | $0.0225/hour + $0.008/LCU-hour |
| **DynamoDB** | On-demand, 1 GB storage, 30K writes/day | $3-5 | Mostly CRDT snapshots, minimal chat |
| **CloudWatch** | Logs (5 GB/month) + custom metrics (10) | $5-7 | $0.50/GB ingested + $0.30/metric |
| **Data Transfer** | 50 GB/month outbound | $4-5 | $0.09/GB after first 1 GB free |
| **NAT Gateway** | 0 (using VPC endpoints for AWS services) | $0 | Savings: $32/month × 2 AZs |
| **VPC Endpoints** | 3 endpoints (ECR, CloudWatch, DynamoDB) | $22 | $0.01/hour/endpoint × 3 × 730 |
| **Cognito** | 10K MAU (free tier) | $0 | First 50K MAU free |
| **Total** | | **$253-278/month** | |

### Cost Optimization Strategies

**Current Estimate Exceeds Target ($100-150/month).**

**Optimizations to Hit Target:**

1. **Reduce Fargate tasks**: Start with 1 task (handles 10K connections), scale to 2-3 only during peak hours
   - Savings: $30/month (avoid running 3 tasks 24/7)

2. **Downsize Redis**: Use cache.r7g.medium (6.4 GB) instead of large (13 GB)
   - Savings: $82/month ($82 vs $164)
   - Risk: Less memory headroom, need to monitor closely

3. **Use Spot instances for Fargate**: Use Fargate Spot (70% discount) for non-critical tasks
   - Savings: Not available for Fargate - only EC2 Spot
   - Alternative: Run on t3.medium EC2 with Spot (2 vCPU × $0.0156/hour spot = $23/month)

4. **Optimize DynamoDB**: Use provisioned capacity for predictable workloads
   - Savings: Minimal (already ~$3-5/month)

5. **Reduce CloudWatch logs**: Decrease log retention from 7 days to 1 day
   - Savings: $2-3/month

**Revised Cost with Optimizations:**

| Component | Optimized | Monthly Cost |
|-----------|-----------|--------------|
| ECS Fargate | 1-2 tasks (auto-scale) | $15-30 |
| ElastiCache Redis | r7g.medium (1+1 replica) | $82 |
| ALB | 1 ALB + 100 GB data | $25 |
| DynamoDB | On-demand | $3-5 |
| CloudWatch | 1-day retention | $3-5 |
| Data Transfer | 50 GB/month | $4-5 |
| VPC Endpoints | 3 endpoints | $22 |
| **Total** | | **$154-174/month** |

**Still slightly over target. Additional options:**

- **Remove VPC endpoints**: Use NAT Gateway for AWS service access (adds $32/month NAT - worse)
- **Self-host Redis**: Run Redis on EC2 t3.micro Spot ($5/month) - not HA, not recommended
- **Use only DynamoDB**: Remove Redis, use DynamoDB Streams for pub/sub - high latency, not suitable

**Recommended:** Accept $150-180/month cost for production HA setup. Cost justified by avoiding $10K-20K/month Lambda/AppSync alternatives.

---

## Monitoring and Observability

### Key Metrics to Track

**Application Metrics (Custom CloudWatch):**
- `websocket.connections.active` - Gauge of current WebSocket connections per node
- `websocket.connections.total` - Counter of total connections accepted (since startup)
- `websocket.messages.inbound` - Counter of messages received from clients
- `websocket.messages.outbound` - Counter of messages sent to clients
- `websocket.messages.dropped` - Counter of messages dropped (client disconnected, send failed)
- `websocket.channels.active` - Gauge of active channels with subscribed clients
- `websocket.nodes.active` - Gauge of active nodes in cluster

**Service-Specific Metrics:**
- `chat.messages.sent` - Counter of chat messages sent
- `presence.users.online` - Gauge of users with active presence
- `cursor.updates.rate` - Rate of cursor position updates (messages/second)
- `reaction.events.total` - Counter of reaction events

**Infrastructure Metrics (AWS Native):**
- **ECS**: CPUUtilization, MemoryUtilization, TaskCount, HealthyTaskCount
- **ALB**: TargetResponseTime, RequestCount, TargetConnectionCount, HTTPCode_Target_4XX_Count
- **ElastiCache**: CPUUtilization, NetworkBytesIn/Out, CurrConnections, Evictions
- **DynamoDB**: ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits, ThrottledRequests

### CloudWatch Alarms

**Critical Alarms (PagerDuty/SMS):**
- ECS Task Count < 1 (no tasks running - service down)
- ALB UnhealthyTargetCount > 0 for 5 minutes (tasks failing health checks)
- ElastiCache Redis Primary Node Down (failover in progress)
- DynamoDB ThrottledRequests > 10 per minute (need to increase capacity)

**Warning Alarms (Email/Slack):**
- ECS CPUUtilization > 80% for 10 minutes (consider scaling)
- websocket.connections.active > 7000 per task (scale out)
- ElastiCache CPUUtilization > 70% (consider larger instance)
- DynamoDB ConsumedWriteCapacityUnits > 80% of provisioned (if using provisioned)

### Logging Strategy

**Structured JSON Logs (CloudWatch Logs):**
```json
{
  "timestamp": "2026-03-02T10:30:00.000Z",
  "level": "info",
  "component": "MessageRouter",
  "event": "channel_broadcast",
  "nodeId": "node-abc123",
  "channel": "lobby",
  "messageType": "chat",
  "targetNodes": ["node-abc123", "node-def456"],
  "latency_ms": 12
}
```

**Log Levels:**
- **ERROR**: Application errors (Redis connection failed, DynamoDB write failed)
- **WARN**: Degraded conditions (Redis unavailable, falling back to standalone)
- **INFO**: Significant events (node startup, graceful shutdown, client connect/disconnect)
- **DEBUG**: Detailed tracing (message routing, channel subscriptions) - disabled in production

**Log Retention:**
- Production: 7 days (balance between debugging and cost)
- Development: 1 day (reduce cost)

---

## Security Considerations

### Network Security

**VPC Configuration:**
- **Public subnets**: ALB only (internet-facing)
- **Private isolated subnets**: ECS Fargate tasks, ElastiCache Redis (no internet access)
- **VPC endpoints**: ECR, CloudWatch Logs, DynamoDB (avoid NAT Gateway costs and security risk)
- **Security groups**: Least privilege (ALB → ECS port 8080, ECS → Redis port 6379)

**TLS/SSL:**
- ALB terminates TLS (WSS protocol)
- Use ACM (AWS Certificate Manager) for free SSL certificates
- Enforce TLS 1.2+ (disable TLS 1.0/1.1)
- Internal traffic (ECS ↔ Redis, ECS ↔ DynamoDB) encrypted in transit

### Application Security

**Authentication:**
- Cognito JWT validation on every WebSocket connection
- Token in query param or Sec-WebSocket-Protocol header
- Reject connections with invalid/expired tokens (401 Unauthorized)

**Authorization:**
- Store user permissions in Cognito custom claims (e.g., `tenantId`, `role`)
- Validate channel access (users can only join channels they have permission for)
- Implement per-service authorization (not all users can use all services)

**Rate Limiting:**
- Per-user message rate: 100 messages/minute
- Per-IP connection rate: 10 connections/minute (prevent DDoS)
- Implement at application layer (cannot use ALB rate limiting for WebSocket)

**Input Validation:**
- Validate all client messages (JSON schema validation)
- Sanitize user content (prevent XSS in chat messages)
- Limit message size (max 10 KB per message)
- Limit channel name length (max 50 characters)

**DDoS Protection:**
- AWS WAF on ALB (rate limiting, geo-blocking, IP reputation)
- AWS Shield Standard (automatic L3/L4 DDoS protection)
- Connection limits per IP (10 connections/minute)

---

## Disaster Recovery and High Availability

### HA Configuration

**Multi-AZ Deployment:**
- ALB: Automatically spans multiple AZs
- ECS Fargate: Tasks distributed across AZs (configure in service)
- ElastiCache Redis: Primary + replicas in different AZs (automatic with replication)
- DynamoDB: Globally distributed (multi-AZ by default)

**Failure Scenarios:**

| Failure | Detection | Recovery | Data Loss |
|---------|-----------|----------|-----------|
| **ECS task crash** | ALB health check (30 sec) | ECS restarts task (60 sec) | Client reconnects, no data loss |
| **AZ failure** | ALB stops routing to AZ (instant) | Tasks in other AZs handle load | No data loss (multi-AZ) |
| **Redis primary failure** | ElastiCache failover (30-60 sec) | Replica promoted to primary | Pub/sub messages in flight lost (ephemeral, acceptable) |
| **ALB failure** | Route 53 health check (30 sec) | Route 53 failover to backup ALB | No data loss (stateless ALB) |
| **Region failure** | Manual detection or Route 53 | Manual failover to DR region | Last 5 minutes of CRDT snapshots lost (RPO: 5 min) |

### Backup and Recovery

**DynamoDB Backups:**
- Point-in-time recovery (PITR): Enabled (continuous backups, 35-day retention)
- On-demand backups: Weekly full backups (retain 30 days)
- Cross-region replication: Optional (adds cost, evaluate need)

**ElastiCache Redis Backups:**
- Not needed (all data is ephemeral - node registrations, pub/sub)
- If needed: Automatic backups daily (retain 1 day) - adds cost

**Recovery Objectives:**
- **RTO (Recovery Time Objective)**: 5 minutes (time to detect and failover)
- **RPO (Recovery Point Objective)**: 5 minutes (CRDT snapshot interval)

---

## Sources

**Confidence Assessment:**

This architecture research is based on:

1. **HIGH Confidence:**
   - ECS Fargate WebSocket deployment patterns (standard AWS pattern)
   - ElastiCache Redis pub/sub configuration (well-documented)
   - Application Load Balancer WebSocket support (AWS documentation)
   - Cognito JWT validation patterns (standard OAuth/OIDC)
   - DynamoDB schema design and TTL (AWS best practices)

2. **MEDIUM Confidence:**
   - Cost estimation (based on AWS pricing calculator, actual costs vary by usage)
   - CRDT snapshot frequency (application-specific, 5 minutes is reasonable)
   - IVS Chat integration complexity (documented but not extensively tested in this use case)
   - Auto-scaling thresholds (7K connections per task is conservative estimate)

3. **LOW Confidence:**
   - None - all recommendations based on established AWS patterns and existing codebase analysis

**Sources:**
- Existing CDK infrastructure code: lib/websocket-gateway-stack.ts, lib/fargate-service.ts, lib/redis.ts
- Existing application code: src/server.js, src/core/message-router.js, src/core/node-manager.js
- AWS architectural patterns for WebSocket deployments (training knowledge)
- AWS service documentation (ElastiCache, ECS Fargate, ALB, Cognito, DynamoDB, IVS)
- PROJECT.md requirements and constraints

**Limitations:**
- WebSearch and WebFetch tools were unavailable during research
- Unable to verify latest AWS service updates from 2025-2026
- Cost estimates based on 2024 AWS pricing (may have changed)
- IVS Chat pricing and integration patterns based on training knowledge (may be outdated)

**Recommendations for Validation:**
1. Review AWS What's New blog for recent WebSocket/ECS/ElastiCache updates
2. Validate ALB sticky session behavior with WebSocket upgrade in test environment
3. Load test to confirm 10K connections per task assumption
4. Verify DynamoDB on-demand pricing vs provisioned for actual workload
5. Evaluate IVS Chat with free tier trial if considering chat persistence

---

*Architecture research for: WebSocket Gateway AWS Deployment*
*Researched: 2026-03-02*
*Confidence: MEDIUM (AWS patterns HIGH, cost estimates MEDIUM, application-specific tuning needed)*
