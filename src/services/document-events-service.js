// services/document-events-service.js
/**
 * DocumentEventsService — handles WebSocket subscriptions for real-time document events.
 *
 * Clients send { service: 'document-events', action: 'subscribe', documentId: '<id>' }
 * to begin receiving document events (comments, reviews, items, workflows) broadcast
 * by social-api via Redis channels `doc-comments:{documentId}` and `doc:{documentId}`.
 *
 * This service ONLY manages subscriptions. Publishing is handled by social-api's
 * BroadcastService which publishes directly to Redis.
 */
class DocumentEventsService {
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
          this.sendError(clientId, `Unknown document-events action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error handling document-events action ${action} for client ${clientId}:`, error);
      this.sendError(clientId, 'Internal server error');
    }
  }

  async handleSubscribe(clientId, { documentId }) {
    if (!documentId || typeof documentId !== 'string' || documentId.length === 0 || documentId.length > 100) {
      this.sendError(clientId, 'documentId is required (string, max 100 chars)');
      return;
    }

    const channels = [
      `doc-comments:${documentId}`,
      `doc:${documentId}`,
    ];

    // Subscribe to both channels via message router
    for (const channel of channels) {
      await this.messageRouter.subscribeToChannel(clientId, channel);
    }

    // Track locally for cleanup on disconnect
    if (!this.clientChannels.has(clientId)) {
      this.clientChannels.set(clientId, new Set());
    }
    for (const channel of channels) {
      this.clientChannels.get(clientId).add(channel);
    }

    this.sendToClient(clientId, {
      type: 'document-events',
      action: 'subscribed',
      documentId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} subscribed to document events for ${documentId}`);
  }

  async handleUnsubscribe(clientId, { documentId }) {
    if (!documentId) {
      this.sendError(clientId, 'documentId is required');
      return;
    }

    const channels = [
      `doc-comments:${documentId}`,
      `doc:${documentId}`,
    ];

    for (const channel of channels) {
      await this.messageRouter.unsubscribeFromChannel(clientId, channel);
    }

    const tracked = this.clientChannels.get(clientId);
    if (tracked) {
      for (const channel of channels) {
        tracked.delete(channel);
      }
      if (tracked.size === 0) {
        this.clientChannels.delete(clientId);
      }
    }

    this.sendToClient(clientId, {
      type: 'document-events',
      action: 'unsubscribed',
      documentId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} unsubscribed from document events for ${documentId}`);
  }

  async handleDisconnect(clientId) {
    const channels = this.clientChannels.get(clientId);
    if (channels) {
      for (const channelId of channels) {
        try {
          await this.messageRouter.unsubscribeFromChannel(clientId, channelId);
        } catch (error) {
          this.logger.error(`Error unsubscribing client ${clientId} from document-events channel ${channelId}:`, error);
        }
      }
      this.clientChannels.delete(clientId);
    }
    this.logger.debug(`Client ${clientId} disconnected from document-events service`);
  }

  sendToClient(clientId, message) {
    if (this.messageRouter) {
      this.messageRouter.sendToClient(clientId, message);
    }
  }

  sendError(clientId, message) {
    this.sendToClient(clientId, {
      type: 'error',
      service: 'document-events',
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

module.exports = DocumentEventsService;
