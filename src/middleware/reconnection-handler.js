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
async function handleReconnection(ws, req, sessionService, messageRouter, logger) {
  const parsedUrl = url.parse(req.url, true);
  const sessionToken = parsedUrl.query.sessionToken;

  // Handle empty string sessionToken (treated as no token)
  if (sessionToken && sessionToken.trim() !== '') {
    // Attempt session recovery
    const session = await sessionService.restoreSession(sessionToken);

    if (session) {
      logger.info(`Client reconnecting with session token, restoring clientId: ${session.clientId}`);

      // Restore subscriptions
      for (const channel of session.subscriptions) {
        await messageRouter.subscribeToChannel(session.clientId, channel);
      }

      return {
        clientId: session.clientId,
        sessionToken, // Return same token
        userContext: session.userContext,
        restored: true
      };
    } else {
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
