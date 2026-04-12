// server.js - Distributed WebSocket Gateway with Node Sharding
const WebSocket = require("ws");
const redis = require("redis");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// Import our distributed architecture components
const NodeManager = require("./core/node-manager");
const MessageRouter = require("./core/message-router");
const Logger = require("./utils/logger");
const MetricsCollector = require("./utils/metrics-collector");
const AuthMiddleware = require("./middleware/auth-middleware");

// Service modules - Unified services supporting both local and distributed modes
const ChatService = require("./services/chat-service");
const PresenceService = require("./services/presence-service");
const CursorService = require("./services/cursor-service");
const ReactionService = require("./services/reaction-service");
const CRDTService = require("./services/crdt-service");
const SessionService = require("./services/session-service");
const SocialService = require("./services/social-service");
const ActivityService = require("./services/activity-service");

// Middleware
const { handleReconnection } = require("./middleware/reconnection-handler");

// Configuration
const config = {
    redis: {
        host: process.env.REDIS_ENDPOINT || 'redis',
        port: process.env.REDIS_PORT || 6379,
        url: `redis://${process.env.REDIS_ENDPOINT || 'redis'}:${process.env.REDIS_PORT || 6379}`
    },
    server: {
        port: process.env.PORT || 8080,
        enabledServices: (process.env.ENABLED_SERVICES || 'chat,presence,cursor,reaction,crdt').split(',')
    }
};

class DistributedWebSocketServer {
    constructor() {
        this.logger = new Logger('WebSocketServer');
        this.nodeManager = null;
        this.messageRouter = null;
        this.sessionService = null;
        this.services = new Map();

        // Validate required environment variables for authentication
        if (!process.env.COGNITO_REGION || !process.env.COGNITO_USER_POOL_ID) {
            this.logger.error('Missing required environment variables: COGNITO_REGION and COGNITO_USER_POOL_ID');
            process.exit(1);
        }

        // Initialize authentication middleware
        this.authMiddleware = new AuthMiddleware(this.logger);

        // Initialize metrics collector
        this.metricsCollector = new MetricsCollector(this.logger);
        this.metricsInterval = null;

        // Redis clients
        this.redisPublisher = null;
        this.redisSubscriber = null;
        this.redisConnected = false;

        // HTTP server and WebSocket server
        this.httpServer = null;
        this.wss = null;

        // Connection tracking
        this.connections = new Map(); // clientId -> { ws, metadata }

        // Connection limits (configurable via environment variables)
        this.connectionsByIp = new Map(); // IP -> count
        this.totalConnections = 0;
        this.MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '100', 10);
        this.MAX_TOTAL_CONNECTIONS = parseInt(process.env.MAX_TOTAL_CONNECTIONS || '10000', 10);

        // CORS configuration
        // In production, set ALLOWED_ORIGINS explicitly (e.g. "https://app.example.com")
        this.allowedOrigins = process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : ['*'];

        this.setupHttpServer();
    }

    async initialize() {
        this.logger.info('Initializing Distributed WebSocket Server...');
        
        // Initialize Redis connections
        await this.initializeRedis();
        
        // Initialize node management
        this.nodeManager = new NodeManager(this.redisPublisher, this.logger);
        await this.nodeManager.registerNode();
        this.nodeManager.setupGracefulShutdown();
        
        // Initialize session service first (MessageRouter needs it)
        this.sessionService = new SessionService(
            this.redisPublisher,
            this.logger,
            null  // Will set messageRouter reference after creation
        );

        // Initialize message router with session service
        this.messageRouter = new MessageRouter(
            this.nodeManager,
            this.redisPublisher,
            this.redisSubscriber,
            this.logger,
            this.sessionService
        );

        // Set messageRouter reference in session service for Redis health check
        this.sessionService.messageRouter = this.messageRouter;

        this.logger.info('✅ Session service initialized');

        // Initialize services
        await this.initializeServices();
        
        // Setup WebSocket server
        this.setupWebSocketServer();

        // Start metrics emission (every 60 seconds)
        this.metricsInterval = setInterval(() => {
            this.metricsCollector.flush();
            this.logger.info('Metrics emitted to CloudWatch', this.metricsCollector.getMetricsSummary());
        }, 60000);

        // Add cleanup handler to node manager
        this.nodeManager.addShutdownHandler(() => this.cleanup());

        this.logger.info(`Server initialized with node ID: ${this.nodeManager.nodeId}`);
    }

    async initializeRedis(retries = 3) {
        this.logger.info(`Attempting to connect to Redis at: ${config.redis.url} (attempt ${4 - retries})`);

        try {
            this.redisPublisher = redis.createClient({
                url: config.redis.url,
                socket: {
                    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
                }
            });

            this.redisSubscriber = redis.createClient({
                url: config.redis.url,
                socket: {
                    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
                }
            });

            // Add error handlers
            this.redisPublisher.on('error', (err) => {
                this.logger.error('Redis Publisher Error:', err.message);
                this.redisConnected = false;
            });

            this.redisSubscriber.on('error', (err) => {
                this.logger.error('Redis Subscriber Error:', err.message);
                this.redisConnected = false;
            });

            this.redisPublisher.on('connect', () => {
                this.logger.info('Redis Publisher connected');
                this.redisConnected = true;
            });

            this.redisSubscriber.on('connect', () => {
                this.logger.info('Redis Subscriber connected');
            });

            await this.redisPublisher.connect();
            await this.redisSubscriber.connect();

            this.logger.info(`✅ Connected to Redis at ${config.redis.url}`);
            this.redisConnected = true;
            return true;
        } catch (error) {
            this.logger.error('❌ Redis connection error:', error.message);

            if (retries > 0) {
                this.logger.info(`🔄 Retrying in 2 seconds... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.initializeRedis(retries - 1);
            } else {
                this.logger.warn('🔄 Max retries reached. Running in standalone mode');
                this.redisPublisher = null;
                this.redisSubscriber = null;
                this.redisConnected = false;
                return false;
            }
        }
    }

    async initializeServices() {
        this.logger.info(`Initializing services: ${config.server.enabledServices.join(', ')}`);

        if (config.server.enabledServices.includes('chat')) {
            const chatService = new ChatService(this.messageRouter, this.logger, this.metricsCollector);
            this.services.set('chat', chatService);
            this.logger.info('✅ Chat service initialized');
        }

        if (config.server.enabledServices.includes('presence')) {
            const presenceService = new PresenceService(this.messageRouter, this.nodeManager, this.logger, this.metricsCollector);
            this.services.set('presence', presenceService);
            this.logger.info('✅ Presence service initialized');
        }

        if (config.server.enabledServices.includes('cursor')) {
            const cursorService = new CursorService(this.messageRouter, this.logger, this.metricsCollector);
            this.services.set('cursor', cursorService);
            this.logger.info('✅ Cursor service initialized');
        }

        if (config.server.enabledServices.includes('reaction')) {
            const reactionService = new ReactionService(this.messageRouter, this.logger, this.metricsCollector);
            this.services.set('reaction', reactionService);
            this.logger.info('✅ Reaction service initialized');
        }

        if (config.server.enabledServices.includes('crdt')) {
            const crdtService = new CRDTService(this.messageRouter, this.logger, this.metricsCollector, this.redisPublisher);
            this.services.set('crdt', crdtService);
            this.logger.info('✅ CRDT service initialized');
        }

        // Social service is always enabled — required for real-time social event delivery
        const socialService = new SocialService(this.messageRouter, this.logger, this.metricsCollector);
        this.services.set('social', socialService);
        this.logger.info('✅ Social service initialized');

        // Activity service is always enabled — required for real-time activity feed
        const activityService = new ActivityService(this.messageRouter, this.logger, this.metricsCollector, this.redisPublisher);
        this.services.set('activity', activityService);
        this.logger.info('✅ Activity service initialized');
    }

    setupHttpServer() {
        const MIME_TYPES = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.map': 'application/json',
        };

        const publicDir = path.join(__dirname, 'public');

        this.httpServer = http.createServer((req, res) => {
            // API routes take priority
            if (req.url === '/health' && req.method === 'GET') {
                this.handleHealthCheck(req, res);
            } else if (req.url === '/cluster' && req.method === 'GET') {
                this.handleClusterInfo(req, res);
            } else if (req.url === '/stats' && req.method === 'GET') {
                this.handleStats(req, res);
            } else if (req.method === 'GET') {
                // Static file serving for the React SPA
                this.serveStatic(req, res, publicDir, MIME_TYPES);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });
    }

    serveStatic(req, res, publicDir, MIME_TYPES) {
        // Parse URL to strip query strings
        const urlPath = req.url.split('?')[0];

        // Prevent directory traversal
        const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(publicDir, safePath);

        // Ensure resolved path is within publicDir
        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        fs.stat(filePath, (err, stats) => {
            if (!err && stats.isFile()) {
                // File exists, serve it
                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                // Assets with hash in filename get long cache; index.html gets no-cache
                const cacheControl = ext === '.html'
                    ? 'no-cache, no-store, must-revalidate'
                    : 'public, max-age=31536000, immutable';

                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Cache-Control': cacheControl,
                });

                const stream = fs.createReadStream(filePath);
                stream.pipe(res);
                stream.on('error', () => {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                });
            } else {
                // File not found -- SPA fallback: serve index.html
                const indexPath = path.join(publicDir, 'index.html');
                fs.stat(indexPath, (indexErr, indexStats) => {
                    if (!indexErr && indexStats.isFile()) {
                        res.writeHead(200, {
                            'Content-Type': 'text/html',
                            'Cache-Control': 'no-cache, no-store, must-revalidate',
                        });
                        const stream = fs.createReadStream(indexPath);
                        stream.pipe(res);
                        stream.on('error', () => {
                            res.writeHead(500, { 'Content-Type': 'text/plain' });
                            res.end('Internal Server Error');
                        });
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                    }
                });
            }
        });
    }

    setupWebSocketServer() {
        this.wss = new WebSocket.Server({ noServer: true });

        // Handle HTTP upgrade for WebSocket connections
        this.httpServer.on('upgrade', async (request, socket, head) => {
            const clientIp = request.socket.remoteAddress;

            // Check connection limits BEFORE authentication to save resources
            // Check global connection limit
            if (this.totalConnections >= this.MAX_TOTAL_CONNECTIONS) {
                this.logger.warn(`Global connection limit reached: ${this.totalConnections}/${this.MAX_TOTAL_CONNECTIONS}`);
                socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                socket.destroy();
                return;
            }

            // Check per-IP connection limit
            const ipCount = this.connectionsByIp.get(clientIp) || 0;
            if (ipCount >= this.MAX_CONNECTIONS_PER_IP) {
                this.logger.warn(`Per-IP connection limit reached for ${clientIp}: ${ipCount}/${this.MAX_CONNECTIONS_PER_IP}`);
                socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
                socket.destroy();
                return;
            }

            try {
                // Validate JWT token BEFORE accepting WebSocket upgrade
                const userContext = await this.authMiddleware.validateToken(request);
                this.logger.info(`Client authenticated: ${userContext.userId}`);

                // Increment connection counters after successful auth
                this.totalConnections++;
                this.connectionsByIp.set(clientIp, ipCount + 1);

                // Accept the WebSocket upgrade
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request, userContext);
                });
            } catch (error) {
                // Record connection failure metric for CloudWatch alarm
                this.metricsCollector.recordMetric('ConnectionFailures', 1);

                this.logger.error('Connection authentication failed', {
                    ip: request.socket.remoteAddress,
                    reason: 'invalid_token',
                    error: error.message
                });

                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
            }
        });

        this.wss.on("connection", async (ws, req, userContext) => {
            const clientIP = req.socket.remoteAddress;

            try {
                // Handle reconnection with session token recovery
                const reconnectionResult = await handleReconnection(
                    ws,
                    req,
                    this.sessionService,
                    this.messageRouter,
                    this.logger,
                    this.metricsCollector
                );

                const clientId = reconnectionResult.clientId;
                const restored = reconnectionResult.restored;
                let sessionToken = reconnectionResult.sessionToken;

                // Record connection in metrics
                this.metricsCollector.recordConnection(1);

                this.logger.info('Client connected', {
                    clientId,
                    ip: clientIP,
                    userId: userContext.userId,
                    restored,
                    totalConnections: this.connections.size + 1
                });

                // For new connections (not restored), create session token
                if (!restored) {
                    sessionToken = await this.sessionService.createSession(clientId, userContext);
                }

                // Register client with message router
                const metadata = {
                    ip: clientIP,
                    userAgent: req.headers['user-agent'],
                    connectedAt: new Date().toISOString(),
                    userContext: userContext,  // Store userContext in metadata
                    sessionToken: sessionToken  // Track session token
                };

                this.messageRouter.registerLocalClient(clientId, ws, metadata);
                this.connections.set(clientId, { ws, metadata });

                // Notify services that support onClientConnect lifecycle hook
                for (const [serviceName, service] of this.services) {
                    if (typeof service.onClientConnect === 'function') {
                        try {
                            await service.onClientConnect(clientId);
                        } catch (error) {
                            this.logger.error(`Error in ${serviceName} onClientConnect handler:`, error);
                        }
                    }
                }

                // WebSocket ping/pong keepalive (every 30 seconds)
                const pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                        this.logger.debug(`[keepalive] Ping sent to client ${clientId}`);
                    }
                }, 30000); // 30 seconds

                ws.on('pong', () => {
                    this.logger.debug(`[keepalive] Pong received from client ${clientId}`);
                });

                // Setup message handler with error boundary
                ws.on("message", async (message) => {
                    try {
                        // Convert Buffer/ArrayBuffer to string for JSON parsing
                        const rawMessage = Buffer.isBuffer(message) ? message.toString('utf8') : message;
                        await this.handleMessage(clientId, rawMessage);
                    } catch (error) {
                        this.logger.error('Unhandled error in message handler', {
                            clientId,
                            error: error.message,
                            stack: error.stack
                        });
                        this.sendToClient(clientId, {
                            type: 'error',
                            code: 'INTERNAL_ERROR',
                            message: 'Internal server error',
                            timestamp: new Date().toISOString()
                        });
                    }
                });

                // Setup close handler
                ws.on("close", () => {
                    clearInterval(pingInterval);
                    this.metricsCollector.recordConnection(-1);
                    this.logger.info('Client disconnected', { clientId, totalConnections: this.connections.size - 1 });
                    this.handleClientDisconnect(clientId, clientIP);
                });

                // Setup error handler
                ws.on("error", (error) => {
                    clearInterval(pingInterval);
                    this.metricsCollector.recordConnection(-1);
                    this.logger.error('WebSocket error', { clientId, error: error.message });
                    this.handleClientDisconnect(clientId, clientIP);
                });

                // Send welcome message with session token
                this.sendToClient(clientId, {
                    type: 'session',
                    status: 'connected',
                    clientId,
                    sessionToken,
                    restored,
                    nodeId: this.nodeManager.nodeId,
                    enabledServices: config.server.enabledServices,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.logger.error('Unhandled error in connection handler', {
                    ip: clientIP,
                    error: error.message,
                    stack: error.stack
                });
                // Close WebSocket with 1011 (unexpected condition)
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close(1011, 'Unexpected server error');
                }
            }
        });
    }

    async handleMessage(clientId, rawMessage) {
        // Generate correlation ID for this message
        const correlationId = crypto.randomUUID();
        const correlatedLogger = this.logger.withCorrelation(correlationId);

        try {
            // Record message start time for latency tracking
            const startTime = Date.now();

            // Validate and rate-limit message using message router
            const message = await this.messageRouter.validateAndRateLimit(clientId, rawMessage);

            // If validation or rate limiting failed, validateAndRateLimit already sent error
            if (!message) {
                return;
            }

            correlatedLogger.debug('Message received', { clientId, service: message.service, action: message.action });

            const { service, action, ...data } = message;

            // Route to appropriate service
            const serviceInstance = this.services.get(service);
            if (!serviceInstance) {
                this.sendToClient(clientId, {
                    type: 'error',
                    code: 'SERVICE_NOT_AVAILABLE',
                    message: `Service '${service}' not available`,
                    availableServices: Array.from(this.services.keys()),
                    timestamp: new Date().toISOString()
                });
                return;
            }

            try {
                // Pass correlationId to service handlers for cross-service tracing
                data.correlationId = correlationId;

                // Call service method
                await serviceInstance.handleAction(clientId, action, data);

                // Record successful message processing latency
                const latency = Date.now() - startTime;
                this.metricsCollector.recordMessage(latency);
            } catch (error) {
                correlatedLogger.error('Message routing failed', {
                    error: error.message,
                    clientId,
                    service,
                    action
                });
                this.sendToClient(clientId, {
                    type: 'error',
                    code: 'SERVICE_ERROR',
                    message: 'Failed to process message',
                    timestamp: new Date().toISOString()
                });

                // Still record latency even for errors
                const latency = Date.now() - startTime;
                this.metricsCollector.recordMessage(latency);
            }
        } catch (error) {
            correlatedLogger.error('Unhandled error in message handler', {
                clientId,
                error: error.message,
                stack: error.stack
            });
            this.sendToClient(clientId, {
                type: 'error',
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                timestamp: new Date().toISOString()
            });
        }
    }

    async handleClientDisconnect(clientId, clientIP) {
        // Decrement connection counters
        this.totalConnections--;

        const ipCount = this.connectionsByIp.get(clientIP);
        if (ipCount !== undefined) {
            if (ipCount <= 1) {
                this.connectionsByIp.delete(clientIP);
            } else {
                this.connectionsByIp.set(clientIP, ipCount - 1);
            }
        }

        // Notify services about disconnect
        // Services may define handleDisconnect() or onClientDisconnect() — check both
        for (const [serviceName, service] of this.services) {
            const handler = service.handleDisconnect || service.onClientDisconnect;
            if (handler) {
                try {
                    await handler.call(service, clientId);
                } catch (error) {
                    this.logger.error(`Error in ${serviceName} disconnect handler:`, error);
                }
            }
        }

        // Unregister from message router
        await this.messageRouter.unregisterLocalClient(clientId);
        this.connections.delete(clientId);
    }

    sendToClient(clientId, message) {
        return this.messageRouter.sendToClient(clientId, message);
    }

    generateClientId() {
        return `client_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    async handleHealthCheck(req, res) {
        const isHealthy = this.redisConnected;
        const health = {
            status: isHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            nodeId: this.nodeManager?.nodeId,
            redis: this.redisConnected ? 'connected' : 'disconnected',
            websocket: 'running',
            uptime: process.uptime(),
            connections: this.connections.size,
            enabledServices: config.server.enabledServices,
            memoryUsage: process.memoryUsage()
        };

        const statusCode = isHealthy ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
    }

    async handleClusterInfo(req, res) {
        const clusterInfo = await this.nodeManager?.getClusterInfo() || {
            nodes: [],
            totalNodes: 1,
            totalConnections: this.connections.size
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clusterInfo, null, 2));
    }

    async handleStats(req, res) {
        const stats = {
            node: this.messageRouter?.getStats() || {},
            services: {}
        };

        // Get stats from each service
        for (const [serviceName, service] of this.services) {
            if (service.getStats) {
                stats.services[serviceName] = service.getStats();
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
    }

    async cleanup() {
        this.logger.info('Cleaning up WebSocket server...');

        // Flush final metrics before shutdown
        if (this.metricsCollector) {
            await this.metricsCollector.flush();
        }

        // Clear metrics interval
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }

        // Close all WebSocket connections
        for (const [clientId, { ws }] of this.connections) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1001, 'Server shutting down');
            }
        }

        // Cleanup message router
        if (this.messageRouter) {
            await this.messageRouter.cleanup();
        }
        
        // Close Redis connections
        if (this.redisPublisher) {
            try {
                await this.redisPublisher.quit();
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn('Error closing Redis publisher:', error.message);
                }
            }
        }
        if (this.redisSubscriber) {
            try {
                await this.redisSubscriber.quit();
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn('Error closing Redis subscriber:', error.message);
                }
            }
        }
        
        // Close HTTP server
        if (this.httpServer) {
            this.httpServer.close();
        }
        
        this.logger.info('WebSocket server cleanup completed');
    }

    async shutdown() {
        this.logger.info('🛑 Shutting down WebSocket server...');
        
        try {
            // Close all WebSocket connections
            if (this.wss) {
                this.wss.clients.forEach((ws) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close(1001, 'Server shutting down');
                    }
                });
            }
            
            // Close HTTP server
            if (this.httpServer) {
                await new Promise((resolve, reject) => {
                    this.httpServer.close((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
            
            // Shut down services (flush pending snapshots, etc.) before closing Redis
            for (const [name, service] of this.services.entries()) {
                if (typeof service.shutdown === 'function') {
                    try {
                        await service.shutdown();
                    } catch (err) {
                        this.logger.warn(`Error shutting down ${name} service:`, err.message);
                    }
                }
            }

            // Close Redis connections
            if (this.redisPublisher) {
                try {
                    await this.redisPublisher.quit();
                } catch (error) {
                    if (error.name !== 'ClientClosedError') {
                        this.logger.warn('Error closing Redis publisher during shutdown:', error.message);
                    }
                }
            }
            if (this.redisSubscriber) {
                try {
                    await this.redisSubscriber.quit();
                } catch (error) {
                    if (error.name !== 'ClientClosedError') {
                        this.logger.warn('Error closing Redis subscriber during shutdown:', error.message);
                    }
                }
            }
            
            // Cleanup node manager
            if (this.nodeManager) {
                await this.nodeManager.shutdown();
            }
            
            this.logger.info('✅ Server shutdown complete');
        } catch (error) {
            this.logger.error('❌ Error during shutdown:', error);
            throw error;
        }
    }

    async start() {
        const port = config.server.port;

        // Start HTTP server FIRST so health checks pass while services initialize.
        // This prevents ECS circuit breaker from killing the task during Redis retry.
        await new Promise(resolve => {
            this.httpServer.listen(port, () => {
                this.logger.info(`🚀 HTTP server listening on port ${port} (initializing services...)`);
                resolve();
            });
        });

        await this.initialize();

        this.logger.info(`✅ All services initialized`);
        this.logger.info(`📊 Health check: http://localhost:${port}/health`);
        this.logger.info(`🆔 Node ID: ${this.nodeManager.nodeId}`);
        this.logger.info(`🔧 Enabled services: ${config.server.enabledServices.join(', ')}`);
        this.logger.info(`💾 Redis: ${this.redisConnected ? 'Connected' : 'Standalone mode'}`);
    }
}

// Start the server
const server = new DistributedWebSocketServer();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await server.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    await server.shutdown();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});