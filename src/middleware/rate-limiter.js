// middleware/rate-limiter.js

const { ErrorCodes } = require('../utils/error-codes');

/**
 * Redis-backed token bucket rate limiter for distributed rate limiting
 * Supports differentiated rate limits for different message types
 */
class RateLimiter {
    constructor(redisClient, logger) {
        this.redis = redisClient;
        this.logger = logger;

        // Rate limits (messages per second)
        this.limits = {
            cursor: 40,
            crdt: 500,      // Y.js CRDT updates + awareness need high throughput
            general: 100
        };
    }

    /**
     * Check if a client is within their rate limit
     * @param {string} clientId - Client identifier
     * @param {string} messageType - 'cursor' or 'general'
     * @returns {Promise<{allowed: boolean, code: string, current: number, limit: number, remaining: number, resetIn: number}>}
     */
    async checkLimit(clientId, messageType) {
        const limit = this.limits[messageType] || this.limits.general;
        const key = `rate:${clientId}:${messageType}`;

        try {
            // Atomic increment
            const current = await this.redis.incr(key);

            // Get TTL
            const ttl = await this.redis.ttl(key);

            // Set expiry on first increment (1 second window)
            if (current === 1) {
                await this.redis.expire(key, 1);
            }

            // Check if limit exceeded
            if (current > limit) {
                this.logger.warn(`Rate limit exceeded: ${clientId} ${messageType} ${current}/${limit}`);
                return {
                    allowed: false,
                    code: messageType === 'cursor'
                        ? ErrorCodes.RATE_LIMIT_CURSOR_QUOTA
                        : ErrorCodes.RATE_LIMIT_MESSAGE_QUOTA,
                    current,
                    limit,
                    remaining: 0,
                    resetIn: ttl > 0 ? ttl : 1
                };
            }

            return {
                allowed: true,
                current,
                limit,
                remaining: limit - current,
                resetIn: ttl > 0 ? ttl : 1
            };
        } catch (error) {
            this.logger.error(`Rate limit check failed for ${clientId}:`, error);
            // Fail open - allow the message if Redis is down
            return { allowed: true, current: 0, limit, remaining: limit, resetIn: 1 };
        }
    }

    /**
     * Detect message type from payload
     * @param {object} message - Message object
     * @returns {string} - 'cursor' or 'general'
     */
    detectMessageType(message) {
        if (message.service === 'cursor') return 'cursor';
        if (message.service === 'crdt') return 'crdt';
        return 'general';
    }
}

module.exports = RateLimiter;
