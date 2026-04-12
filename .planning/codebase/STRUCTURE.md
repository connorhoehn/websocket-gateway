# Codebase Structure

**Analysis Date:** 2026-04-12

## Directory Layout

```
websocker_gateway/
├── .planning/                    # GSD planning and codebase documentation
│   └── codebase/                # Auto-generated architecture docs
├── assets/                       # Demo GIFs and documentation images
├── bin/                          # CLI entry point for AWS CDK
│   └── websocker_gateway.js     # CDK app instantiation
├── config/                       # Configuration files
├── frontend/                     # React SPA (built output served by gateway)
│   └── src/
│       ├── components/          # React components
│       │   └── doc-editor/      # Collaborative document editor UI
│       ├── hooks/               # Custom React hooks (useCollaborativeDoc, etc.)
│       ├── types/               # TypeScript type definitions
│       └── utils/               # Frontend utilities
├── helm/                         # Helm charts for K8s deployment
├── lib/                          # AWS CDK infrastructure definitions
│   ├── cluster.ts               # ECS cluster configuration
│   ├── redis.ts                 # Redis setup
│   ├── fargate-service.ts       # Fargate task definition
│   ├── task-definition.ts       # ECS task configuration
│   ├── vpc.ts                   # VPC and networking
│   └── websocket-gateway-stack.ts # Main CDK stack
├── src/                          # Backend application source code
│   ├── core/                    # Core distributed system components
│   │   ├── message-router.js    # Intelligent pub/sub message routing (781 lines)
│   │   ├── node-manager.js      # Node registration, discovery, heartbeat (498 lines)
│   │   └── websocket-manager.js # LEGACY - unused simple WS manager (218 lines)
│   ├── lambda/                  # AWS Lambda handlers
│   │   └── message-review-handler.js  # CRDT snapshot persistence via EventBridge
│   ├── middleware/              # Cross-cutting middleware
│   │   ├── auth-middleware.js   # Cognito JWT validation
│   │   ├── authz-middleware.js  # Channel permission checks
│   │   ├── rate-limiter.js      # Per-client rate limiting
│   │   └── reconnection-handler.js # Session token recovery
│   ├── services/                # Domain-specific business logic
│   │   ├── activity-service.js  # Real-time activity feed (297 lines)
│   │   ├── chat-service.js      # Chat messaging and history (407 lines)
│   │   ├── crdt-service.js      # Y.js CRDT collaborative editing (1943 lines)
│   │   ├── cursor-service.js    # Multi-mode cursor tracking (607 lines)
│   │   ├── ivs-chat-service.js  # IVS chat integration
│   │   ├── presence-service.js  # User presence tracking (533 lines)
│   │   ├── reaction-service.js  # Emoji reactions (285 lines)
│   │   ├── session-service.js   # Session tokens for reconnection (144 lines)
│   │   └── social-service.js    # Real-time social events (127 lines)
│   ├── utils/                   # Shared utility functions
│   │   ├── error-codes.js       # Standardized error codes and response factory
│   │   ├── logger.js            # Structured logging with correlation IDs
│   │   └── metrics-collector.js # CloudWatch metrics emission
│   ├── validators/              # Input validation
│   │   └── message-validator.js # Message structure/size validation
│   ├── server.js                # Main WebSocket server (855 lines)
│   ├── package.json             # Backend-specific dependencies
│   └── package-lock.json
├── test/                         # Test files
│   ├── clients/                 # WebSocket test client implementations
│   └── websocker_gateway.test.ts # Infrastructure tests
├── Dockerfile                    # Container image definition
├── Tiltfile                      # Tilt local dev configuration
├── Makefile                      # Development and deployment automation
├── docker-compose.yml            # Local development environment
├── cdk.json                      # CDK configuration
├── jest.config.js                # Jest testing configuration
├── package.json                  # Root project dependencies
└── tsconfig.json                 # TypeScript configuration
```

## Directory Purposes

**`src/core/`:**
- Purpose: Core distributed system and routing infrastructure
- Contains: Message routing (Redis pub/sub), node management, client tracking
- Key files:
  - `src/core/message-router.js` - Central mediator for all WebSocket communication
  - `src/core/node-manager.js` - Cluster membership and client-to-node registry
  - `src/core/websocket-manager.js` - **LEGACY, not imported by server.js** - can be deleted

**`src/services/`:**
- Purpose: Domain-specific real-time feature implementations
- Contains: 9 service files, each implementing the `handleAction()` contract
- Key files:
  - `src/services/crdt-service.js` - Largest service (1943 lines), handles Y.js CRDT, document metadata CRUD, presence, snapshots, DynamoDB access
  - `src/services/chat-service.js` - Chat messaging with LRU message history
  - `src/services/presence-service.js` - Online/away/busy status with heartbeat cleanup
  - `src/services/session-service.js` - Session token management (not routed via handleAction)

**`src/middleware/`:**
- Purpose: Authentication, authorization, rate limiting, reconnection
- Contains: 4 middleware modules, called inline by services or server.js (not Express-style pipeline)
- Key files:
  - `src/middleware/auth-middleware.js` - Called once at WS upgrade, validates Cognito JWT
  - `src/middleware/authz-middleware.js` - `checkChannelPermission()` called by services before channel ops

**`src/utils/`:**
- Purpose: Shared utility functions used by all layers
- Key files:
  - `src/utils/error-codes.js` - Error code constants and `createErrorResponse()` factory
  - `src/utils/logger.js` - `Logger` class with `withCorrelation()` for request tracing
  - `src/utils/metrics-collector.js` - CloudWatch metric buffering and emission

**`src/validators/`:**
- Purpose: Message validation logic extracted from router
- Key files: `src/validators/message-validator.js` - Validates service name whitelist, action presence, 64KB payload limit, channel name format

**`src/lambda/`:**
- Purpose: AWS Lambda function handlers (deployed separately from gateway)
- Key files: `src/lambda/message-review-handler.js` - EventBridge consumer for CRDT snapshot persistence

**`frontend/`:**
- Purpose: React SPA served by the gateway's static file handler
- Key subdirectories:
  - `frontend/src/components/doc-editor/` - Collaborative document editor components
  - `frontend/src/hooks/` - Custom hooks including `useCollaborativeDoc.ts` for Y.js WebSocket sync

## Key File Locations

**Entry Points:**
- `src/server.js`: Application server entry point (`DistributedWebSocketServer` class)
- `bin/websocker_gateway.js`: CDK app entry point for infrastructure deployment

**Configuration:**
- `src/server.js` lines 30-40: Runtime config object (Redis URL, port, enabled services)
- `cdk.json`: CDK context and configuration
- `Dockerfile`: Container image definition
- `docker-compose.yml`: Local development (Redis + gateway)
- `Tiltfile`: Tilt + Helm local K8s dev

**Core Logic:**
- `src/core/message-router.js`: All inter-service and inter-node communication
- `src/core/node-manager.js`: Distributed cluster coordination
- `src/services/crdt-service.js`: Collaborative editing, document CRUD, snapshot persistence

**Testing:**
- `test/websocker_gateway.test.ts`: Infrastructure tests
- `test/clients/`: Manual WebSocket test clients

## Naming Conventions

**Files:**
- Services: `{domain}-service.js` (e.g., `chat-service.js`, `crdt-service.js`)
- Core: `{function}-{type}.js` (e.g., `node-manager.js`, `message-router.js`)
- Middleware: `{concern}-middleware.js` or `{concern}-handler.js`
- Utils: `{purpose}.js` (e.g., `error-codes.js`, `logger.js`)
- Infrastructure (CDK): `{component}.ts` (e.g., `redis.ts`, `vpc.ts`)

**Directories:**
- Lowercase, hyphen-separated where needed
- `src/services/`, `src/core/`, `src/middleware/`, `src/utils/`, `src/validators/`

**Classes:**
- PascalCase: `ChatService`, `MessageRouter`, `NodeManager`, `DistributedWebSocketServer`

**Redis Keys:**
- Colon-separated hierarchy: `websocket:node:{nodeId}:info`, `websocket:channel:{channel}:nodes`
- CRDT-specific: `crdt:snapshot:{channel}`, `doc:meta:{id}`, `doc:list`
- Activity: `activity:history:{channel}`
- Session: `session:{token}`

**Environment Variables:**
- UPPER_SNAKE_CASE: `REDIS_ENDPOINT`, `COGNITO_USER_POOL_ID`, `DYNAMODB_CRDT_TABLE`, `ENABLED_SERVICES`, `LOG_LEVEL`

## Where to Add New Code

**New Real-Time Service:**
1. Create: `src/services/{feature}-service.js`
2. Implement class with:
   - `constructor(messageRouter, logger, metricsCollector)` - standard args
   - `handleAction(clientId, action, data)` - switch on action name
   - `handleDisconnect(clientId)` - cleanup on disconnect
   - `sendToClient(clientId, message)` - wrapper: `this.messageRouter.sendToClient()`
   - `sendError(clientId, message, errorCode)` - wrapper using `createErrorResponse()`
   - `getStats()` - for `/stats` endpoint
   - `shutdown()` - clear timers, flush state
3. Register in `src/server.js` `initializeServices()` (line 201-243)
4. Add service name to `ENABLED_SERVICES` env var or config

**New Service Action:**
1. Add case to existing service's `handleAction()` switch statement
2. Implement `handle{ActionName}(clientId, data)` method
3. Use `this.messageRouter.sendToChannel()` for broadcast or `this.sendToClient()` for direct response

**New Middleware:**
1. Create: `src/middleware/{concern}-middleware.js`
2. Export function or class
3. Wire into `src/server.js` or call from services as needed
4. Note: Middleware is called inline, not Express-style pipeline

**New Utility:**
1. Create: `src/utils/{utility-name}.js`
2. Export via `module.exports`
3. Import where needed: `const X = require('./utils/{utility-name}')`

**New DynamoDB Table Access:**
1. Add DynamoDB commands in the service that needs them (currently only `src/services/crdt-service.js`)
2. Add table name as env var: `DYNAMODB_{TABLE}_TABLE`
3. Add `_ensureTable()` method for local dev (LocalStack)
4. No shared data access layer exists -- DynamoDB access is inline in services

**New Frontend Component:**
1. Create: `frontend/src/components/{feature}/{ComponentName}.tsx`
2. Types: `frontend/src/types/{feature}.ts`
3. Hooks: `frontend/src/hooks/use{Feature}.ts`

## Special Directories

**`src/core/websocket-manager.js`:**
- Purpose: Legacy simple WebSocket manager
- Status: **Not imported or used** by `server.js` or any service
- Note: Superseded by `MessageRouter` which handles the same functionality plus distributed routing
- Action: Safe to delete

**`src/lambda/`:**
- Purpose: Lambda function handlers deployed separately via CDK
- Contains: EventBridge consumer for CRDT snapshot persistence
- Note: Production path writes snapshots via EventBridge -> Lambda -> DynamoDB. Local dev uses `DIRECT_DYNAMO_WRITE=true` to bypass.

**`helm/`:**
- Purpose: Helm charts for Kubernetes deployment via Tilt
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-04-12*
