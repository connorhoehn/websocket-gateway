// services/chat-service.js
/**
 * Unified Chat Service - Handles chat messaging
 * Supports both local and distributed modes based on configuration
 */

class ChatService {
    constructor(messageRouter, logger) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        
        // Local state management
        this.clientChannels = new Map(); // clientId -> Set of channels
        this.channelHistory = new Map(); // channel -> Array of messages
        this.maxHistorySize = 100; // Maximum messages to keep in memory
        
        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode
    }

    async handleAction(clientId, action, data) {
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
        }
    }

    async handleJoinChannel(clientId, { channel, metadata = {} }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        // Validate channel name
        if (typeof channel !== 'string' || channel.length === 0 || channel.length > 50) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
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
        if (typeof message !== 'string' || message.length === 0 || message.length > 1000) {
            this.sendError(clientId, 'Message must be a string between 1 and 1000 characters');
            return;
        }

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

    async handleGetHistory(clientId, { channel, limit = 50 }) {
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

    addToChannelHistory(channel, messageData) {
        if (!this.channelHistory.has(channel)) {
            this.channelHistory.set(channel, []);
        }

        const history = this.channelHistory.get(channel);
        history.push(messageData);

        // Trim history if it exceeds maximum size
        if (history.length > this.maxHistorySize) {
            history.splice(0, history.length - this.maxHistorySize);
        }
    }

    getChannelHistory(channel, limit = 50) {
        const history = this.channelHistory.get(channel) || [];
        return history.slice(-limit); // Return last 'limit' messages
    }

    async sendChannelHistory(clientId, channel) {
        const history = this.getChannelHistory(channel, 20); // Send last 20 messages by default
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
            // In distributed mode, publish to Redis channel
            await this.messageRouter.sendToChannel(
                channel,
                broadcastMessage
            );
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

    sendError(clientId, error) {
        this.sendToClient(clientId, {
            type: 'chat',
            action: 'error',
            error,
            timestamp: new Date().toISOString()
        });
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
        this.channelHistory.clear();
        
        this.logger.info('Chat service shut down');
    }

    // Utility methods for debugging/monitoring
    getStats() {
        return {
            connectedClients: this.clientChannels.size,
            activeChannels: this.channelHistory.size,
            totalMessages: Array.from(this.channelHistory.values()).reduce((sum, history) => sum + history.length, 0),
            isDistributed: this.isDistributed
        };
    }
}

module.exports = ChatService;
