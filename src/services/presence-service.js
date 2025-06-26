// services/presence-service.js
/**
 * Unified Presence Service - Handles user presence tracking
 * Supports both local and distributed modes based on configuration
 */

class PresenceService {
    constructor(messageRouter, nodeManager, logger) {
        this.messageRouter = messageRouter;
        this.nodeManager = nodeManager;
        this.logger = logger;
        
        // Local state management
        this.clientPresence = new Map(); // clientId -> presence data
        this.channelPresence = new Map(); // channel -> Map of clientId -> presence
        this.presenceHeartbeatInterval = null;
        this.heartbeatInterval = 30000; // 30 seconds
        this.presenceTimeout = 60000; // 60 seconds before marking as offline
        
        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode
        
        this.startPresenceHeartbeat();
    }

    async handleAction(clientId, action, data) {
        try {
            switch (action) {
                case 'set':
                    return await this.handleSetPresence(clientId, data);
                case 'get':
                    return await this.handleGetPresence(clientId, data);
                case 'subscribe':
                    return await this.handleSubscribePresence(clientId, data);
                case 'unsubscribe':
                    return await this.handleUnsubscribePresence(clientId, data);
                case 'heartbeat':
                    return await this.handleHeartbeat(clientId, data);
                default:
                    this.sendError(clientId, `Unknown presence action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling presence action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        }
    }

    async handleSetPresence(clientId, { status, metadata = {}, channels = [] }) {
        if (!status) {
            this.sendError(clientId, 'Status is required');
            return;
        }

        // Validate status
        const validStatuses = ['online', 'away', 'busy', 'offline'];
        if (!validStatuses.includes(status)) {
            this.sendError(clientId, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
            return;
        }

        const presenceData = {
            clientId,
            status,
            metadata,
            channels,
            nodeId: this.nodeManager ? this.nodeManager.nodeId : 'local',
            timestamp: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };

        // Store presence locally
        this.clientPresence.set(clientId, presenceData);

        // Update channel presence
        await this.updateChannelPresence(clientId, presenceData, channels);

        // Broadcast presence update
        await this.broadcastPresenceUpdate(presenceData);

        // Send confirmation to client
        this.sendToClient(clientId, {
            type: 'presence',
            action: 'set',
            presence: presenceData,
            timestamp: new Date().toISOString()
        });

        this.logger.info(`Presence set for client ${clientId}: ${status}`);
    }

    async handleGetPresence(clientId, { targetClientId, channel }) {
        try {
            let presenceData;

            if (targetClientId) {
                // Get specific client's presence
                presenceData = this.clientPresence.get(targetClientId);
                if (!presenceData) {
                    this.sendError(clientId, 'Client not found');
                    return;
                }
            } else if (channel) {
                // Get all presence data for a channel
                presenceData = this.getChannelPresence(channel);
            } else {
                this.sendError(clientId, 'Either targetClientId or channel is required');
                return;
            }

            this.sendToClient(clientId, {
                type: 'presence',
                action: 'presence',
                data: presenceData,
                timestamp: new Date().toISOString()
            });

            this.logger.debug(`Sent presence data to client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error getting presence for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to get presence data');
        }
    }

    async handleSubscribePresence(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel is required');
            return;
        }

        if (this.isDistributed) {
            // Subscribe to presence updates for this channel
            await this.messageRouter.subscribeToChannel(clientId, `presence:${channel}`);
        }

        // Send current presence data for the channel
        const channelPresence = this.getChannelPresence(channel);
        this.sendToClient(clientId, {
            type: 'presence',
            action: 'subscribed',
            channel,
            presence: channelPresence,
            timestamp: new Date().toISOString()
        });

        this.logger.info(`Client ${clientId} subscribed to presence for channel: ${channel}`);
    }

    async handleUnsubscribePresence(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel is required');
            return;
        }

        if (this.isDistributed) {
            // Unsubscribe from presence updates for this channel
            await this.messageRouter.unsubscribeFromChannel(clientId, `presence:${channel}`);
        }

        this.sendToClient(clientId, {
            type: 'presence',
            action: 'unsubscribed',
            channel,
            timestamp: new Date().toISOString()
        });

        this.logger.info(`Client ${clientId} unsubscribed from presence for channel: ${channel}`);
    }

    async handleHeartbeat(clientId, data) {
        const presenceData = this.clientPresence.get(clientId);
        if (presenceData) {
            presenceData.lastSeen = new Date().toISOString();
            this.clientPresence.set(clientId, presenceData);
        }
    }

    async updateChannelPresence(clientId, presenceData, newChannels) {
        // Remove client from old channels
        for (const [channel, channelPresenceMap] of this.channelPresence) {
            if (channelPresenceMap.has(clientId) && !newChannels.includes(channel)) {
                channelPresenceMap.delete(clientId);
                if (channelPresenceMap.size === 0) {
                    this.channelPresence.delete(channel);
                }
            }
        }

        // Add client to new channels
        for (const channel of newChannels) {
            if (!this.channelPresence.has(channel)) {
                this.channelPresence.set(channel, new Map());
            }
            this.channelPresence.get(channel).set(clientId, presenceData);
        }
    }

    getChannelPresence(channel) {
        const channelPresenceMap = this.channelPresence.get(channel);
        if (!channelPresenceMap) {
            return [];
        }

        return Array.from(channelPresenceMap.values());
    }

    async broadcastPresenceUpdate(presenceData) {
        const { channels, clientId } = presenceData;
        
        const message = {
            type: 'presence',
            action: 'update',
            presence: presenceData,
            timestamp: new Date().toISOString()
        };

        // Broadcast to all channels the client is in
        for (const channel of channels) {
            if (this.isDistributed) {
                await this.messageRouter.sendToChannel(
                    `presence:${channel}`,
                    message,
                    clientId
                );
            } else {
                await this.broadcastToLocalClients(channel, message, clientId);
            }
        }
    }

    async broadcastToLocalClients(channel, message, excludeClientId) {
        // This method would need to be implemented if we support local-only mode
        // For now, we'll assume we're always in distributed mode with messageRouter
        this.logger.warn('Local-only mode not implemented for presence service');
    }

    startPresenceHeartbeat() {
        this.presenceHeartbeatInterval = setInterval(() => {
            this.cleanupStalePresence();
        }, this.heartbeatInterval);

        this.logger.debug('Presence heartbeat started');
    }

    cleanupStalePresence() {
        const now = Date.now();
        const staleClients = [];

        for (const [clientId, presenceData] of this.clientPresence) {
            const lastSeen = new Date(presenceData.lastSeen).getTime();
            if (now - lastSeen > this.presenceTimeout) {
                staleClients.push(clientId);
            }
        }

        // Mark stale clients as offline
        for (const clientId of staleClients) {
            this.setClientOffline(clientId);
        }

        if (staleClients.length > 0) {
            this.logger.debug(`Marked ${staleClients.length} clients as offline due to inactivity`);
        }
    }

    async setClientOffline(clientId) {
        const presenceData = this.clientPresence.get(clientId);
        if (presenceData && presenceData.status !== 'offline') {
            presenceData.status = 'offline';
            presenceData.timestamp = new Date().toISOString();
            
            // Update channel presence
            await this.updateChannelPresence(clientId, presenceData, presenceData.channels);
            
            // Broadcast offline status
            await this.broadcastPresenceUpdate(presenceData);
            
            this.logger.debug(`Client ${clientId} marked as offline due to inactivity`);
        }
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
            type: 'presence',
            action: 'error',
            error,
            timestamp: new Date().toISOString()
        });
    }

    // Client lifecycle methods
    async onClientConnect(clientId) {
        // Set initial presence as online
        await this.handleSetPresence(clientId, {
            status: 'online',
            metadata: { connected: true },
            channels: []
        });

        this.logger.debug(`Client ${clientId} connected to presence service`);
    }

    async onClientDisconnect(clientId) {
        // Set client as offline
        const presenceData = this.clientPresence.get(clientId);
        if (presenceData) {
            await this.setClientOffline(clientId);
            
            // Clean up after a delay to allow for reconnections
            setTimeout(() => {
                this.clientPresence.delete(clientId);
                
                // Remove from all channels
                for (const [channel, channelPresenceMap] of this.channelPresence) {
                    if (channelPresenceMap.has(clientId)) {
                        channelPresenceMap.delete(clientId);
                        if (channelPresenceMap.size === 0) {
                            this.channelPresence.delete(channel);
                        }
                    }
                }
            }, 5000); // 5 second delay
        }
        
        this.logger.debug(`Client ${clientId} disconnected from presence service`);
    }

    // Service lifecycle methods
    async shutdown() {
        // Stop heartbeat
        if (this.presenceHeartbeatInterval) {
            clearInterval(this.presenceHeartbeatInterval);
            this.presenceHeartbeatInterval = null;
        }

        // Clear all data
        this.clientPresence.clear();
        this.channelPresence.clear();
        
        this.logger.info('Presence service shut down');
    }

    // Utility methods for debugging/monitoring
    getStats() {
        const statusCounts = {};
        for (const presenceData of this.clientPresence.values()) {
            statusCounts[presenceData.status] = (statusCounts[presenceData.status] || 0) + 1;
        }

        return {
            connectedClients: this.clientPresence.size,
            activeChannels: this.channelPresence.size,
            statusBreakdown: statusCounts,
            isDistributed: this.isDistributed
        };
    }
}

module.exports = PresenceService;
