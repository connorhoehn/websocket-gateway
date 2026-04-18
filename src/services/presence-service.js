// services/presence-service.js
/**
 * Unified Presence Service - Handles user presence tracking
 * Supports both local and distributed modes based on configuration
 */

const { enforceChannelPermission } = require('./authz-interceptor');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const {
    MAX_METADATA_KEYS,
    MAX_METADATA_SIZE,
    PRESENCE_HEARTBEAT_INTERVAL_MS,
    PRESENCE_TIMEOUT_MS,
    PRESENCE_STALE_THRESHOLD_MS,
    PRESENCE_CLEANUP_INTERVAL_MS,
    PRESENCE_DISCONNECT_DELAY_MS,
} = require('../config/constants');

function validateMetadata(metadata, logger) {
    if (!metadata || typeof metadata !== 'object') return {};

    // Limit number of keys
    const keys = Object.keys(metadata);
    if (keys.length > MAX_METADATA_KEYS) {
        logger.warn(`Metadata exceeds key limit: ${keys.length}/${MAX_METADATA_KEYS}`);
        const truncated = {};
        for (let i = 0; i < MAX_METADATA_KEYS; i++) {
            truncated[keys[i]] = metadata[keys[i]];
        }
        metadata = truncated;
    }

    // Limit total serialized size
    const serialized = JSON.stringify(metadata);
    if (serialized.length > MAX_METADATA_SIZE) {
        logger.warn(`Metadata exceeds size limit: ${serialized.length}/${MAX_METADATA_SIZE}`);
        return { _truncated: true, displayName: metadata.displayName || 'unknown' };
    }

    return metadata;
}

class PresenceService {
    constructor(messageRouter, nodeManager, logger, metricsCollector = null) {
        this.messageRouter = messageRouter;
        this.nodeManager = nodeManager;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        // Local state management
        this.clientPresence = new Map(); // clientId -> presence data
        this.channelPresence = new Map(); // channel -> Map of clientId -> presence
        this.clientChannels = new Map(); // clientId -> Set of channels (reverse index)
        this.presenceHeartbeatInterval = null;
        this.isCleaningUp = false; // Mutex flag for cleanup/heartbeat race
        this.disconnectTimers = new Map(); // clientId -> timer ID for disconnect delays
        this.heartbeatInterval = PRESENCE_HEARTBEAT_INTERVAL_MS;
        this.presenceTimeout = PRESENCE_TIMEOUT_MS;

        // Memory leak fix: TTL cleanup for stale clients
        this.STALE_THRESHOLD = PRESENCE_STALE_THRESHOLD_MS;
        this.CLEANUP_INTERVAL = PRESENCE_CLEANUP_INTERVAL_MS;

        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode

        this.startPresenceHeartbeat();

        // Start cleanup interval for stale clients
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleClients();
        }, this.CLEANUP_INTERVAL);
    }

    async handleAction(clientId, action, data) {
        const startTime = Date.now();
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
        } finally {
            const duration = Date.now() - startTime;
            this.logger.info(`[presence] ${action}`, { clientId, channel: data.channel, duration });
            if (duration > 500) {
                this.logger.warn(`Slow message handler: presence/${action} took ${duration}ms`, { clientId });
            }
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

        // Validate metadata for size and key count
        metadata = validateMetadata(metadata, this.logger);

        const presenceData = {
            clientId,
            status,
            metadata,
            channels,
            nodeId: this.nodeManager ? this.nodeManager.nodeId : 'local',
            timestamp: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            lastHeartbeat: Date.now() // Track lastHeartbeat for cleanup
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

        try {
            // Check channel authorization via shared interceptor
            if (!enforceChannelPermission(this, clientId, channel)) {
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
        } catch (error) {
            this.logger.error(`Error subscribing to presence for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to subscribe to presence');
        }
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
            presenceData.lastHeartbeat = Date.now(); // Update lastHeartbeat timestamp
            this.clientPresence.set(clientId, presenceData);
        }
    }

    async updateChannelPresence(clientId, presenceData, newChannels) {
        const oldChannels = this.clientChannels.get(clientId) || new Set();
        const newChannelSet = new Set(newChannels);

        // Remove from channels no longer in list (O(old_channels))
        for (const channel of oldChannels) {
            if (!newChannelSet.has(channel)) {
                const channelMap = this.channelPresence.get(channel);
                if (channelMap) {
                    channelMap.delete(clientId);
                    if (channelMap.size === 0) this.channelPresence.delete(channel);
                }
            }
        }

        // Add to new channels
        for (const channel of newChannels) {
            if (!this.channelPresence.has(channel)) {
                this.channelPresence.set(channel, new Map());
            }
            this.channelPresence.get(channel).set(clientId, presenceData);
        }

        // Update reverse index
        this.clientChannels.set(clientId, newChannelSet);
    }

    removeClientFromAllChannels(clientId) {
        const channels = this.clientChannels.get(clientId);
        if (channels) {
            for (const channel of channels) {
                const channelMap = this.channelPresence.get(channel);
                if (channelMap) {
                    channelMap.delete(clientId);
                    if (channelMap.size === 0) this.channelPresence.delete(channel);
                }
            }
            this.clientChannels.delete(clientId);
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

        // Check if Redis is available
        const redisAvailable = this.messageRouter && this.messageRouter.redisAvailable !== false;

        // Broadcast to all channels the client is in
        for (const channel of channels) {
            if (this.isDistributed) {
                // MessageRouter will handle fallback to local-only broadcast if Redis is down
                await this.messageRouter.sendToChannel(
                    `presence:${channel}`,
                    message,
                    clientId
                );
            } else {
                await this.broadcastToLocalClients(channel, message, clientId);
            }
        }

        if (!redisAvailable && channels.length > 0) {
            this.logger.debug(`Redis unavailable, presence update local only`);
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

    cleanupStaleClients() {
        if (this.isCleaningUp) return; // Prevent concurrent cleanup
        this.isCleaningUp = true;

        try {
            const now = Date.now();
            // Snapshot keys to avoid iteration-during-mutation
            const entries = Array.from(this.clientPresence.entries());
            let cleaned = 0;

            for (const [clientId, entry] of entries) {
                // Re-check freshness (heartbeat may have updated during iteration)
                const currentEntry = this.clientPresence.get(clientId);
                if (!currentEntry || now - currentEntry.lastHeartbeat > this.STALE_THRESHOLD) {
                    this.clientPresence.delete(clientId);
                    cleaned++;
                    this.removeClientFromAllChannels(clientId);
                }
            }

            if (cleaned > 0) {
                this.logger.info(`Presence cleanup: removed ${cleaned} stale clients`);
            }
        } finally {
            this.isCleaningUp = false;
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

    sendError(clientId, message, errorCode = ErrorCodes.SERVICE_INTERNAL_ERROR) {
        const errorResponse = createErrorResponse(errorCode, message, {
            service: 'presence',
            clientId,
        });

        this.sendToClient(clientId, {
            type: 'error',
            service: 'presence',
            ...errorResponse,
        });

        // Record error metric
        if (this.metricsCollector) {
            this.metricsCollector.recordError(errorCode);
        }
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

    // Alias for server.js handleClientDisconnect which calls service.handleDisconnect()
    async handleDisconnect(clientId) {
        return this.onClientDisconnect(clientId);
    }

    async onClientDisconnect(clientId) {
        // Set client as offline and broadcast to remaining users
        const presenceData = this.clientPresence.get(clientId);
        if (presenceData) {
            await this.setClientOffline(clientId);

            // Broadcast offline status to all channel subscribers
            const channels = this.clientChannels.get(clientId);
            if (channels) {
                const offlineMsg = {
                    type: 'presence',
                    action: 'offline',
                    clientId,
                    timestamp: new Date().toISOString()
                };
                for (const channel of channels) {
                    if (this.messageRouter) {
                        await this.messageRouter.sendToChannel(
                            `presence:${channel}`,
                            offlineMsg,
                            clientId
                        );
                    }
                }
            }

            // Clean up after a delay to allow for reconnections
            const timerId = setTimeout(() => {
                this.clientPresence.delete(clientId);
                this.removeClientFromAllChannels(clientId);
                this.disconnectTimers.delete(clientId);
            }, PRESENCE_DISCONNECT_DELAY_MS);
            this.disconnectTimers.set(clientId, timerId);
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

        // Stop cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Clear all disconnect delay timers
        for (const timerId of this.disconnectTimers.values()) {
            clearTimeout(timerId);
        }
        this.disconnectTimers.clear();

        // Clear all data
        this.clientPresence.clear();
        this.channelPresence.clear();
        this.clientChannels.clear();

        this.logger.info('Presence service shutdown complete');
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
