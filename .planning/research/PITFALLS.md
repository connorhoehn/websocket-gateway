# Pitfalls Research: AWS WebSocket Gateway Migration

**Domain:** WebSocket gateway for real-time collaboration on AWS
**Researched:** 2026-03-02
**Confidence:** HIGH (based on codebase analysis, AWS documentation, and training data)

---

## Critical Pitfalls

### Pitfall 1: Missing Authentication on WebSocket $connect Route

**What goes wrong:**
WebSocket connections are accepted without any identity verification. Any client can connect, impersonate users, subscribe to any channel, and access all real-time data. On AWS, this becomes worse because ALB exposes the service to the internet by default.

**Why it happens:**
- Development shortcuts: "We'll add auth later"
- Misunderstanding WebSocket handshake: HTTP auth headers aren't automatically passed to upgraded connection
- Cognito integration is non-trivial: requires custom authorizer or API Gateway setup
- Code evidence: `src/server.js` lines 191-233 show no token validation on connect

**How to avoid:**
1. Implement Cognito JWT validation in the WebSocket $connect handler BEFORE accepting the connection
2. Extract token from query parameters (e.g., `wss://api.example.com?token=...`) since WebSocket handshakes can't set custom headers in browsers
3. Validate JWT signature, expiration, and issuer on every connection attempt
4. Store validated user identity (sub, email) in client metadata for authorization checks
5. Reject connections with 401 before the WebSocket upgrade completes

**Warning signs:**
- No `Authorization` header or query param validation in connection handler
- ClientId generated without tying to authenticated user identity (see `src/server.js:299`)
- No user context in message routing or service calls
- Security audit flags: "Anyone can connect"

**Phase to address:**
**Phase 1: Security Hardening** — Cannot deploy to AWS without authentication. This is the first blocker.

**Prevention verification:**
- [ ] All WebSocket connections require valid Cognito JWT
- [ ] Invalid/expired tokens are rejected with 401 before upgrade
- [ ] User identity is extracted and stored in client context
- [ ] Load test with expired/malformed tokens confirms rejection

---

### Pitfall 2: No Per-Client Rate Limiting = DDoS Vector

**What goes wrong:**
A single malicious client can spam thousands of messages per second, exhausting CPU, memory, and Redis pub/sub bandwidth. The system has no defense mechanism. On AWS, this means paying for wasted compute and potentially hitting ElastiCache connection limits.

**Why it happens:**
- Real-time collaboration requires high-frequency messages (cursor updates at 25-50ms)
- Implementing rate limiting adds latency concerns
- False assumption that "authenticated users won't abuse the system"
- Code evidence: `src/server.js` lines 236-275 route all messages without rate checks

**How to avoid:**
1. Implement token bucket rate limiter per clientId: 100 messages/second for regular messages, 40/second for cursor updates
2. Track message counts in memory (not Redis) to avoid adding latency
3. Return backpressure signal to client when rate limit hit: `{error: "rate_limit", retry_after: 1000}`
4. Automatically disconnect clients that exceed rate limit 3x in 60 seconds
5. Use CloudWatch metrics to monitor per-client message rates and alert on anomalies

**Warning signs:**
- Single client sending >1000 msgs/sec in logs
- Redis pub/sub bandwidth saturation (ElastiCache network metrics)
- CPU usage spikes correlated with specific clientId
- Other clients experiencing latency while one client floods

**Phase to address:**
**Phase 1: Security Hardening** — Required before production deployment. Rate limiting prevents abuse and reduces AWS costs.

**Prevention verification:**
- [ ] Rate limiter implemented with per-client token buckets
- [ ] Load test: single client hitting rate limit receives backpressure
- [ ] CloudWatch dashboard shows per-service message rate metrics
- [ ] Alert configured for clients exceeding 200 msgs/sec

---

### Pitfall 3: Memory Leaks in Presence and Chat Services

**What goes wrong:**
The `clientPresence` Map in `presence-service.js` and `channelHistory` Map in `chat-service.js` grow unbounded. Rapid client connect/disconnect cycles or abandoned channels cause memory to balloon until the Node process crashes with OOM errors. On ECS Fargate, this wastes money (overprovisioned memory) or causes frequent task restarts.

**Why it happens:**
- Cleanup logic has race conditions: `handleDisconnect` waits 5 seconds before cleanup, but client may reconnect first (lines 317-329 in `presence-service.js`)
- Channel history has no TTL: channels created once persist forever (lines 14, 194-206 in `chat-service.js`)
- No monitoring: developers don't notice memory growth until production crashes
- No memory limits enforced at service level

**How to avoid:**
1. **Presence Service Fix:**
   - Remove 5-second cleanup delay; clean up immediately on disconnect
   - Add TTL to presence entries: if no heartbeat in 90 seconds, expire entry
   - Implement periodic cleanup (every 60 seconds) that scans for expired entries
   - Add metric: `presence.activeClients.count` to CloudWatch

2. **Chat Service Fix:**
   - Add TTL to channel history: expire channels with no messages in 1 hour
   - Implement LRU eviction: max 1000 active channels per node
   - Move persistent chat to AWS IVS (as planned in PROJECT.md)
   - Store only last 10 messages in memory; fetch history from IVS on demand

3. **General Monitoring:**
   - Add heap usage metrics to CloudWatch: `process.memoryUsage().heapUsed`
   - Set ECS Fargate memory alarm at 80% utilization
   - Configure task autoscaling based on memory, not just CPU

**Warning signs:**
- ECS tasks restarting due to OOM (exit code 137)
- Memory usage climbing steadily over hours (not sawtooth GC pattern)
- `clientPresence.size` or `channelHistory.size` growing without bound in logs
- Fargate tasks requiring increasingly larger memory allocations

**Phase to address:**
**Phase 1: Security Hardening** — Memory leaks are known issues (documented in CONCERNS.md lines 34-44). Must fix before deploying to AWS to avoid runaway costs.

**Prevention verification:**
- [ ] Load test: 10k connect/disconnect cycles shows stable memory
- [ ] Leave server running for 24 hours; memory usage stays below 500MB
- [ ] CloudWatch alarm triggers at 80% memory usage
- [ ] Channel history eviction confirmed after 1 hour of inactivity

---

### Pitfall 4: ALB Idle Timeout Too Short for WebSocket Connections

**What goes wrong:**
Application Load Balancer's default idle timeout is 60 seconds. If no data flows on a WebSocket connection for 60 seconds, ALB closes the connection. Clients see unexpected disconnects, leading to poor UX and reconnection storms. This affects presence-only clients who don't send frequent messages.

**Why it happens:**
- Developers assume WebSocket connections are "persistent" without explicit keepalives
- ALB idle timeout is independent of WebSocket ping/pong frames
- No client-side heartbeat implementation
- Testing only covers active users (who send frequent messages), not idle ones

**How to avoid:**
1. **ALB Configuration:**
   - Set `idle_timeout.timeout_seconds` to 300 (5 minutes) or higher
   - Document this as critical infrastructure requirement in CDK stack

2. **Server-Side Keepalives:**
   - Implement WebSocket ping frames every 30 seconds from server to all clients
   - Expect pong response within 10 seconds; disconnect clients that don't respond
   - Use `ws` library's built-in ping/pong: `ws.ping()` and listen for `pong` event

3. **Client-Side Heartbeats:**
   - Send application-level heartbeat message every 30 seconds from client
   - Presence service heartbeat (already implemented) serves this purpose if client subscribes to presence

4. **Monitoring:**
   - Track `ALBRejectedConnectionCount` and `TargetConnectionErrorCount` in CloudWatch
   - Alert on sudden spikes in connection errors

**Warning signs:**
- Client disconnect events exactly at 60-second intervals in logs
- CloudWatch ALB metrics showing `HTTP_CODE_TARGET_5XX_COUNT` spikes
- Users reporting "disconnected while idle"
- Reconnection storms after periods of low activity

**Phase to address:**
**Phase 2: AWS Infrastructure Setup** — Must configure ALB correctly during deployment to avoid production issues.

**Prevention verification:**
- [ ] ALB idle timeout set to 300 seconds in CDK stack
- [ ] Server sends WebSocket pings every 30 seconds
- [ ] Load test: idle connection stays alive for 5+ minutes
- [ ] CloudWatch dashboard tracks connection error rates

---

### Pitfall 5: Missing Connection Draining During ECS Task Termination

**What goes wrong:**
When ECS scales down or deploys a new version, tasks are terminated immediately. Active WebSocket connections are dropped without warning, causing users to see "connection closed" errors. Autoscaling or CI/CD deployments disrupt all active users.

**Why it happens:**
- Default ECS task stop behavior: sends SIGTERM, waits 30 seconds, then SIGKILL
- WebSocket server doesn't intercept SIGTERM to initiate graceful shutdown
- No coordination with ALB's deregistration delay
- Signal handlers in `src/server.js` (lines 465-485) attempt cleanup but don't wait for connections to drain

**How to avoid:**
1. **ECS Configuration:**
   - Set `deregistrationDelay` to 120 seconds in target group configuration
   - Set `stopTimeout` to 150 seconds in ECS task definition (must be longer than deregistration delay)

2. **Graceful Shutdown Implementation:**
   - On SIGTERM, immediately stop accepting new connections
   - Send "server_shutting_down" message to all connected clients with 30-second warning
   - Wait for clients to disconnect gracefully (up to 30 seconds)
   - After timeout, close remaining connections forcefully
   - Only then call `process.exit(0)`

3. **Code Fix Required:**
   ```javascript
   // In server.js, replace immediate shutdown with:
   process.on('SIGTERM', async () => {
     logger.info('SIGTERM received, starting graceful shutdown...');

     // Stop accepting new connections
     wss.close(() => {
       logger.info('WebSocket server closed to new connections');
     });

     // Notify all clients
     broadcastToAll({ type: 'server_shutdown', message: 'Server restarting in 30 seconds' });

     // Wait for clients to disconnect or timeout
     await waitForConnections(30000);

     // Clean up resources
     await cleanup();

     process.exit(0);
   });
   ```

4. **ALB Health Check Configuration:**
   - Implement `/health` HTTP endpoint that returns 503 during shutdown
   - ALB will stop routing new connections to draining task

**Warning signs:**
- Connection errors spike during deployments in CloudWatch
- Users report being kicked out when you deploy
- ECS tasks killed with SIGKILL (exit code 137 or 143)
- Deployments cause support tickets

**Phase to address:**
**Phase 2: AWS Infrastructure Setup** — Critical for production stability. Users will churn if deployments break their sessions.

**Prevention verification:**
- [ ] Deployment test: rolling update doesn't disconnect active clients
- [ ] SIGTERM handling includes 30-second grace period
- [ ] Load test: active connections during deployment migrate gracefully
- [ ] CloudWatch shows zero connection errors during deployment

---

### Pitfall 6: ElastiCache Redis Single-AZ = Single Point of Failure

**What goes wrong:**
Default ElastiCache Redis cluster is deployed in a single availability zone. If that AZ has an outage, the entire WebSocket system goes down because Redis is required for node coordination and pub/sub. The system has no failover capability.

**Why it happens:**
- Cost optimization: Multi-AZ Redis costs 2x
- False assumption: "AWS AZs never fail"
- No graceful degradation when Redis is unavailable (documented in CONCERNS.md lines 219-225)
- Developers test with local Redis and never simulate AZ failure

**How to avoid:**
1. **Infrastructure Decision:**
   - Use ElastiCache Redis with Multi-AZ replication (1 primary + 1 replica minimum)
   - Enable automatic failover (promoted replica becomes primary)
   - Cost: ~$12/month → ~$24/month (acceptable per PROJECT.md constraint of $100-150/month)

2. **Application-Level Failover:**
   - Implement Redis connection retry with exponential backoff
   - Cache critical data locally during Redis outage:
     - Channel subscriptions: keep in-memory Map as backup
     - Node registrations: fall back to local state for single-node operation
   - When Redis recovers, reconcile local state back to Redis

3. **Code Fix Required (cursor-service.js):**
   ```javascript
   // Fix inconsistent fallback: lines 136-169 write to local storage on Redis failure
   // But lines 313-337 only read from Redis, ignoring local fallback
   async getCursor(channelId, userId) {
     try {
       // Try Redis first
       const redisKey = this.getCursorKey(channelId, userId);
       const data = await this.redis.get(redisKey);
       if (data) return JSON.parse(data);
     } catch (err) {
       logger.warn('Redis getCursor failed, checking local fallback');
     }

     // Check local fallback storage
     const localKey = `${channelId}:${userId}`;
     return this.localCursorCache.get(localKey) || null;
   }
   ```

4. **Monitoring:**
   - CloudWatch alarm on `EngineCPUUtilization` > 75% (indicates primary overload)
   - Alert on `ReplicationLag` > 5 seconds
   - Dashboard showing Redis failover events

**Warning signs:**
- ElastiCache cluster has zero replicas in AWS console
- No failover test in runbook
- Application crashes when Redis is unreachable (no fallback)
- CONCERNS.md documents "no graceful degradation when Redis is down"

**Phase to address:**
**Phase 2: AWS Infrastructure Setup** — Deploy with Multi-AZ from day one. Retrofitting after production issues is painful.

**Prevention verification:**
- [ ] ElastiCache cluster configured with Multi-AZ automatic failover
- [ ] Chaos test: manually failover Redis; application continues with <5s disruption
- [ ] Local fallback logic tested for cursor, presence, and node registration
- [ ] CloudWatch alarm configured for replication lag

---

### Pitfall 7: No Channel-Level Authorization = Data Leakage

**What goes wrong:**
Even after adding authentication, there's no verification that a user has permission to subscribe to a specific channel. A user authenticated as `user@example.com` can subscribe to `channel:private:other-user` and see all their cursor movements, messages, and presence. This is a privacy violation and potential data breach.

**Why it happens:**
- Authentication (who you are) is confused with authorization (what you can access)
- WebSocket channels are treated as public by default
- No concept of channel ownership or ACLs in codebase
- Code evidence: `src/server.js` lines 263-275 subscribe to channels without permission checks

**How to avoid:**
1. **Channel Naming Convention:**
   - Public channels: `channel:public:lobby`
   - User-specific: `channel:user:{userId}` (only that user can subscribe)
   - Group channels: `channel:group:{groupId}` (members only)
   - Document channels: `channel:doc:{docId}` (check document permissions)

2. **Authorization Service:**
   - Create `AuthorizationService` to check permissions
   - Before subscribing, call `authz.canSubscribe(userId, channelId)`
   - Cache permissions in memory with 60-second TTL
   - Fetch permissions from DynamoDB or API Gateway

3. **Code Fix Required:**
   ```javascript
   // In server.js, before subscribing:
   async handleSubscribe(clientId, channelId) {
     const client = this.clients.get(clientId);
     const userId = client.userId; // from JWT auth

     // Authorization check
     const permitted = await this.authz.canSubscribe(userId, channelId);
     if (!permitted) {
       this.sendToClient(clientId, {
         type: 'error',
         message: 'Forbidden: cannot subscribe to this channel'
       });
       return;
     }

     // Proceed with subscription
     await this.nodeManager.subscribeClientToChannel(clientId, channelId);
   }
   ```

4. **Default-Deny Policy:**
   - Reject subscription if authorization service is unavailable (fail closed)
   - Log all authorization failures for security monitoring
   - Implement rate limiting on authorization failures (10/minute/client)

**Warning signs:**
- No authorization logic in subscription handler
- All channels are accessible to all authenticated users
- Security audit flags: "Authenticated users can access any channel"
- CONCERNS.md documents "no channel-level access control"

**Phase to address:**
**Phase 1: Security Hardening** — Required before production. Data leakage is a compliance risk.

**Prevention verification:**
- [ ] Authorization service checks permissions on every subscription
- [ ] Test: user A cannot subscribe to user B's private channel
- [ ] Security test: malicious JWT with forged userId rejected
- [ ] CloudWatch logs show authorization denials

---

### Pitfall 8: Incorrect ECS Task Auto-Scaling Metrics

**What goes wrong:**
ECS task autoscaling is configured to scale on CPU utilization, which is the wrong metric for WebSocket applications. WebSocket servers are network and memory-bound, not CPU-bound. The system scales too late (when CPU maxes out) or not at all, leading to connection failures during traffic spikes.

**Why it happens:**
- Default ECS autoscaling templates use CPU as the metric
- WebSocket servers maintain many idle connections (low CPU, high memory)
- Traffic spikes show up as connection count increases, not CPU spikes
- Developers don't monitor the right metrics (active connections, memory)

**How to avoid:**
1. **Use Connection-Based Scaling:**
   - Primary metric: `ActiveConnectionCount` per target (ALB metric)
   - Scale up when average connections per task > 5000
   - Scale down when average connections per task < 2000
   - Target: 3000-4000 connections per Fargate task (leaves headroom)

2. **Secondary Metrics:**
   - Memory utilization > 70% triggers scale-up
   - Network bandwidth utilization > 60% triggers scale-up
   - Do NOT use CPU as primary metric (only as safety threshold at 80%)

3. **CDK Configuration:**
   ```typescript
   // In infrastructure stack:
   const scalableTarget = fargateService.autoScaleTaskCount({
     minCapacity: 2,
     maxCapacity: 10
   });

   // Scale on active connections (custom metric from ALB)
   scalableTarget.scaleOnMetric('ScaleOnConnections', {
     metric: targetGroup.metric('ActiveConnectionCount'),
     scalingSteps: [
       { upper: 6000, change: -1 },  // scale down
       { lower: 10000, change: +1 }, // scale up
       { lower: 15000, change: +2 }  // scale up faster
     ],
     adjustmentType: ecs.AdjustmentType.CHANGE_IN_CAPACITY
   });
   ```

4. **Prevent Scale-Down Too Aggressive:**
   - Set scale-in cooldown to 300 seconds (5 minutes)
   - Prevents thrashing during fluctuating traffic
   - Use deregistration delay to drain connections gracefully

**Warning signs:**
- CPU at 20% but connection failures occurring
- Memory at 80% but no autoscaling triggered
- Manual scaling "fixes" the problem temporarily
- CloudWatch shows high connection count but low CPU

**Phase to address:**
**Phase 3: Monitoring & Optimization** — Can deploy with basic CPU scaling initially, but must fix early in production to prevent outages.

**Prevention verification:**
- [ ] ECS autoscaling configured on connection count, not CPU
- [ ] Load test: simulated traffic spike triggers autoscaling within 2 minutes
- [ ] Scale-down respects deregistration delay (no dropped connections)
- [ ] CloudWatch dashboard shows connection count driving scaling decisions

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Cognito integration, use API keys | Faster to deploy; simpler client code | No user-level identity; can't tie actions to users; API keys leak easily | Never for production |
| Use single-AZ Redis to save cost | 50% savings on Redis (~$12/month) | Single point of failure; no HA; production outages | Dev/staging only |
| Store all chat history in memory | Lower latency; no database needed | Memory leaks; no persistence; OOM crashes | MVP only, migrate to IVS in Phase 3 |
| No authorization checks, only authentication | Simpler code; faster development | Data leakage; privacy violations; compliance issues | Never for production |
| Hardcode configuration in code | No env var setup; easier to test locally | Can't change settings without redeploying; environment-specific values in codebase | Only in early prototypes |
| Skip rate limiting during development | Simpler testing; no false positives | DDoS vector; cost overruns; abuse potential | Dev only, must add before AWS deployment |
| Use single Fargate task (no autoscaling) | Predictable cost; simpler ops | No resilience; single point of failure; can't handle spikes | Proof of concept only |
| Log full message payloads for debugging | Easier debugging; full context in logs | Privacy violations; sensitive data in logs; CloudWatch costs | Never in production |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cognito JWT | Not verifying JWT signature, only decoding base64 | Use `jsonwebtoken` library to verify signature against Cognito public keys; validate issuer, audience, expiration |
| ElastiCache Redis | Using connection string directly without TLS | Enable in-transit encryption; use `rediss://` protocol; validate certificates |
| ALB Target Groups | Using `instance` target type instead of `ip` | Must use `ip` target type for Fargate; `awsvpc` network mode requires ENI-based routing |
| ECS Task Definitions | Not setting `stopTimeout` long enough for graceful shutdown | Set `stopTimeout` > `deregistrationDelay` + 30 seconds for connection draining |
| CloudWatch Logs | Sending all logs to CloudWatch without filtering | Use log filtering to reduce costs; only send ERROR and WARN to CloudWatch; keep INFO local |
| AWS IVS Chat | Assuming IVS chat replaces WebSocket for all messages | IVS is for persistent chat only; high-frequency cursor/presence still needs WebSocket |
| DynamoDB | Using on-demand pricing for high-frequency writes | Provision capacity for CRDT snapshots (predictable 5-minute intervals); on-demand costs 5x more |
| VPC Configuration | Deploying Fargate tasks in public subnets | Use private subnets with NAT gateway; ALB in public subnet; Fargate tasks internal only |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| In-memory channel history without eviction | Memory usage grows steadily; OOM crashes after days | Implement LRU cache with max 1000 channels; add TTL-based expiration | >10k total channels created |
| Presence cleanup every 30 seconds for all clients | Cleanup loop takes longer than 30 seconds; CPU spikes | Use lazy expiration (check on query) or priority queue for expiration | >5k concurrent clients |
| Iterating all clients to find channel subscribers | O(n*m) lookup time; high CPU during unsubscribe | Build reverse index: `channelToClients` Map; update on subscribe/unsubscribe | >1k clients per node |
| No backpressure on outgoing WebSocket messages | `ws.bufferedAmount` grows unbounded; memory leak | Check `ws.bufferedAmount` before sending; pause if >1MB buffered | Slow clients on 3G connections |
| Redis pub/sub without connection pooling | Connection exhaustion; ElastiCache max connections (65k) hit | Use single Redis client for pub/sub; don't create new connection per publish | >10k messages/sec |
| Logging every message to CloudWatch | CloudWatch ingestion costs spike; logs delayed | Sample logs (1% of messages); use local aggregation; only log errors/warnings | >1M messages/day |
| No CDN for static assets (client SDK) | High ALB bandwidth costs; slow client loads | Use CloudFront for serving WebSocket client library | >10k client connections/day |
| Synchronous JSON parsing for every message | Event loop blocking; increased latency | Use streaming JSON parser for large messages; validate size limits | Messages >10KB |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accepting WebSocket connections without auth | Impersonation, data leakage, abuse | Validate Cognito JWT on $connect; reject unauthorized clients |
| No rate limiting per client | DDoS, cost overruns, service degradation | Implement token bucket: 100 msgs/sec general, 40 msgs/sec cursor updates |
| Logging user messages or cursor positions | Privacy violations, GDPR non-compliance | Sanitize logs; never log message payloads; only log metadata (clientId, channelId, timestamp) |
| Channel names predictable (sequential IDs) | Enumeration attacks, unauthorized access | Use UUIDs for channel IDs; validate authorization on subscribe |
| Redis without password authentication | Full data access if Redis exposed | Set Redis password via env var; use ElastiCache auth token |
| No message size limits | Memory exhaustion attacks | Reject messages >64KB; close connection after 3 violations |
| Trusting clientId from client messages | Spoofing, impersonation | Ignore client-provided clientId; use server-generated clientId from connection context |
| No TLS for Redis connections | MITM attacks, credential theft | Enable in-transit encryption on ElastiCache; use `rediss://` protocol |
| Exposing internal error details to clients | Information leakage, attack surface discovery | Return generic error messages; log detailed errors server-side only |
| No monitoring of authorization failures | Brute force attacks go unnoticed | CloudWatch alarm on authz denial rate > 100/minute; investigate spikes |

---

## UX Pitfalls

Common user experience mistakes in real-time collaboration systems.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No reconnection backoff strategy | Reconnection storms after outage; server overload | Exponential backoff: 1s, 2s, 4s, 8s, max 30s; add jitter to prevent thundering herd |
| Not notifying users of disconnection | Users think they're still online; confusion when messages don't send | Send "disconnected" event immediately; show UI banner; attempt auto-reconnect |
| Dropping messages during reconnection | Lost cursor positions, chat messages disappear | Buffer messages client-side during disconnect; replay after reconnect |
| No loading states during connection | Users see empty UI; assume system is broken | Show "Connecting..." spinner; progressive loading; optimistic updates |
| Reconnecting to different server loses state | Users see stale data; channels need re-subscription | Send "reconnected" message with list of previous channels; auto-resubscribe |
| No indication when rate limited | Users see messages not appearing; confusion | Send "rate_limited" message; show warning banner; suggest slowing down |
| Cursor positions jumping during lag | Disorienting; hard to track collaborators | Interpolate cursor movement; show "lagging" indicator for stale cursors |
| No warning before server shutdown | Abrupt disconnections during deployments | Send "server_shutting_down" 30 seconds before; allow users to save work |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **WebSocket Authentication:** Verify JWT signature is validated (not just decoded), expiration checked, and issuer matches Cognito
- [ ] **Rate Limiting:** Confirm per-client limits enforced (not just service-level throttling)
- [ ] **Memory Leak Fixes:** Run 24-hour stability test; verify memory stays flat (not climbing)
- [ ] **Graceful Shutdown:** Deploy new version; confirm active connections drain (not immediately dropped)
- [ ] **ALB Idle Timeout:** Idle connection test (no activity for 5 minutes); connection stays alive
- [ ] **Redis Failover:** Manually trigger Redis failover; application recovers within 10 seconds
- [ ] **Authorization Checks:** User A cannot subscribe to user B's private channels
- [ ] **CloudWatch Alarms:** Alarms exist for memory >80%, connections >10k/task, authz failures >100/min
- [ ] **Connection Draining:** Scale-down test; existing connections migrate to other tasks (not dropped)
- [ ] **Multi-AZ Deployment:** ElastiCache has replicas in multiple AZs; Fargate tasks in multiple AZs

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Memory leak in production | HIGH | 1. Identify leaking service (presence or chat) via heap dump<br>2. Emergency deploy with fix from CONCERNS.md<br>3. Restart all ECS tasks<br>4. Monitor memory for 24 hours |
| Redis failover causes outage | MEDIUM | 1. Check ElastiCache failover logs<br>2. Verify Multi-AZ is enabled<br>3. If manual fix needed: promote replica, update DNS<br>4. Restart affected Fargate tasks |
| Rate limiting not deployed, DDoS ongoing | MEDIUM | 1. Deploy emergency rate limiter (hotfix)<br>2. Identify attacking clientIds in logs<br>3. Block at ALB level via security group<br>4. Add CloudWatch alarm to detect future attacks |
| Missing authorization, data leaked | HIGH | 1. Immediate: Deploy authorization service (Phase 1 work)<br>2. Audit logs for unauthorized access<br>3. Notify affected users (privacy breach)<br>4. Post-mortem: why authorization was skipped |
| ALB idle timeout drops connections | LOW | 1. Update ALB target group idle timeout to 300s via AWS console<br>2. Redeploy CDK stack with corrected config<br>3. No client changes needed (transparent) |
| ECS autoscaling misconfigured, tasks overloaded | MEDIUM | 1. Manually scale up tasks immediately<br>2. Update autoscaling policy to use connection count<br>3. Add CloudWatch dashboard for connection metrics<br>4. Load test new policy |
| Graceful shutdown missing, deployments drop users | LOW | 1. Implement SIGTERM handler with 30s grace period<br>2. Update ECS stopTimeout to 150s<br>3. Test with rolling deployment<br>4. Announce maintenance window for fix |
| Chat history memory leak | MEDIUM | 1. Emergency: flush channelHistory Map via admin endpoint<br>2. Deploy TTL-based expiration fix<br>3. Migrate to AWS IVS for persistent chat (long-term) |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Missing WebSocket authentication | Phase 1: Security Hardening | Load test with invalid JWT confirms rejection |
| No per-client rate limiting | Phase 1: Security Hardening | Single client hitting limit receives backpressure |
| Memory leaks (presence, chat) | Phase 1: Security Hardening | 24-hour stability test shows flat memory usage |
| No channel-level authorization | Phase 1: Security Hardening | User cannot subscribe to unauthorized channels |
| ALB idle timeout too short | Phase 2: AWS Infrastructure | Idle connection survives 5+ minutes |
| Missing connection draining | Phase 2: AWS Infrastructure | Rolling deployment doesn't drop connections |
| Single-AZ Redis (no HA) | Phase 2: AWS Infrastructure | Manual failover test completes in <10 seconds |
| Incorrect autoscaling metrics | Phase 3: Monitoring & Optimization | Traffic spike triggers autoscaling on connection count |
| No CloudWatch alarms | Phase 3: Monitoring & Optimization | Alarm test: trigger memory alarm at 80% threshold |
| Cursor service Redis fallback bug | Phase 1: Security Hardening | Redis outage test: cursors still readable from local cache |

---

## Sources

**Codebase Analysis (HIGH confidence):**
- `/Users/connorhoehn/Projects/websocker_gateway/.planning/codebase/CONCERNS.md` — Known security gaps, memory leaks, performance bottlenecks
- `/Users/connorhoehn/Projects/websocker_gateway/src/server.js` — No authentication, no rate limiting, signal handling issues
- `/Users/connorhoehn/Projects/websocker_gateway/src/services/presence-service.js` — Memory leak in clientPresence Map
- `/Users/connorhoehn/Projects/websocker_gateway/src/services/chat-service.js` — Unbounded channel history
- `/Users/connorhoehn/Projects/websocker_gateway/src/services/cursor-service.js` — Redis fallback not tested

**AWS Documentation (MEDIUM confidence):**
- AWS API Gateway WebSocket API — Security considerations, JWT authorizers
- AWS Application Load Balancer — Idle timeout defaults (60s), connection draining
- AWS ECS Fargate — Target type requirements (`ip` for awsvpc), stopTimeout behavior
- AWS ElastiCache Redis — Multi-AZ replication, automatic failover

**Training Data (MEDIUM confidence):**
- WebSocket security best practices — Authentication on $connect, rate limiting patterns
- ECS autoscaling patterns — Connection-based metrics vs CPU-based metrics
- Redis pub/sub at scale — Connection pooling, memory management

---

*Pitfalls research for: WebSocket Gateway AWS Migration*
*Researched: 2026-03-02*
