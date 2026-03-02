# Phase 02: AWS Infrastructure Foundation - Research

**Researched:** 2026-03-02
**Domain:** AWS CDK Infrastructure as Code for ECS Fargate, ElastiCache Redis, Application Load Balancer
**Confidence:** HIGH

## Summary

Phase 2 deploys the security-hardened WebSocket gateway (from Phase 1) to AWS production infrastructure. The existing CDK codebase provides a solid foundation with VPC, ECS cluster, Redis Multi-AZ, and NLB already implemented. Primary work involves: (1) replacing NLB with ALB for WebSocket protocol support and TLS termination, (2) removing NAT Gateway and adding VPC endpoints for cost optimization, (3) right-sizing resources for low-load scenario, and (4) implementing ECS auto-scaling.

**Primary recommendation:** Modify existing CDK constructs rather than rewrite from scratch. Redis Multi-AZ configuration is already correct. Focus changes on `lib/vpc.js` (VPC endpoints), `lib/fargate-service.js` (ALB + auto-scaling), and `lib/task-definition.js` (resource sizing).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Load Balancer**
- Application Load Balancer (ALB), not Network Load Balancer
- ALB handles WebSocket upgrade protocol correctly and supports TLS termination
- Sticky sessions enabled (WebSocket connections need persistent routing)
- Worth the $7/mo premium over NLB for WebSocket-specific features

**VPC Networking**
- **No NAT Gateway** - use VPC endpoints instead (saves ~$30-40/mo)
- VPC endpoints for: ECR (container images), CloudWatch (logs/metrics), Secrets Manager (if needed)
- Private subnets for ECS tasks and Redis
- Public subnets only for ALB
- 2 Availability Zones for high availability

**Resource Sizing (Cost-Optimized for Low Load)**

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

**Auto-Scaling Configuration**

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

**TLS/SSL**
- ALB terminates TLS (wss:// → ws:// internally)
- Certificate: AWS Certificate Manager (ACM) - free
- Redirect HTTP → HTTPS automatically

**Health Checks**
- Endpoint: /health on port 8080
- Healthy threshold: 2 consecutive successes
- Unhealthy threshold: 3 consecutive failures
- Interval: 30 seconds
- Timeout: 5 seconds
- Expected response: 200 OK

**Graceful Shutdown**
- ECS sends SIGTERM to containers
- Application drains WebSocket connections for up to 30 seconds
- ALB connection draining timeout: 30 seconds
- ALB idle timeout: 300 seconds (5 minutes)
- WebSocket ping interval: 30 seconds (keep connections alive)

**Cost Summary**

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

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Deploy WebSocket server to ECS Fargate with Docker containers | Existing CDK constructs for Fargate task definition and service; modify resource allocation |
| INFRA-02 | Configure Application Load Balancer with sticky sessions and 300s idle timeout | Replace NetworkLoadBalancer with ApplicationLoadBalancer in fargate-service.js; enable stickiness on target group |
| INFRA-03 | Migrate to ElastiCache Redis (Multi-AZ, automatic failover) | Already implemented correctly in redis.js; only needs instance type change (t3.micro → t4g.micro) |
| INFRA-04 | Set up VPC with isolated subnets and VPC endpoints (no NAT gateway) | Modify vpc.js to set natGateways: 0 and add InterfaceVpcEndpoint constructs for ECR, CloudWatch, Secrets Manager |
| INFRA-05 | Configure ECS auto-scaling based on connection count (5000/task threshold) | Use TargetTrackingScalingPolicy with CPU utilization as proxy metric (no custom metrics cost) |
| INFRA-06 | Implement graceful shutdown and connection draining (30s deregistration delay) | Configure deregistrationDelay on ALB target group; application already handles SIGTERM |
| INFRA-07 | Add health check HTTP endpoint for ALB routing | Configure healthCheck on ALB target group pointing to /health endpoint |
| INFRA-08 | Configure server-side ping/pong to keep connections alive | ALB idleTimeout property; application-level implementation (separate from CDK) |
| SEC-05 | TLS/SSL termination for wss:// connections (via ALB) | Use Certificate.fromCertificateArn() for ACM certificate; add HTTPS listener with redirect from HTTP |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aws-cdk-lib | 2.x | AWS CDK v2 unified library | Official AWS IaC framework, type-safe, single dependency |
| constructs | 10.x | CDK construct base classes | Required peer dependency for CDK v2 |
| aws-cdk-lib/aws-ec2 | (included) | VPC, subnets, security groups, VPC endpoints | Native CDK L2 constructs for networking |
| aws-cdk-lib/aws-ecs | (included) | Fargate tasks, services, clusters | Native CDK L2 constructs for container orchestration |
| aws-cdk-lib/aws-elasticloadbalancingv2 | (included) | Application Load Balancer, target groups, listeners | Native CDK L2 constructs for load balancing |
| aws-cdk-lib/aws-elasticache | (included) | Redis replication groups, subnet groups | Native CDK L1 (CFN) constructs for ElastiCache |
| aws-cdk-lib/aws-certificatemanager | (included) | ACM certificates for TLS | Native CDK L2 constructs for certificates |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| aws-cdk-lib/aws-logs | (included) | CloudWatch Logs log groups | Configure retention period for cost optimization |
| aws-cdk-lib/aws-ecr | (included) | ECR repositories | If creating repo in CDK vs external management |
| aws-cdk-lib/aws-applicationautoscaling | (included) | ECS service auto-scaling targets and policies | Required for INFRA-05 auto-scaling implementation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CDK | Terraform | Terraform has broader cloud support; CDK offers better TypeScript/Python integration and L2 constructs |
| ALB | Network Load Balancer (NLB) | NLB is $7/mo cheaper but lacks WebSocket protocol awareness and TLS termination |
| Fargate | EC2 instances | EC2 requires AMI management, patching, capacity planning; Fargate is pay-per-use with no servers |
| ElastiCache | Self-managed Redis on EC2 | Self-managed saves ~$12/mo but adds operational burden for HA, failover, backups |

**Installation:**
```bash
# Already installed in existing project
npm install aws-cdk-lib constructs
```

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── websocket-gateway-stack.js  # Main stack orchestrator
├── vpc.js                       # VPC + VPC endpoints
├── cluster.js                   # ECS cluster
├── redis.js                     # ElastiCache Redis Multi-AZ
├── task-definition.js           # Fargate task with env vars
├── fargate-service.js           # ALB + ECS service + auto-scaling
└── repository.js                # ECR repository (if used)
```

### Pattern 1: VPC Endpoint Creation (Cost Optimization)

**What:** Replace NAT Gateway ($32/mo) with VPC Interface Endpoints (~$7/mo each) for AWS service access from private subnets

**When to use:** ECS tasks in private subnets need access to ECR (pull images), CloudWatch (logs/metrics), Secrets Manager (secrets)

**Example:**
```typescript
// Source: AWS CDK Documentation - VPC Endpoints
import { InterfaceVpcEndpointAwsService } from 'aws-cdk-lib/aws-ec2';

const vpc = new Vpc(scope, 'GatewayVpc', {
  maxAzs: 2,
  natGateways: 0, // Remove NAT Gateway
});

// Add VPC endpoints
vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
  service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
});

vpc.addInterfaceEndpoint('EcrApiEndpoint', {
  service: InterfaceVpcEndpointAwsService.ECR,
});

vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
  service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
});

vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
  service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
});
```

**Note:** ECR requires TWO endpoints (ecr.dkr for Docker operations, ecr.api for API operations). S3 Gateway endpoint (free) also needed for ECR layer storage.

### Pattern 2: ALB with WebSocket Support

**What:** Configure Application Load Balancer for WebSocket (wss://) connections with sticky sessions and TLS termination

**When to use:** WebSocket servers behind a load balancer requiring TLS termination and session persistence

**Example:**
```typescript
// Source: AWS CDK Documentation - Application Load Balancer
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
  Protocol,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';

const alb = new ApplicationLoadBalancer(scope, 'WebSocketALB', {
  vpc: props.vpc,
  internetFacing: true,
  idleTimeout: Duration.seconds(300), // 5 minutes for long-lived WebSocket connections
});

// HTTPS listener with TLS termination
const httpsListener = alb.addListener('HttpsListener', {
  port: 443,
  protocol: ApplicationProtocol.HTTPS,
  certificates: [Certificate.fromCertificateArn(scope, 'Cert', certificateArn)],
});

// Target group with sticky sessions
const targetGroup = httpsListener.addTargets('ECS', {
  port: 8080,
  protocol: ApplicationProtocol.HTTP, // wss:// -> ws:// internally
  targets: [service],
  healthCheck: {
    path: '/health',
    interval: Duration.seconds(30),
    timeout: Duration.seconds(5),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
  },
  deregistrationDelay: Duration.seconds(30), // Graceful shutdown window
  stickinessCookieDuration: Duration.hours(1), // Sticky sessions
});

// HTTP -> HTTPS redirect
alb.addListener('HttpListener', {
  port: 80,
  protocol: ApplicationProtocol.HTTP,
  defaultAction: ListenerAction.redirect({
    protocol: ApplicationProtocol.HTTPS,
    port: '443',
    permanent: true,
  }),
});
```

### Pattern 3: ECS Auto-Scaling with Target Tracking

**What:** Auto-scale ECS Fargate tasks based on CPU utilization (proxy for connection count)

**When to use:** Variable load requiring automatic capacity adjustment within defined min/max bounds

**Example:**
```typescript
// Source: AWS CDK Documentation - ECS Service Auto Scaling
import { ScalingInterval } from 'aws-cdk-lib/aws-applicationautoscaling';

const scaling = service.autoScaleTaskCount({
  minCapacity: 2, // Always maintain redundancy
  maxCapacity: 4, // Cost cap
});

scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70, // Scale up when CPU > 70%
  scaleInCooldown: Duration.seconds(300), // 5 min cooldown for scale-down (aggressive cost savings)
  scaleOutCooldown: Duration.seconds(60), // 1 min cooldown for scale-up (responsive)
});
```

**Note:** Using CPU as proxy metric avoids CloudWatch custom metrics charges. At 500 connections/task capacity, CPU correlates well with connection count.

### Pattern 4: Fargate Task Resource Allocation

**What:** Right-size Fargate task CPU and memory for cost optimization

**When to use:** Known workload characteristics allow precise resource allocation

**Example:**
```typescript
// Source: AWS CDK Documentation - Fargate Task Definition
import { FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';

const taskDef = new FargateTaskDefinition(scope, 'TaskDef', {
  cpu: 256, // 0.25 vCPU
  memoryLimitMiB: 512, // 0.5 GB
});

taskDef.addContainer('WebSocketContainer', {
  image: ContainerImage.fromAsset('.'),
  memoryLimitMiB: 512,
  cpu: 256,
  portMappings: [{ containerPort: 8080 }],
  environment: {
    REDIS_ENDPOINT: redisEndpoint,
    REDIS_PORT: redisPort,
  },
  logging: LogDriver.awsLogs({
    streamPrefix: 'websocket-gateway',
    logRetention: RetentionDays.ONE_WEEK, // Cost optimization
  }),
});
```

**Fargate pricing:** $0.04048/vCPU-hour + $0.004445/GB-hour = ~$6/mo per task at 0.25 vCPU + 0.5 GB

### Pattern 5: Redis Multi-AZ with Cluster Mode Disabled

**What:** ElastiCache Redis replication group with automatic failover across availability zones

**When to use:** High availability requirement for Redis pub/sub coordination

**Example:**
```typescript
// Source: AWS CDK Documentation - ElastiCache
import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';

const subnetGroup = new CfnSubnetGroup(scope, 'RedisSubnetGroup', {
  description: 'Subnet group for Redis cluster',
  subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
});

const replicationGroup = new CfnReplicationGroup(scope, 'RedisCluster', {
  replicationGroupId: 'websocket-redis',
  replicationGroupDescription: 'Redis for WebSocket pub/sub',
  cacheNodeType: 'cache.t4g.micro', // Graviton2, 0.5 GB memory
  engine: 'redis',
  numNodeGroups: 1, // Cluster mode disabled (single shard)
  replicasPerNodeGroup: 1, // Primary + 1 replica = 2 nodes total
  automaticFailoverEnabled: true, // Required for Multi-AZ
  cacheSubnetGroupName: subnetGroup.ref,
  securityGroupIds: [redisSecurityGroup.securityGroupId],
});
```

**Note:** Existing code uses `cache.t3.micro` (x86). Change to `cache.t4g.micro` (Graviton2) for same price, better performance.

### Anti-Patterns to Avoid

- **Cluster Mode Enabled for pub/sub:** Redis pub/sub doesn't benefit from sharding; adds complexity and cost. Use single shard with replication.
- **Public subnets for ECS tasks:** Exposes containers directly to internet. Use private subnets with ALB in public subnets.
- **NAT Gateway for AWS service access:** $32/mo when VPC endpoints cost $7/mo each. Use endpoints for ECR, CloudWatch, Secrets Manager.
- **Custom CloudWatch metrics for auto-scaling:** $0.30/metric/month. Use built-in CPU utilization as proxy for connection count.
- **Fargate Spot for WebSocket gateway:** Spot interruptions terminate active WebSocket connections. Use standard Fargate for stateful connections.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS certificate management | Custom cert rotation, manual renewals | AWS Certificate Manager (ACM) | Free, automatic renewals, seamless ALB integration |
| Load balancer health checks | Custom health check daemon | ALB target group health checks | Built-in, automatic deregistration, zero code |
| Connection draining | Custom drain logic in LB layer | ALB `deregistrationDelay` property | Native support, automatic during ECS task replacement |
| Auto-scaling logic | Custom metrics + Lambda functions | ECS Target Tracking Scaling | Built-in, no custom metrics charges, battle-tested |
| Redis failover | Custom failover scripts | ElastiCache Multi-AZ with automatic failover | Managed, < 60s failover, no manual intervention |
| Security group ingress rules | Manual port calculations | CDK security group connections API | Type-safe, automatic bidirectional rules |

**Key insight:** AWS managed services eliminate operational burden for HA, failover, and lifecycle management. Custom solutions introduce bugs, maintenance costs, and scaling challenges.

## Common Pitfalls

### Pitfall 1: Forgetting S3 Gateway Endpoint for ECR

**What goes wrong:** ECS tasks fail to pull container images from ECR with "timeout" or "no route to host" errors

**Why it happens:** ECR stores Docker layers in S3. VPC endpoints for `ecr.dkr` and `ecr.api` aren't sufficient—S3 access required.

**How to avoid:** Add S3 Gateway Endpoint (free) when using ECR with VPC endpoints and no NAT Gateway

**Warning signs:** CDK deploy succeeds, but ECS tasks stuck in "PROVISIONING" state with image pull failures in CloudWatch Logs

```typescript
vpc.addGatewayEndpoint('S3Endpoint', {
  service: GatewayVpcEndpointAwsService.S3,
});
```

### Pitfall 2: ALB Idle Timeout Too Short for WebSocket

**What goes wrong:** WebSocket connections close unexpectedly after 60 seconds of inactivity

**Why it happens:** ALB default idle timeout is 60 seconds; WebSocket connections idle during low activity

**How to avoid:** Set `idleTimeout` to 300+ seconds and implement server-side ping/pong every 30 seconds

**Warning signs:** Clients reconnect frequently, "connection closed" errors in client logs

```typescript
const alb = new ApplicationLoadBalancer(scope, 'WebSocketALB', {
  vpc: props.vpc,
  internetFacing: true,
  idleTimeout: Duration.seconds(300), // 5 minutes
});
```

### Pitfall 3: Missing Sticky Sessions for WebSocket

**What goes wrong:** WebSocket handshake succeeds, but subsequent messages fail with "connection not found" errors

**Why it happens:** ALB routes requests to different ECS tasks; WebSocket state is task-local

**How to avoid:** Enable sticky sessions (`stickinessCookieDuration`) on ALB target group

**Warning signs:** WebSocket connects successfully but messages fail intermittently

```typescript
const targetGroup = httpsListener.addTargets('ECS', {
  // ... other config
  stickinessCookieDuration: Duration.hours(1),
});
```

### Pitfall 4: Security Group Circular Dependency

**What goes wrong:** CDK synth fails with "Circular dependency between resources" error

**Why it happens:** ECS security group references Redis security group, Redis security group references ECS security group

**How to avoid:** Use `addIngressRule()` after resource creation to establish one-way dependency

**Warning signs:** CDK synth or deploy fails before CloudFormation execution

```typescript
// DON'T: Create security groups with mutual references in constructor

// DO: Create security groups separately, then add ingress rules
const ecsSecurityGroup = new SecurityGroup(scope, 'ECSSecurityGroup', { vpc });
const redisSecurityGroup = new SecurityGroup(scope, 'RedisSecurityGroup', { vpc });

// One-way dependency: Redis allows inbound from ECS
redisSecurityGroup.addIngressRule(ecsSecurityGroup, Port.tcp(6379), 'Allow ECS to connect to Redis');
```

### Pitfall 5: Wrong Certificate ARN Format

**What goes wrong:** CDK deploy fails with "Certificate not found" error

**Why it happens:** ACM certificates are region-specific; ARN must match stack region

**How to avoid:** Use `Certificate.fromCertificateArn()` and verify ARN region matches stack region. For ALB, certificate MUST be in same region as ALB.

**Warning signs:** CDK deploy fails during CloudFormation execution with InvalidCertificate error

```typescript
// Certificate ARN format: arn:aws:acm:REGION:ACCOUNT:certificate/CERT_ID
// Region in ARN must match stack region
const cert = Certificate.fromCertificateArn(
  scope,
  'Cert',
  'arn:aws:acm:us-east-1:123456789012:certificate/abc123...'
);
```

### Pitfall 6: Insufficient Deregistration Delay for Graceful Shutdown

**What goes wrong:** Active WebSocket connections abruptly terminate during ECS task replacement

**Why it happens:** ALB deregisters task before application finishes draining connections

**How to avoid:** Set `deregistrationDelay` >= application graceful shutdown timeout (30s)

**Warning signs:** Connection drops during deployments, "connection reset" errors in client logs

```typescript
const targetGroup = httpsListener.addTargets('ECS', {
  // ... other config
  deregistrationDelay: Duration.seconds(30), // Match app shutdown timeout
});
```

## Code Examples

Verified patterns from AWS CDK documentation:

### VPC with Endpoints (No NAT Gateway)

```typescript
// Source: AWS CDK VPC Documentation
import { Vpc, InterfaceVpcEndpointAwsService, GatewayVpcEndpointAwsService } from 'aws-cdk-lib/aws-ec2';

export function createVpc(scope: Construct): Vpc {
  const vpc = new Vpc(scope, 'GatewayVpc', {
    maxAzs: 2,
    natGateways: 0, // Remove NAT Gateway
  });

  // ECR requires two endpoints
  vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
  });

  vpc.addInterfaceEndpoint('EcrApiEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR,
  });

  // CloudWatch Logs for ECS task logs
  vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
    service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
  });

  // Secrets Manager (if using for Redis password or other secrets)
  vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
    service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  });

  // S3 Gateway Endpoint (free) for ECR layer storage
  vpc.addGatewayEndpoint('S3Endpoint', {
    service: GatewayVpcEndpointAwsService.S3,
  });

  return vpc;
}
```

### ALB with TLS, Sticky Sessions, and Health Checks

```typescript
// Source: AWS CDK Application Load Balancer Documentation
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Duration } from 'aws-cdk-lib';

export function createFargateServiceWithALB(scope: Construct, props: FargateServiceProps) {
  const alb = new ApplicationLoadBalancer(scope, 'WebSocketALB', {
    vpc: props.vpc,
    internetFacing: true,
    idleTimeout: Duration.seconds(300), // 5 minutes for WebSocket
  });

  // HTTPS listener with TLS termination
  const httpsListener = alb.addListener('HttpsListener', {
    port: 443,
    protocol: ApplicationProtocol.HTTPS,
    certificates: [Certificate.fromCertificateArn(scope, 'Cert', props.certificateArn)],
  });

  // Create ECS service (security groups, etc. omitted for brevity)
  const service = new FargateService(scope, 'FargateWebSocketService', {
    cluster: props.cluster,
    taskDefinition: props.taskDef,
    desiredCount: 2,
    assignPublicIp: false, // Private subnets
    securityGroups: [ecsSecurityGroup],
  });

  // Target group with sticky sessions and health checks
  const targetGroup = httpsListener.addTargets('ECS', {
    port: 8080,
    protocol: ApplicationProtocol.HTTP, // wss:// -> ws:// internally
    targets: [service],
    healthCheck: {
      path: '/health',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    },
    deregistrationDelay: Duration.seconds(30), // Graceful shutdown
    stickinessCookieDuration: Duration.hours(1), // Enable sticky sessions
  });

  // HTTP -> HTTPS redirect
  alb.addListener('HttpListener', {
    port: 80,
    protocol: ApplicationProtocol.HTTP,
    defaultAction: ListenerAction.redirect({
      protocol: ApplicationProtocol.HTTPS,
      port: '443',
      permanent: true,
    }),
  });

  return { alb, service };
}
```

### ECS Auto-Scaling with Target Tracking

```typescript
// Source: AWS CDK ECS Service Auto Scaling Documentation
import { Duration } from 'aws-cdk-lib';

export function configureAutoScaling(service: FargateService) {
  const scaling = service.autoScaleTaskCount({
    minCapacity: 2, // Always maintain redundancy
    maxCapacity: 4, // Cost cap
  });

  scaling.scaleOnCpuUtilization('CpuScaling', {
    targetUtilizationPercent: 70, // Scale up when CPU > 70%
    scaleInCooldown: Duration.seconds(300), // 5 min cooldown for scale-down
    scaleOutCooldown: Duration.seconds(60), // 1 min cooldown for scale-up
  });

  return scaling;
}
```

### Fargate Task Definition with Optimized Resources

```typescript
// Source: AWS CDK Fargate Task Definition Documentation
import { FargateTaskDefinition, ContainerImage, LogDriver } from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export function createTaskDefinition(scope: Construct, props: TaskDefinitionProps): FargateTaskDefinition {
  const taskDef = new FargateTaskDefinition(scope, 'TaskDef', {
    cpu: 256, // 0.25 vCPU
    memoryLimitMiB: 512, // 0.5 GB
  });

  taskDef.addContainer('WebSocketContainer', {
    image: ContainerImage.fromAsset('.'),
    memoryLimitMiB: 512,
    cpu: 256,
    portMappings: [{ containerPort: 8080 }],
    environment: {
      REDIS_ENDPOINT: props.redisEndpoint,
      REDIS_PORT: props.redisPort || '6379',
    },
    logging: LogDriver.awsLogs({
      streamPrefix: 'websocket-gateway',
      logRetention: RetentionDays.ONE_WEEK, // Cost optimization
    }),
  });

  return taskDef;
}
```

### Redis Multi-AZ with Graviton2

```typescript
// Source: AWS CDK ElastiCache Documentation
import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';
import { Vpc, SecurityGroup, Port } from 'aws-cdk-lib/aws-ec2';

export function createRedis(scope: Construct, vpc: Vpc) {
  const redisSecurityGroup = new SecurityGroup(scope, 'RedisSecurityGroup', {
    vpc,
    description: 'Security group for Redis cluster',
    allowAllOutbound: false,
  });

  const subnetGroup = new CfnSubnetGroup(scope, 'RedisSubnetGroup', {
    description: 'Subnet group for Redis cluster',
    subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
  });

  const replicationGroup = new CfnReplicationGroup(scope, 'RedisCluster', {
    replicationGroupId: 'websocket-redis',
    replicationGroupDescription: 'Redis for WebSocket pub/sub',
    cacheNodeType: 'cache.t4g.micro', // Graviton2, 0.5 GB memory
    engine: 'redis',
    numNodeGroups: 1,
    replicasPerNodeGroup: 1,
    automaticFailoverEnabled: true,
    cacheSubnetGroupName: subnetGroup.ref,
    securityGroupIds: [redisSecurityGroup.securityGroupId],
  });

  replicationGroup.addDependency(subnetGroup);

  return {
    replicationGroup,
    securityGroup: redisSecurityGroup,
    endpoint: replicationGroup.attrConfigurationEndPointAddress,
    port: 6379,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CDK v1 with separate @aws-cdk/* packages | CDK v2 with unified aws-cdk-lib | Dec 2021 | Single dependency, faster installs, consistent versioning |
| NAT Gateway for AWS service access | VPC Interface/Gateway Endpoints | 2019+ | $32/mo → $7-21/mo savings, no bandwidth charges |
| x86 Fargate/ElastiCache (t3) | Graviton2 instances (t4g) | 2020+ | Same price, 20-40% better performance, lower power |
| Network Load Balancer for WebSocket | Application Load Balancer with WebSocket support | 2018+ | ALB added WebSocket support, TLS termination, sticky sessions |
| Manual ECS scaling with CloudWatch Alarms | Target Tracking Scaling Policies | 2017+ | Simpler configuration, automatic step scaling calculations |

**Deprecated/outdated:**
- CDK v1: Deprecated April 2023, maintenance mode only. Use CDK v2 (aws-cdk-lib).
- EC2 Classic: Retired Aug 2022. All resources must be in VPC.
- Cache node type t2: Use t3 (better performance, similar price) or t4g (Graviton2, best value).

## Open Questions

1. **ACM Certificate ARN**
   - What we know: User needs to create ACM certificate manually or use existing
   - What's unclear: Certificate ARN not provided in context
   - Recommendation: Parameterize certificate ARN in CDK stack or read from SSM Parameter Store

2. **CloudWatch Log Retention Cost vs Compliance**
   - What we know: 7-day retention suggested for cost optimization
   - What's unclear: Whether user has compliance requirements for longer retention
   - Recommendation: Start with 7 days, can increase if needed

3. **Container Image Source**
   - What we know: Task definition uses `ContainerImage.fromAsset('.')` (local build)
   - What's unclear: Whether to use ECR repository vs CDK build-time image
   - Recommendation: Keep fromAsset for initial deploy; can switch to ECR repo later for CI/CD

## Sources

### Primary (HIGH confidence)
- AWS CDK v2 Official Documentation - VPC, ECS, ALB, ElastiCache constructs
- AWS Fargate Pricing Calculator - $0.04048/vCPU-hour, $0.004445/GB-hour (us-east-1, 2026)
- AWS ElastiCache Pricing - cache.t4g.micro Multi-AZ pricing
- AWS ALB Pricing - $0.0225/hour + $0.008/LCU-hour (us-east-1, 2026)
- Existing project CDK code - lib/*.js files (verified working patterns)

### Secondary (MEDIUM confidence)
- AWS Best Practices for WebSocket on ECS - ALB idle timeout, sticky sessions
- AWS VPC Endpoint Pricing - $0.01/hour per AZ ($7.20/mo per endpoint)

### Tertiary (LOW confidence)
- None - all findings verified with official AWS sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - AWS CDK official library, verified in existing project
- Architecture: HIGH - Patterns derived from AWS documentation and existing working code
- Pitfalls: HIGH - Common issues documented in AWS troubleshooting guides

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - infrastructure patterns are stable)

---

*Phase: 02-aws-infrastructure-foundation*
*Research complete: 2026-03-02*
