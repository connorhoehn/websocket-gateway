# Coding Conventions

**Analysis Date:** 2026-03-02

## Language and Module System

**TypeScript (Infrastructure/Infrastructure-as-Code):**
- Used exclusively for AWS CDK infrastructure code in `lib/` directory
- Target: ES2022 with strict type checking enabled
- Module system: NodeNext (ESM-compatible)

**JavaScript (Runtime):**
- Used for all server runtime code in `src/` directory
- CommonJS modules (require/module.exports)
- Node.js runtime with modern async/await patterns

## Naming Patterns

**Files:**
- TypeScript files: PascalCase with hyphens for CDK constructs (e.g., `websocket-gateway-stack.ts`, `fargate-service.ts`)
- JavaScript files: camelCase for all runtime code (e.g., `server.js`, `message-router.js`, `chat-service.js`)
- Test files: Suffix pattern `.test.ts` (e.g., `websocker_gateway.test.ts`)

**Variables and Functions:**
- Local variables: camelCase (e.g., `clientId`, `redisPublisher`, `enabledServices`)
- Class properties: camelCase (e.g., `this.nodeManager`, `this.localClients`, `this.redisConnected`)
- Constants: camelCase or UPPER_SNAKE_CASE for environment variable names (e.g., `REDIS_ENDPOINT`, `ENABLED_SERVICES`, `LOG_LEVEL`)
- Method names: camelCase with descriptive action verbs (e.g., `handleMessage`, `sendToClient`, `broadcastMessage`)

**Classes:**
- PascalCase for class names (e.g., `DistributedWebSocketServer`, `MessageRouter`, `ChatService`, `Logger`)
- Suffix pattern: Service classes end with "Service" (e.g., `ChatService`, `PresenceService`)
- Manager classes end with "Manager" (e.g., `NodeManager`, `WebSocketManager`)

**Interfaces (TypeScript):**
- PascalCase with "Props" or "Result" suffix (e.g., `FargateServiceProps`, `FargateServiceResult`, `RedisClusterResult`, `TaskDefinitionProps`)

## Code Style

**Formatting:**
- No explicit linting config file present (no `.eslintrc`, `.prettierrc`)
- Line length: No strict limit observed (code extends to 150+ characters)
- Indentation: 2 spaces consistently throughout codebase

**Constructor and Initialization:**
- TypeScript: Constructor parameters directly assigned to properties (AWS CDK pattern)
- JavaScript: Explicit property initialization in constructor with detailed comments explaining each property

**Comments:**
- JSDoc-style comments used for class documentation (e.g., `/** * Handles chat messaging */`)
- Inline comments explain non-obvious logic (e.g., `// Check if Redis should be enabled via environment variable`)
- Section dividers: Blank lines and grouping comments organize related methods

## Import Organization

**Order (TypeScript):**
1. Node.js built-in modules (`import { Stack } from 'aws-cdk-lib'`)
2. AWS CDK libraries (`import { Vpc } from 'aws-cdk-lib/aws-ec2'`)
3. Local imports (`import { createVpc } from './vpc'`)

**Order (JavaScript):**
1. Node.js built-in modules (`const http = require('http')`)
2. Third-party libraries (`const WebSocket = require('ws')`)
3. Local modules (`const Logger = require('./utils/logger')`)

**Path Aliases:**
- Not used; relative paths only (e.g., `require('./core/node-manager')`, `require('./utils/logger')`)

## Error Handling

**Patterns Observed:**

1. **Try-Catch with Logging:**
   ```javascript
   try {
       // operation
   } catch (error) {
       this.logger.error('Error message:', error);
       this.sendError(clientId, 'User-friendly message');
   }
   ```

2. **Boolean Return Values:**
   Functions return boolean for success/failure (e.g., `subscribeToChannel()` returns true/false)

3. **Explicit Error Messages:**
   - User-facing errors: Descriptive, user-friendly messages
   - Server-side logging: Full error details with context

4. **Graceful Fallbacks:**
   - Redis connection failures fall back to standalone mode with retry logic
   - Message routing falls back to local broadcast if Redis unavailable
   - Service cleanup handles already-closed connections gracefully

5. **Validation:**
   - Input validation before processing (e.g., check channel name length, message length)
   - Invalid format handling returns error to client

**Example from `chat-service.js`:**
```javascript
if (typeof channel !== 'string' || channel.length === 0 || channel.length > 50) {
    this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
    return;
}
```

## Logging

**Framework:** Custom `Logger` utility class (`src/utils/logger.js`)

**Implementation:**
- Logger constructor takes a module/class name: `new Logger('WebSocketServer')`
- Configurable via `LOG_LEVEL` environment variable (default: 'info')
- Levels: error, warn, info, debug (0-3 severity)

**Patterns:**
- Info level: Server startup, client connections, major state changes
- Debug level: Detailed routing info, method entry/exit
- Warn level: Fallback conditions, retry attempts
- Error level: Exception details with context

**Format:** `[TIMESTAMP] [LEVEL] [MODULE_NAME] message`

**Examples from codebase:**
```javascript
this.logger.info(`Client ${clientId} connected from ${clientIP}`);
this.logger.debug(`Message from ${clientId}:`, message);
this.logger.error('Redis connection error:', error.message);
this.logger.warn('🔄 Max retries reached. Running in standalone mode');
```

## Async/Await Patterns

**Consistent Usage:**
- All asynchronous operations use async/await (not callbacks or `.then()`)
- Async methods explicitly marked: `async handleMessage(clientId, message) { ... }`
- Redis operations: `await this.redisPublisher.connect()`
- Service methods: `async handleAction(clientId, action, data) { ... }`

**Error Handling in Async Context:**
```javascript
try {
    await this.nodeManager.registerNode();
} catch (error) {
    this.logger.error('Error registering node:', error);
}
```

## Data Structures

**Maps for Client/Connection Tracking:**
- `this.connections = new Map()` - clientId to WebSocket mapping
- `this.localClients = new Map()` - Local client connection metadata
- `this.services = new Map()` - Service name to service instance
- `this.channelHistory = new Map()` - Channel name to message array

**Sets for Channel Subscriptions:**
- `client.channels = new Set()` - Set of channels client is subscribed to
- `this.subscribedChannels = new Set()` - Set of Redis channels subscribed to

**Objects for Configuration:**
```javascript
const config = {
    redis: { host, port, url },
    server: { port, enabledServices: Array }
};
```

## Service Architecture Pattern

**Service Classes** (in `src/services/`):
1. Constructor receives: `messageRouter` and `logger`
2. Public method: `handleAction(clientId, action, data)` - routes to action handlers
3. Private handlers: `handleJoinChannel()`, `handleSendMessage()`, etc.
4. Utility methods: `sendToClient()`, `sendError()`, `getStats()`
5. Optional lifecycle: `handleDisconnect(clientId)` for cleanup

**Example method signature:**
```javascript
async handleAction(clientId, action, data) {
    try {
        switch (action) {
            case 'join':
                return await this.handleJoinChannel(clientId, data);
            // ...
        }
    } catch (error) {
        // error handling
    }
}
```

## Message Format

**Outgoing Messages (Wire Protocol):**
```javascript
{
    type: 'service_name',      // 'chat', 'presence', 'cursor', 'reaction'
    action: 'action_name',     // 'joined', 'sent', 'message', 'error'
    [additional_data]: any,
    timestamp: '2026-03-02T...'
}
```

**Incoming Messages (Client Request):**
```javascript
{
    service: 'chat',           // service name
    action: 'send',            // action to perform
    channel: 'general',        // service-specific data
    message: 'hello',
    ...
}
```

## TypeScript Compiler Options (CDK)

**Strict Mode Settings:**
- `strict: true` - All strict type checking
- `noImplicitAny: true` - Explicit types required
- `strictNullChecks: true` - Null/undefined checking
- `noImplicitThis: true` - This binding checked
- `noImplicitReturns: true` - All code paths must return

**Relaxed Settings:**
- `noUnusedLocals: false` - Unused variables allowed (AWS CDK pattern)
- `noUnusedParameters: false` - Unused parameters allowed
- `strictPropertyInitialization: false` - Property initialization not enforced

**Decorators:**
- `experimentalDecorators: true` - Required for AWS CDK

## Function Design

**Size:** Methods typically 20-50 lines, with longer methods breaking at 100+ lines for complex operations

**Parameters:**
- Single objects preferred over multiple parameters: `handleAction(clientId, { channel, message })`
- Optional parameters use destructuring defaults: `limit = 50`
- Metadata parameters are optional: `metadata = {}`

**Return Values:**
- Async service methods: void (communicate via message router)
- Query methods: return data directly (e.g., `getStats()` returns object)
- Validation methods: boolean for success/failure
- Router/tracker methods: return boolean or data

## Property Access

**Public vs Private:**
- No explicit private field markers (JavaScript convention)
- Private methods/properties documented in comments
- Assume properties prefixed with underscore are private (not observed in codebase)
- Most properties are effectively public through `this` references

---

*Convention analysis: 2026-03-02*
