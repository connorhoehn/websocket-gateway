# Technology Stack

**Analysis Date:** 2026-03-02

## Languages

**Primary:**
- TypeScript 5.6.3 - Infrastructure as Code via AWS CDK in `lib/` directory
- JavaScript (Node.js) - Runtime application code in `src/` directory

**Secondary:**
- Shell - Deployment scripts (`deploy.sh`)

## Runtime

**Environment:**
- Node.js 20 (Alpine Linux) - Specified in `Dockerfile`
- Node.js >=18.0.0 - Minimum requirement in `src/package.json`

**Package Manager:**
- npm - Primary package manager
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- AWS CDK 2.195.0 - Infrastructure provisioning in `lib/`
- aws-cdk-lib 2.195.0 - AWS construct library for CDK definitions
- constructs ^10.0.0 - CDK construct base classes

**WebSocket:**
- ws 8.14.0 - WebSocket server implementation (`src/server.js`, `src/core/websocket-manager.js`)

**Data:**
- redis 4.6.0 - Redis pub/sub client for distributed messaging (`src/server.js`)

## Key Dependencies

**Critical:**
- aws-cdk 2.1016.0 - CLI tool for CDK deployment
- aws-cdk-lib 2.195.0 - AWS service constructs (EC2, ECS, ElastiCache, LoadBalancing, IAM, Logs, S3)
- redis 4.6.0 - Redis client for pub/sub messaging across WebSocket nodes
- ws 8.14.0 - WebSocket protocol implementation for real-time connections
- constructs ^10.0.0 - Base library for CDK construct implementation

**AWS Service Modules:**
- @aws-cdk/aws-ec2 ^1.203.0 - VPC, Security Groups, Subnets
- @aws-cdk/aws-ecs ^1.203.0 - ECS Cluster, Fargate Service, Task Definitions
- @aws-cdk/aws-elasticloadbalancingv2 ^1.203.0 - Network Load Balancer
- @aws-cdk/aws-elasticache - Redis cluster provisioning (imported in `lib/redis.ts`)
- @aws-cdk/aws-iam ^1.203.0 - IAM Roles and Policies
- @aws-cdk/aws-logs ^1.203.0 - CloudWatch Logs
- @aws-cdk/aws-s3 ^1.203.0 - S3 bucket support
- @aws-cdk/aws-apigateway ^1.203.0 - API Gateway (included but not actively used in current stack)
- @aws-cdk/aws-dynamodb ^1.203.0 - DynamoDB (included but not actively used)
- @aws-cdk/aws-lambda ^1.203.0 - Lambda functions (included but not actively used)

**Development:**
- TypeScript ~5.6.3 - TypeScript compiler
- ts-node ^10.9.2 - Execute TypeScript directly
- ts-jest ^29.2.5 - Jest transformer for TypeScript
- jest ^29.7.0 - Unit test framework
- @types/jest ^29.5.14 - Jest type definitions
- @types/node 22.7.9 - Node.js type definitions

## Configuration

**Environment:**
- Configuration managed via environment variables:
  - `REDIS_ENDPOINT` - Redis host (default: 'redis')
  - `REDIS_PORT` - Redis port (default: 6379)
  - `PORT` - WebSocket server port (default: 8080)
  - `ENABLED_SERVICES` - Comma-separated list of services to enable (default: 'chat,presence,cursor,reaction')
  - `LOG_LEVEL` - Logging verbosity (default: 'info')
  - `NODE_ENV` - Environment (development/production)
  - `ENABLE_REDIS` - Toggle Redis support (default: 'false') in CDK stack

- Configuration files:
  - `config/full-service.env` - All services enabled
  - `config/chat-only.env` - Chat service only
  - `config/presence-only.env` - Presence service only
  - `config/cursor-only.env` - Cursor service only
  - `config/local-dev.env` - Local development configuration

**Build:**
- `tsconfig.json` - TypeScript compiler configuration targeting ES2022, NodeNext modules
- `jest.config.js` - Jest test runner configuration (Node environment, `test/` directory, ts-jest transform)
- `cdk.json` - CDK application entry point and context configuration
- `Dockerfile` - Container image definition (Node 20 Alpine, non-root user)

## Platform Requirements

**Development:**
- Node.js 18+ or 20+
- npm for dependency management
- AWS CLI credentials configured for CDK deployments
- Docker (for containerized development)

**Production:**
- AWS Account with permissions for:
  - EC2 (VPC, Security Groups, Subnets)
  - ECS (Fargate clusters, task definitions, services)
  - ElastiCache (Redis clusters)
  - Elastic Load Balancing (Network Load Balancer)
  - CloudWatch (Logs)
  - IAM (Roles and policies)
- Docker container runtime (ECS Fargate)
- Redis cluster (AWS ElastiCache or external)

---

*Stack analysis: 2026-03-02*
