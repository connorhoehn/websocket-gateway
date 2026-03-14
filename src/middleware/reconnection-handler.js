// src/middleware/reconnection-handler.js
const url = require('url');
const crypto = require('crypto');

/**
 * Handle WebSocket reconnection with session token recovery
 *
 * Workflow:
 * 1. Parse sessionToken from query params
 * 2. If token present and valid, restore clientId and subscriptions
 * 3. If token absent/invalid/expired, treat as new connection
 *
 * @param {WebSocket} ws - WebSocket connection
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {SessionService} sessionService - Session management service
 * @param {MessageRouter} messageRouter - Message router for subscription restoration
 * @param {Logger} logger - Logger instance
 * @returns {Promise<object>} Connection result with clientId, sessionToken, restored flag
 */
async function handleReconnection(ws, req, sessionService, messageRouter, logger, metricsCollector = null) {
  const parsedUrl = url.parse(req.url, true);
  const sessionToken = parsedUrl.query.sessionToken;

  // Handle empty string sessionToken (treated as no token)
  if (sessionToken && sessionToken.trim() !== '') {
    // Record reconnection attempt
    if (metricsCollector) {
      try { metricsCollector.recordReconnectionAttempt(); } catch (e) { /* fail open */ }
    }

    // Attempt session recovery
    const session = await sessionService.restoreSession(sessionToken);

    if (session) {
      logger.info(`Client reconnecting with session token, restoring clientId: ${session.clientId}`);

      // Restore subscriptions atomically
      const restoredChannels = [];
      try {
        for (const channel of session.subscriptions) {
          await messageRouter.subscribeToChannel(session.clientId, channel);
          restoredChannels.push(channel);
        }
      } catch (error) {
        // Rollback: unsubscribe from all successfully restored channels
        logger.error(`Subscription restoration failed at channel ${restoredChannels.length + 1}/${session.subscriptions.length}, rolling back`, {
          clientId: session.clientId,
          restoredCount: restoredChannels.length,
          error: error.message
        });

        for (const channel of restoredChannels) {
          try {
            await messageRouter.unsubscribeFromChannel(session.clientId, channel);
          } catch (rollbackError) {
            logger.error(`Rollback failed for channel ${channel}`, { error: rollbackError.message });
          }
        }

        // Record failed reconnection due to subscription restore failure
        if (metricsCollector) {
          try { metricsCollector.recordReconnectionFailure('subscription_restore_failed'); } catch (e) { /* fail open */ }
        }

        // Treat as new connection since restoration failed
        logger.warn('Falling back to new connection after subscription restore failure');
        const newClientId = crypto.randomUUID();
        return {
          clientId: newClientId,
          sessionToken: null,
          userContext: null,
          restored: false
        };
      }

      logger.info('Subscription restoration complete', { clientId: session.clientId, channelCount: restoredChannels.length });

      // Record successful reconnection with session age
      if (metricsCollector) {
        try {
          const sessionAgeMs = session.createdAt ? Date.now() - session.createdAt : 0;
          metricsCollector.recordReconnectionSuccess(sessionAgeMs);
        } catch (e) { /* fail open */ }
      }

      return {
        clientId: session.clientId,
        sessionToken, // Return same token
        userContext: session.userContext,
        restored: true
      };
    } else {
      // Record failed reconnection
      if (metricsCollector) {
        try { metricsCollector.recordReconnectionFailure('expired'); } catch (e) { /* fail open */ }
      }
      logger.warn('Invalid or expired session token, treating as new connection');
    }
  }

  // New connection - generate new session
  const newClientId = crypto.randomUUID();

  return {
    clientId: newClientId,
    sessionToken: null, // Will be created after user auth
    userContext: null,
    restored: false
  };
}

module.exports = { handleReconnection };
