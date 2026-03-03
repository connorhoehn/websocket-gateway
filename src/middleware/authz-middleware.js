// middleware/authz-middleware.js

const { ErrorCodes } = require('../utils/error-codes');

/**
 * Custom error class for authorization failures
 */
class AuthzError extends Error {
    constructor(code, statusCode, message) {
        super(message);
        this.name = 'AuthzError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * Check if a user has permission to access a channel
 * @param {Object} userContext - User context from JWT (userId, email, channels, isAdmin)
 * @param {string} channelId - Channel ID to check permission for
 * @param {Object} logger - Logger instance for audit trail (optional)
 * @param {Object} metricsCollector - MetricsCollector instance for emitting denial metrics (optional)
 * @returns {boolean} True if user has permission
 * @throws {AuthzError} If user does not have permission
 */
function checkChannelPermission(userContext, channelId, logger = null, metricsCollector = null) {
    // Public channels are accessible to all authenticated users
    if (channelId.startsWith('public:')) {
        return true;
    }

    // Admin channels require isAdmin claim
    if (channelId.startsWith('admin:')) {
        if (!userContext.isAdmin) {
            // Emit authorization denial metric for CloudWatch alarm
            if (metricsCollector) {
                metricsCollector.recordMetric('AuthorizationDenials', 1);
            }

            if (logger) {
                logger.warn('Authorization denied - admin access required', {
                    userId: userContext.userId,
                    channelId,
                    reason: 'not_admin'
                });
            }
            throw new AuthzError(ErrorCodes.AUTHZ_ADMIN_REQUIRED, 403, 'Admin access required');
        }
        return true;
    }

    // Check if channel is in user's channels array
    if (!userContext.channels.includes(channelId)) {
        // Emit authorization denial metric for CloudWatch alarm
        if (metricsCollector) {
            metricsCollector.recordMetric('AuthorizationDenials', 1);
        }

        if (logger) {
            logger.warn('Authorization denied - channel not in permissions', {
                userId: userContext.userId,
                channelId,
                userChannels: userContext.channels,
                reason: 'channel_not_in_permissions'
            });
        }
        throw new AuthzError(ErrorCodes.AUTHZ_CHANNEL_DENIED, 403, 'No permission for channel');
    }

    return true;
}

module.exports = {
    checkChannelPermission,
    AuthzError
};
