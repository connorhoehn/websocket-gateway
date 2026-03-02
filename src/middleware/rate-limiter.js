// middleware/rate-limiter.js

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
            general: 100
        };
    }

    /**
     * Check if a client is within their rate limit
     * @param {string} clientId - Client identifier
     * @param {string} messageType - 'cursor' or 'general'
     * @returns {Promise<{allowed: boolean, current: number, limit: number}>}
     */
    async checkLimit(clientId, messageType) {
        const limit = this.limits[messageType] || this.limits.general;
        const key = `rate:${clientId}:${messageType}`;

        try {
            // Atomic increment
            const current = await this.redis.incr(key);

            // Set expiry on first increment (1 second window)
            if (current === 1) {
                await this.redis.expire(key, 1);
            }

            // Check if limit exceeded
            if (current > limit) {
                this.logger.warn(`Rate limit exceeded: ${clientId} ${messageType} ${current}/${limit}`);
                return { allowed: false, current, limit };
            }

            return { allowed: true, current, limit };
        } catch (error) {
            this.logger.error(`Rate limit check failed for ${clientId}:`, error);
            // Fail open - allow the message if Redis is down
            return { allowed: true, current: 0, limit };
        }
    }

    /**
     * Detect message type from payload
     * @param {object} message - Message object
     * @returns {string} - 'cursor' or 'general'
     */
    detectMessageType(message) {
        return message.service === 'cursor' ? 'cursor' : 'general';
    }
}

module.exports = RateLimiter;
