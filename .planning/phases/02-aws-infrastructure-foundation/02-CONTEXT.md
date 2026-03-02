# Phase 02: AWS Infrastructure Foundation - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy the security-hardened WebSocket gateway (from Phase 01) to AWS production infrastructure using ECS Fargate, ElastiCache Redis, Application Load Balancer, and cost-optimized VPC networking. Focus: infrastructure deployment, not application changes.

</domain>

<decisions>
## Implementation Decisions

### Load Balancer
- Application Load Balancer (ALB), not Network Load Balancer
- ALB handles WebSocket upgrade protocol correctly and supports TLS termination
- Sticky sessions enabled (WebSocket connections need persistent routing)
- Worth the $7/mo premium over NLB for WebSocket-specific features

### VPC Networking
- **No NAT Gateway** - use VPC endpoints instead (saves ~$30-40/mo)
- VPC endpoints for: ECR (container images), CloudWatch (logs/metrics), Secrets Manager (if needed)
- Private subnets for ECS tasks and Redis
- Public subnets only for ALB
- 2 Availability Zones for high availability

### Resource Sizing (Cost-Optimized for Low Load)

**Expected Load:** <1000 WebSocket connections

**ECS Tasks:**
- CPU: 0.25 vCPU per task
- Memory: 0.5GB RAM per task
- Cost: ~$6/mo per task
- Initial desired count: 2 tasks (redundancy + $12/mo base cost)
- Capacity: ~500 connections per task = 1000 total at baseline

**Redis:**
- Instance type: cache.t4g.micro
- Memory: 0.5GB
- Multi-AZ with automatic failover: Yes
- Cost: ~$12/mo
- Sufficient for presence + cursor data for 1000 users

### Auto-Scaling Configuration

**Scaling Metric:** CPU utilization (simple, no custom metrics needed)

**Scale-Up Policy:**
- Trigger: Average CPU > 70% for 3 minutes
- Action: Add 1 task
- Cooldown: 60 seconds between scale-ups
- Max tasks: 4 (hard cap at ~$24/mo for ECS tasks)
- Max capacity: ~2000 connections (4 tasks × 500 connections/task)

**Scale-Down Policy:**
- Trigger: Average CPU < 40% for 5 minutes
- Action: Remove 1 task
- Cooldown: 5 minutes between scale-downs (aggressive cost savings)
- Min tasks: 2 (always maintain redundancy)
- Note: Aggressive scale-down prioritizes cost over connection stability during variable load

### TLS/SSL
- ALB terminates TLS (wss:// → ws:// internally)
- Certificate: AWS Certificate Manager (ACM) - free
- Redirect HTTP → HTTPS automatically

### Health Checks
- Endpoint: /health on port 8080
- Healthy threshold: 2 consecutive successes
- Unhealthy threshold: 3 consecutive failures
- Interval: 30 seconds
- Timeout: 5 seconds
- Expected response: 200 OK

### Graceful Shutdown
- ECS sends SIGTERM to containers
- Application drains WebSocket connections for up to 30 seconds
- ALB connection draining timeout: 30 seconds
- ALB idle timeout: 300 seconds (5 minutes)
- WebSocket ping interval: 30 seconds (keep connections alive)

### Cost Summary

**Monthly AWS Bill (Estimated):**
- ECS Fargate tasks: 2-4 tasks × $6/mo = **$12-24/mo**
- ElastiCache Redis (t4g.micro Multi-AZ): **$12/mo**
- Application Load Balancer: **$23/mo**
- Data transfer (estimated): **$5-10/mo**
- VPC endpoints (3 endpoints): **$21/mo** ($7/mo per endpoint)
- **Total: ~$73-90/mo**

**Cost vs Roadmap Target:** Well within $100-150/mo target, optimized for low-load scenario.

### Claude's Discretion
- Exact security group rule configuration
- CloudWatch log retention period (suggest: 7 days for cost savings)
- Container image repository naming
- Stack naming conventions
- Specific VPC CIDR blocks

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

**CDK Infrastructure (lib/ directory):**
- `lib/websocket-gateway-stack.js` - Main stack orchestrator (VPC → Cluster → Redis → Tasks → LB)
- `lib/vpc.js` - VPC creation (currently: 2 AZs, 1 NAT gateway)
- `lib/cluster.js` - ECS cluster setup
- `lib/redis.js` - ElastiCache Redis with Multi-AZ failover (already configured!)
- `lib/fargate-service.js` - Fargate service + NLB (needs ALB conversion)
- `lib/task-definition.js` - ECS task definition with Redis env vars
- `cdk.json` - CDK app configuration

**What's Already Right:**
- Redis Multi-AZ with automatic failover is already implemented correctly
- Security groups properly isolate ECS ↔ Redis communication
- Task definition accepts Redis endpoint/port as props
- 2 Availability Zones configured

### Required Modifications

**Changes needed to existing CDK code:**

1. **lib/vpc.js:** Remove NAT Gateway, add VPC endpoints
   - Change `natGateways: 1` → `natGateways: 0`
   - Add VPC endpoints for ECR, CloudWatch, Secrets Manager

2. **lib/fargate-service.js:** Replace NLB with ALB
   - Replace `NetworkLoadBalancer` with `ApplicationLoadBalancer`
   - Add TLS certificate from ACM
   - Configure sticky sessions (target group attribute: `stickiness.enabled = true`)
   - Add HTTP → HTTPS redirect listener
   - Configure health check path: `/health`

3. **lib/task-definition.js:** Update resource allocation
   - CPU: 256 (0.25 vCPU) - currently may be higher
   - Memory: 512 (0.5GB) - currently may be higher

4. **lib/fargate-service.js:** Add auto-scaling
   - Create `ScalableTarget` for ECS service
   - Add `TargetTrackingScalingPolicy` for CPU utilization (70% target)
   - Min: 2 tasks, Max: 4 tasks
   - Scale-in cooldown: 300 seconds (5 minutes)
   - Scale-out cooldown: 60 seconds

5. **lib/redis.js:** Update instance type
   - Change `cacheNodeType: 'cache.t3.micro'` → `'cache.t4g.micro'`
   - Keep existing Multi-AZ configuration

### Integration Points

- **ECS Task ↔ Redis:** Environment variables `REDIS_ENDPOINT` and `REDIS_PORT` already wired through task definition
- **ALB ↔ ECS Service:** ALB target group will register ECS tasks automatically via CDK
- **Health Check:** Application must expose `/health` endpoint on port 8080
- **Graceful Shutdown:** `src/core/node-manager.js` likely handles SIGTERM for graceful WebSocket draining

</code_context>

<specifics>
## Specific Ideas

- "I want the cost to be low" - prioritized smallest viable resources
- "i dont want a nat if i dont need it" - VPC endpoints chosen over NAT Gateway
- "whaterver you think best for ALB vs NLB" - ALB chosen for WebSocket protocol support and TLS termination

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope (infrastructure deployment).

Monitoring and observability (CloudWatch metrics, alarms, dashboards) are Phase 3.

</deferred>

---

*Phase: 02-aws-infrastructure-foundation*
*Context gathered: 2026-03-02*
