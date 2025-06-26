// services/reaction-service.js
/**
 * Unified Reaction Service - Handles emoji reactions and visual effects
 * Supports both local and distributed modes based on configuration
 */

class ReactionService {
    constructor(messageRouter, logger) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        
        // Local state management
        this.clientChannels = new Map(); // clientId -> Set of channels
        this.reactionHistory = new Map(); // channel -> Array of recent reactions
        this.maxHistorySize = 50; // Maximum reactions to keep in memory
        
        // Configuration
        this.isDistributed = !!messageRouter; // If messageRouter exists, we're in distributed mode
        
        // Available reactions with their effects
        this.availableReactions = {
            '❤️': { name: 'heart', effect: 'pulse-red' },
            '😂': { name: 'laugh', effect: 'shake' },
            '👍': { name: 'thumbs-up', effect: 'bounce-green' },
            '👎': { name: 'thumbs-down', effect: 'bounce-red' },
            '😮': { name: 'wow', effect: 'zoom' },
            '😢': { name: 'sad', effect: 'fade-blue' },
            '😡': { name: 'angry', effect: 'shake-red' },
            '🎉': { name: 'party', effect: 'confetti' },
            '🔥': { name: 'fire', effect: 'flicker-orange' },
            '⚡': { name: 'lightning', effect: 'flash-yellow' },
            '💯': { name: 'hundred', effect: 'spin-gold' },
            '🚀': { name: 'rocket', effect: 'fly-up' }
        };
    }

    async handleAction(clientId, action, data) {
        try {
            switch (action) {
                case 'subscribe':
                    return await this.handleSubscribeToReactions(clientId, data);
                case 'unsubscribe':
                    return await this.handleUnsubscribeFromReactions(clientId, data);
                case 'send':
                    return await this.handleSendReaction(clientId, data);
                case 'getAvailable':
                    return await this.handleGetAvailableReactions(clientId);
                default:
                    this.sendError(clientId, `Unknown reaction action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling reaction action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        }
    }

    async handleSubscribeToReactions(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        // Validate channel name
        if (typeof channel !== 'string' || channel.length === 0 || channel.length > 50) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        // Track client subscription
        if (!this.clientChannels.has(clientId)) {
            this.clientChannels.set(clientId, new Set());
        }
        this.clientChannels.get(clientId).add(channel);

        // Subscribe to channel updates via message router
        if (this.isDistributed) {
            await this.messageRouter.subscribeToChannel(clientId, `reactions:${channel}`);
        }

        this.sendSuccess(clientId, 'reaction_subscribed', {
            channel,
            message: `Subscribed to reactions in channel: ${channel}`,
            availableReactions: Object.keys(this.availableReactions)
        });

        this.logger.info(`Client ${clientId} subscribed to reactions in channel: ${channel}`);
    }

    async handleUnsubscribeFromReactions(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        const clientChannelSet = this.clientChannels.get(clientId);
        if (clientChannelSet) {
            clientChannelSet.delete(channel);
            if (clientChannelSet.size === 0) {
                this.clientChannels.delete(clientId);
            }
        }

        // Unsubscribe from channel updates via message router
        if (this.isDistributed) {
            await this.messageRouter.unsubscribeFromChannel(clientId, `reactions:${channel}`);
        }

        this.sendSuccess(clientId, 'reaction_unsubscribed', {
            channel,
            message: `Unsubscribed from reactions in channel: ${channel}`
        });

        this.logger.info(`Client ${clientId} unsubscribed from reactions in channel: ${channel}`);
    }

    async handleSendReaction(clientId, { channel, emoji, position = null, metadata = {} }) {
        if (!channel || !emoji) {
            this.sendError(clientId, 'Channel and emoji are required');
            return;
        }

        // Validate emoji is in available reactions
        if (!this.availableReactions[emoji]) {
            this.sendError(clientId, 'Invalid emoji reaction');
            return;
        }

        const reaction = {
            id: this.generateReactionId(),
            clientId,
            channel,
            emoji,
            effect: this.availableReactions[emoji].effect,
            position,
            metadata,
            timestamp: new Date().toISOString()
        };

        // Store in local history
        if (!this.reactionHistory.has(channel)) {
            this.reactionHistory.set(channel, []);
        }
        const history = this.reactionHistory.get(channel);
        history.push(reaction);
        
        // Keep history size manageable
        if (history.length > this.maxHistorySize) {
            history.shift();
        }

        // Broadcast reaction to all subscribers in the channel
        const reactionMessage = {
            type: 'reaction',
            action: 'reaction_received',
            data: reaction
        };

        if (this.isDistributed) {
            // Distribute to all nodes with clients in this channel
            await this.messageRouter.sendToChannel(`reactions:${channel}`, reactionMessage);
        } else {
            // Local mode - broadcast to local clients
            this.broadcastToLocalChannel(channel, reactionMessage);
        }

        // Send confirmation to sender
        this.sendSuccess(clientId, 'reaction_sent', {
            reactionId: reaction.id,
            emoji,
            channel,
            timestamp: reaction.timestamp
        });

        this.logger.info(`Client ${clientId} sent reaction ${emoji} in channel: ${channel}`);
    }

    async handleGetAvailableReactions(clientId) {
        this.sendSuccess(clientId, 'available_reactions', {
            reactions: this.availableReactions
        });
    }

    generateReactionId() {
        return `reaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    broadcastToLocalChannel(channel, message) {
        // In local mode, find all clients subscribed to this channel and send message
        for (const [clientId, channels] of this.clientChannels.entries()) {
            if (channels.has(channel)) {
                this.sendToClient(clientId, message);
            }
        }
    }

    sendToClient(clientId, message) {
        if (this.messageRouter && this.messageRouter.sendToLocalClient) {
            this.messageRouter.sendToLocalClient(clientId, message);
        }
    }

    sendSuccess(clientId, action, data) {
        this.sendToClient(clientId, {
            type: 'reaction',
            action,
            success: true,
            data
        });
    }

    sendError(clientId, error) {
        this.sendToClient(clientId, {
            type: 'reaction',
            action: 'error',
            success: false,
            error
        });
    }

    // Clean up when a client disconnects
    async handleDisconnect(clientId) {
        const clientChannelSet = this.clientChannels.get(clientId);
        if (clientChannelSet) {
            // Unsubscribe from all channels
            for (const channel of clientChannelSet) {
                if (this.isDistributed) {
                    await this.messageRouter.unsubscribeFromChannel(clientId, `reactions:${channel}`);
                }
            }
            this.clientChannels.delete(clientId);
        }
        
        this.logger.debug(`Cleaned up reactions for disconnected client: ${clientId}`);
    }

    // Get service statistics
    getStats() {
        const totalReactions = Array.from(this.reactionHistory.values())
            .reduce((sum, history) => sum + history.length, 0);
        
        return {
            connectedClients: this.clientChannels.size,
            activeChannels: this.reactionHistory.size,
            totalReactions,
            availableReactionsCount: Object.keys(this.availableReactions).length
        };
    }
}

module.exports = ReactionService;
