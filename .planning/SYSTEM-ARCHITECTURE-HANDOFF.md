# System Architecture Handoff

> Comprehensive analysis from 10 parallel research agents. Use this as the single source of truth for understanding the system before making changes.
> Last updated: 2026-04-11

---

## Table of Contents
1. [Design Guardrails](#design-guardrails)
2. [System Overview](#system-overview)
3. [Infrastructure (CDK)](#infrastructure-cdk)
4. [Redis Architecture](#redis-architecture)
5. [WebSocket Architecture](#websocket-architecture)
6. [Frontend](#frontend)
7. [Social API](#social-api)
8. [Lambda Functions](#lambda-functions)
9. [DynamoDB Data Model](#dynamodb-data-model)
10. [CRDT & Sync](#crdt--sync)
11. [Multi-Tab Behavior](#multi-tab-behavior)
12. [Known Bugs & Gaps](#known-bugs--gaps)
13. [Portability Notes](#portability-notes)

---

## Design Guardrails

**HARD RULES — do not violate these:**

| Rule | Reason |
|------|--------|
| **NO ElastiCache** | Takes ~20min to deploy via CDK. Redis MUST run as ECS container (sidecar or standalone service). `lib/redis.ts` has been deleted. |
| **Fast CDK deploys** | All infrastructure must deploy in < 1 minute. No managed caches, no NAT gateways. |
| **Portable components** | System should be extractable into other projects. Keep coupling loose. |

---

## System Overview

```
Browser (React SPA)
  │
  ├── WSS ──► ALB ──► ECS Fargate (WebSocket Gateway + Redis sidecar)
  │                     ├── Node.js server (port 8080)
  │                     └── Redis 7 Alpine (port 6379, localhost)
  │
  ├── HTTPS ──► Social API (Express, port 3001)
  │               └── DynamoDB (9 social tables)
  │
  └── Cognito (auth)

Async Pipeline:
  Social API ──► DynamoDB Outbox ──► Outbox-Relay Lambda ──► SQS ──► Activity-Log Lambda ──► DynamoDB + Redis pub/sub
```

**CDK Stacks (in `bin/websocker_gateway.ts`):**
- `WebsocketGatewayStack` — VPC, ECS, ALB, Cognito, CloudWatch
- `SocialStack` — 9 DynamoDB tables for social features
- `EventBusStack` — **EXISTS but NOT instantiated** (see Gaps)

---

## Infrastructure (CDK)

### VPC (`lib/vpc.ts`)
- 2 AZs, public + private isolated subnets
- **0 NAT gateways** (cost optimization)
- VPC endpoints: S3, DynamoDB (gateway); ECR, CloudWatch Logs, Secrets Manager (interface)

### ECS (`lib/fargate-service.ts`, `lib/task-definition.ts`)
- **Cluster:** `GatewayCluster`
- **Task:** 512 CPU / 1024 MB, ARM64 (Graviton)
  - Container 1: `RedisContainer` — `redis:7-alpine`, 128 CPU / 128 MB, port 6379
  - Container 2: `WebSocketContainer` — app image, 384 CPU / 896 MB, port 8080
  - App waits for Redis START before launching
- **Service:** 2 desired, min 2 / max 4, CPU auto-scaling at 70%
- **ALB:** Internet-facing, 300s idle timeout (WebSocket), sticky sessions (1hr cookie)
- **Health check:** `/health`, 30s interval, 2 healthy / 3 unhealthy threshold

### Authentication (`lib/cognito.ts`)
- User Pool: `websocket-gateway-users`, email sign-in, self-signup disabled
- Client: `wsgateway-server`, USER_PASSWORD + SRP auth flows

### Monitoring (`lib/dashboard.ts`, `lib/alarms.ts`)
- Dashboard: connections, message throughput, P95 latency, errors, ECS CPU/memory, ALB health
- Alarms: memory >80%, connection failures >10/min, auth denials >5/min → SNS

### Environment Variables (ECS task)
```
REDIS_ENDPOINT=localhost
REDIS_PORT=6379
DYNAMODB_CRDT_TABLE=crdt-snapshots
COGNITO_USER_POOL_ID=<from stack>
COGNITO_REGION=<stack region>
```

---

## Redis Architecture

### Current Model: Sidecar (per-task)
Each ECS task runs its own Redis container. App connects to `localhost:6379`. This means:
- **No shared state between tasks** — each task has isolated Redis
- Pub/sub only works within a single task
- If you scale to 2+ tasks, messages published on task-1 are NOT received by task-2

### Redis Key Patterns
```
CLUSTER MANAGEMENT:
  websocket:nodes                           → SET of active node IDs
  websocket:node:{nodeId}:info              → HASH with node metadata
  websocket:node:{nodeId}:heartbeat         → HASH with health (90s TTL)
  websocket:node:{nodeId}:clients           → SET of clientIds on node
  websocket:node:{nodeId}:channels          → SET of channels node serves

CLIENT MAPPING:
  websocket:client:{clientId}:node          → STRING mapping to nodeId
  websocket:client:{clientId}:metadata      → HASH with connection metadata
  websocket:client:{clientId}:channels      → SET of subscribed channels

CHANNEL ROUTING:
  websocket:channel:{channelId}:nodes       → SET of nodes with subscribers
  websocket:route:{channelId}               → PUB/SUB channel for messages
  websocket:direct:{nodeId}                 → PUB/SUB for node-to-node
  websocket:broadcast:all                   → PUB/SUB global broadcast

SESSIONS:
  session:{sessionToken}                    → STRING (JSON), 24h TTL
```

### Redis Client Setup (`src/server.js`)
- Two clients: `redisPublisher` and `redisSubscriber`
- URL: `redis://${REDIS_ENDPOINT}:${REDIS_PORT}`
- Reconnection: exponential backoff, max 1000ms, 5 retries then standalone fallback
- **Graceful degradation:** If Redis unavailable, falls back to local-only broadcast

### Implication for Multi-Task
The code is DESIGNED for shared Redis (node registration, channel routing, pub/sub). But the sidecar model means each task gets its own Redis. **To make multi-tab across tasks work, Redis needs to be a shared ECS service** — NOT ElastiCache, but a standalone Fargate service with service discovery.

---

## WebSocket Architecture

### Connection Flow
1. Client connects: `wss://{ALB}/?token={JWT}&sessionToken={optional}`
2. Server validates JWT via `AuthMiddleware`
3. Generates unique `clientId` (UUID)
4. Registers with `NodeManager` (Redis) and `MessageRouter` (local)
5. Sends welcome message with session token

### Message Routing (`src/core/message-router.js`)
```
Client sends: { service: 'chat', action: 'send', channel: 'room-123', content: 'hello' }
  → Server parses service + action
  → Routes to ChatService.handleAction('send', ...)
  → ChatService calls messageRouter.sendToChannel('room-123', message)
  → MessageRouter queries Redis for target nodes
  → Publishes to websocket:route:room-123
  → All subscribing nodes receive and broadcast to local clients
```

### Services (pluggable via `ENABLED_SERVICES` env var)
| Service | Actions | Channel Pattern |
|---------|---------|-----------------|
| chat | send, subscribe, unsubscribe, history | `{channelId}` |
| presence | subscribe, heartbeat, setTyping | `presence:{channelId}` |
| cursor | update, subscribe | `cursor:{channelId}` |
| reaction | send, subscribe | `reactions:{channelId}` |
| crdt | subscribe, update, getSnapshot | `crdt:{channelId}` |
| social | subscribe | `{channelId}` (room channel) |
| activity | subscribe | `activity:{userId}` |

### Session Recovery
- Sessions stored in Redis (24h TTL) + LRU cache (10k entries)
- On reconnect with `sessionToken`, server restores clientId + channel subscriptions
- Exponential backoff: 1s, 2s, 4s, 8s, 16s (MAX_RETRIES=5)

---

## Frontend

### Tech Stack
- React 19, TypeScript, Vite 7.3
- `amazon-cognito-identity-js` for auth
- `yjs` for CRDT collaborative editing

### Key Hooks
| Hook | Purpose |
|------|---------|
| `useWebSocket` | Core WS connection, send/receive, reconnect |
| `useAuth` | Cognito auth, token refresh, cross-tab sync via BroadcastChannel |
| `useCRDT` | Y.js doc per channel, snapshot recovery, conflict detection |
| `usePresence` | Online users, typing indicators, 30s heartbeat |
| `useChat` | Message history (100), real-time messages |
| `useCursors` | 4 modes (freeform/table/text/canvas), 50ms throttle |
| `useReactions` | Ephemeral emoji, 2.5s auto-disappear |
| `usePosts` / `useComments` / `useLikes` | REST social features with real-time WS updates |
| `useRooms` | Room CRUD, member tracking |

### Configuration (`frontend/src/config/gateway.ts`)
```
VITE_WS_URL          — WebSocket endpoint
VITE_SOCIAL_API_URL   — Social API REST endpoint
VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID
VITE_DEV_BYPASS_AUTH  — Skip Cognito in dev
VITE_DEFAULT_CHANNEL  — Default channel (default: 'general')
```

### Auth Cross-Tab Sync
- `BroadcastChannel('auth')` syncs sign-out and token refresh across tabs
- localStorage: `auth_id_token`, `auth_refresh_token`, `auth_email`
- Token refresh scheduled 2 min before expiry

---

## Social API

### Stack
- Express 4.18 + TypeScript
- DynamoDB via AWS SDK v3
- Redis for real-time broadcast to WebSocket clients
- Port 3001

### Broadcast Pattern (`social-api/src/services/broadcast.ts`)
After any mutation (post, comment, like, join/leave):
1. TransactWrite: business data + outbox record (atomic)
2. Redis publish to `websocket:route:{channelId}` for real-time delivery
3. Outbox ensures eventual consistency even if Redis is down

### Endpoints
- `/rooms` — CRUD, join/leave, members
- `/rooms/:roomId/posts` — CRUD with pagination (ULID sort)
- `/posts/:postId/comments` — CRUD with nested replies
- `/posts/:postId/likes`, `/comments/:commentId/likes`
- `/profiles` — CRUD, visibility gating
- `/relationships` — follow/unfollow, followers/following/friends
- `/groups` — CRUD, invite, accept/reject, roles

---

## Lambda Functions

### 1. activity-log (`lambdas/activity-log/handler.ts`)
- **Trigger:** SQS (from outbox-relay)
- **Action:** Write to `user-activity` DynamoDB + publish to Redis for real-time delivery
- **Deps:** `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `redis`

### 2. crdt-snapshot (`lambdas/crdt-snapshot/handler.ts`)
- **Trigger:** SQS (crdt.checkpoint events)
- **Action:** Store gzip-compressed Y.js snapshots in `crdt-snapshots` table with 7-day TTL
- **Deps:** `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`

### 3. outbox-relay (`lambdas/outbox-relay/handler.ts`)
- **Trigger:** Scheduled (EventBridge)
- **Action:** Poll `social-outbox` table for UNPROCESSED records, relay to SQS queues
- **Deps:** `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sqs`
- **Env vars needed:** `SQS_FOLLOWS_URL`, `SQS_ROOMS_URL`, `SQS_POSTS_URL`, `SQS_REACTIONS_URL`

### 4. message-review (IVS Chat, optional) (`src/lambda/message-review-handler.js`)
- **Trigger:** IVS Chat room (sync)
- **Action:** Profanity filter + Redis publish
- **Status:** Dead code — IVS never enabled

---

## DynamoDB Data Model

### Tables (12 total)

| # | Table | PK | SK | GSI | TTL |
|---|-------|----|----|-----|-----|
| 1 | social-profiles | userId | - | - | No |
| 2 | social-relationships | followerId | followeeId | - | No |
| 3 | social-groups | groupId | - | - | No |
| 4 | social-group-members | groupId | userId | - | No |
| 5 | social-rooms | roomId | - | - | No |
| 6 | social-room-members | roomId | userId | - | No |
| 7 | social-posts | roomId | postId (ULID) | - | No |
| 8 | social-comments | postId | commentId (ULID) | - | No |
| 9 | social-likes | targetId | userId | - | No |
| 10 | crdt-snapshots | documentId | timestamp | - | 7 days |
| 11 | social-outbox | outboxId | - | status-index | No |
| 12 | user-activity | userId | timestamp | - | No |

Tables 1-9: CDK-managed in `SocialStack`
Tables 10-12: Referenced externally or created by application

---

## CRDT & Sync

### Library: Yjs
- Y.Doc per channel with Y.Text for collaborative editing
- `encodeStateAsUpdate()` / `applyUpdate()` / `mergeUpdates()`

### Sync Flow
1. Client subscribes → server sends latest snapshot from DynamoDB (`crdt:snapshot`)
2. Client edits → encodes full doc state → sends as base64 update
3. Server batches operations (10ms window) → merges with `mergeUpdates()`
4. Broadcasts merged update to all channel subscribers (`crdt:update`)
5. Snapshots persisted every 5 min or 50 ops via EventBridge → Lambda → DynamoDB

### Conflict Resolution
- Y.js CRDT guarantees automatic convergence — no custom merge logic needed
- Frontend shows yellow "Edits merged" banner on remote transaction detection
- Conflicts are informational only — data is never lost

---

## Multi-Tab Behavior

- Each tab gets its own `clientId` and WebSocket connection
- Auth synced across tabs via `BroadcastChannel('auth')`
- WebSocket state is NOT shared — each tab subscribes independently
- Both tabs receive messages for same channel independently
- Tab close only cleans up that tab's clientId

---

## Known Bugs & Gaps

### CRITICAL

| Issue | Location | Description |
|-------|----------|-------------|
| **CRDT live update protocol mismatch** | `crdt-service.js` vs `useCRDT.ts` | Gateway sends `{type:'crdt', action:'operations'}`, frontend expects `{type:'crdt:update', update:'base64'}`. Live collaborative edits are silently dropped. Only snapshot recovery on reconnect works. |
| **EventBusStack not instantiated** | `bin/websocker_gateway.ts` | Stack exists in `lib/event-bus-stack.ts` but is never `new`'d in the app. SQS queues, EventBridge bus, and DLQ alarms won't deploy. |
| **Frontend not served/deployed** | Dockerfile, CDK | No mechanism to serve `frontend/dist/`. No S3+CloudFront, no nginx, no static middleware. Users can't access the React UI in production. |
| **Redis sidecar = no cross-task pub/sub** | `lib/task-definition.ts` | Each ECS task has its own Redis. With 2+ tasks, messages don't cross task boundaries. Need shared Redis ECS service for multi-instance. |

### HIGH

| Issue | Location | Description |
|-------|----------|-------------|
| **Hardcoded localhost fallbacks** | `ActivityPanel.tsx:39`, `BigBrotherPanel.tsx:49` | `VITE_SOCIAL_API_URL` falls back to `http://localhost:3001` — breaks in production. |
| **CORS defaults to `*`** | `server.js:80` | `ALLOWED_ORIGINS` defaults to `'*'` — overly permissive for production. |
| **Missing IAM permissions** | `task-definition.ts:28-32` | Task role only has DynamoDB access. Missing `events:PutEvents` for EventBridge, `sqs:SendMessage` for queues. |
| **Lambda deps not installed** | `lambdas/activity-log/`, `lambdas/crdt-snapshot/` | `npm install` not run — `node_modules` missing or incomplete. Lambdas will fail at runtime. |

### MEDIUM

| Issue | Location | Description |
|-------|----------|-------------|
| social-api missing `EVENT_BUS_NAME` | `docker-compose.localstack.yml` | Code falls back to `'social-events'` but config is inconsistent. |
| Outbox-relay SQS URLs default empty | `lambdas/outbox-relay/handler.ts` | Silent skip if env vars missing. |
| Frontend TypeScript errors (20) | Various hooks/components | setState in effects, ref access during render, type mismatches. |
| Stale `.env.real` | Root | Generated 2026-03-04, credentials may be expired. |
| Inconsistent Redis hostnames | `docker-compose.yml` vs `server.js` | `core-redis` vs `redis` default. |

---

## Portability Notes

### What's extractable as-is
- **WebSocket Gateway** (`src/`) — self-contained Node.js server with pluggable services. Configure via `ENABLED_SERVICES`. Bring Redis sidecar pattern with it.
- **Social API** (`social-api/`) — standalone Express app. Just needs DynamoDB tables and optional Redis for broadcast.
- **CDK patterns** (`lib/`) — VPC with zero NAT gateways + VPC endpoints, ECS with Redis sidecar, ALB with sticky sessions, Cognito auth. Copy and adapt.
- **Frontend hooks** (`frontend/src/hooks/`) — each hook is self-contained. `useWebSocket` is the only dependency.

### What needs work for portability
- **Redis sidecar → shared service:** Current sidecar model doesn't support multi-instance. Need a shared Redis ECS service with CloudMap service discovery for any multi-task deployment.
- **DynamoDB table creation:** Some tables (crdt-snapshots, social-outbox, user-activity) are created outside CDK. Should be brought into stacks.
- **Frontend deployment:** No serving mechanism. Add S3+CloudFront or nginx container.
- **Lambda packaging:** No CI/CD for Lambda builds. Each needs `npm install` + `tsc` + zip.

### Architecture decisions worth keeping
- Zero NAT gateways + VPC endpoints (saves ~$65/mo)
- Redis as ECS container, NOT ElastiCache (fast deploys)
- Transactional outbox pattern for reliable event delivery
- Y.js CRDT for conflict-free collaborative editing
- Graceful degradation when Redis is unavailable
- Cookie-based ALB sticky sessions for WebSocket affinity
- ARM64 Fargate (Graviton) for cost efficiency
