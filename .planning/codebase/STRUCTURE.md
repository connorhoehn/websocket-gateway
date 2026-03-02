# Codebase Structure

**Analysis Date:** 2026-03-02

## Directory Layout

```
websocker_gateway/
├── .planning/                    # GSD planning and codebase documentation
├── assets/                       # Demo GIFs and documentation images
├── bin/                          # CLI entry point for AWS CDK
│   └── websocker_gateway.js     # CDK app instantiation
├── config/                       # Configuration files
├── lib/                          # AWS CDK infrastructure definitions
│   ├── cluster.ts               # ECS cluster configuration
│   ├── redis.ts                 # ElastiCache Redis setup
│   ├── fargate-service.ts       # Fargate task definition
│   ├── task-definition.ts       # ECS task configuration
│   ├── vpc.ts                   # VPC and networking
│   └── websocket-gateway-stack.ts # Main CDK stack
├── src/                          # Application source code
│   ├── core/                    # Core distributed system components
│   │   ├── node-manager.js      # Node registration, discovery, heartbeat
│   │   ├── message-router.js    # Intelligent pub/sub message routing
│   │   └── websocket-manager.js # Legacy WebSocket connection tracking
│   ├── services/                # Domain-specific business logic services
│   │   ├── chat-service.js      # Chat messaging and history
│   │   ├── presence-service.js  # User presence tracking
│   │   ├── cursor-service.js    # Cursor position synchronization
│   │   └── reaction-service.js  # Reaction/emoji tracking
│   ├── utils/                   # Utility functions
│   │   └── logger.js            # Structured logging utility
│   ├── server.js                # Main WebSocket server and HTTP endpoints
│   └── package.json             # Local src dependencies
├── test/                         # Test files and test clients
│   ├── clients/                 # WebSocket test client implementations
│   └── websocker_gateway.test.ts # Infrastructure tests
├── templates/                    # CloudFormation templates (legacy)
├── cdk.json                      # CDK configuration
├── docker-compose.yml            # Local development environment
├── Dockerfile                    # Container image definition
├── jest.config.js                # Jest testing configuration
├── Makefile                      # Development and deployment automation
├── package.json                  # Root project dependencies
├── tsconfig.json                 # TypeScript configuration
├── DISTRIBUTED_ARCHITECTURE.md   # Detailed distributed system design
└── README.md                      # Project overview
```

## Directory Purposes

**`.planning/codebase/`:**
- Purpose: GSD-generated codebase analysis and documentation
- Contains: ARCHITECTURE.md, STRUCTURE.md, and other analysis docs
- Committed: Yes
- Generated: Yes (by GSD)

**`bin/`:**
- Purpose: Entry point for AWS CDK infrastructure-as-code
- Contains: TypeScript CDK app that defines and synthesizes CloudFormation templates
- Key files: `bin/websocker_gateway.js` - entry point when running `npm run cdk`

**`lib/`:**
- Purpose: AWS CDK infrastructure definitions using TypeScript
- Contains: Modular CDK constructs for VPC, Redis, ECS Fargate, load balancing
- Key files:
  - `lib/websocket-gateway-stack.ts` - Main stack composition
  - `lib/fargate-service.ts` - Fargate task configuration
  - `lib/redis.ts` - ElastiCache Redis setup

**`src/core/`:**
- Purpose: Core distributed system and routing components
- Contains: Abstractions for multi-node communication, client/node discovery
- Key files:
  - `src/core/message-router.js` - Pub/Sub routing that selects target nodes
  - `src/core/node-manager.js` - Node registration, heartbeat, channel tracking in Redis
  - `src/core/websocket-manager.js` - Legacy connection management (used for reference)

**`src/services/`:**
- Purpose: Domain-specific WebSocket service implementations
- Contains: Chat, Presence, Cursor, Reaction services
- Key files:
  - `src/services/chat-service.js` - Chat messaging, join/leave, history
  - `src/services/presence-service.js` - Online status, presence subscriptions
  - `src/services/cursor-service.js` - Multi-user cursor position tracking
  - `src/services/reaction-service.js` - Emoji/reaction broadcasting
- Pattern: Each service implements handleAction(clientId, action, data) and optional handleDisconnect(clientId)

**`src/utils/`:**
- Purpose: Shared utility functions
- Contains: Logger and helper utilities
- Key files: `src/utils/logger.js` - Configurable structured logging

**`src/server.js`:**
- Purpose: Main application server
- Contains: HTTP server setup, WebSocket server, service initialization, message routing
- Key responsibilities: Redis connection, node registration, client lifecycle, service orchestration

**`test/`:**
- Purpose: Test suite and test clients
- Contains: Jest tests and WebSocket client implementations for manual testing
- Key files: `test/websocker_gateway.test.ts` - Infrastructure tests

**`config/`:**
- Purpose: Configuration files (likely environment-specific)
- Contains: Unknown (directory exists but not fully explored)

## Key File Locations

**Entry Points:**
- `bin/websocker_gateway.js`: CDK app entry point for infrastructure deployment
- `src/server.js`: Application server entry point (DistributedWebSocketServer class)

**Configuration:**
- `cdk.json`: CDK context and configuration
- `tsconfig.json`: TypeScript compilation settings
- `jest.config.js`: Test runner configuration
- `Dockerfile`: Container image definition
- `docker-compose.yml`: Local development environment

**Core Logic:**
- `src/core/node-manager.js`: Node discovery and registration (Redis-backed)
- `src/core/message-router.js`: Intelligent message routing and pub/sub
- `src/services/chat-service.js`: Chat service implementation
- `src/services/presence-service.js`: Presence service implementation
- `src/services/cursor-service.js`: Cursor synchronization service
- `src/services/reaction-service.js`: Reaction service

**Testing:**
- `test/websocker_gateway.test.ts`: Main test file
- `test/clients/`: WebSocket client implementations for manual testing

## Naming Conventions

**Files:**
- Service files: `{service-name}-service.js` (e.g., `chat-service.js`)
- Core modules: `{function}-{type}.js` (e.g., `node-manager.js`, `message-router.js`)
- Infrastructure: `{component}.ts` in lib/ (e.g., `redis.ts`, `fargate-service.ts`)
- Tests: `{module}.test.ts` (e.g., `websocker_gateway.test.ts`)

**Directories:**
- Services: plural `src/services/`
- Core utilities: `src/core/`
- Infrastructure: `lib/`
- Tests: `test/`

**Classes/Functions:**
- Service classes: PascalCase (e.g., ChatService, PresenceService)
- Manager classes: PascalCase (e.g., NodeManager, MessageRouter)
- Logger class: PascalCase (Logger)
- Server class: PascalCase (DistributedWebSocketServer)

**Variables & Constants:**
- In MessageRouter: camelCase with descriptive purpose (e.g., localClients, subscribedChannels, messageTypes)
- Redis keys: snake_case with colons for hierarchy (e.g., `websocket:node:${nodeId}:info`, `websocket:client:${clientId}:node`)
- Environment variables: UPPER_SNAKE_CASE (e.g., REDIS_ENDPOINT, PORT, ENABLED_SERVICES, LOG_LEVEL)

## Where to Add New Code

**New Feature (Service):**
- Create service file: `src/services/{feature-name}-service.js`
- Implement class with: constructor(messageRouter, logger), handleAction(clientId, action, data), getStats()
- Register in: `src/server.js` - initializeServices() method (line 145-171)
- Add to enabled services: environment variable ENABLED_SERVICES or config.server.enabledServices
- Tests: create `test/{feature-name}-service.test.ts`

**New Core Component:**
- Create file: `src/core/{component-name}.js`
- Example: routing logic, client management abstractions
- Update imports in: `src/server.js` (line 7-10)
- Use in: DistributedWebSocketServer or existing services

**Utility Functions:**
- Add to: `src/utils/logger.js` or create `src/utils/{utility-name}.js`
- Export as module: `module.exports = ClassName or functionName`
- Import where needed with: `const Thing = require('./utils/logger')`

**Infrastructure Changes:**
- Add CDK construct: `lib/{component}.ts`
- Compose in: `lib/websocket-gateway-stack.ts`
- Redeploy with: `cdk deploy --all`

**Tests:**
- Co-located with source: `test/{module}.test.ts` or alongside source file
- Use Jest as runner: `npm test`
- Patterns: async/await for promises, mock Redis/WebSocket dependencies

## Special Directories

**`config/`:**
- Purpose: Configuration files
- Generated: Unknown
- Committed: Yes

**`cdk.out/`:**
- Purpose: CDK synthesis output (CloudFormation templates)
- Generated: Yes (by CDK)
- Committed: No (in .gitignore)

**`templates/`:**
- Purpose: CloudFormation templates (legacy, superceded by CDK)
- Generated: No
- Committed: Yes

**`assets/`:**
- Purpose: Demo GIFs and documentation images
- Generated: No
- Committed: Yes

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (by npm install)
- Committed: No (in .gitignore)

## Message Flow by Example: Chat Message

```
User sends: { service: 'chat', action: 'send', channel: 'lobby', message: 'Hello!' }
    ↓
src/server.js: DistributedWebSocketServer.handleMessage()
    ↓
Routes to: this.services.get('chat').handleAction(clientId, 'send', data)
    ↓
src/services/chat-service.js: ChatService.handleSendMessage()
    - Validates message length
    - Creates messageData object with timestamp/ID
    - Adds to local history: this.addToChannelHistory()
    - Calls: this.messageRouter.sendToChannel(channel, broadcastMessage)
    ↓
src/core/message-router.js: MessageRouter.sendToChannel()
    - Gets target nodes: this.nodeManager.getNodesForChannel(channel)
    - Publishes to Redis: websocket:route:lobby
    ↓
All nodes receive Redis message and call: MessageRouter.handleChannelMessage()
    - Check if this node is in targetNodes list
    - Call: this.broadcastToLocalChannel(channel, message)
    ↓
src/core/message-router.js: MessageRouter.broadcastToLocalChannel()
    - For each local client on this channel:
        - Call sendToLocalClient() to send message via WebSocket
```

---

*Structure analysis: 2026-03-02*
