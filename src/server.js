// server.js - Distributed WebSocket Gateway with Node Sharding
const WebSocket = require("ws");
const redis = require("redis");
const http = require("http");
const crypto = require("crypto");

// Import our distributed architecture components
const NodeManager = require("./core/node-manager");
const MessageRouter = require("./core/message-router");
const Logger = require("./utils/logger");

// Service modules - Unified services supporting both local and distributed modes
const ChatService = require("./services/chat-service");
const PresenceService = require("./services/presence-service");
const CursorService = require("./services/cursor-service");
const ReactionService = require("./services/reaction-service");

// Configuration
const config = {
    redis: {
        host: process.env.REDIS_ENDPOINT || 'redis',
        port: process.env.REDIS_PORT || 6379,
        url: `redis://${process.env.REDIS_ENDPOINT || 'redis'}:${process.env.REDIS_PORT || 6379}`
    },
    server: {
        port: process.env.PORT || 8080,
        enabledServices: (process.env.ENABLED_SERVICES || 'chat,presence,cursor,reaction').split(',')
    }
};

class DistributedWebSocketServer {
    constructor() {
        this.logger = new Logger('WebSocketServer');
        this.nodeManager = null;
        this.messageRouter = null;
        this.services = new Map();
        
        // Redis clients
        this.redisPublisher = null;
        this.redisSubscriber = null;
        this.redisConnected = false;
        
        // HTTP server and WebSocket server
        this.httpServer = null;
        this.wss = null;
        
        // Connection tracking
        this.connections = new Map(); // clientId -> { ws, metadata }
        
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
        
        // Initialize message router
        this.messageRouter = new MessageRouter(
            this.nodeManager, 
            this.redisPublisher, 
            this.redisSubscriber, 
            this.logger
        );
        
        // Initialize services
        await this.initializeServices();
        
        // Setup WebSocket server
        this.setupWebSocketServer();
        
        // Add cleanup handler to node manager
        this.nodeManager.addShutdownHandler(() => this.cleanup());
        
        this.logger.info(`Server initialized with node ID: ${this.nodeManager.nodeId}`);
    }

    async initializeRedis(retries = 5) {
        this.logger.info(`Attempting to connect to Redis at: ${config.redis.url} (attempt ${6 - retries})`);
        
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
            const chatService = new ChatService(this.messageRouter, this.logger);
            this.services.set('chat', chatService);
            this.logger.info('✅ Chat service initialized');
        }
        
        if (config.server.enabledServices.includes('presence')) {
            const presenceService = new PresenceService(this.messageRouter, this.nodeManager, this.logger);
            this.services.set('presence', presenceService);
            this.logger.info('✅ Presence service initialized');
        }
        
        if (config.server.enabledServices.includes('cursor')) {
            const cursorService = new CursorService(this.messageRouter, this.logger);
            this.services.set('cursor', cursorService);
            this.logger.info('✅ Cursor service initialized');
        }
        
        if (config.server.enabledServices.includes('reaction')) {
            const reactionService = new ReactionService(this.messageRouter, this.logger);
            this.services.set('reaction', reactionService);
            this.logger.info('✅ Reaction service initialized');
        }
    }

    setupHttpServer() {
        this.httpServer = http.createServer((req, res) => {
            if (req.url === '/health' && req.method === 'GET') {
                this.handleHealthCheck(req, res);
            } else if (req.url === '/cluster' && req.method === 'GET') {
                this.handleClusterInfo(req, res);
            } else if (req.url === '/stats' && req.method === 'GET') {
                this.handleStats(req, res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });
    }

    setupWebSocketServer() {
        this.wss = new WebSocket.Server({ server: this.httpServer });

        this.wss.on("connection", (ws, req) => {
            const clientId = this.generateClientId();
            const clientIP = req.socket.remoteAddress;
            
            this.logger.info(`Client ${clientId} connected from ${clientIP}`);
            
            // Register client with message router
            const metadata = {
                ip: clientIP,
                userAgent: req.headers['user-agent'],
                connectedAt: new Date().toISOString()
            };
            
            this.messageRouter.registerLocalClient(clientId, ws, metadata);
            this.connections.set(clientId, { ws, metadata });

            // Setup message handler
            ws.on("message", async (message) => {
                await this.handleMessage(clientId, message);
            });

            // Setup close handler
            ws.on("close", () => {
                this.logger.info(`Client ${clientId} disconnected`);
                this.handleClientDisconnect(clientId);
            });

            // Setup error handler
            ws.on("error", (error) => {
                this.logger.error(`WebSocket error for client ${clientId}:`, error);
                this.handleClientDisconnect(clientId);
            });

            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connection',
                status: 'connected',
                clientId,
                nodeId: this.nodeManager.nodeId,
                enabledServices: config.server.enabledServices,
                timestamp: new Date().toISOString()
            });
        });
    }

    async handleMessage(clientId, rawMessage) {
        try {
            const message = JSON.parse(rawMessage);
            this.logger.debug(`Message from ${clientId}:`, message);

            const { service, action, ...data } = message;

            if (!service || !action) {
                this.sendToClient(clientId, {
                    type: 'error',
                    message: 'Invalid message format. Required: service, action',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Route to appropriate service
            const serviceInstance = this.services.get(service);
            if (!serviceInstance) {
                this.sendToClient(clientId, {
                    type: 'error',
                    message: `Service '${service}' not available`,
                    availableServices: Array.from(this.services.keys()),
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Call service method
            await serviceInstance.handleAction(clientId, action, data);

        } catch (error) {
            this.logger.error(`Error handling message from ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Invalid JSON message',
                timestamp: new Date().toISOString()
            });
        }
    }

    async handleClientDisconnect(clientId) {
        // Notify services about disconnect
        for (const [serviceName, service] of this.services) {
            if (service.handleDisconnect) {
                try {
                    await service.handleDisconnect(clientId);
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
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            nodeId: this.nodeManager?.nodeId,
            redis: this.redisConnected ? 'connected' : 'disconnected',
            websocket: 'running',
            uptime: process.uptime(),
            connections: this.connections.size,
            enabledServices: config.server.enabledServices,
            memoryUsage: process.memoryUsage()
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
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
                await this.nodeManager.cleanup();
            }
            
            this.logger.info('✅ Server shutdown complete');
        } catch (error) {
            this.logger.error('❌ Error during shutdown:', error);
            throw error;
        }
    }

    async start() {
        await this.initialize();
        
        const port = config.server.port;
        this.httpServer.listen(port, () => {
            this.logger.info(`🚀 Distributed WebSocket Server running on port ${port}`);
            this.logger.info(`📊 Health check: http://localhost:${port}/health`);
            this.logger.info(`🔍 Cluster info: http://localhost:${port}/cluster`);
            this.logger.info(`📈 Stats: http://localhost:${port}/stats`);
            this.logger.info(`🆔 Node ID: ${this.nodeManager.nodeId}`);
            this.logger.info(`🔧 Enabled services: ${config.server.enabledServices.join(', ')}`);
            this.logger.info(`💾 Redis: ${this.redisConnected ? 'Connected' : 'Standalone mode'}`);
        });
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