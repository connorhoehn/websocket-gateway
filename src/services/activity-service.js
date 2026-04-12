// services/activity-service.js
/**
 * ActivityService — handles WebSocket subscriptions and publishing for real-time activity
 * feed events.
 *
 * Clients send { service: 'activity', action: 'subscribe', channelId: 'activity:<userId>' }
 * to begin receiving activity events (activity:event) published by the activity-log Lambda
 * via Redis after writing to DynamoDB.
 *
 * Clients can also publish activity events directly through the gateway using:
 *   { service: 'activity', action: 'publish', event: { eventType: string, detail: object } }
 * Published events are broadcast to all subscribers of the 'activity:broadcast' channel.
 *
 * On connect, clients are auto-subscribed to 'activity:broadcast' for global activity events.
 */
class ActivityService {
  static BROADCAST_CHANNEL = 'activity:broadcast';
  static HISTORY_KEY_PREFIX = 'activity:history:';
  static MAX_HISTORY_ITEMS = 200;

  constructor(messageRouter, logger, metricsCollector = null, redisClient = null) {
    this.messageRouter = messageRouter;
    this.logger = logger;
    this.metricsCollector = metricsCollector;
    this.redisClient = redisClient;
    this.clientChannels = new Map(); // clientId -> Set of channelIds
  }

  async handleAction(clientId, action, data) {
    try {
      switch (action) {
        case 'subscribe':
          return await this.handleSubscribe(clientId, data);
        case 'unsubscribe':
          return await this.handleUnsubscribe(clientId, data);
        case 'publish':
          return await this.handlePublish(clientId, data);
        case 'getHistory':
          return await this.handleGetHistory(clientId, data);
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

  async handlePublish(clientId, data) {
    const { event } = data;

    // Validate event payload
    if (!event || typeof event !== 'object') {
      this.sendError(clientId, 'event object is required');
      return;
    }

    if (!event.eventType || typeof event.eventType !== 'string') {
      this.sendError(clientId, 'event.eventType is required (string)');
      return;
    }

    // Enrich event with server-side data
    const timestamp = new Date().toISOString();
    const clientData = this.messageRouter ? this.messageRouter.getClientData(clientId) : null;
    const userId = clientData?.userContext?.userId || null;
    const displayName = clientData?.metadata?.displayName
      || clientData?.userContext?.displayName
      || clientData?.userContext?.username
      || userId
      || 'anonymous';

    const enrichedPayload = {
      eventType: event.eventType,
      detail: event.detail || {},
      timestamp,
      userId,
      displayName,
    };

    const broadcastMessage = {
      type: 'activity:event',
      payload: enrichedPayload,
    };

    // Persist event to Redis history list (non-blocking)
    this._persistEvent(ActivityService.BROADCAST_CHANNEL, enrichedPayload)
      .catch(err => this.logger.error('Failed to persist activity event to Redis:', err.message));

    // Broadcast to all subscribers of activity:broadcast
    if (this.messageRouter) {
      await this.messageRouter.sendToChannel(ActivityService.BROADCAST_CHANNEL, broadcastMessage);
    } else {
      // Local-only mode: broadcast directly to all local subscribers
      this._broadcastToLocalSubscribers(ActivityService.BROADCAST_CHANNEL, broadcastMessage);
    }

    // Send confirmation back to the publishing client
    this.sendToClient(clientId, {
      type: 'activity',
      action: 'published',
      eventType: event.eventType,
      timestamp,
    });

    this.logger.info(`Client ${clientId} published activity event: ${event.eventType}`);
  }

  /**
   * Auto-subscribe a newly connected client to the global activity:broadcast channel.
   * Called by the server on connection setup.
   */
  async onClientConnect(clientId) {
    try {
      await this.handleSubscribe(clientId, { channelId: ActivityService.BROADCAST_CHANNEL });
      this.logger.debug(`Client ${clientId} auto-subscribed to ${ActivityService.BROADCAST_CHANNEL}`);
    } catch (error) {
      this.logger.error(`Failed to auto-subscribe client ${clientId} to ${ActivityService.BROADCAST_CHANNEL}:`, error);
    }
  }

  /**
   * Broadcast a message to all local subscribers of a channel (local-only / no-Redis fallback).
   */
  _broadcastToLocalSubscribers(channelId, message) {
    for (const [subscriberClientId, channels] of this.clientChannels) {
      if (channels.has(channelId)) {
        this.sendToClient(subscriberClientId, message);
      }
    }
  }

  /**
   * Check if Redis is available for history persistence
   */
  _isRedisAvailable() {
    return this.redisClient && this.messageRouter && this.messageRouter.redisAvailable !== false;
  }

  /**
   * Persist an activity event to a Redis list for history retrieval.
   * Uses LPUSH + LTRIM to maintain a capped list of MAX_HISTORY_ITEMS.
   */
  async _persistEvent(channelId, enrichedPayload) {
    if (!this._isRedisAvailable()) return;
    try {
      const key = `${ActivityService.HISTORY_KEY_PREFIX}${channelId}`;
      const serialized = JSON.stringify(enrichedPayload);
      await this.redisClient.lPush(key, serialized);
      await this.redisClient.lTrim(key, 0, ActivityService.MAX_HISTORY_ITEMS - 1);
      // Set a TTL so old history eventually expires (24 hours)
      await this.redisClient.expire(key, 86400);
    } catch (err) {
      this.logger.error(`Failed to persist activity event:`, err.message);
    }
  }

  /**
   * Return recent activity history from Redis.
   * Client sends: { service: 'activity', action: 'getHistory', limit: 50 }
   */
  async handleGetHistory(clientId, data) {
    const limit = Math.min(Math.max(parseInt(data.limit, 10) || 50, 1), ActivityService.MAX_HISTORY_ITEMS);
    const channelId = data.channelId || ActivityService.BROADCAST_CHANNEL;

    if (!this._isRedisAvailable()) {
      // No Redis — return empty history
      this.sendToClient(clientId, {
        type: 'activity',
        action: 'history',
        events: [],
        channelId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const key = `${ActivityService.HISTORY_KEY_PREFIX}${channelId}`;
      const items = await this.redisClient.lRange(key, 0, limit - 1);
      const events = items.map(item => {
        try { return JSON.parse(item); } catch { return null; }
      }).filter(Boolean);

      this.sendToClient(clientId, {
        type: 'activity',
        action: 'history',
        events,
        channelId,
        timestamp: new Date().toISOString(),
      });

      this.logger.info(`Sent ${events.length} history events to client ${clientId}`);
    } catch (err) {
      this.logger.error(`Error retrieving activity history for ${clientId}:`, err.message);
      this.sendToClient(clientId, {
        type: 'activity',
        action: 'history',
        events: [],
        channelId,
        timestamp: new Date().toISOString(),
      });
    }
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
