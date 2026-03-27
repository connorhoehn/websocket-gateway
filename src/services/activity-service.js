// services/activity-service.js
/**
 * ActivityService — handles WebSocket subscriptions for real-time activity feed events.
 *
 * Clients send { service: 'activity', action: 'subscribe', channelId: 'activity:<userId>' }
 * to begin receiving activity events (activity:event) published by the activity-log Lambda
 * via Redis after writing to DynamoDB.
 *
 * This service ONLY manages subscriptions. Publishing is handled by the activity-log Lambda
 * which publishes directly to Redis after DynamoDB write.
 */
class ActivityService {
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
          this.sendError(clientId, `Unknown activity action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error handling activity action ${action} for client ${clientId}:`, error);
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
      type: 'activity',
      action: 'subscribed',
      channelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} subscribed to activity channel ${channelId}`);
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
      type: 'activity',
      action: 'unsubscribed',
      channelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} unsubscribed from activity channel ${channelId}`);
  }

  async handleDisconnect(clientId) {
    const channels = this.clientChannels.get(clientId);
    if (channels) {
      for (const channelId of channels) {
        try {
          await this.messageRouter.unsubscribeFromChannel(clientId, channelId);
        } catch (error) {
          this.logger.error(`Error unsubscribing client ${clientId} from activity channel ${channelId}:`, error);
        }
      }
      this.clientChannels.delete(clientId);
    }
    this.logger.debug(`Client ${clientId} disconnected from activity service`);
  }

  sendToClient(clientId, message) {
    if (this.messageRouter) {
      this.messageRouter.sendToClient(clientId, message);
    }
  }

  sendError(clientId, message) {
    this.sendToClient(clientId, {
      type: 'error',
      service: 'activity',
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

module.exports = ActivityService;
