---
phase: 02-aws-infrastructure-foundation
plan: 03
subsystem: infrastructure
status: complete
tags: [alb, tls, auto-scaling, websocket]
dependency_graph:
  requires: [02-01-vpc-endpoints, 02-02-resource-sizing]
  provides: [alb-wss-support, ecs-auto-scaling, https-termination]
  affects: [websocket-gateway-stack]
tech_stack:
  added:
    - aws-cdk-lib/aws-elasticloadbalancingv2 (ApplicationLoadBalancer)
    - aws-cdk-lib/aws-certificatemanager (Certificate)
    - aws-cdk-lib (Duration)
  patterns:
    - Application Load Balancer for WebSocket connections
    - TLS termination at load balancer layer
    - Sticky sessions for WebSocket connection affinity
    - CPU-based auto-scaling for cost optimization
    - HTTP to HTTPS redirect for security
key_files:
  created: []
  modified:
    - lib/fargate-service.ts (NLB -> ALB conversion, auto-scaling config)
    - lib/websocket-gateway-stack.ts (ALB output references)
decisions:
  - "Use ACM certificate ARN from environment variable (process.env.ACM_CERTIFICATE_ARN) for TLS termination"
  - "Configure sticky sessions with 1-hour cookie duration for WebSocket connection affinity"
  - "Set ALB idle timeout to 300 seconds (5 minutes) for long-lived WebSocket connections"
  - "Use CPU utilization as proxy for connection count to avoid CloudWatch custom metrics costs"
  - "Configure aggressive scale-down (5-minute cooldown) for cost optimization"
  - "Update stack file to reference ALB instead of NLB (blocking fix - Rule 3)"
metrics:
  duration: 715s (11m 55s)
  tasks_completed: 2
  commits: 2
  files_modified: 2
  completed_at: "2026-03-02T19:39:13Z"
---

# Phase 02 Plan 03: ALB with Auto-Scaling Summary

Application Load Balancer with WebSocket/TLS support, sticky sessions, and CPU-based auto-scaling (2-4 tasks)

## Objective Achievement

**Goal:** Replace Network Load Balancer with Application Load Balancer and configure auto-scaling

**Outcome:** Successfully migrated from NLB to ALB with HTTPS/WSS support, sticky sessions, and auto-scaling. Infrastructure now supports secure WebSocket connections with automatic capacity adjustment based on CPU utilization.

## Tasks Completed

### Task T1: Replace NLB with ALB and configure TLS
**Status:** Complete
**Commit:** 5572ac2
**Files:** lib/fargate-service.ts, lib/websocket-gateway-stack.ts

**Changes:**
- Replaced NetworkLoadBalancer with ApplicationLoadBalancer
- Added HTTPS listener on port 443 with ACM certificate from environment variable
- Added HTTP listener on port 80 with permanent redirect to HTTPS
- Configured sticky sessions with 1-hour cookie duration for WebSocket connection affinity
- Added health check to /health endpoint (30s interval, 5s timeout)
- Set deregistration delay to 30 seconds for graceful shutdown
- Set ALB idle timeout to 300 seconds for long-lived WebSocket connections
- Created dedicated ALB security group allowing HTTP/HTTPS from internet
- Updated ECS security group to allow traffic from ALB only (not anyIpv4)
- Updated desiredCount from 0 to 2 for redundancy
- Updated stack outputs to reference ALB instead of NLB (wss:// URL)

**Verification:**
- CDK synth shows AWS::ElasticLoadBalancingV2::LoadBalancer (ALB type)
- HTTPS listener on port 443 with certificate configuration
- HTTP listener on port 80 with redirect to HTTPS (StatusCode: HTTP_301)
- Target group has stickiness enabled with 1-hour duration
- Health check path set to /health
- Deregistration delay set to 30 seconds
- ALB idle timeout set to 300 seconds

### Task T2: Configure ECS auto-scaling
**Status:** Complete
**Commit:** ba8876c
**Files:** lib/fargate-service.ts

**Changes:**
- Added auto-scaling configuration with min=2, max=4 tasks
- Configured CPU-based scaling with 70% target utilization
- Set scale-in cooldown to 300 seconds (5 minutes) for aggressive cost savings
- Set scale-out cooldown to 60 seconds (1 minute) for responsive scaling
- Used CPU as proxy metric for connection count to avoid CloudWatch custom metrics costs

**Verification:**
- CDK synth shows AWS::ApplicationAutoScaling::ScalableTarget with MinCapacity: 2, MaxCapacity: 4
- Scaling policy shows TargetTrackingScaling with PredefinedMetricType: ECSServiceAverageCPUUtilization
- TargetValue: 70
- ScaleInCooldown: 300
- ScaleOutCooldown: 60

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stack file to reference ALB instead of NLB**
- **Found during:** Task T1 compilation
- **Issue:** TypeScript compilation failed because websocket-gateway-stack.ts still referenced `fargateResources.nlb` after interface changed to use `alb`
- **Fix:** Updated stack outputs to reference `fargateResources.alb` instead of `nlb`, updated LoadBalancer description from "Network Load Balancer ARN" to "Application Load Balancer ARN", changed WebSocketURL from `ws://` to `wss://` protocol
- **Files modified:** lib/websocket-gateway-stack.ts
- **Commit:** Included in 5572ac2 (Task T1 commit)
- **Impact:** Blocking fix required to complete task compilation

## Key Technical Details

### TLS Configuration
- Certificate ARN read from `process.env.ACM_CERTIFICATE_ARN` environment variable
- Falls back to `<PLACEHOLDER>` if not set (deploy-time error, not build-time)
- User must provide certificate ARN from AWS Certificate Manager
- Certificate must be in same region as stack deployment

### Load Balancer Configuration
- **Type:** Application Load Balancer (ALB)
- **Listeners:**
  - Port 443 HTTPS with ACM certificate
  - Port 80 HTTP with redirect to HTTPS (permanent 301)
- **Idle Timeout:** 300 seconds (5 minutes) for WebSocket connections
- **Security:** ALB security group allows 80/443 from internet, ECS allows 8080 from ALB only

### Target Group Configuration
- **Protocol:** HTTP (TLS terminates at ALB, forwards as ws:// to tasks)
- **Port:** 8080 (application container port)
- **Sticky Sessions:** Enabled with 1-hour cookie duration
- **Health Check:**
  - Path: /health
  - Interval: 30 seconds
  - Timeout: 5 seconds
  - Healthy threshold: 2
  - Unhealthy threshold: 3
- **Deregistration Delay:** 30 seconds for graceful shutdown

### Auto-Scaling Configuration
- **Min Capacity:** 2 tasks (always maintain redundancy)
- **Max Capacity:** 4 tasks (cost cap at ~$24/mo for ECS)
- **Metric:** CPU utilization (proxy for connection count)
- **Target:** 70% CPU utilization
- **Scale-Out:** 60-second cooldown (responsive)
- **Scale-In:** 300-second cooldown (aggressive cost savings)
- **Cost Optimization:** Avoids CloudWatch custom metrics charges

### Security Group Changes
- **ALB Security Group:** New security group allowing inbound 80/443 from 0.0.0.0/0
- **ECS Security Group:** Updated to allow inbound 8080 from ALB security group (not anyIpv4)
- **Redis Security Group:** Preserved from previous plans

## Requirements Fulfilled

- **INFRA-02:** Application Load Balancer with HTTPS/WSS support ✓
- **INFRA-05:** Auto-scaling configuration (2-4 tasks) ✓
- **INFRA-06:** Health checks and graceful shutdown (30s deregistration delay) ✓
- **INFRA-08:** Sticky sessions for WebSocket connection affinity ✓
- **SEC-05:** TLS termination at load balancer layer ✓

## Testing Recommendations

1. **Certificate Setup:**
   - Request or import certificate in AWS Certificate Manager
   - Validate domain ownership (DNS or email)
   - Export certificate ARN: `export ACM_CERTIFICATE_ARN=arn:aws:acm:...`

2. **Deploy and Verify:**
   - Deploy stack: `npx cdk deploy`
   - Verify ALB created with HTTPS listener
   - Test HTTP to HTTPS redirect: `curl -I http://<alb-dns>`
   - Test WebSocket connection: `wss://<alb-dns>`

3. **Auto-Scaling Verification:**
   - Monitor ECS service task count (should start at 2)
   - Generate CPU load to trigger scale-out
   - Observe scale-up to 3-4 tasks
   - Remove load and verify scale-in after 5-minute cooldown

4. **Sticky Session Verification:**
   - Establish WebSocket connection
   - Verify connection stays on same task
   - Check ALB target group stickiness cookie

## Performance Impact

- **Redundancy:** Increased from 0 to 2 minimum tasks (always available)
- **Capacity:** Auto-scales from 2-4 tasks based on CPU load
- **Latency:** TLS termination at ALB adds ~1-2ms overhead
- **Cost:** Estimated ~$16-48/mo for ALB + $12-24/mo for 2-4 ECS tasks

## Next Steps

1. Provide ACM certificate ARN via environment variable
2. Deploy stack with `npx cdk deploy`
3. Update DNS to point to ALB endpoint
4. Test WebSocket connections over wss://
5. Monitor auto-scaling behavior under load
6. Proceed to next plan (02-04) for remaining infrastructure setup

## Self-Check

Verifying claims made in summary.

### File Existence Check
```bash
[ -f "lib/fargate-service.ts" ] && echo "FOUND: lib/fargate-service.ts" || echo "MISSING: lib/fargate-service.ts"
[ -f "lib/websocket-gateway-stack.ts" ] && echo "FOUND: lib/websocket-gateway-stack.ts" || echo "MISSING: lib/websocket-gateway-stack.ts"
```

### Commit Existence Check
```bash
git log --oneline --all | grep -q "5572ac2" && echo "FOUND: 5572ac2" || echo "MISSING: 5572ac2"
git log --oneline --all | grep -q "ba8876c" && echo "FOUND: ba8876c" || echo "MISSING: ba8876c"
```

**Result:**
- FOUND: lib/fargate-service.ts
- FOUND: lib/websocket-gateway-stack.ts
- FOUND: 5572ac2
- FOUND: ba8876c

## Self-Check: PASSED

All files and commits verified successfully.
