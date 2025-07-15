// services/cursor-service.js
/**
 * Unified Cursor Service - Handles real-time cursor position sharing
 * Supports both local and distributed modes based on configuration
 * Enhanced with multi-mode support for different cursor tracking types
 */

class CursorService {
    constructor(messageRouter, logger, redisClient = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.redisClient = redisClient;
        
        // Local state management (fallback when Redis is not available)
        this.clientCursors = new Map(); // clientId -> cursor data
        this.channelCursors = new Map(); // channel -> Map of clientId -> cursor data
        this.cursorUpdateThrottle = new Map(); // clientId -> last update timestamp
        this.throttleInterval = 250; // 250ms throttle for updates
        
        // TTL mechanism for cursor cleanup
        this.cursorTTL = 30000; // 30 seconds TTL for cursor data
        this.cleanupInterval = 10000; // Run cleanup every 10 seconds
        this.startCleanupTimer();
        
        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode
        this.useRedis = !!redisClient; // Use Redis if available
        
        // Redis keys
        this.redisKeys = {
            clientCursor: (clientId) => `cursor:client:${clientId}`,
            channelCursors: (channel) => `cursor:channel:${channel}`,
            cursorList: (channel) => `cursor:list:${channel}`
        };
        
        // Supported cursor modes
        this.supportedModes = {
            'freeform': {
                name: 'Freeform Cursor',
                description: 'Traditional mouse cursor tracking (Miro, Figma)',
                requiredFields: ['x', 'y'],
                optionalFields: ['viewport', 'zoom']
            },
            'table': {
                name: 'Table Cell Cursor',
                description: 'Cell-based cursor tracking (Excel, Sheets)',
                requiredFields: ['row', 'col'],
                optionalFields: ['sheet', 'range']
            },
            'text': {
                name: 'Text Position Cursor',
                description: 'Text position tracking (Google Docs, Word)',
                requiredFields: ['position'],
                optionalFields: ['paragraph', 'line', 'selection']
            },
            'canvas': {
                name: 'Canvas Cursor',
                description: 'Canvas-based cursor tracking with tools',
                requiredFields: ['x', 'y'],
                optionalFields: ['tool', 'brush', 'layer']
            }
        };
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
                case 'modes':
                    return await this.handleGetModes(clientId, data);
                default:
                    this.sendError(clientId, `Unknown cursor action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling cursor action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        }
    }

    async handleUpdateCursor(clientId, { channel, position, metadata = {}, mode = 'freeform' }) {
        if (!channel || !position) {
            this.sendError(clientId, 'Channel and position are required');
            return;
        }

        // Validate mode
        if (!this.supportedModes[mode]) {
            this.sendError(clientId, `Unsupported cursor mode: ${mode}. Supported modes: ${Object.keys(this.supportedModes).join(', ')}`);
            return;
        }

        // Validate position structure based on mode
        if (!this.validatePositionForMode(position, mode)) {
            const modeConfig = this.supportedModes[mode];
            this.sendError(clientId, `Invalid position for mode ${mode}. Required fields: ${modeConfig.requiredFields.join(', ')}`);
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
            metadata: {
                ...metadata,
                mode,
                userInitials: metadata.userInitials || this.generateInitials(clientId),
                userColor: metadata.userColor || this.generateUserColor(clientId)
            },
            timestamp: new Date().toISOString()
        };

        // Store cursor data in Redis or local memory
        await this.storeCursorData(clientId, channel, cursorData);

        // Broadcast cursor update to channel subscribers
        await this.broadcastCursorUpdate(channel, cursorData, clientId);

        this.logger.info(`Cursor updated for client ${clientId} in channel ${channel} (mode: ${mode})`);
    }

    async storeCursorData(clientId, channel, cursorData) {
        if (this.useRedis) {
            try {
                // Store client cursor data with TTL
                await this.redisClient.setEx(
                    this.redisKeys.clientCursor(clientId),
                    Math.ceil(this.cursorTTL / 1000), // Convert to seconds
                    JSON.stringify(cursorData)
                );

                // Add to channel cursor list with TTL
                await this.redisClient.hSet(
                    this.redisKeys.channelCursors(channel),
                    clientId,
                    JSON.stringify(cursorData)
                );
                
                // Set TTL for channel cursor list
                await this.redisClient.expire(
                    this.redisKeys.channelCursors(channel),
                    Math.ceil(this.cursorTTL / 1000)
                );

                this.logger.debug(`Stored cursor data in Redis for client ${clientId} in channel ${channel}`);
            } catch (error) {
                this.logger.error(`Failed to store cursor data in Redis for client ${clientId}:`, error);
                // Fallback to local storage
                this.storeLocalCursorData(clientId, channel, cursorData);
            }
        } else {
            // Fallback to local storage
            this.storeLocalCursorData(clientId, channel, cursorData);
        }
    }

    storeLocalCursorData(clientId, channel, cursorData) {
        // Store cursor data locally (fallback)
        this.clientCursors.set(clientId, cursorData);

        // Store in channel cursors
        if (!this.channelCursors.has(channel)) {
            this.channelCursors.set(channel, new Map());
        }
        this.channelCursors.get(channel).set(clientId, cursorData);
    }

    validatePositionForMode(position, mode) {
        const modeConfig = this.supportedModes[mode];
        if (!modeConfig) return false;

        // Check if all required fields are present
        for (const field of modeConfig.requiredFields) {
            if (position[field] === undefined || position[field] === null) {
                return false;
            }
        }

        // Validate field types based on mode
        switch (mode) {
            case 'freeform':
            case 'canvas':
                return typeof position.x === 'number' && typeof position.y === 'number';
            case 'table':
                return typeof position.row === 'number' && typeof position.col === 'number' && 
                       position.row >= 0 && position.col >= 0;
            case 'text':
                return typeof position.position === 'number' && position.position >= 0;
            default:
                return false;
        }
    }

    generateInitials(clientId) {
        // Generate initials from clientId (first 2 chars, uppercase)
        return clientId.substring(0, 2).toUpperCase();
    }

    generateUserColor(clientId) {
        // Generate consistent color based on clientId
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
            '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
            '#1DD1A1', '#F368E0', '#3742FA', '#2F3542', '#FF3838'
        ];
        let hash = 0;
        for (let i = 0; i < clientId.length; i++) {
            hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    async handleGetModes(clientId, data) {
        this.sendToClient(clientId, {
            type: 'cursor',
            action: 'modes',
            modes: this.supportedModes,
            timestamp: new Date().toISOString()
        });

        this.logger.debug(`Sent cursor modes to client ${clientId}`);
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
        const channelCursors = await this.getChannelCursors(channel);
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

        const channelCursors = await this.getChannelCursors(channel);
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

    async getChannelCursors(channel) {
        if (this.useRedis) {
            try {
                const cursorsData = await this.redisClient.hGetAll(this.redisKeys.channelCursors(channel));
                const cursors = [];
                
                for (const [clientId, cursorDataStr] of Object.entries(cursorsData)) {
                    try {
                        const cursorData = JSON.parse(cursorDataStr);
                        cursors.push(cursorData);
                    } catch (error) {
                        this.logger.warn(`Failed to parse cursor data for client ${clientId}:`, error);
                    }
                }
                
                return cursors;
            } catch (error) {
                this.logger.error(`Failed to get channel cursors from Redis for channel ${channel}:`, error);
                // Fallback to local storage
                return this.getLocalChannelCursors(channel);
            }
        } else {
            return this.getLocalChannelCursors(channel);
        }
    }

    getLocalChannelCursors(channel) {
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
        // Clean up client data from Redis or local storage
        await this.removeCursorData(clientId);
        
        // Clean up throttle data
        this.cursorUpdateThrottle.delete(clientId);
        
        this.logger.debug(`Client ${clientId} disconnected from cursor service`);
    }

    async removeCursorData(clientId) {
        if (this.useRedis) {
            try {
                // Get client cursor data first to know which channel to clean
                const cursorDataStr = await this.redisClient.get(this.redisKeys.clientCursor(clientId));
                if (cursorDataStr) {
                    const cursorData = JSON.parse(cursorDataStr);
                    const { channel } = cursorData;
                    
                    // Remove client cursor data
                    await this.redisClient.del(this.redisKeys.clientCursor(clientId));
                    
                    // Remove from channel cursor list
                    await this.redisClient.hDel(this.redisKeys.channelCursors(channel), clientId);
                    
                    // Check if channel is empty and clean up if necessary
                    const channelSize = await this.redisClient.hLen(this.redisKeys.channelCursors(channel));
                    if (channelSize === 0) {
                        await this.redisClient.del(this.redisKeys.channelCursors(channel));
                    }
                    
                    // Broadcast cursor removal to channel
                    await this.broadcastCursorRemoval(channel, clientId);
                    
                    this.logger.debug(`Removed cursor data from Redis for client ${clientId} in channel ${channel}`);
                }
            } catch (error) {
                this.logger.error(`Failed to remove cursor data from Redis for client ${clientId}:`, error);
                // Fallback to local cleanup
                this.removeLocalCursorData(clientId);
            }
        } else {
            this.removeLocalCursorData(clientId);
        }
    }

    async removeLocalCursorData(clientId) {
        // Clean up client data locally
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
        // Clear cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        // Clear all data
        this.clientCursors.clear();
        this.channelCursors.clear();
        this.cursorUpdateThrottle.clear();
        
        this.logger.info('Cursor service shut down');
    }

    // TTL cleanup mechanism
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupStaleData();
        }, this.cleanupInterval);
    }

    cleanupStaleData() {
        const now = Date.now();
        const staleCursors = [];

        // Find stale cursors
        for (const [clientId, cursorData] of this.clientCursors) {
            const cursorAge = now - new Date(cursorData.timestamp).getTime();
            if (cursorAge > this.cursorTTL) {
                staleCursors.push(clientId);
            }
        }

        // Remove stale cursors
        for (const clientId of staleCursors) {
            this.logger.debug(`Removing stale cursor data for client ${clientId}`);
            this.removeStaleClientCursor(clientId);
        }

        if (staleCursors.length > 0) {
            this.logger.info(`Cleaned up ${staleCursors.length} stale cursor(s)`);
        }
    }

    async removeStaleClientCursor(clientId) {
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
