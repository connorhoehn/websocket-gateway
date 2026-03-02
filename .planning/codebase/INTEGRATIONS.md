# External Integrations

**Analysis Date:** 2026-03-02

## APIs & External Services

**WebSocket Clients:**
- Client connects via WebSocket protocol (`ws://`) to the gateway
- Bidirectional message passing through `src/server.js` WebSocket server
- Health check endpoint at `GET /health` (Dockerfile health check)

## Data Storage

**Databases:**
- Redis Cluster (AWS ElastiCache or local)
  - Connection: Configured via `REDIS_ENDPOINT` and `REDIS_PORT` environment variables
  - Client: `redis` npm package v4.6.0
  - URL format: `redis://{REDIS_ENDPOINT}:{REDIS_PORT}`
  - Default: `redis://redis:6379`
  - Usage: Pub/sub messaging for distributed WebSocket node communication
  - Instance type (AWS): `cache.t3.micro` with automatic failover enabled
  - Port: 6379 (standard Redis port)

**File Storage:**
- Local filesystem only - no file storage integration

**Caching:**
- Redis serves dual purpose as both primary pub/sub broker and optional cache layer
- No separate caching service configured

## Authentication & Identity

**Auth Provider:**
- Custom or none - No auth integration detected in codebase
- Implementation: WebSocket connections are not authenticated in current implementation
- Note: No auth provider SDK dependencies present

## Monitoring & Observability

**Error Tracking:**
- None detected - No error tracking service integration (e.g., Sentry, DataDog)

**Logs:**
- CloudWatch Logs
  - Log group: `/ecs/websocket-gateway`
  - AWS CDK integration via `aws-cdk-lib/aws-logs` (`lib/task-definition.ts`)
  - ECS task logs configured with AWS Logs driver
  - Log prefix: `websocket-gateway`
  - Custom Logger class at `src/utils/logger.js` for application-level logging with configurable `LOG_LEVEL`

**Metrics:**
- CloudWatch Metrics available through ECS task metrics
- No custom metrics integration configured

## Networking

**DNS & Load Balancing:**
- AWS Network Load Balancer (NLB)
  - Internet-facing (public subnets)
  - Port: 80 (forwards to ECS tasks on port 8080)
  - Target group: ECS Fargate service tasks
  - Instance: Created in `lib/fargate-service.ts`
  - Output: WebSocket URL exposed as `ws://{loadBalancerDnsName}`

**Security Groups:**
- ECS Service Security Group:
  - Inbound: Port 8080 from NLB
  - Outbound: Port 443 (HTTPS) to AWS VPC endpoints
  - Optionally: Port 6379 to Redis security group (if Redis enabled)

- Redis Security Group:
  - Inbound: Port 6379 from ECS security group only
  - Outbound: Restricted (no all-outbound)

**Subnets:**
- VPC with public, private, and isolated subnets
- NLB: Public subnets
- ECS tasks: Private isolated subnets
- Redis: Isolated subnets (ElastiCache subnet group)

## CI/CD & Deployment

**Hosting:**
- AWS (via CDK)
  - Compute: ECS Fargate
  - Container: Docker images
  - Orchestration: ECS Cluster
  - Load balancing: Network Load Balancer
  - Database: ElastiCache Redis (optional)

**Infrastructure as Code:**
- AWS CDK (TypeScript)
  - Entry point: `bin/websocker_gateway.ts`
  - Stack definition: `lib/websocket-gateway-stack.ts`
  - Stack name: `WebsockerGatewayStack`
  - Deployment script: `deploy.sh`

**CI Pipeline:**
- None detected - No GitHub Actions, GitLab CI, or other CI service integration

**Local Development:**
- Docker Compose
  - Configuration: `docker-compose.yml`
  - Services: websocket-gateway, chat-service, presence-service, cursor-service, websocket-dev
  - Profiles for selective service startup
  - Local Redis container (core-redis)
  - Network: Custom bridge network (websocket-network) + shared external network

## Environment Configuration

**Required env vars:**
- `REDIS_ENDPOINT` - Redis server host
- `REDIS_PORT` - Redis server port
- `PORT` - WebSocket server port
- `ENABLED_SERVICES` - Comma-separated service list
- `LOG_LEVEL` - Logging level
- `NODE_ENV` - Environment type

**Optional env vars:**
- `ENABLE_REDIS` - Enable Redis support in CDK stack (default: false)
- `npm_package_version` - Application version

**Secrets location:**
- Environment variables (via `.env` files or deployment configuration)
- No AWS Secrets Manager integration currently configured
- AWS IAM roles for service authentication

## Webhooks & Callbacks

**Incoming:**
- WebSocket client connections on port 8080
- Health check endpoint: `GET /health`

**Outgoing:**
- Redis pub/sub channels for distributed messaging:
  - `node:register` - Node registration events
  - `node:deregister` - Node deregistration events
  - `chat:*` - Chat service messages
  - `presence:*` - Presence service messages
  - `cursor:*` - Cursor service messages
  - `reaction:*` - Reaction service messages
  - `heartbeat` - Node health heartbeats

## AWS Infrastructure

**Core Services Used:**
- EC2 - VPC, Security Groups, Subnets, Network Interfaces
- ECS - Cluster, Task Definitions, Fargate Services
- ElastiCache - Redis replication groups and subnet groups
- Elastic Load Balancing - Network Load Balancer
- CloudWatch - Logs and Metrics
- IAM - Execution roles and policies
- (Optional) S3, API Gateway, DynamoDB, Lambda modules included but not used

**CDK Modules:**
- `lib/vpc.ts` - VPC with public/private/isolated subnets
- `lib/cluster.ts` - ECS cluster within VPC
- `lib/task-definition.ts` - Fargate task definition with container configuration
- `lib/fargate-service.ts` - Fargate service with NLB
- `lib/redis.ts` - ElastiCache Redis cluster (optional via `ENABLE_REDIS` env var)
- `lib/websocket-gateway-stack.ts` - Main stack orchestration

---

*Integration audit: 2026-03-02*
