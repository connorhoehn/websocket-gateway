// services/cursor-service.js
/**
 * Unified Cursor Service - Handles real-time cursor position sharing
 * Supports both local and distributed modes based on configuration
 */

class CursorService {
    constructor(messageRouter, logger) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        
        // Local state management
        this.clientCursors = new Map(); // clientId -> cursor data
        this.channelCursors = new Map(); // channel -> Map of clientId -> cursor data
        this.cursorUpdateThrottle = new Map(); // clientId -> last update timestamp
        this.throttleInterval = 250; // 1000ms (1 second) throttle for updates
        
        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode
    }

    async handleAction(clientId, action, data) {
        try {
            switch (action) {
                case 'update':
                    return await this.handleUpdateCursor(clientId, data);
                case 'subscribe':
                    return await this.handleSubscribeCursors(clientId, data);
                case 'unsubscribe':
                    return await this.handleUnsubscribeCursors(clientId, data);
                case 'get':
                    return await this.handleGetCursors(clientId, data);
                default:
                    this.sendError(clientId, `Unknown cursor action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling cursor action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        }
    }

    async handleUpdateCursor(clientId, { channel, position, metadata = {} }) {
        if (!channel || !position) {
            this.sendError(clientId, 'Channel and position are required');
            return;
        }

        // Validate position structure
        if (typeof position.x !== 'number' || typeof position.y !== 'number') {
            this.sendError(clientId, 'Position must have numeric x and y coordinates');
            return;
        }

        // Throttle cursor updates to prevent spam
        if (!this.shouldUpdateCursor(clientId)) {
            return; // Ignore this update due to throttling
        }

        const cursorData = {
            clientId,
            channel,
            position,
            metadata,
            timestamp: new Date().toISOString()
        };

        // Store cursor data locally
        this.clientCursors.set(clientId, cursorData);

        // Store in channel cursors
        if (!this.channelCursors.has(channel)) {
            this.channelCursors.set(channel, new Map());
        }
        this.channelCursors.get(channel).set(clientId, cursorData);

        // Broadcast cursor update to channel subscribers
        await this.broadcastCursorUpdate(channel, cursorData, clientId);

        this.logger.info(`Cursor updated for client ${clientId} in channel ${channel}`);
    }

    async handleSubscribeCursors(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel is required');
            return;
        }

        if (this.isDistributed) {
            // In distributed mode, subscribe to Redis channel
            await this.messageRouter.subscribeToChannel(clientId, `cursor:${channel}`);
        }

        // Send current cursors in the channel
        const channelCursors = this.getChannelCursors(channel);
        this.sendToClient(clientId, {
            type: 'cursor',
            action: 'subscribed',
            channel,
            cursors: channelCursors,
            timestamp: new Date().toISOString()
        });

        this.logger.info(`Client ${clientId} subscribed to cursors for channel: ${channel}`);
    }

    async handleUnsubscribeCursors(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel is required');
            return;
        }

        if (this.isDistributed) {
            // In distributed mode, unsubscribe from Redis channel
            await this.messageRouter.unsubscribeFromChannel(clientId, `cursor:${channel}`);
        }

        this.sendToClient(clientId, {
            type: 'cursor',
            action: 'unsubscribed',
            channel,
            timestamp: new Date().toISOString()
        });

        this.logger.info(`Client ${clientId} unsubscribed from cursors for channel: ${channel}`);
    }

    async handleGetCursors(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel is required');
            return;
        }

        const channelCursors = this.getChannelCursors(channel);
        this.sendToClient(clientId, {
            type: 'cursor',
            action: 'cursors',
            channel,
            cursors: channelCursors,
            timestamp: new Date().toISOString()
        });

        this.logger.debug(`Sent cursor list for channel ${channel} to client ${clientId}`);
    }

    shouldUpdateCursor(clientId) {
        const now = Date.now();
        const lastUpdate = this.cursorUpdateThrottle.get(clientId) || 0;
        
        if (now - lastUpdate < this.throttleInterval) {
            return false; // Too frequent, ignore this update
        }
        
        this.cursorUpdateThrottle.set(clientId, now);
        return true;
    }

    getChannelCursors(channel) {
        const channelCursorMap = this.channelCursors.get(channel);
        if (!channelCursorMap) {
            return [];
        }

        return Array.from(channelCursorMap.values());
    }

    async broadcastCursorUpdate(channel, cursorData, excludeClientId) {
        const message = {
            type: 'cursor',
            action: 'update',
            channel,
            cursor: cursorData,
            timestamp: new Date().toISOString()
        };

        if (this.isDistributed) {
            // In distributed mode, publish to Redis channel
            await this.messageRouter.sendToChannel(
                `cursor:${channel}`,
                message,
                excludeClientId
            );
        } else {
            // In local mode, broadcast directly to local clients
            await this.broadcastToLocalClients(channel, message, excludeClientId);
        }
    }

    async broadcastToLocalClients(channel, message, excludeClientId) {
        // This method would need to be implemented if we support local-only mode
        // For now, we'll assume we're always in distributed mode with messageRouter
        this.logger.warn('Local-only mode not implemented for cursor service');
    }

    sendToClient(clientId, message) {
        if (this.messageRouter) {
            this.messageRouter.sendToClient(clientId, message);
        } else {
            this.logger.warn(`Cannot send message to client ${clientId}: no message router`);
        }
    }

    sendError(clientId, error) {
        this.sendToClient(clientId, {
            type: 'cursor',
            action: 'error',
            error,
            timestamp: new Date().toISOString()
        });
    }

    // Client lifecycle methods
    async onClientConnect(clientId) {
        this.logger.debug(`Client ${clientId} connected to cursor service`);
    }

    async onClientDisconnect(clientId) {
        // Clean up client data
        const clientCursor = this.clientCursors.get(clientId);
        if (clientCursor) {
            const { channel } = clientCursor;
            
            // Remove from client cursors
            this.clientCursors.delete(clientId);
            
            // Remove from channel cursors
            const channelCursorMap = this.channelCursors.get(channel);
            if (channelCursorMap) {
                channelCursorMap.delete(clientId);
                
                // If channel is empty, remove it
                if (channelCursorMap.size === 0) {
                    this.channelCursors.delete(channel);
                }
                
                // Broadcast cursor removal to channel
                await this.broadcastCursorRemoval(channel, clientId);
            }
        }
        
        // Clean up throttle data
        this.cursorUpdateThrottle.delete(clientId);
        
        this.logger.debug(`Client ${clientId} disconnected from cursor service`);
    }

    async broadcastCursorRemoval(channel, clientId) {
        const message = {
            type: 'cursor',
            action: 'remove',
            channel,
            clientId,
            timestamp: new Date().toISOString()
        };

        if (this.isDistributed) {
            await this.messageRouter.sendToChannel(`cursor:${channel}`, message);
        } else {
            await this.broadcastToLocalClients(channel, message);
        }
    }

    // Service lifecycle methods
    async shutdown() {
        // Clear all data
        this.clientCursors.clear();
        this.channelCursors.clear();
        this.cursorUpdateThrottle.clear();
        
        this.logger.info('Cursor service shut down');
    }

    // Utility methods for debugging/monitoring
    getStats() {
        return {
            connectedClients: this.clientCursors.size,
            activeChannels: this.channelCursors.size,
            isDistributed: this.isDistributed
        };
    }
}

module.exports = CursorService;
