// core/message-router.js

/**
 * Handles intelligent message routing in a distributed WebSocket system
 * Routes messages only to nodes that have clients subscribed to specific channels
 */
class MessageRouter {
    constructor(nodeManager, redisPublisher, redisSubscriber, logger) {
        this.nodeManager = nodeManager;
        this.redisPublisher = redisPublisher;
        this.redisSubscriber = redisSubscriber;
        this.logger = logger;
        this.localClients = new Map(); // clientId -> WebSocket connection
        this.subscribedChannels = new Set();
        
        // Message types for node-to-node communication
        this.messageTypes = {
            DIRECT_MESSAGE: 'direct_message',
            BROADCAST: 'broadcast',
            CHANNEL_MESSAGE: 'channel_message',
            PRESENCE_UPDATE: 'presence_update',
            CURSOR_UPDATE: 'cursor_update'
        };

        this.setupNodeMessageHandlers();
    }

    /**
     * Register a local WebSocket connection
     */
    registerLocalClient(clientId, ws, metadata = {}) {
        this.localClients.set(clientId, {
            ws,
            metadata,
            channels: new Set(),
            joinedAt: new Date()
        });
        
        // Register with node manager
        this.nodeManager.registerClient(clientId, metadata);
        
        this.logger.debug(`Registered local client ${clientId}`);
    }

    /**
     * Unregister a local WebSocket connection
     */
    async unregisterLocalClient(clientId) {
        const client = this.localClients.get(clientId);
        if (client) {
            // Unsubscribe from all channels
            for (const channel of client.channels) {
                await this.unsubscribeFromChannel(clientId, channel);
            }
            
            this.localClients.delete(clientId);
            await this.nodeManager.unregisterClient(clientId);
            
            this.logger.debug(`Unregistered local client ${clientId}`);
        }
    }

    /**
     * Subscribe a client to a channel
     */
    async subscribeToChannel(clientId, channel) {
        const client = this.localClients.get(clientId);
        if (!client) {
            this.logger.warn(`Attempted to subscribe unknown client ${clientId} to ${channel}`);
            return false;
        }

        client.channels.add(channel);
        await this.nodeManager.subscribeClientToChannel(clientId, channel);
        
        // Subscribe to Redis channel if not already subscribed
        if (!this.subscribedChannels.has(channel)) {
            await this.subscribeToRedisChannel(channel);
        }

        this.logger.debug(`Client ${clientId} subscribed to channel ${channel}`);
        return true;
    }

    /**
     * Unsubscribe a client from a channel
     */
    async unsubscribeFromChannel(clientId, channel) {
        const client = this.localClients.get(clientId);
        if (client) {
            client.channels.delete(channel);
            await this.nodeManager.unsubscribeClientFromChannel(clientId, channel);

            // Check if we still need to listen to this channel
            const stillNeeded = Array.from(this.localClients.values())
                .some(c => c.channels.has(channel));
            
            if (!stillNeeded) {
                await this.unsubscribeFromRedisChannel(channel);
            }

            this.logger.debug(`Client ${clientId} unsubscribed from channel ${channel}`);
        }
    }

    /**
     * Send a message to a specific channel with intelligent routing
     */
    async sendToChannel(channel, message, excludeClientId = null) {
        if (!this.redisPublisher) {
            // Fallback to local broadcast
            return this.broadcastToLocalChannel(channel, message, excludeClientId);
        }

        try {
            // Get nodes that have clients subscribed to this channel
            const targetNodes = await this.nodeManager.getNodesForChannel(channel);
            
            if (targetNodes.length === 0) {
                this.logger.debug(`No nodes found for channel ${channel}`);
                return;
            }

            const routedMessage = {
                type: this.messageTypes.CHANNEL_MESSAGE,
                channel,
                message,
                excludeClientId,
                fromNode: this.nodeManager.nodeId,
                timestamp: new Date().toISOString(),
                targetNodes
            };

            // Publish to Redis with node targeting
            const redisChannel = `websocket:route:${channel}`;
            await this.redisPublisher.publish(redisChannel, JSON.stringify(routedMessage));
            
            this.logger.debug(`Message routed to ${targetNodes.length} nodes for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Failed to route message to channel ${channel}:`, error);
            // Fallback to local broadcast
            this.broadcastToLocalChannel(channel, message, excludeClientId);
        }
    }

    /**
     * Send a direct message to a specific client
     */
    async sendToClient(clientId, message) {
        // Check if client is connected locally
        if (this.localClients.has(clientId)) {
            return this.sendToLocalClient(clientId, message);
        }

        if (!this.redisPublisher) {
            this.logger.warn(`Client ${clientId} not found locally and Redis not available`);
            return false;
        }

        try {
            // Find which node the client is connected to
            const targetNode = await this.nodeManager.getClientNode(clientId);
            
            if (!targetNode) {
                this.logger.warn(`Client ${clientId} not found in any node`);
                return false;
            }

            const routedMessage = {
                type: this.messageTypes.DIRECT_MESSAGE,
                clientId,
                message,
                fromNode: this.nodeManager.nodeId,
                targetNode,
                timestamp: new Date().toISOString()
            };

            // Publish to the specific node's direct message channel
            const redisChannel = `websocket:direct:${targetNode}`;
            await this.redisPublisher.publish(redisChannel, JSON.stringify(routedMessage));
            
            this.logger.debug(`Direct message sent to client ${clientId} on node ${targetNode}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send message to client ${clientId}:`, error);
            return false;
        }
    }

    /**
     * Broadcast a message to all connected clients
     */
    async broadcastToAll(message, excludeClientId = null) {
        if (!this.redisPublisher) {
            return this.broadcastToLocalClients(message, excludeClientId);
        }

        try {
            const routedMessage = {
                type: this.messageTypes.BROADCAST,
                message,
                excludeClientId,
                fromNode: this.nodeManager.nodeId,
                timestamp: new Date().toISOString()
            };

            // Broadcast to all nodes
            await this.redisPublisher.publish('websocket:broadcast:all', JSON.stringify(routedMessage));
            
            this.logger.debug('Message broadcasted to all nodes');
        } catch (error) {
            this.logger.error('Failed to broadcast message:', error);
            this.broadcastToLocalClients(message, excludeClientId);
        }
    }

    /**
     * Setup Redis message handlers for node-to-node communication
     */
    async setupNodeMessageHandlers() {
        if (!this.redisSubscriber) return;

        try {
            // Subscribe to direct messages for this node
            const directChannel = `websocket:direct:${this.nodeManager.nodeId}`;
            await this.redisSubscriber.subscribe(directChannel, this.handleDirectMessage.bind(this));
            
            // Subscribe to broadcast messages
            await this.redisSubscriber.subscribe('websocket:broadcast:all', this.handleBroadcastMessage.bind(this));
            
            this.logger.info(`Node message handlers setup for node ${this.nodeManager.nodeId}`);
        } catch (error) {
            this.logger.error('Failed to setup node message handlers:', error);
        }
    }

    /**
     * Subscribe to a Redis channel for routing messages
     */
    async subscribeToRedisChannel(channel) {
        if (!this.redisSubscriber || this.subscribedChannels.has(channel)) return;

        try {
            const redisChannel = `websocket:route:${channel}`;
            await this.redisSubscriber.subscribe(redisChannel, this.handleChannelMessage.bind(this));
            this.subscribedChannels.add(channel);
            
            this.logger.debug(`Subscribed to Redis channel: ${redisChannel}`);
        } catch (error) {
            this.logger.error(`Failed to subscribe to Redis channel ${channel}:`, error);
        }
    }

    /**
     * Unsubscribe from a Redis channel
     */
    async unsubscribeFromRedisChannel(channel) {
        if (!this.redisSubscriber || !this.subscribedChannels.has(channel)) return;

        try {
            const redisChannel = `websocket:route:${channel}`;
            await this.redisSubscriber.unsubscribe(redisChannel);
            this.subscribedChannels.delete(channel);
            
            this.logger.debug(`Unsubscribed from Redis channel: ${redisChannel}`);
        } catch (error) {
            this.logger.error(`Failed to unsubscribe from Redis channel ${channel}:`, error);
        }
    }

    /**
     * Handle direct messages from other nodes
     */
    handleDirectMessage(message, channel) {
        try {
            const data = JSON.parse(message);
            
            if (data.type === this.messageTypes.DIRECT_MESSAGE) {
                this.sendToLocalClient(data.clientId, data.message);
            }
        } catch (error) {
            this.logger.error('Failed to handle direct message:', error);
        }
    }

    /**
     * Handle broadcast messages from other nodes
     */
    handleBroadcastMessage(message, channel) {
        try {
            const data = JSON.parse(message);
            
            if (data.type === this.messageTypes.BROADCAST && data.fromNode !== this.nodeManager.nodeId) {
                this.broadcastToLocalClients(data.message, data.excludeClientId);
            }
        } catch (error) {
            this.logger.error('Failed to handle broadcast message:', error);
        }
    }

    /**
     * Handle channel messages from other nodes
     */
    handleChannelMessage(message, redisChannel) {
        try {
            const data = JSON.parse(message);
            
            if (data.type === this.messageTypes.CHANNEL_MESSAGE) {
                // Only process if this node is in the target nodes list
                if (data.targetNodes.includes(this.nodeManager.nodeId)) {
                    this.broadcastToLocalChannel(data.channel, data.message, data.excludeClientId);
                }
            }
        } catch (error) {
            this.logger.error('Failed to handle channel message:', error);
        }
    }

    /**
     * Send message to a local client
     */
    sendToLocalClient(clientId, message) {
        const client = this.localClients.get(clientId);
        if (client && client.ws.readyState === 1) { // WebSocket.OPEN
            try {
                const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
                client.ws.send(messageStr);
                return true;
            } catch (error) {
                this.logger.error(`Failed to send to local client ${clientId}:`, error);
                // Remove dead connection
                this.unregisterLocalClient(clientId);
            }
        }
        return false;
    }

    /**
     * Broadcast to local clients on a specific channel
     */
    broadcastToLocalChannel(channel, message, excludeClientId = null) {
        let sentCount = 0;
        
        for (const [clientId, client] of this.localClients) {
            if (clientId === excludeClientId) continue;
            if (!client.channels.has(channel)) continue;
            
            if (this.sendToLocalClient(clientId, message)) {
                sentCount++;
            }
        }
        
        this.logger.debug(`Broadcasted to ${sentCount} local clients on channel ${channel}`);
        return sentCount;
    }

    /**
     * Broadcast to all local clients
     */
    broadcastToLocalClients(message, excludeClientId = null) {
        let sentCount = 0;
        
        for (const [clientId, client] of this.localClients) {
            if (clientId === excludeClientId) continue;
            
            if (this.sendToLocalClient(clientId, message)) {
                sentCount++;
            }
        }
        
        this.logger.debug(`Broadcasted to ${sentCount} local clients`);
        return sentCount;
    }

    /**
     * Get statistics about this node's routing
     */
    getStats() {
        return {
            nodeId: this.nodeManager.nodeId,
            localClients: this.localClients.size,
            subscribedChannels: this.subscribedChannels.size,
            channelDistribution: this.getChannelDistribution()
        };
    }

    /**
     * Get distribution of clients across channels
     */
    getChannelDistribution() {
        const distribution = {};
        
        for (const client of this.localClients.values()) {
            for (const channel of client.channels) {
                distribution[channel] = (distribution[channel] || 0) + 1;
            }
        }
        
        return distribution;
    }

    /**
     * Cleanup when shutting down
     */
    async cleanup() {
        this.logger.info('Cleaning up message router...');
        
        // Unregister all local clients
        const clientIds = Array.from(this.localClients.keys());
        for (const clientId of clientIds) {
            try {
                await this.unregisterLocalClient(clientId);
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn(`Error unregistering client ${clientId} during cleanup:`, error.message);
                }
            }
        }
        
        // Unsubscribe from all Redis channels
        for (const channel of this.subscribedChannels) {
            try {
                await this.unsubscribeFromRedisChannel(channel);
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn(`Error unsubscribing from channel ${channel} during cleanup:`, error.message);
                }
            }
        }
        
        this.localClients.clear();
        this.subscribedChannels.clear();
        
        this.logger.info('Message router cleanup completed');
    }
}

module.exports = MessageRouter;
