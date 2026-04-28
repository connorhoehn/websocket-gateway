// services/chat-service.js
/**
 * Unified Chat Service - Handles chat messaging
 * Supports both local and distributed modes based on configuration
 */

const { PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { enforceChannelPermission } = require('./authz-interceptor');
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
    constructor(messageRouter, logger, metricsCollector = null, dynamoClient = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.dynamoClient = dynamoClient;
        this.chatTableName = process.env.DYNAMODB_CHAT_TABLE || 'chat-messages';
        this.TTL_90_DAYS_SEC = 90 * 24 * 60 * 60;

        // Local state management
        this.clientChannels = new Map(); // clientId -> Set of channels
        this.channelCaches = new Map(); // channelId -> LRU cache
        this.MAX_MESSAGES_PER_CHANNEL = CHAT_MAX_MESSAGES_PER_CHANNEL;

        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode

        // Periodic cleanup for empty channel caches
        this._cleanupInterval = setInterval(() => {
            for (const [channelId, cache] of this.channelCaches.entries()) {
                if (cache.size === 0) {
                    this.channelCaches.delete(channelId);
                }
            }
        }, CHAT_CACHE_CLEANUP_INTERVAL_MS);
        if (this._cleanupInterval.unref) this._cleanupInterval.unref();

        // Wave 4c: track whether ownership cleanup handlers have been
        // registered so registration is idempotent across calls.
        this._ownershipHandlersRegistered = false;
        this._registerOwnershipHandlers();
    }

    /**
     * Drop the in-flight (in-memory) chat buffer for a given room/channel.
     * IMPORTANT: this only evicts the local LRU cache for the channel —
     * persisted messages in DynamoDB are untouched. The next handleGetHistory
     * for this channel will fall back to DynamoDB and rehydrate the cache.
     *
     * @param {string} roomId - channel id (rooms map 1:1 to channels here)
     * @returns {Promise<void>}
     * @private
     */
    async _cleanupRoom(roomId) {
        if (!roomId) return;
        const hadCache = this.channelCaches.delete(roomId);
        this.logger.info(
            `chat-service flushed in-memory buffer for roomId ${roomId}` +
                (hadCache ? '' : ' (no buffer present)')
        );
    }

    /**
     * Register cleanup handlers with the ownership-cleanup-coordinator.
     * Idempotent. When the ownership feature flag is off, the coordinator's
     * start() is a no-op so the handler is never invoked and behavior is
     * byte-identical to today.
     *
     * The coordinator pre-registers a stub handler for 'chat' at construction
     * time; registerCleanupHandler() uses Map.set() so re-registering cleanly
     * overrides the stub. We still wrap in try/catch defensively in case a
     * future coordinator revision rejects duplicate handlers — a registration
     * failure must NOT crash the chat service.
     *
     * @private
     */
    _registerOwnershipHandlers() {
        if (this._ownershipHandlersRegistered) return;

        try {
            // eslint-disable-next-line global-require
            const { getOwnershipCleanupCoordinator } = require('./ownership-cleanup-coordinator');
            const coordinator = getOwnershipCleanupCoordinator();
            coordinator.registerCleanupHandler('chat', {
                onLost: async (roomId) => this._cleanupRoom(roomId),
                onGained: async (roomId) => {
                    // Chat does not hydrate on ownership gain — the LRU
                    // cache lazily backfills from DynamoDB on the next
                    // handleGetHistory call. Just log for observability.
                    this.logger.debug(
                        `chat-service ownership gained for roomId ${roomId} (no-op; cache lazily rehydrates from DynamoDB)`
                    );
                },
            });
            this._ownershipHandlersRegistered = true;
            this.logger.debug('chat-service: registered ownership cleanup handlers');
        } catch (err) {
            this.logger.warn('chat-service: failed to register ownership cleanup handlers', {
                error: err && err.message,
            });
        }
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
            // Check channel authorization via shared interceptor
            if (!enforceChannelPermission(this, clientId, channel)) {
                return;
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

            // Fire-and-forget persist to DynamoDB
            this._persistMessage(messageData).catch(err =>
                this.logger.error('Failed to persist chat message:', err.message));

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
            const history = await this.getChannelHistory(channel, limit);

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

    async getChannelHistory(channel, limit = CHAT_DEFAULT_HISTORY_LIMIT) {
        const cache = this.getChannelCache(channel);
        const allMessages = Array.from(cache.values());
        if (allMessages.length > 0) {
            return allMessages.slice(-limit);
        }

        // LRU cache empty — fall back to DynamoDB
        const dynamoMessages = await this._loadHistoryFromDynamo(channel, limit);
        if (dynamoMessages.length > 0) {
            // Backfill LRU cache
            for (const msg of dynamoMessages) {
                cache.set(msg.id, msg);
            }
        }
        return dynamoMessages;
    }

    async sendChannelHistory(clientId, channel) {
        const history = await this.getChannelHistory(channel, CHAT_JOIN_HISTORY_LIMIT);
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

    async _persistMessage(messageData) {
        if (!this.dynamoClient) return;

        const item = {
            channelId: { S: messageData.channel },
            messageId: { S: messageData.id },
            clientId: { S: messageData.clientId },
            message: { S: messageData.message },
            timestamp: { S: messageData.timestamp },
            ttl: { N: String(Math.floor(Date.now() / 1000) + this.TTL_90_DAYS_SEC) },
        };

        if (messageData.metadata && Object.keys(messageData.metadata).length > 0) {
            item.metadata = { S: JSON.stringify(messageData.metadata) };
        }

        await this.dynamoClient.send(new PutItemCommand({
            TableName: this.chatTableName,
            Item: item,
        }));
    }

    async _loadHistoryFromDynamo(channel, limit) {
        if (!this.dynamoClient) return [];

        try {
            const result = await this.dynamoClient.send(new QueryCommand({
                TableName: this.chatTableName,
                KeyConditionExpression: 'channelId = :ch',
                ExpressionAttributeValues: { ':ch': { S: channel } },
                ScanIndexForward: false,
                Limit: limit,
            }));

            const items = (result.Items || []).map(item => ({
                id: item.messageId.S,
                clientId: item.clientId.S,
                channel: item.channelId.S,
                message: item.message.S,
                metadata: item.metadata ? JSON.parse(item.metadata.S) : {},
                timestamp: item.timestamp.S,
            }));

            // Query returned newest-first; reverse to chronological order
            return items.reverse();
        } catch (err) {
            this.logger.error('DynamoDB history load failed:', err.message);
            return [];
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
        // Stop periodic cleanup timer
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }

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
