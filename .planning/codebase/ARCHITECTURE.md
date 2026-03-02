# Architecture

**Analysis Date:** 2026-03-02

## Pattern Overview

**Overall:** Distributed Pub/Sub WebSocket Gateway with Pluggable Services

**Key Characteristics:**
- Multi-node distributed architecture using Redis Pub/Sub for inter-node communication
- Service-oriented architecture with pluggable business logic services
- Hybrid fallback mode: operates in standalone or distributed modes depending on Redis availability
- Node-to-node intelligent message routing based on client location and channel subscriptions
- Stateful WebSocket connections managed locally with distributed state synchronized through Redis

## Layers

**Application Layer (Services):**
- Purpose: Domain-specific business logic for different WebSocket features
- Location: `src/services/`
- Contains: ChatService, PresenceService, CursorService, ReactionService
- Depends on: MessageRouter, Logger
- Used by: DistributedWebSocketServer

**Core Routing & Distribution Layer:**
- Purpose: Handles message routing, node discovery, and client management in distributed systems
- Location: `src/core/`
- Contains: NodeManager, MessageRouter, WebSocketManager
- Depends on: Redis client, Logger
- Used by: DistributedWebSocketServer and Services

**Infrastructure Layer:**
- Purpose: Raw WebSocket connection handling and HTTP server management
- Location: `src/server.js`
- Contains: HTTP server, WebSocket server setup, connection lifecycle
- Depends on: Core layer components, Services
- Used by: Entry point at `bin/websocker_gateway.js`

**Utilities:**
- Purpose: Shared logging and helper functions
- Location: `src/utils/`
- Contains: Logger with configurable log levels
- Depends on: Node.js built-ins
- Used by: All layers

## Data Flow

**Client Connection Flow:**

1. Client connects to HTTP server on port 8080
2. WebSocket upgrade negotiated, connection stored in MessageRouter.localClients
3. NodeManager registers client ID to this node in Redis
4. Welcome message sent to client with node ID and enabled services
5. Client is ready to send messages

**Message Routing (Service-based):**

1. Client sends JSON message with `{ service, action, ...data }`
2. DistributedWebSocketServer.handleMessage parses and validates message
3. Message routed to appropriate service instance via handleAction()
4. Service executes action (join channel, send message, set presence, etc.)
5. Service broadcasts result via MessageRouter.sendToChannel() or sendToClient()

**Distributed Broadcasting (Redis Pub/Sub):**

1. Service calls MessageRouter.sendToChannel(channel, message)
2. NodeManager.getNodesForChannel(channel) returns all nodes serving that channel
3. MessageRouter publishes to Redis channel: `websocket:route:{channel}`
4. All nodes subscribed to that Redis channel receive the message
5. Each node's handleChannelMessage() broadcasts to local clients on that channel
6. MessageRouter.broadcastToLocalChannel() delivers message only to clients on that channel

**Direct Client Messaging:**

1. Service or system calls MessageRouter.sendToClient(clientId, message)
2. If client is local: MessageRouter.sendToLocalClient() delivers directly
3. If client is remote: MessageRouter publishes to Redis channel: `websocket:direct:{targetNodeId}`
4. Target node receives message via handleDirectMessage() and delivers to local client

**State Management:**

**Local State (in-memory on each node):**
- MessageRouter.localClients: Map of connected WebSocket connections
- Service-specific state: ChatService.channelHistory, PresenceService.clientPresence
- Channel subscriptions per client

**Distributed State (Redis):**
- Node registration and heartbeat: `websocket:nodes`, `websocket:node:{nodeId}:*`
- Client-to-node mapping: `websocket:client:{clientId}:node`
- Channel-to-node mapping: `websocket:channel:{channel}:nodes`
- Client metadata and channel subscriptions

## Key Abstractions

**MessageRouter:**
- Purpose: Intelligent message routing that abstracts whether a client is local or remote
- Examples: `src/core/message-router.js`
- Pattern: Pub/Sub abstraction that routes messages to nodes containing target clients, only publishes to nodes that need the message

**NodeManager:**
- Purpose: Abstracts distributed node coordination and discovery
- Examples: `src/core/node-manager.js`
- Pattern: Manages node registration, heartbeat, channel tracking, and graceful shutdown

**Service Interface (ChatService, PresenceService, etc.):**
- Purpose: Unified interface for domain services that work in both standalone and distributed modes
- Examples: `src/services/chat-service.js`, `src/services/presence-service.js`
- Pattern: Each service implements handleAction(clientId, action, data) and optional handleDisconnect(clientId)

**Redis Connection Strategy:**
- Purpose: Graceful fallback to standalone mode if Redis is unavailable
- Pattern: RedisPublisher and RedisSubscriber with retry logic; server continues operating locally if Redis fails

## Entry Points

**CLI Entry Point:**
- Location: `bin/websocker_gateway.js`
- Triggers: npm start or direct node execution
- Responsibilities: CDK stack instantiation (infrastructure-as-code deployment)

**Server Entry Point:**
- Location: `src/server.js`
- Triggers: Container startup or direct Node.js execution
- Responsibilities: Initialize DistributedWebSocketServer, connect to Redis, start HTTP/WebSocket server, handle graceful shutdown

**WebSocket Connection Entry:**
- Location: `src/server.js` - DistributedWebSocketServer.setupWebSocketServer()
- Triggers: New client WebSocket connection
- Responsibilities: Generate client ID, register in NodeManager and MessageRouter, setup message/close/error handlers

## Error Handling

**Strategy:** Layered error handling with graceful degradation

**Patterns:**

**Redis Failures:**
- Server attempts 5 retries with exponential backoff (lines 84-143 in server.js)
- Falls back to standalone mode if Redis unavailable
- Continues operating locally with message broadcasting only to connected clients
- Each service checks if messageRouter exists before using distributed features

**WebSocket Client Errors:**
- Errors caught in message handler (line 219-222 in server.js)
- Client automatically unregistered from NodeManager and MessageRouter
- Services notified via handleDisconnect(clientId)
- Graceful cleanup of channel subscriptions

**Service-Level Errors:**
- Each service's handleAction() wrapped in try-catch (line 21-39 in chat-service.js)
- Errors logged and error response sent to client via sendError()
- Server continues operating; error doesn't crash process

**Graceful Shutdown:**
- Process signals (SIGTERM, SIGINT) trigger graceful shutdown sequence
- All WebSocket connections closed with code 1001
- All clients unregistered from Redis
- Node deregistered from cluster
- Redis connections cleanly closed
- HTTP server stopped

## Cross-Cutting Concerns

**Logging:**
- Utility: `src/utils/logger.js`
- Approach: Structured logging with timestamp, level, and component name
- Levels: error, warn, info, debug; controlled by LOG_LEVEL env var
- Used throughout all layers for debugging distributed behavior

**Validation:**
- Applied at service layer before processing
- Example: ChatService validates channel name (1-50 chars), message (1-1000 chars)
- Example: PresenceService validates status against allowed values
- Invalid messages return error responses to client

**Authentication:**
- Not implemented at infrastructure layer
- Client IP and User-Agent captured in metadata for tracking
- Services can implement custom auth via metadata in handleAction()
- Currently clientId is auto-generated; no auth/authorization enforcement

**Scalability Considerations:**
- Node discovery via Redis enables horizontal scaling
- Intelligent routing reduces Redis load: only publishes to nodes with subscribed clients
- Local in-memory message history with configurable limits (100 messages default)
- Heartbeat mechanism (30 seconds) detects failed nodes
- Graceful node addition/removal via Redis registration

---

*Architecture analysis: 2026-03-02*
