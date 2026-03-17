// services/social-service.js
/**
 * SocialService — handles WebSocket subscriptions for real-time social events.
 *
 * Clients send { service: 'social', action: 'subscribe', channelId: '<room channelId>' }
 * to begin receiving social events (social:post, social:comment, social:like,
 * social:member_joined, social:member_left) broadcast by social-api via Redis.
 *
 * This service ONLY manages subscriptions. Publishing is handled by social-api's
 * BroadcastService which publishes directly to Redis.
 */
class SocialService {
  constructor(messageRouter, logger, metricsCollector = null) {
    this.messageRouter = messageRouter;
    this.logger = logger;
    this.metricsCollector = metricsCollector;
    this.clientChannels = new Map(); // clientId -> Set of channelIds
  }

  async handleAction(clientId, action, data) {
    try {
      switch (action) {
        case 'subscribe':
          return await this.handleSubscribe(clientId, data);
        case 'unsubscribe':
          return await this.handleUnsubscribe(clientId, data);
        default:
          this.sendError(clientId, `Unknown social action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error handling social action ${action} for client ${clientId}:`, error);
      this.sendError(clientId, 'Internal server error');
    }
  }

  async handleSubscribe(clientId, { channelId }) {
    if (!channelId || typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 100) {
      this.sendError(clientId, 'channelId is required (string, max 100 chars)');
      return;
    }

    // Subscribe to channel via message router (registers node in Redis SET)
    await this.messageRouter.subscribeToChannel(clientId, channelId);

    // Track locally for cleanup on disconnect
    if (!this.clientChannels.has(clientId)) {
      this.clientChannels.set(clientId, new Set());
    }
    this.clientChannels.get(clientId).add(channelId);

    this.sendToClient(clientId, {
      type: 'social',
      action: 'subscribed',
      channelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} subscribed to social channel ${channelId}`);
  }

  async handleUnsubscribe(clientId, { channelId }) {
    if (!channelId) {
      this.sendError(clientId, 'channelId is required');
      return;
    }

    await this.messageRouter.unsubscribeFromChannel(clientId, channelId);

    const channels = this.clientChannels.get(clientId);
    if (channels) {
      channels.delete(channelId);
      if (channels.size === 0) {
        this.clientChannels.delete(clientId);
      }
    }

    this.sendToClient(clientId, {
      type: 'social',
      action: 'unsubscribed',
      channelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} unsubscribed from social channel ${channelId}`);
  }

  async handleDisconnect(clientId) {
    const channels = this.clientChannels.get(clientId);
    if (channels) {
      for (const channelId of channels) {
        try {
          await this.messageRouter.unsubscribeFromChannel(clientId, channelId);
        } catch (error) {
          this.logger.error(`Error unsubscribing client ${clientId} from social channel ${channelId}:`, error);
        }
      }
      this.clientChannels.delete(clientId);
    }
    this.logger.debug(`Client ${clientId} disconnected from social service`);
  }

  sendToClient(clientId, message) {
    if (this.messageRouter) {
      this.messageRouter.sendToClient(clientId, message);
    }
  }

  sendError(clientId, message) {
    this.sendToClient(clientId, {
      type: 'error',
      service: 'social',
      message,
      timestamp: new Date().toISOString(),
    });
  }

  getStats() {
    return {
      subscribedClients: this.clientChannels.size,
      totalSubscriptions: Array.from(this.clientChannels.values())
        .reduce((sum, set) => sum + set.size, 0),
    };
  }
}

module.exports = SocialService;
