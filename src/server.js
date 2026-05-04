// server.js - Distributed WebSocket Gateway with Node Sharding
const WebSocket = require("ws");
const redis = require("redis");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");

// Import our distributed architecture components
const NodeManager = require("./core/node-manager");
const MessageRouter = require("./core/message-router");
const Logger = require("./utils/logger");
const MetricsCollector = require("./utils/metrics-collector");
const promMetrics = require("./observability/metrics");
const { handlePostmortem } = require("./observability/postmortem");
const AuthMiddleware = require("./middleware/auth-middleware");
const {
    KEEPALIVE_INTERVAL_MS,
    METRICS_FLUSH_INTERVAL_MS,
    REDIS_RETRY_DELAY_MS,
    REDIS_RECONNECT_BASE_MS,
    REDIS_RECONNECT_MAX_MS,
} = require("./config/constants");

// Service modules - Unified services supporting both local and distributed modes
const ChatService = require("./services/chat-service");
const PresenceService = require("./services/presence-service");
const CursorService = require("./services/cursor-service");
const ReactionService = require("./services/reaction-service");
const CRDTService = require("./services/crdt-service");
const SessionService = require("./services/session-service");
const SocialService = require("./services/social-service");
const ActivityService = require("./services/activity-service");
const DocumentEventsService = require("./services/document-events-service");
const PipelineService = require("./services/pipeline-service");
const { PipelineBridge, bindPipelineModule } = require("./pipeline-bridge/pipeline-bridge");

// Utilities
const { createDynamoClient } = require('./utils/dynamo-client');

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

        // Observability counters
        this._metrics = {
            peakConnections: 0,
            messagesReceived: 0,
            messagesSent: 0,
            messageErrors: 0,
            startTime: Date.now(),
        };

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

        // DC-PIPELINE-7 receive side: when ownership routing is enabled, the
        // RoomOwnershipService singleton lazy-bootstraps the cluster and
        // surfaces a PeerMessaging instance. We attach it to message-router
        // so peer-addressed `wsg.channel.<channel>` envelopes from other
        // nodes fan out to local subscribers (instead of being silently
        // auto-acked by PeerMessaging). The bootstrap is fire-and-forget;
        // attach is idempotent so a hot-reload or repeated init won't double
        // register handlers.
        this._attachPeerMessagingWhenReady();
        this._attachPresenceRegistryWhenReady();

        // Initialize services
        await this.initializeServices();
        
        // Setup WebSocket server
        this.setupWebSocketServer();

        // Start metrics emission
        this.metricsInterval = setInterval(() => {
            this.metricsCollector.flush();
            this.logger.info('Metrics emitted to CloudWatch', this.metricsCollector.getMetricsSummary());
        }, METRICS_FLUSH_INTERVAL_MS);
        if (this.metricsInterval.unref) this.metricsInterval.unref();

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
                    reconnectStrategy: (retries) => Math.min(retries * REDIS_RECONNECT_BASE_MS, REDIS_RECONNECT_MAX_MS)
                }
            });

            this.redisSubscriber = redis.createClient({
                url: config.redis.url,
                socket: {
                    reconnectStrategy: (retries) => Math.min(retries * REDIS_RECONNECT_BASE_MS, REDIS_RECONNECT_MAX_MS)
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
                await new Promise(resolve => setTimeout(resolve, REDIS_RETRY_DELAY_MS));
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

        // Create shared DynamoDB client for all services
        this.dynamoClient = createDynamoClient();

        if (config.server.enabledServices.includes('chat')) {
            const chatService = new ChatService(this.messageRouter, this.logger, this.metricsCollector, this.dynamoClient);
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
            const crdtService = new CRDTService(this.messageRouter, this.logger, this.metricsCollector, this.redisPublisher, this.dynamoClient);
            this.services.set('crdt', crdtService);
            this.logger.info('✅ CRDT service initialized');
        }

        // Social service is always enabled — required for real-time social event delivery
        const socialService = new SocialService(this.messageRouter, this.logger, this.metricsCollector);
        this.services.set('social', socialService);
        this.logger.info('✅ Social service initialized');

        // Activity service is always enabled — required for real-time activity feed
        const activityService = new ActivityService(this.messageRouter, this.logger, this.metricsCollector, this.redisPublisher, this.dynamoClient);
        this.services.set('activity', activityService);
        this.logger.info('✅ Activity service initialized');

        // Document events service is always enabled — required for real-time document event delivery
        const docEventsService = new DocumentEventsService(this.messageRouter, this.logger, this.metricsCollector);
        this.services.set('document-events', docEventsService);
        this.logger.info('✅ Document events service initialized');

        // Phase 1: a local EventEmitter acts as the pipeline event source. Phase 3 swaps
        // this for a distributed-core EventBus (same subscribeAll shape).
        // Created before the PipelineService so cancel/resolveApproval fallbacks can
        // synthesize events directly onto it without extra wiring.
        // TODO Phase 3: real events will flow from distributed-core EventBus.
        this.pipelineEventSource = new EventEmitter();

        // Pipeline service is always enabled — Phase 4 scaffold pinning the WS message-routing shape.
        // Phase 4 will register cancelHandler / resolveApprovalHandler that call
        // PipelineModule.deleteResource() / PipelineModule.resolveApproval(); until
        // then the service uses the local event-source fallback for both actions.
        const pipelineService = new PipelineService(
            this.messageRouter,
            this.logger,
            this.metricsCollector,
            { eventSource: this.pipelineEventSource },
        );
        this.services.set('pipeline', pipelineService);
        this.logger.info('✅ Pipeline service initialized (stub — Phase 4 integration pending)');

        this.pipelineBridge = new PipelineBridge({
            eventSource: this.pipelineEventSource,
            pipelineService,
            logger: this.logger,
        });
        this.pipelineBridge.start();

        // Wire the distributed-core PipelineModule (async, non-blocking).
        // When available, real pipeline execution replaces the mock fallback.
        // When unavailable (distributed-core not built, cluster not enabled),
        // the mock fallback in PipelineService continues to work.
        this._wirePipelineModule(pipelineService);

        // Expose the source on the HTTP server so later phases (and tests) can grab it.
        if (this.httpServer) {
            this.httpServer.pipelineEventSource = this.pipelineEventSource;
        }
        this.logger.info('✅ Pipeline bridge started (Phase 1 stub — EventEmitter source)');
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
            // Parse path without query string for matching
            const urlPathOnly = (req.url || '').split('?')[0];

            // API routes take priority
            if (req.url === '/health' && req.method === 'GET') {
                this.handleHealthCheck(req, res);
            } else if (req.url === '/cluster' && req.method === 'GET') {
                this.handleClusterInfo(req, res);
            } else if (req.url === '/stats' && req.method === 'GET') {
                this.handleStats(req, res);
            } else if (req.url === '/metrics' && req.method === 'GET') {
                this.handleMetrics(req, res);
            } else if (req.url === '/internal/metrics' && req.method === 'GET') {
                // Prometheus scrape endpoint — distributed-core MetricsRegistry.
                // Coexists with CloudWatch push from MetricsCollector.
                res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
                res.end(promMetrics.renderPrometheusText());
            } else if (req.url === '/internal/postmortem' && req.method === 'GET') {
                // Postmortem aggregator — surfaces `cluster.snapshot()` for
                // incident response. Same auth gate as /internal/metrics
                // (today: open at the app layer; internal/admin-only at the
                // network layer). Returns 200 + JSON snapshot when wired,
                // 200 + { wired: false } when ownership routing is disabled,
                // 500 + { wired: true } when snapshot() throws.
                handlePostmortem(req, res, { logger: this.logger });
            } else if (req.method === 'POST' && urlPathOnly.startsWith('/hooks/pipeline/')) {
                // Phase 4-forward: external webhook trigger for pipelines with
                // triggerBinding.event === 'webhook'. Emits a bus event that the
                // PipelineBridge fans out via pipeline:all → WS subscribers.
                this.handlePipelineWebhook(req, res, urlPathOnly);
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
        // The JWT travels via Sec-WebSocket-Protocol as the value following the
        // 'bearer-token-v1' marker. Echo only the marker — never the token —
        // back to the client. Old clients that authenticate via the deprecated
        // ?token=... query param send no subprotocol, so handleProtocols isn't
        // invoked and they still upgrade cleanly.
        this.wss = new WebSocket.Server({
            noServer: true,
            handleProtocols: (protocols) => {
                const has = typeof protocols.has === 'function'
                    ? protocols.has('bearer-token-v1')
                    : protocols.includes('bearer-token-v1');
                return has ? 'bearer-token-v1' : false;
            },
        });

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
                promMetrics.recordConnectionFailure();

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
                promMetrics.recordConnection(1);

                // Track peak connections
                const currentCount = this.connections.size + 1;
                if (currentCount > this._metrics.peakConnections) {
                    this._metrics.peakConnections = currentCount;
                }

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

                // WebSocket ping/pong keepalive
                const pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                        this.logger.debug(`[keepalive] Ping sent to client ${clientId}`);
                    }
                }, KEEPALIVE_INTERVAL_MS);

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
                    promMetrics.recordConnection(-1);
                    this.logger.info('Client disconnected', { clientId, totalConnections: this.connections.size - 1 });
                    this.handleClientDisconnect(clientId, clientIP);
                });

                // Setup error handler
                ws.on("error", (error) => {
                    clearInterval(pingInterval);
                    this.metricsCollector.recordConnection(-1);
                    promMetrics.recordConnection(-1);
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
            this._metrics.messagesReceived++;

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
                promMetrics.recordMessage();
            } catch (error) {
                this._metrics.messageErrors++;
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
        this._metrics.messagesSent++;
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

    async handleMetrics(req, res) {
        // Gather CRDT-specific stats
        const crdtService = this.services.get('crdt');
        const crdtStats = crdtService ? crdtService.getStats() : {};
        let totalYDocMemoryMB = 0;
        if (crdtService && crdtService.channelStates) {
            const Y = require('yjs');
            for (const state of crdtService.channelStates.values()) {
                if (state.ydoc) {
                    try {
                        const encoded = Y.encodeStateAsUpdate(state.ydoc);
                        totalYDocMemoryMB += encoded.byteLength;
                    } catch (_) { /* ignore encoding errors */ }
                }
            }
            totalYDocMemoryMB = Math.round((totalYDocMemoryMB / (1024 * 1024)) * 100) / 100;
        }

        const metrics = {
            connections: {
                current: this.connections.size,
                peak: this._metrics.peakConnections,
            },
            messages: {
                received: this._metrics.messagesReceived,
                sent: this._metrics.messagesSent,
                errors: this._metrics.messageErrors,
            },
            crdt: {
                activeDocuments: crdtStats.activeChannels || 0,
                totalYDocMemoryMB,
            },
            redis: {
                status: this.redisConnected ? 'connected' : 'disconnected',
            },
            uptime: Math.round((Date.now() - this._metrics.startTime) / 1000),
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metrics, null, 2));
    }

    /**
     * POST /hooks/pipeline/:path — external webhook endpoint.
     *
     * Extracts the path segment after `/hooks/pipeline/`, reads the body,
     * and emits a `pipeline.webhook.triggered` event on the gateway's
     * pipelineEventSource. The PipelineBridge fans this out to
     * `pipeline:all` (and optionally `pipeline:run:{runId}` when a runId
     * is present). Subscribers on the frontend match on `webhookPath`.
     *
     * Responds 202 Accepted with `{ accepted: true, path }`.
     */
    async handlePipelineWebhook(req, res, urlPathOnly) {
        const PREFIX = '/hooks/pipeline/';
        // Strip prefix + any trailing slash(es); allow the remainder to contain
        // further slashes so `/hooks/pipeline/foo/bar` → webhookPath `foo/bar`.
        let webhookPath = urlPathOnly.slice(PREFIX.length);
        webhookPath = webhookPath.replace(/\/+$/, '');

        if (!webhookPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'webhook path is required' }));
            return;
        }

        // Reject payloads above a hard cap to avoid unbounded memory use.
        const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

        // Collect the body as a buffer so we can parse it as JSON when
        // appropriate and fall back to raw text otherwise.
        const chunks = [];
        let received = 0;
        let tooLarge = false;

        req.on('data', (chunk) => {
            if (tooLarge) return;
            received += chunk.length;
            if (received > MAX_BODY_BYTES) {
                tooLarge = true;
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (tooLarge) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'payload too large' }));
                return;
            }

            const raw = Buffer.concat(chunks).toString('utf8');
            const contentType = (req.headers['content-type'] || '').toLowerCase();
            let body;
            if (raw.length === 0) {
                body = null;
            } else if (contentType.includes('application/json')) {
                try {
                    body = JSON.parse(raw);
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'invalid JSON body' }));
                    return;
                }
            } else {
                body = raw;
            }

            // Build a header snapshot minus anything bearer-like. Pass through
            // everything else verbatim — subscribers decide what they need.
            const safeHeaders = {};
            for (const [name, value] of Object.entries(req.headers)) {
                const lower = name.toLowerCase();
                if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') {
                    continue;
                }
                safeHeaders[lower] = Array.isArray(value) ? value.join(', ') : value;
            }

            const payload = {
                webhookPath,
                body,
                headers: safeHeaders,
                at: new Date().toISOString(),
            };

            if (this.pipelineEventSource && typeof this.pipelineEventSource.emit === 'function') {
                try {
                    this.pipelineEventSource.emit('event', {
                        eventType: 'pipeline.webhook.triggered',
                        payload,
                    });
                } catch (err) {
                    this.logger.error('[pipeline-webhook] emit failed', err?.message || err);
                }
            } else {
                this.logger.warn('[pipeline-webhook] pipelineEventSource not available');
            }

            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: true, path: webhookPath }));
        });

        req.on('error', (err) => {
            this.logger.warn('[pipeline-webhook] request error', err?.message || err);
            try {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'request aborted' }));
            } catch (_) { /* connection already closed */ }
        });
    }

    /**
     * Resolve the RoomOwnershipService singleton (which lazy-bootstraps
     * the gateway cluster when WSG_ENABLE_OWNERSHIP_ROUTING=true) and
     * attach its PeerMessaging instance to message-router for receive-side
     * channel fan-out (DC-PIPELINE-7).
     *
     * Fire-and-forget: bootstrap can take seconds (waitForConvergence) and
     * we must not block server initialize(). When the flag is off, the
     * singleton is the NullRoomOwnershipService whose getPeerMessaging()
     * returns null — we log + skip.
     *
     * MessageRouter.attachPeerMessaging() is idempotent and backfills
     * handlers for channels already locally subscribed at attach time, so
     * any client subscribing during the bootstrap window is covered.
     */
    /**
     * If the presence service is enabled AND `WSG_PRESENCE_REGISTRY_ENABLED=true`
     * caused cluster-bootstrap to construct a secondary EntityRegistry, attach
     * it to PresenceService as a shadow-write target. Fire-and-forget — the
     * bootstrap is lazy and may resolve after services are constructed; until
     * it does, the in-memory presence path is the only path. When the flag is
     * off, the bootstrap's `presenceRegistry` is null and this is a no-op.
     */
    _attachPresenceRegistryWhenReady() {
        // eslint-disable-next-line global-require
        const { getRoomOwnershipService } = require('./services/room-ownership-service');
        Promise.resolve()
            .then(() => getRoomOwnershipService({ logger: this.logger }))
            .then((svc) => {
                const registry = svc && svc.presenceRegistry ? svc.presenceRegistry : null;
                if (!registry) {
                    this.logger.debug && this.logger.debug(
                        'Presence shadow-write registry unavailable (flag off or bootstrap returned null); skipping',
                    );
                    return;
                }
                const presenceService = this.services && this.services.get
                    ? this.services.get('presence')
                    : null;
                if (!presenceService || typeof presenceService.setPresenceRegistry !== 'function') {
                    this.logger.debug && this.logger.debug(
                        'Presence service not present or missing setPresenceRegistry(); skipping',
                    );
                    return;
                }
                presenceService.setPresenceRegistry(registry);
                this.logger.info('✅ Presence shadow-write registry attached');
            })
            .catch((err) => {
                this.logger.warn && this.logger.warn(
                    'Failed to attach presence shadow-write registry',
                    { error: err && err.message },
                );
            });
    }

    /**
     * Wire the distributed-core PipelineModule into PipelineService so
     * trigger / cancel / resolveApproval / getRun / getHistory /
     * resumeFromStep go through the real executor instead of the in-memory
     * mock shim.
     *
     * Non-blocking: if distributed-core is not available or the cluster is
     * not enabled, we log a warning and leave the mock fallback in place.
     * The gateway continues to work either way.
     */
    _wirePipelineModule(pipelineService) {
        // Ensure the WAL data directory exists (gitignored).
        const dataDir = path.join(__dirname, '..', 'data');
        try {
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
        } catch (err) {
            this.logger.warn('Failed to create data/ directory for pipeline WAL', {
                error: err && err.message,
            });
        }

        // eslint-disable-next-line global-require
        const { getRoomOwnershipService } = require('./services/room-ownership-service');
        Promise.resolve()
            .then(() => getRoomOwnershipService({ logger: this.logger }))
            .then(async (svc) => {
                // The room-ownership bootstrap gives us a Cluster facade
                // (when ownership routing is enabled). We need its pubsub
                // and clusterManager to initialize PipelineModule.
                const cluster = svc && svc.shutdown && svc._cluster
                    ? svc._cluster
                    : null;
                // If no cluster, try to grab it from the bootstrap result
                // stashed on the singleton.
                const clusterFacade = cluster
                    || (svc && svc.clusterHandle)
                    || null;

                // Fallback: construct a minimal standalone context so
                // PipelineModule can initialize without the full cluster.
                // This is the common path when ownership routing is
                // disabled (WSG_ENABLE_OWNERSHIP_ROUTING != "true").
                let PipelineModule, FixtureLLMClient;
                try {
                    // eslint-disable-next-line global-require
                    ({ PipelineModule, FixtureLLMClient } = require('distributed-core'));
                } catch (loadErr) {
                    this.logger.warn(
                        '[pipeline] distributed-core not available; PipelineModule wiring skipped — using mock fallback',
                        { error: loadErr && loadErr.message },
                    );
                    return;
                }

                // Build a minimal ApplicationModuleContext. When the full
                // cluster facade is available we use its pubsub +
                // clusterManager; otherwise we construct in-memory stubs.
                const { EventEmitter: EE } = require('events');
                const nodeId = (clusterFacade && clusterFacade.clusterManager)
                    ? clusterFacade.clusterManager.localNodeId
                    : `wsg-pipeline-${Date.now()}`;

                let pubsub;
                if (clusterFacade && clusterFacade.pubsub) {
                    pubsub = clusterFacade.pubsub;
                } else {
                    // Construct a minimal in-memory PubSub stub for the
                    // PipelineModule's EventBus. The EventBus only needs
                    // subscribe/unsubscribe/publish — same pattern used by
                    // distributed-core's own test harness.
                    const handlers = new Map();
                    let counter = 0;
                    pubsub = {
                        subscribe(_topic, handler) {
                            counter++;
                            const id = `ps-${counter}`;
                            handlers.set(id, handler);
                            return id;
                        },
                        unsubscribe(id) { handlers.delete(id); },
                        async publish(topic, payload) {
                            const meta = {
                                publisherNodeId: nodeId,
                                messageId: String(Date.now()),
                                timestamp: Date.now(),
                                topic,
                            };
                            await Promise.all(
                                Array.from(handlers.values()).map((h) => h(topic, payload, meta)),
                            );
                        },
                    };
                }

                const stubEvents = new EE();
                const clusterManager = (clusterFacade && clusterFacade.clusterManager)
                    ? clusterFacade.clusterManager
                    : {
                        localNodeId: nodeId,
                        on: stubEvents.on.bind(stubEvents),
                        off: stubEvents.off.bind(stubEvents),
                        emit: stubEvents.emit.bind(stubEvents),
                    };

                const context = {
                    clusterManager,
                    resourceRegistry: {
                        registerResourceType: () => {},
                        getResourcesByType: () => [],
                    },
                    topologyManager: {},
                    moduleRegistry: {
                        registerModule: async () => {},
                        unregisterModule: async () => {},
                        getModule: () => undefined,
                        getAllModules: () => [],
                        getModulesByResourceType: () => [],
                    },
                    configuration: { pubsub },
                    logger: {
                        info: (...a) => this.logger.info('[PipelineModule]', ...a),
                        warn: (...a) => this.logger.warn('[PipelineModule]', ...a),
                        error: (...a) => this.logger.error('[PipelineModule]', ...a),
                        debug: (...a) => this.logger.debug && this.logger.debug('[PipelineModule]', ...a),
                    },
                };

                const pipelineModule = new PipelineModule({
                    moduleId: 'pipeline',
                    moduleName: 'Pipeline',
                    version: '1.0.0',
                    resourceTypes: ['pipeline-run'],
                    configuration: {},
                    llmClient: new FixtureLLMClient([]),
                    walFilePath: path.join(dataDir, 'pipeline-wal'),
                    checkpointEveryN: 10,
                });

                await pipelineModule.initialize(context);
                await pipelineModule.start();

                // Use the existing bindPipelineModule helper to wire
                // setPipelineModule + setCancelHandler + setResolveApprovalHandler.
                bindPipelineModule(pipelineService, pipelineModule);

                // Wire metrics subscriber to EventBus (task #371).
                const { subscribePipelineMetrics } = require('./pipeline-metrics-subscriber');
                // Import metrics recording functions from social-api.
                // In production, social-api runs as separate process; here we import
                // directly for single-process dev mode. Multi-process setups would
                // export metrics via gateway's own registry.
                try {
                    // eslint-disable-next-line global-require
                    const socialApiMetrics = require('../social-api/src/observability/metrics');
                    const eventBus = pipelineModule.getEventBus && pipelineModule.getEventBus();
                    if (eventBus && typeof eventBus.subscribeAll === 'function') {
                        const unsubscribe = subscribePipelineMetrics(
                            eventBus,
                            {
                                recordPipelineStepDuration: socialApiMetrics.recordPipelineStepDuration,
                                recordPipelineRunInflightDelta: socialApiMetrics.recordPipelineRunInflightDelta,
                                recordPipelineApprovalPendingDelta: socialApiMetrics.recordPipelineApprovalPendingDelta,
                                recordLLMTokens: socialApiMetrics.recordLLMTokens,
                            },
                            this.logger,
                        );
                        // Stash unsubscribe for shutdown.
                        this._pipelineMetricsUnsubscribe = unsubscribe;
                    }
                } catch (metricsErr) {
                    this.logger.warn('[pipeline] metrics subscriber wiring failed; continuing without detailed telemetry', {
                        error: metricsErr && metricsErr.message,
                    });
                }

                // Stash reference for shutdown.
                this._pipelineModule = pipelineModule;

                this.logger.info('✅ PipelineModule wired from distributed-core — real execution enabled');
            })
            .catch((err) => {
                this.logger.warn(
                    '[pipeline] PipelineModule wiring failed; continuing with mock fallback',
                    { error: err && err.message },
                );
            });
    }

    _attachPeerMessagingWhenReady() {
        // eslint-disable-next-line global-require
        const { getRoomOwnershipService } = require('./services/room-ownership-service');
        Promise.resolve()
            .then(() => getRoomOwnershipService({ logger: this.logger }))
            .then((svc) => {
                const peerMessaging = svc && typeof svc.getPeerMessaging === 'function'
                    ? svc.getPeerMessaging()
                    : null;
                if (!peerMessaging) {
                    this.logger.debug && this.logger.debug(
                        'PeerMessaging unavailable (ownership routing disabled or older distributed-core); peer receive-side fan-out skipped',
                    );
                    return;
                }
                if (!this.messageRouter || typeof this.messageRouter.attachPeerMessaging !== 'function') {
                    this.logger.warn && this.logger.warn(
                        'message-router missing attachPeerMessaging(); peer receive-side fan-out skipped',
                    );
                    return;
                }
                this.messageRouter.attachPeerMessaging(peerMessaging);
                this.logger.info(
                    '✅ Peer-addressed channel receive-side fan-out wired (DC-PIPELINE-7)',
                );
            })
            .catch((err) => {
                this.logger.warn && this.logger.warn(
                    'Failed to attach PeerMessaging for receive-side fan-out',
                    { error: err && err.message },
                );
            });
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

        // Stop PipelineModule (if wired from distributed-core)
        if (this._pipelineModule && typeof this._pipelineModule.stop === 'function') {
            try {
                await this._pipelineModule.stop();
            } catch (err) {
                this.logger.warn('Error stopping PipelineModule:', err.message);
            }
        }

        // Stop pipeline bridge (unsubscribe from event source)
        if (this.pipelineBridge) {
            try {
                this.pipelineBridge.stop();
            } catch (err) {
                this.logger.warn('Error stopping pipeline bridge:', err.message);
            }
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
            // Stop PipelineModule before bridge so executors finish cleanly
            if (this._pipelineModule && typeof this._pipelineModule.stop === 'function') {
                try {
                    await this._pipelineModule.stop();
                } catch (err) {
                    this.logger.warn('Error stopping PipelineModule during shutdown:', err.message);
                }
            }

            // Stop pipeline bridge first so no more events fan out to closing sockets
            if (this.pipelineBridge) {
                try {
                    this.pipelineBridge.stop();
                } catch (err) {
                    this.logger.warn('Error stopping pipeline bridge:', err.message);
                }
            }

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