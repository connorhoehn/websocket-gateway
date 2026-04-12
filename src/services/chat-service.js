// services/chat-service.js
/**
 * Unified Chat Service - Handles chat messaging
 * Supports both local and distributed modes based on configuration
 */

const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const { LRUCache } = require('lru-cache');
const {
    MAX_METADATA_KEYS,
    MAX_METADATA_SIZE,
    CHAT_MAX_MESSAGES_PER_CHANNEL,
    CHAT_CACHE_CLEANUP_INTERVAL_MS,
    CHAT_DEFAULT_HISTORY_LIMIT,
    CHAT_JOIN_HISTORY_LIMIT,
    CHAT_MAX_MESSAGE_LENGTH,
    MAX_CHANNEL_NAME_LENGTH,
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

class ChatService {
    constructor(messageRouter, logger, metricsCollector = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        // Local state management
        this.clientChannels = new Map(); // clientId -> Set of channels
        this.channelCaches = new Map(); // channelId -> LRU cache
        this.MAX_MESSAGES_PER_CHANNEL = CHAT_MAX_MESSAGES_PER_CHANNEL;

        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode

        // Periodic cleanup for empty channel caches
        setInterval(() => {
            for (const [channelId, cache] of this.channelCaches.entries()) {
                if (cache.size === 0) {
                    this.channelCaches.delete(channelId);
                }
            }
        }, CHAT_CACHE_CLEANUP_INTERVAL_MS);
    }

    async handleAction(clientId, action, data) {
        const startTime = Date.now();
        try {
            switch (action) {
                case 'join':
                    return await this.handleJoinChannel(clientId, data);
                case 'leave':
                    return await this.handleLeaveChannel(clientId, data);
                case 'send':
                    return await this.handleSendMessage(clientId, data);
                case 'history':
                    return await this.handleGetHistory(clientId, data);
                default:
                    this.sendError(clientId, `Unknown chat action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling chat action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        } finally {
            const duration = Date.now() - startTime;
            this.logger.info(`[chat] ${action}`, { clientId, channel: data.channel, duration });
            if (duration > 500) {
                this.logger.warn(`Slow message handler: chat/${action} took ${duration}ms`, { clientId });
            }
        }
    }

    async handleJoinChannel(clientId, { channel, metadata = {} }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        // Validate channel name
        if (typeof channel !== 'string' || channel.length === 0 || channel.length > MAX_CHANNEL_NAME_LENGTH) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
            // Check channel authorization
            const clientData = this.messageRouter.getClientData(clientId);
            if (!clientData || !clientData.userContext) {
                this.sendError(clientId, 'User context not found');
                return;
            }

            try {
                checkChannelPermission(clientData.userContext, channel, this.logger, this.metricsCollector);
            } catch (error) {
                if (error instanceof AuthzError) {
                    this.sendError(clientId, error.message, error.code);
                    return;
                }
                throw error;
            }
            if (this.isDistributed) {
                // Subscribe to channel through message router (handles node distribution)
                await this.messageRouter.subscribeToChannel(clientId, channel);
            }
            
            // Track client's channels locally
            if (!this.clientChannels.has(clientId)) {
                this.clientChannels.set(clientId, new Set());
            }
            this.clientChannels.get(clientId).add(channel);

            // Send confirmation to client
            this.sendToClient(clientId, {
                type: 'chat',
                action: 'joined',
                channel,
                timestamp: new Date().toISOString()
            });

            // Send recent message history if available
            await this.sendChannelHistory(clientId, channel);

            this.logger.info(`Client ${clientId} joined chat channel: ${channel}`);
        } catch (error) {
            this.logger.error(`Error joining channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to join channel');
        }
    }

    async handleLeaveChannel(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        try {
            if (this.isDistributed) {
                // Unsubscribe from channel through message router
                await this.messageRouter.unsubscribeFromChannel(clientId, channel);
            }

            // Remove from client's channels
            const clientChannelSet = this.clientChannels.get(clientId);
            if (clientChannelSet) {
                clientChannelSet.delete(channel);
                if (clientChannelSet.size === 0) {
                    this.clientChannels.delete(clientId);
                }
            }

            // Send confirmation to client
            this.sendToClient(clientId, {
                type: 'chat',
                action: 'left',
                channel,
                timestamp: new Date().toISOString()
            });

            this.logger.info(`Client ${clientId} left chat channel: ${channel}`);
        } catch (error) {
            this.logger.error(`Error leaving channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to leave channel');
        }
    }

    async handleSendMessage(clientId, { channel, message, metadata = {} }) {
        if (!channel || !message) {
            this.sendError(clientId, 'Channel and message are required');
            return;
        }

        // Validate message
        if (typeof message !== 'string' || message.length === 0 || message.length > CHAT_MAX_MESSAGE_LENGTH) {
            this.sendError(clientId, 'Message must be a string between 1 and 1000 characters');
            return;
        }

        // Validate metadata for size and key count
        metadata = validateMetadata(metadata, this.logger);

        // Check if client is in the channel
        const clientChannelSet = this.clientChannels.get(clientId);
        if (!clientChannelSet || !clientChannelSet.has(channel)) {
            this.sendError(clientId, 'You must join the channel before sending messages');
            return;
        }

        try {
            const messageData = {
                id: this.generateMessageId(),
                clientId,
                channel,
                message,
                metadata,
                timestamp: new Date().toISOString()
            };

            // Store message in local history
            this.addToChannelHistory(channel, messageData);

            // Broadcast message to channel subscribers (including sender)
            await this.broadcastMessage(channel, messageData);

            // Send confirmation to sender
            this.sendToClient(clientId, {
                type: 'chat',
                action: 'sent',
                messageId: messageData.id,
                channel,
                timestamp: messageData.timestamp
            });

            this.logger.info(`Message sent by client ${clientId} to channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error sending message to channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to send message');
        }
    }

    async handleGetHistory(clientId, { channel, limit = CHAT_DEFAULT_HISTORY_LIMIT }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        try {
            const history = this.getChannelHistory(channel, limit);
            
            this.sendToClient(clientId, {
                type: 'chat',
                action: 'history',
                channel,
                messages: history,
                timestamp: new Date().toISOString()
            });

            this.logger.debug(`Sent message history for channel ${channel} to client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error getting history for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to get message history');
        }
    }

    getChannelCache(channelId) {
        if (!this.channelCaches.has(channelId)) {
            const cache = new LRUCache({
                max: this.MAX_MESSAGES_PER_CHANNEL,
                updateAgeOnGet: false,
                updateAgeOnHas: false
            });
            this.channelCaches.set(channelId, cache);
        }
        return this.channelCaches.get(channelId);
    }

    addToChannelHistory(channel, messageData) {
        const cache = this.getChannelCache(channel);
        cache.set(messageData.id, messageData);
    }

    getChannelHistory(channel, limit = CHAT_DEFAULT_HISTORY_LIMIT) {
        const cache = this.getChannelCache(channel);
        const allMessages = Array.from(cache.values());
        return allMessages.slice(-limit); // Return last 'limit' messages
    }

    async sendChannelHistory(clientId, channel) {
        const history = this.getChannelHistory(channel, CHAT_JOIN_HISTORY_LIMIT);
        if (history.length > 0) {
            this.sendToClient(clientId, {
                type: 'chat',
                action: 'history',
                channel,
                messages: history,
                timestamp: new Date().toISOString()
            });
        }
    }

    async broadcastMessage(channel, messageData) {
        const broadcastMessage = {
            type: 'chat',
            action: 'message',
            channel,
            message: messageData,
            timestamp: new Date().toISOString()
        };

        if (this.isDistributed) {
            // Check if Redis is available
            const redisAvailable = this.messageRouter.redisAvailable !== false;

            // In distributed mode, publish to Redis channel
            // MessageRouter will handle fallback to local-only broadcast if Redis is down
            await this.messageRouter.sendToChannel(
                channel,
                broadcastMessage
            );

            if (!redisAvailable) {
                this.logger.debug(`Redis unavailable, message delivered to local clients only`);
            }
        } else {
            // In local mode, broadcast directly to local clients
            await this.broadcastToLocalClients(channel, broadcastMessage);
        }
    }

    async broadcastToLocalClients(channel, message) {
        // This method would need to be implemented if we support local-only mode
        // For now, we'll assume we're always in distributed mode with messageRouter
        this.logger.warn('Local-only mode not implemented for chat service');
    }

    generateMessageId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
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
            service: 'chat',
            clientId,
        });

        this.sendToClient(clientId, {
            type: 'error',
            service: 'chat',
            ...errorResponse,
        });

        // Record error metric
        if (this.metricsCollector) {
            this.metricsCollector.recordError(errorCode);
        }
    }

    // Client lifecycle methods
    async onClientConnect(clientId) {
        this.logger.debug(`Client ${clientId} connected to chat service`);
    }

    async onClientDisconnect(clientId) {
        // Clean up client data
        const clientChannelSet = this.clientChannels.get(clientId);
        if (clientChannelSet) {
            // Leave all channels
            for (const channel of clientChannelSet) {
                if (this.isDistributed) {
                    try {
                        await this.messageRouter.unsubscribeFromChannel(clientId, channel);
                    } catch (error) {
                        this.logger.error(`Error unsubscribing client ${clientId} from channel ${channel}:`, error);
                    }
                }
            }
            
            this.clientChannels.delete(clientId);
        }
        
        this.logger.debug(`Client ${clientId} disconnected from chat service`);
    }

    // Service lifecycle methods
    async shutdown() {
        // Clear all data
        this.clientChannels.clear();
        this.channelCaches.clear();

        this.logger.info('Chat service shut down');
    }

    // Utility methods for debugging/monitoring
    getStats() {
        let totalMessages = 0;
        for (const cache of this.channelCaches.values()) {
            totalMessages += cache.size;
        }

        return {
            connectedClients: this.clientChannels.size,
            activeChannels: this.channelCaches.size,
            totalMessages: totalMessages,
            isDistributed: this.isDistributed
        };
    }
}

module.exports = ChatService;
