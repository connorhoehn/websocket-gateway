# Technology Stack

**Analysis Date:** 2026-04-12

## Languages

**Primary:**
- JavaScript (Node.js) - Backend WebSocket gateway (`src/`)
- TypeScript - CDK infrastructure (`lib/`, `bin/`) and frontend (`frontend/`)

**Secondary:**
- Shell scripts - Deployment and local dev (`deploy.sh`, `scripts/`)

## Runtime

**Environment:**
- Node.js >= 18.0.0 (specified in `src/package.json` engines field)
- No `.nvmrc` or `.node-version` detected

**Package Manager:**
- npm (lockfile present at `src/package-lock.json` and root `package-lock.json`)
- Two separate package.json files:
  - Root `package.json`: CDK infrastructure + dev tooling
  - `src/package.json`: Runtime gateway application

## Frameworks

**Core:**
- `ws` ^8.14.0 - Raw WebSocket server (no Socket.IO or higher-level framework)
- Node.js `http` module - HTTP server for health checks + SPA static serving
- No Express, Fastify, or other HTTP framework

**CRDT/Collaboration:**
- `yjs` ^13.6.30 - CRDT data structure library for collaborative editing
- `y-protocols` ^1.0.7 - Y.js protocol utilities (awareness, sync)
- `lib0` ^0.2.117 - Y.js utility library

**Testing:**
- `jest` ^29.7.0 - Test runner (root package.json)
- `ts-jest` ^29.2.5 - TypeScript support for Jest

**Build/Dev:**
- `typescript` ~5.6.3 - TypeScript compiler (CDK infrastructure only)
- `aws-cdk` 2.1016.0 - CDK CLI
- `aws-cdk-lib` 2.195.0 - CDK constructs library
- Docker (`Dockerfile` present)
- Tilt + Helm for local K8s dev (`k8s/` directory)

## Key Dependencies

**Critical (runtime):**
- `ws` ^8.14.0 - WebSocket server; the entire gateway is built on this
- `redis` ^4.6.0 - Redis pub/sub for distributed message routing and state caching
- `yjs` ^13.6.30 - CRDT engine for collaborative document editing
- `jsonwebtoken` ^9.0.3 - JWT validation for Cognito tokens
- `jwks-rsa` ^3.2.2 - JWKS key fetching for Cognito JWT verification
- `lru-cache` ^10.4.3 - In-memory caching (session store, chat history)

**AWS SDK (runtime):**
- `@aws-sdk/client-dynamodb` ^3.1000.0 - DynamoDB for CRDT snapshots and document metadata
- `@aws-sdk/client-cloudwatch` ^3.1000.0 - CloudWatch metrics emission
- `@aws-sdk/client-eventbridge` ^3.1029.0 - EventBridge for decoupled snapshot persistence
- `@aws-sdk/client-ivschat` ^3.1000.0 - IVS Chat integration (optional, disabled if no room ARN)
- `@aws-sdk/client-cognito-identity-provider` ^3.1019.0 - Cognito (root package only)

**Infrastructure (CDK, not runtime):**
- `@aws-cdk/*` v1 packages (legacy) in root package.json alongside `aws-cdk-lib` v2
- `constructs` ^10.0.0

## Configuration

**Environment Variables (required):**
- `COGNITO_REGION` - AWS region for Cognito (server exits if missing)
- `COGNITO_USER_POOL_ID` - Cognito User Pool ID (server exits if missing)

**Environment Variables (optional with defaults):**
- `REDIS_ENDPOINT` - Redis host (default: `redis`)
- `REDIS_PORT` - Redis port (default: `6379`)
- `PORT` - Server HTTP port (default: `8080`)
- `ENABLED_SERVICES` - Comma-separated list (default: `chat,presence,cursor,reaction,crdt`)
- `LOG_LEVEL` - Logger level (default: `info`)
- `SKIP_AUTH` - Set `true` to bypass Cognito JWT validation (local dev)
- `AWS_REGION` - AWS region for DynamoDB/CloudWatch (default: `us-east-1`)
- `LOCALSTACK_ENDPOINT` - LocalStack URL for local AWS service emulation
- `DIRECT_DYNAMO_WRITE` - Set `true` to write snapshots directly to DynamoDB (bypasses EventBridge)
- `DYNAMODB_CRDT_TABLE` - DynamoDB table for CRDT snapshots (default: `crdt-snapshots`)
- `DYNAMODB_DOCUMENTS_TABLE` - DynamoDB table for document metadata (default: `crdt-documents`)
- `EVENT_BUS_NAME` - EventBridge bus name (default: `social-events`)
- `SNAPSHOT_DEBOUNCE_MS` - Debounce window for snapshot writes (default: `5000`)
- `SNAPSHOT_INTERVAL_MS` - Periodic snapshot interval (default: `300000`)
- `IDLE_EVICTION_MS` - Y.Doc idle eviction timeout (default: `600000`)
- `MAX_CONNECTIONS_PER_IP` - Per-IP connection limit (default: `100`)
- `MAX_TOTAL_CONNECTIONS` - Global connection limit (default: `10000`)
- `ALLOWED_ORIGINS` - Comma-separated CORS origins (default: `*`)
- `IVS_CHAT_ROOM_ARN` - IVS Chat room ARN (optional, feature disabled if unset)

**Build Configuration:**
- `tsconfig.json` - TypeScript config (CDK infrastructure)
- `jest.config.js` - Jest test configuration
- `cdk.json` - CDK app entry point
- `Dockerfile` - Container build for gateway
- `k8s/` - Helm charts for Kubernetes deployment

## Platform Requirements

**Development:**
- Docker + Docker Compose (or Colima K8s + Tilt + Helm)
- LocalStack for AWS service emulation
- Redis (containerized via Docker Compose or Helm)
- Node.js >= 18

**Production:**
- AWS ECS (containerized deployment)
- Redis running in ECS (NOT ElastiCache - see project rules)
- DynamoDB for persistent CRDT snapshots and document metadata
- Cognito for authentication
- CloudWatch for metrics and monitoring
- EventBridge for decoupled event processing
- Lambda for snapshot persistence and message review

---

*Stack analysis: 2026-04-12*
