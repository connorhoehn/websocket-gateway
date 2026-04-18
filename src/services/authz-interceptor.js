// services/authz-interceptor.js
/**
 * Authorization Interceptor
 *
 * Single audit point for channel authorization checks across all gateway services.
 * Wraps the boilerplate that previously lived inline in chat/crdt/presence/cursor/
 * reaction services:
 *   1. Resolve clientData from the message router
 *   2. Verify userContext is present
 *   3. Invoke checkChannelPermission (which throws AuthzError on denial)
 *   4. Translate failures into service.sendError(...) + early return
 *
 * Adding a new permission model or rotating ACLs now touches this file plus
 * authz-middleware.js, not the five service implementations.
 */
const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');

/**
 * Enforce channel permission for a service method invocation.
 *
 * Resolves the client's user context via the service's messageRouter, runs the
 * authorization check, and — on any failure path — calls service.sendError
 * with the appropriate code/message. Returns a boolean so the caller can
 * early-return without re-implementing the branch shape.
 *
 * @param {Object} service - Service instance; must expose messageRouter, logger,
 *                           metricsCollector, and sendError(clientId, msg, code).
 * @param {string} clientId - Client whose user context is being checked.
 * @param {string} channel - Channel id to authorize against.
 * @returns {boolean} true if permitted (caller may proceed); false if denied
 *                    (caller must return — error has already been sent).
 */
function enforceChannelPermission(service, clientId, channel) {
    const clientData = service.messageRouter
        ? service.messageRouter.getClientData(clientId)
        : null;

    if (!clientData || !clientData.userContext) {
        service.sendError(clientId, 'User context not found');
        return false;
    }

    try {
        checkChannelPermission(
            clientData.userContext,
            channel,
            service.logger,
            service.metricsCollector
        );
        return true;
    } catch (error) {
        if (error instanceof AuthzError) {
            service.sendError(clientId, error.message, error.code);
            return false;
        }
        throw error;
    }
}

module.exports = {
    enforceChannelPermission,
    // Re-export so services can import the error type from the interceptor
    // if they need to reason about authz failures downstream.
    AuthzError,
};
