// core/node-manager.js
const crypto = require('crypto');
const os = require('os');

/**
 * Manages node registration, client mapping, and message routing in a distributed WebSocket system
 */
class NodeManager {
    constructor(redisClient, logger) {
        this.redis = redisClient;
        this.logger = logger;
        this.nodeId = this.generateNodeId();
        this.nodeInfo = this.getNodeInfo();
        this.heartbeatInterval = null;
        this.shutdownHandlers = [];
        
        // Redis key patterns
        this.keys = {
            nodes: 'websocket:nodes',
            nodeInfo: (nodeId) => `websocket:node:${nodeId}:info`,
            nodeClients: (nodeId) => `websocket:node:${nodeId}:clients`,
            clientNode: (clientId) => `websocket:client:${clientId}:node`,
            channelNodes: (channel) => `websocket:channel:${channel}:nodes`,
            nodeChannels: (nodeId) => `websocket:node:${nodeId}:channels`,
            nodeHeartbeat: (nodeId) => `websocket:node:${nodeId}:heartbeat`
        };
    }

    generateNodeId() {
        const hostname = os.hostname();
        const pid = process.pid;
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${hostname}-${pid}-${timestamp}-${random}`;
    }

    getNodeInfo() {
        return {
            nodeId: this.nodeId,
            hostname: os.hostname(),
            pid: process.pid,
            startTime: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            port: process.env.PORT || 8080,
            // Network interfaces for direct node-to-node communication if needed
            networks: this.getNetworkInterfaces()
        };
    }

    getNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const addresses = [];
        
        Object.keys(interfaces).forEach(name => {
            interfaces[name].forEach(iface => {
                if (!iface.internal && iface.family === 'IPv4') {
                    addresses.push({
                        interface: name,
                        address: iface.address,
                        netmask: iface.netmask
                    });
                }
            });
        });
        
        return addresses;
    }

    /**
     * Register this node in the cluster
     */
    async registerNode() {
        if (!this.redis) {
            this.logger.warn('Redis not available, running in standalone mode');
            return false;
        }

        try {
            // Add node to the active nodes set
            await this.redis.sAdd(this.keys.nodes, this.nodeId);
            
            // Store detailed node information - serialize complex objects to JSON strings
            const serializedNodeInfo = {};
            for (const [key, value] of Object.entries(this.nodeInfo)) {
                if (typeof value === 'object' && value !== null) {
                    serializedNodeInfo[key] = JSON.stringify(value);
                } else {
                    serializedNodeInfo[key] = String(value);
                }
            }
            await this.redis.hSet(this.keys.nodeInfo(this.nodeId), serializedNodeInfo);
            
            // Set initial heartbeat
            await this.updateHeartbeat();
            
            // Start heartbeat interval
            this.startHeartbeat();
            
            this.logger.info(`Node ${this.nodeId} registered successfully`);
            return true;
        } catch (error) {
            this.logger.error('Failed to register node:', error);
            return false;
        }
    }

    /**
     * Start sending periodic heartbeat signals
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.updateHeartbeat();
            } catch (error) {
                this.logger.error('Heartbeat failed:', error);
            }
        }, 30000); // 30 second heartbeat
    }

    async updateHeartbeat() {
        if (!this.redis) return;

        const heartbeatData = {
            timestamp: new Date().toISOString(),
            uptime: String(process.uptime()),
            memoryUsage: JSON.stringify(process.memoryUsage()),
            connectionCount: String(await this.getConnectionCount())
        };

        await this.redis.hSet(this.keys.nodeHeartbeat(this.nodeId), heartbeatData);
        await this.redis.expire(this.keys.nodeHeartbeat(this.nodeId), 90); // Expire in 90 seconds
    }

    /**
     * Register a client connection to this node
     */
    async registerClient(clientId, metadata = {}) {
        if (!this.redis) return;

        try {
            // Map client to this node
            await this.redis.set(this.keys.clientNode(clientId), this.nodeId);
            
            // Add client to this node's client set
            await this.redis.sAdd(this.keys.nodeClients(this.nodeId), clientId);
            
            // Store client metadata if provided
            if (Object.keys(metadata).length > 0) {
                // Serialize metadata values to ensure they're strings
                const serializedMetadata = {};
                for (const [key, value] of Object.entries(metadata)) {
                    if (typeof value === 'object' && value !== null) {
                        serializedMetadata[key] = JSON.stringify(value);
                    } else {
                        serializedMetadata[key] = String(value);
                    }
                }
                await this.redis.hSet(`websocket:client:${clientId}:metadata`, serializedMetadata);
            }

            this.logger.debug(`Client ${clientId} registered to node ${this.nodeId}`);
        } catch (error) {
            this.logger.error(`Failed to register client ${clientId}:`, error);
        }
    }

    /**
     * Unregister a client connection from this node
     */
    async unregisterClient(clientId) {
        if (!this.redis) return;

        try {
            // Remove client-to-node mapping
            await this.redis.del(this.keys.clientNode(clientId));
            
            // Remove client from this node's client set
            await this.redis.sRem(this.keys.nodeClients(this.nodeId), clientId);
            
            // Clean up client metadata
            await this.redis.del(`websocket:client:${clientId}:metadata`);

            this.logger.debug(`Client ${clientId} unregistered from node ${this.nodeId}`);
        } catch (error) {
            this.logger.error(`Failed to unregister client ${clientId}:`, error);
        }
    }

    /**
     * Subscribe a client to a channel and track which nodes serve this channel
     */
    async subscribeClientToChannel(clientId, channel) {
        if (!this.redis) return;

        try {
            // Add this node to the channel's node set
            await this.redis.sAdd(this.keys.channelNodes(channel), this.nodeId);
            
            // Add channel to this node's channel set
            await this.redis.sAdd(this.keys.nodeChannels(this.nodeId), channel);
            
            // Store client's channel subscription
            await this.redis.sAdd(`websocket:client:${clientId}:channels`, channel);

            this.logger.debug(`Client ${clientId} subscribed to channel ${channel} on node ${this.nodeId}`);
        } catch (error) {
            this.logger.error(`Failed to subscribe client ${clientId} to channel ${channel}:`, error);
        }
    }

    /**
     * Unsubscribe a client from a channel
     */
    async unsubscribeClientFromChannel(clientId, channel) {
        if (!this.redis) return;

        try {
            // Remove client's channel subscription
            await this.redis.sRem(`websocket:client:${clientId}:channels`, channel);
            
            // Check if this node still has any clients for this channel
            const nodeClients = await this.redis.sMembers(this.keys.nodeClients(this.nodeId));
            let hasChannelClients = false;
            
            for (const client of nodeClients) {
                const clientChannels = await this.redis.sMembers(`websocket:client:${client}:channels`);
                if (clientChannels.includes(channel)) {
                    hasChannelClients = true;
                    break;
                }
            }
            
            // If no clients on this node are subscribed to the channel, remove node from channel
            if (!hasChannelClients) {
                await this.redis.sRem(this.keys.channelNodes(channel), this.nodeId);
                await this.redis.sRem(this.keys.nodeChannels(this.nodeId), channel);
            }

            this.logger.debug(`Client ${clientId} unsubscribed from channel ${channel}`);
        } catch (error) {
            this.logger.error(`Failed to unsubscribe client ${clientId} from channel ${channel}:`, error);
        }
    }

    /**
     * Get all nodes that have clients subscribed to a specific channel
     */
    async getNodesForChannel(channel) {
        if (!this.redis) return [this.nodeId];

        try {
            const nodes = await this.redis.sMembers(this.keys.channelNodes(channel));
            return nodes.length > 0 ? nodes : [this.nodeId];
        } catch (error) {
            this.logger.error(`Failed to get nodes for channel ${channel}:`, error);
            return [this.nodeId];
        }
    }

    /**
     * Get all clients connected to this node
     */
    async getNodeClients() {
        if (!this.redis) return [];

        try {
            return await this.redis.sMembers(this.keys.nodeClients(this.nodeId));
        } catch (error) {
            this.logger.error('Failed to get node clients:', error);
            return [];
        }
    }

    /**
     * Get the node that serves a specific client
     */
    async getClientNode(clientId) {
        if (!this.redis) return this.nodeId;

        try {
            const nodeId = await this.redis.get(this.keys.clientNode(clientId));
            return nodeId || null;
        } catch (error) {
            this.logger.error(`Failed to get node for client ${clientId}:`, error);
            return null;
        }
    }

    /**
     * Get connection count for this node
     */
    async getConnectionCount() {
        if (!this.redis) return 0;

        try {
            return await this.redis.sCard(this.keys.nodeClients(this.nodeId));
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get information about all active nodes
     */
    async getClusterInfo() {
        if (!this.redis) {
            return {
                nodes: [{ ...this.nodeInfo, connectionCount: 0 }],
                totalNodes: 1,
                totalConnections: 0
            };
        }

        try {
            const nodeIds = await this.redis.sMembers(this.keys.nodes);
            const nodes = [];
            let totalConnections = 0;

            for (const nodeId of nodeIds) {
                const nodeInfo = await this.redis.hGetAll(this.keys.nodeInfo(nodeId));
                const heartbeat = await this.redis.hGetAll(this.keys.nodeHeartbeat(nodeId));
                const connectionCount = parseInt(heartbeat.connectionCount || '0', 10);
                
                totalConnections += connectionCount;
                
                // Deserialize JSON fields from nodeInfo
                const deserializedNodeInfo = { ...nodeInfo };
                if (nodeInfo.networks && typeof nodeInfo.networks === 'string') {
                    try {
                        deserializedNodeInfo.networks = JSON.parse(nodeInfo.networks);
                    } catch (e) {
                        this.logger.warn(`Failed to parse networks for node ${nodeId}:`, e);
                        deserializedNodeInfo.networks = [];
                    }
                }
                
                nodes.push({
                    ...deserializedNodeInfo,
                    connectionCount,
                    lastHeartbeat: heartbeat.timestamp,
                    uptime: parseFloat(heartbeat.uptime || '0'),
                    memoryUsage: heartbeat.memoryUsage ? JSON.parse(heartbeat.memoryUsage) : null
                });
            }

            return {
                nodes,
                totalNodes: nodes.length,
                totalConnections
            };
        } catch (error) {
            this.logger.error('Failed to get cluster info:', error);
            return {
                nodes: [],
                totalNodes: 0,
                totalConnections: 0
            };
        }
    }

    /**
     * Gracefully shutdown this node
     */
    async shutdown() {
        this.logger.info(`Shutting down node ${this.nodeId}...`);

        // Stop heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.redis) {
            try {
                // Get all clients connected to this node
                const clients = await this.redis.sMembers(this.keys.nodeClients(this.nodeId));
                
                // Clean up all client mappings
                for (const clientId of clients) {
                    await this.unregisterClient(clientId);
                }

                // Get all channels this node was serving
                const channels = await this.redis.sMembers(this.keys.nodeChannels(this.nodeId));
                
                // Remove this node from all channel mappings
                for (const channel of channels) {
                    await this.redis.sRem(this.keys.channelNodes(channel), this.nodeId);
                }

                // Clean up node data
                await this.redis.del(this.keys.nodeInfo(this.nodeId));
                await this.redis.del(this.keys.nodeClients(this.nodeId));
                await this.redis.del(this.keys.nodeChannels(this.nodeId));
                await this.redis.del(this.keys.nodeHeartbeat(this.nodeId));
                
                // Remove node from active nodes set
                await this.redis.sRem(this.keys.nodes, this.nodeId);

                this.logger.info(`Node ${this.nodeId} cleanup completed`);
            } catch (error) {
                // Only log as warning if it's a client closed error during shutdown
                if (error.name === 'ClientClosedError') {
                    this.logger.warn('Redis client already closed during shutdown');
                } else {
                    this.logger.error('Error during node shutdown:', error);
                }
            }
        }

        // Execute any additional shutdown handlers
        for (const handler of this.shutdownHandlers) {
            try {
                await handler();
            } catch (error) {
                this.logger.error('Error in shutdown handler:', error);
            }
        }
    }

    /**
     * Add a custom shutdown handler
     */
    addShutdownHandler(handler) {
        this.shutdownHandlers.push(handler);
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
            await this.shutdown();
            process.exit(0);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            this.logger.error('Uncaught exception:', error);
            await this.shutdown();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
            await this.shutdown();
            process.exit(1);
        });
    }
}

module.exports = NodeManager;
