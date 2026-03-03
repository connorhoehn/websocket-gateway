// src/services/session-service.js
const crypto = require('crypto');

/**
 * SessionService manages client session tokens for reconnection support
 *
 * Provides:
 * - Session token generation with 24hr expiry
 * - Session restoration from Redis or local cache
 * - Subscription tracking within sessions
 * - Graceful degradation when Redis unavailable
 */
class SessionService {
  constructor(redisClient, logger, messageRouter = null) {
    this.redis = redisClient;
    this.logger = logger;
    this.messageRouter = messageRouter; // For redisAvailable check
    this.localSessionStore = new Map(); // Fallback storage
    this.sessionTTL = 24 * 60 * 60; // 24 hours in seconds
  }

  /**
   * Create a new session for a client
   * @param {string} clientId - Client identifier
   * @param {object} userContext - User authentication context
   * @returns {Promise<string>} Session token (UUID)
   */
  async createSession(clientId, userContext) {
    const sessionToken = crypto.randomUUID();
    const sessionData = {
      clientId,
      userContext,
      subscriptions: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + (this.sessionTTL * 1000)
    };

    const key = `session:${sessionToken}`;
    const value = JSON.stringify(sessionData);

    // Always write to local cache (cache-aside pattern from 01-03)
    this.localSessionStore.set(key, sessionData);

    // Try Redis if available
    if (this.isRedisAvailable()) {
      try {
        await this.redis.setEx(key, this.sessionTTL, value);
        this.logger.debug(`Session created in Redis: ${sessionToken}`);
      } catch (err) {
        this.logger.warn('Redis unavailable, session cached locally only');
      }
    }

    return sessionToken;
  }

  /**
   * Restore a session from Redis or local cache
   * @param {string} sessionToken - Session token to restore
   * @returns {Promise<object|null>} Session data or null if expired/not found
   */
  async restoreSession(sessionToken) {
    const key = `session:${sessionToken}`;

    // Try Redis first if available
    if (this.isRedisAvailable()) {
      try {
        const value = await this.redis.get(key);
        if (value) {
          const session = JSON.parse(value);
          // Check expiry
          if (session.expiresAt < Date.now()) {
            await this.redis.del(key);
            this.localSessionStore.delete(key);
            this.logger.debug(`Session expired: ${sessionToken}`);
            return null;
          }
          // Sync to local cache
          this.localSessionStore.set(key, session);
          this.logger.debug(`Session restored from Redis: ${sessionToken}`);
          return session;
        }
      } catch (err) {
        this.logger.warn('Redis error during session restore, checking local cache');
      }
    }

    // Fallback to local cache
    const session = this.localSessionStore.get(key);
    if (!session) {
      this.logger.debug(`Session not found: ${sessionToken}`);
      return null;
    }

    // Check expiry
    if (session.expiresAt < Date.now()) {
      this.localSessionStore.delete(key);
      this.logger.debug(`Session expired in local cache: ${sessionToken}`);
      return null;
    }

    this.logger.debug(`Session restored from local cache: ${sessionToken}`);
    return session;
  }

  /**
   * Update subscriptions for an existing session
   * @param {string} sessionToken - Session token
   * @param {string[]} subscriptions - Array of channel IDs
   * @returns {Promise<boolean>} True if updated, false if session not found
   */
  async updateSubscriptions(sessionToken, subscriptions) {
    const key = `session:${sessionToken}`;
    const session = await this.restoreSession(sessionToken);
    if (!session) {
      this.logger.debug(`Cannot update subscriptions for non-existent session: ${sessionToken}`);
      return false;
    }

    session.subscriptions = subscriptions;
    const value = JSON.stringify(session);

    this.localSessionStore.set(key, session);

    if (this.isRedisAvailable()) {
      try {
        await this.redis.setEx(key, this.sessionTTL, value);
        this.logger.debug(`Subscriptions updated in Redis for session: ${sessionToken}`);
      } catch (err) {
        this.logger.warn('Redis unavailable, subscriptions updated locally only');
      }
    }

    return true;
  }

  /**
   * Check if Redis is available
   * @returns {boolean} True if Redis is available
   */
  isRedisAvailable() {
    return this.messageRouter ? this.messageRouter.redisAvailable : true;
  }
}

module.exports = SessionService;
