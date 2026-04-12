# External Integrations

**Analysis Date:** 2026-04-12

## APIs & External Services

**AWS Cognito (Authentication):**
- Purpose: JWT-based authentication for WebSocket connections
- SDK/Client: `jsonwebtoken` ^9.0.3 + `jwks-rsa` ^3.2.2
- Auth flow: Client passes JWT token as `?token=` query param on WebSocket upgrade
- JWKS endpoint: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`
- Implementation: `src/middleware/auth-middleware.js`
- Required env: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`
- Dev bypass: `SKIP_AUTH=true` accepts any connection with userId from query params

**AWS IVS Chat (Optional):**
- Purpose: Managed chat with persistent history and moderation
- SDK/Client: `@aws-sdk/client-ivschat`
- Implementation: `src/services/ivs-chat-service.js`
- Feature flag: Only enabled when `IVS_CHAT_ROOM_ARN` env var is set
- Graceful degradation: Falls back to standard `ChatService` when disabled

## Data Storage

**Redis:**
- Purpose: Distributed pub/sub message routing, state caching, rate limiting, session storage
- Client: `redis` ^4.6.0 (node-redis v4)
- Connection: `redis://{REDIS_ENDPOINT}:{REDIS_PORT}` (default: `redis:6379`)
- Reconnect strategy: exponential backoff `Math.min(retries * 50, 1000)ms`
- Uses two clients: publisher + subscriber (required for Redis pub/sub pattern)
- Graceful degradation: All services fall back to local-only mode when Redis is unavailable
- Key patterns used:
  - `websocket:nodes` - Active node set
  - `websocket:node:{nodeId}:*` - Node info, clients, channels, heartbeat
  - `websocket:client:{clientId}:*` - Client-node mapping, metadata, channels
  - `websocket:channel:{channel}:nodes` - Channel-to-node routing
  - `websocket:route:{channel}` - Redis pub/sub channels for message routing
  - `websocket:direct:{nodeId}` - Direct node-to-node messaging
  - `websocket:broadcast:all` - Global broadcast channel
  - `rate:{clientId}:{type}` - Rate limit counters (1s TTL)
  - `session:{token}` - Session data (24hr TTL)
  - `crdt:snapshot:{channel}` - CRDT snapshot hot-cache (1hr TTL)
  - `doc:meta:{id}` - Document metadata
  - `doc:list` - Sorted set of document IDs by updatedAt
  - `activity:history:{channel}` - Activity event history (24hr TTL, capped at 200)
  - `cursor:client:{id}` / `cursor:channel:{ch}` - Cursor state (30s TTL)

**DynamoDB:**
- Purpose: Persistent CRDT snapshot storage and document metadata
- Client: `@aws-sdk/client-dynamodb` (raw client, no Document Client or ORM)
- Tables:
  - `crdt-snapshots` (env: `DYNAMODB_CRDT_TABLE`): PK=`documentId` (S), SK=`timestamp` (N)
    - Stores gzip-compressed Y.js state snapshots
    - TTL field for auto-expiry: 30 days (auto), 90 days (pre-restore/pre-clear), no TTL (manual)
    - Version metadata: `versionType`, `author`, `versionName`, `sizeBytes`
  - `crdt-documents` (env: `DYNAMODB_DOCUMENTS_TABLE`): PK=`documentId` (S)
    - Stores document metadata (title, type, status, createdBy, timestamps)
    - Used as fallback when Redis is empty (hydration on startup)
- Implementation: `src/services/crdt-service.js` (DynamoDB operations inline, no separate DAO)
- Local dev: Tables auto-created via LocalStack when `DIRECT_DYNAMO_WRITE=true`
- Two write paths:
  1. Direct DynamoDB write (`DIRECT_DYNAMO_WRITE=true`): Used in local dev
  2. EventBridge -> Lambda -> DynamoDB: Used in production (decoupled)

**File Storage:**
- No external file storage (S3 CDK construct exists in root package.json but not used at runtime)

**Caching:**
- Redis for hot-cache (CRDT snapshots, document metadata, sessions)
- `lru-cache` for in-memory fallback (sessions: 10K max, chat history: 100 msgs/channel)
- Node-level in-memory cache for channel-to-node mapping (5s TTL in `src/core/node-manager.js`)

## Authentication & Identity

**Auth Provider:** AWS Cognito
- Implementation: `src/middleware/auth-middleware.js`
- Token type: JWT (RS256) passed as query parameter on WebSocket upgrade
- JWKS caching: 1 hour cache, rate limited to 10 requests/minute
- User context extracted: `{ userId, email, channels, isAdmin }`
- Token validation: issuer check, signature verification, expiry check

**Authorization:**
- Implementation: `src/middleware/authz-middleware.js`
- Channel-based permission model:
  - `public:*` channels: accessible to all authenticated users
  - `admin:*` channels: require `isAdmin` claim
  - Other channels: must be in user's `channels` array claim
  - Admins bypass all channel restrictions
- Applied per-service at channel subscribe/join time

## Monitoring & Observability

**Metrics (CloudWatch):**
- Implementation: `src/utils/metrics-collector.js`
- Namespace: `WebSocketGateway`
- Emission interval: Every 60 seconds
- Standard metrics:
  - `activeConnections` (Count)
  - `messagesPerSecond` (Count/Second)
  - `p95Latency` (Milliseconds) - computed from histogram buckets
- Custom alarm metrics:
  - `ConnectionFailures` - Failed WebSocket upgrades (auth failures)
  - `AuthorizationDenials` - Channel permission denials
  - `ValidationErrors` - Message validation failures
  - `RateLimitExceeded` - Rate limit violations
  - `ServiceErrors` - Internal service errors
  - `ReconnectionAttempts/Successes/Failures` - Session reconnection tracking
- Dimensions: `NodeId`, `ServiceName`
- Health check: fails after 3 consecutive flush failures

**Logging:**
- Implementation: `src/utils/logger.js`
- Format: JSON-structured with `timestamp`, `level`, `name`, `message`, `context`
- Levels: error, warn, info, debug (configurable via `LOG_LEVEL` env var)
- Correlation IDs: Per-message `correlationId` for cross-service tracing
- Safe serialization: Handles circular references
- Output: stdout/stderr (console.log/console.error)

**Error Tracking:**
- No external error tracking service (Sentry, Datadog, etc.)
- Errors logged to CloudWatch via structured JSON logs

## CI/CD & Deployment

**Hosting:**
- AWS ECS (containerized)
- Local dev: Colima K8s + Tilt + Helm (or Docker Compose)

**CI Pipeline:**
- Not detected in repository (no `.github/workflows/`, `.gitlab-ci.yml`, etc.)

**Container:**
- `Dockerfile` at project root
- Helm charts in `k8s/` directory

**CDK Infrastructure:**
- CDK v2 (`aws-cdk-lib` 2.195.0) for AWS resource provisioning
- Entry point: `bin/websocker_gateway.js`
- Stack definitions: `lib/`

## Webhooks & Callbacks

**Incoming (via Redis pub/sub):**
- Social API publishes events to Redis channels that the gateway's `SocialService` relays to WebSocket clients
- Activity Lambda publishes to `activity:broadcast` Redis channel
- Any service can publish to `websocket:route:{channel}` to reach WebSocket clients

**Outgoing:**
- EventBridge events: `crdt.checkpoint` published by CRDT service for snapshot persistence
  - Source: `crdt-service`
  - Bus: configurable via `EVENT_BUS_NAME` (default: `social-events`)
  - Consumer: Lambda function (`lambdas/` directory)
- CloudWatch PutMetricData: metrics emitted every 60 seconds

**Lambda Functions:**
- `src/lambda/message-review-handler.js` - Message review/moderation
- `lambdas/` directory - Additional Lambda functions (snapshot persistence)

## Environment Configuration

**Required env vars:**
- `COGNITO_REGION` - Server refuses to start without this
- `COGNITO_USER_POOL_ID` - Server refuses to start without this

**Environment files:**
- `.env` files present (existence noted, contents not read)
- Docker Compose files reference environment variables

**Secrets location:**
- AWS Cognito JWKS keys fetched at runtime (no local secrets for auth)
- Redis credentials: none (no auth configured in connection URL)
- AWS credentials: IAM roles in production, env vars or profile in local dev

---

*Integration audit: 2026-04-12*
