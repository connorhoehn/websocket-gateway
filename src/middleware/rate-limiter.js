// middleware/rate-limiter.js

const { ErrorCodes } = require('../utils/error-codes');
const {
    RATE_LIMITS,
    RATE_LIMIT_CLEANUP_INTERVAL_MS,
    RATE_LIMIT_STALE_WINDOW_MS,
} = require('../config/constants');

/**
 * In-memory sliding-window rate limiter.
 * Per-connection (not cross-node), so no Redis needed.
 * Map<clientId, Map<messageType, { count, windowStart }>>
 */
class RateLimiter {
    constructor(logger) {
        this.logger = logger;

        // Rate limits (messages per second)
        this.limits = { ...RATE_LIMITS };

        // Map<clientId, Map<messageType, { count: number, windowStart: number }>>
        this.clients = new Map();

        // Periodic cleanup of stale entries
        this._cleanupInterval = setInterval(() => this._cleanup(), RATE_LIMIT_CLEANUP_INTERVAL_MS);
        if (this._cleanupInterval.unref) {
            this._cleanupInterval.unref(); // Don't prevent process exit
        }
    }

    /**
     * Check if a client is within their rate limit
     * @param {string} clientId - Client identifier
     * @param {string} messageType - 'cursor', 'crdt', 'awareness', or 'general'
     * @returns {{ allowed: boolean, code?: string, current: number, limit: number, remaining: number, resetIn: number }}
     */
    checkLimit(clientId, messageType) {
        const limit = this.limits[messageType] || this.limits.general;
        const now = Date.now();

        if (!this.clients.has(clientId)) {
            this.clients.set(clientId, new Map());
        }
        const buckets = this.clients.get(clientId);

        let bucket = buckets.get(messageType);
        if (!bucket || (now - bucket.windowStart) >= 1000) {
            // New window
            bucket = { count: 1, windowStart: now };
            buckets.set(messageType, bucket);
            return {
                allowed: true,
                current: 1,
                limit,
                remaining: limit - 1,
                resetIn: 1
            };
        }

        bucket.count++;

        if (bucket.count > limit) {
            this.logger.warn(`Rate limit exceeded: ${clientId} ${messageType} ${bucket.count}/${limit}`);
            return {
                allowed: false,
                code: messageType === 'cursor'
                    ? ErrorCodes.RATE_LIMIT_CURSOR_QUOTA
                    : ErrorCodes.RATE_LIMIT_MESSAGE_QUOTA,
                current: bucket.count,
                limit,
                remaining: 0,
                resetIn: Math.max(1, Math.ceil((1000 - (now - bucket.windowStart)) / 1000))
            };
        }

        return {
            allowed: true,
            current: bucket.count,
            limit,
            remaining: limit - bucket.count,
            resetIn: Math.max(1, Math.ceil((1000 - (now - bucket.windowStart)) / 1000))
        };
    }

    /**
     * Detect message type from payload
     * @param {object} message - Message object
     * @returns {string} - 'cursor', 'crdt', 'awareness', or 'general'
     */
    detectMessageType(message) {
        if (message.service === 'cursor') return 'cursor';
        if (message.service === 'crdt') {
            // Separate awareness from CRDT document updates so cursor spam
            // doesn't consume the CRDT budget and block document edits
            if (message.action === 'awareness') return 'awareness';
            return 'crdt';
        }
        return 'general';
    }

    /**
     * Remove all rate-limit state for a disconnected client.
     * @param {string} clientId
     */
    removeClient(clientId) {
        this.clients.delete(clientId);
    }

    /**
     * Periodic cleanup: remove entries whose windows are older than 5 seconds.
     * @private
     */
    _cleanup() {
        const now = Date.now();
        for (const [clientId, buckets] of this.clients) {
            for (const [type, bucket] of buckets) {
                if (now - bucket.windowStart > RATE_LIMIT_STALE_WINDOW_MS) {
                    buckets.delete(type);
                }
            }
            if (buckets.size === 0) {
                this.clients.delete(clientId);
            }
        }
    }

    /**
     * Stop the cleanup interval (for graceful shutdown / tests).
     */
    destroy() {
        clearInterval(this._cleanupInterval);
    }
}

module.exports = RateLimiter;
