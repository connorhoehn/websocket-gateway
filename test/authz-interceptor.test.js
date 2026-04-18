// test/authz-interceptor.test.js
/**
 * Tests for authz-interceptor.enforceChannelPermission
 *
 * Verifies the shared authorization helper used by chat/crdt/cursor/presence/
 * reaction services. Mocks the underlying authz-middleware to isolate the
 * interceptor's branching behavior (missing context, AuthzError translation,
 * non-AuthzError rethrow).
 */

jest.mock('../src/middleware/authz-middleware', () => {
    const actual = jest.requireActual('../src/middleware/authz-middleware');
    return {
        // Keep the real AuthzError so `instanceof` checks in the interceptor work.
        AuthzError: actual.AuthzError,
        checkChannelPermission: jest.fn(),
    };
});

const {
    checkChannelPermission,
    AuthzError,
} = require('../src/middleware/authz-middleware');
const {
    enforceChannelPermission,
    AuthzError: ReExportedAuthzError,
} = require('../src/services/authz-interceptor');
const { ErrorCodes } = require('../src/utils/error-codes');

/**
 * Build a minimal service test double with just enough surface for the
 * interceptor: a messageRouter.getClientData map, a sendError spy, and
 * stubbed logger / metricsCollector (passed through to checkChannelPermission).
 */
function makeService({ clientData } = {}) {
    return {
        messageRouter: {
            getClientData: jest.fn().mockReturnValue(clientData),
        },
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
        metricsCollector: { recordMetric: jest.fn() },
        sendError: jest.fn(),
    };
}

const validClientData = {
    clientId: 'client-1',
    userContext: {
        userId: 'user-1',
        email: 'user@example.com',
        channels: ['team:eng'],
        isAdmin: false,
    },
};

describe('enforceChannelPermission', () => {
    beforeEach(() => {
        checkChannelPermission.mockReset();
    });

    describe('re-exports', () => {
        test('re-exports AuthzError from authz-middleware', () => {
            expect(ReExportedAuthzError).toBe(AuthzError);
        });
    });

    describe('happy path', () => {
        test('returns true and does not call sendError when check passes', () => {
            // Arrange
            const service = makeService({ clientData: validClientData });
            checkChannelPermission.mockReturnValue(true);

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'team:eng');

            // Assert
            expect(result).toBe(true);
            expect(service.sendError).not.toHaveBeenCalled();
            expect(checkChannelPermission).toHaveBeenCalledTimes(1);
            expect(checkChannelPermission).toHaveBeenCalledWith(
                validClientData.userContext,
                'team:eng',
                service.logger,
                service.metricsCollector
            );
            expect(service.messageRouter.getClientData).toHaveBeenCalledWith('client-1');
        });
    });

    describe('missing user context', () => {
        test('sends "User context not found" and returns false when clientData is null', () => {
            // Arrange
            const service = makeService({ clientData: null });

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'team:eng');

            // Assert
            expect(result).toBe(false);
            expect(service.sendError).toHaveBeenCalledTimes(1);
            expect(service.sendError).toHaveBeenCalledWith('client-1', 'User context not found');
            expect(checkChannelPermission).not.toHaveBeenCalled();
        });

        test('sends "User context not found" when clientData exists but userContext is missing', () => {
            // Arrange
            const service = makeService({ clientData: { clientId: 'client-1' } });

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'team:eng');

            // Assert
            expect(result).toBe(false);
            expect(service.sendError).toHaveBeenCalledWith('client-1', 'User context not found');
            expect(checkChannelPermission).not.toHaveBeenCalled();
        });

        test('sends "User context not found" when service has no messageRouter', () => {
            // Arrange — simulate a service instantiated without a messageRouter.
            const service = {
                messageRouter: null,
                logger: {},
                metricsCollector: {},
                sendError: jest.fn(),
            };

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'team:eng');

            // Assert
            expect(result).toBe(false);
            expect(service.sendError).toHaveBeenCalledWith('client-1', 'User context not found');
            expect(checkChannelPermission).not.toHaveBeenCalled();
        });
    });

    describe('permission denied (AuthzError)', () => {
        test('calls sendError(clientId, message, code) and returns false for AUTHZ_CHANNEL_DENIED', () => {
            // Arrange
            const service = makeService({ clientData: validClientData });
            const denial = new AuthzError(
                ErrorCodes.AUTHZ_CHANNEL_DENIED,
                403,
                'No permission for channel'
            );
            checkChannelPermission.mockImplementation(() => {
                throw denial;
            });

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'team:finance');

            // Assert
            expect(result).toBe(false);
            // NOTE: the interceptor forwards (message, code) positionally, NOT
            // as an object. Services implement sendError(clientId, message, errorCode).
            expect(service.sendError).toHaveBeenCalledTimes(1);
            expect(service.sendError).toHaveBeenCalledWith(
                'client-1',
                'No permission for channel',
                ErrorCodes.AUTHZ_CHANNEL_DENIED
            );
        });

        test('forwards AUTHZ_ADMIN_REQUIRED code and message verbatim', () => {
            // Arrange
            const service = makeService({ clientData: validClientData });
            checkChannelPermission.mockImplementation(() => {
                throw new AuthzError(
                    ErrorCodes.AUTHZ_ADMIN_REQUIRED,
                    403,
                    'Admin access required'
                );
            });

            // Act
            const result = enforceChannelPermission(service, 'client-1', 'admin:ops');

            // Assert
            expect(result).toBe(false);
            expect(service.sendError).toHaveBeenCalledWith(
                'client-1',
                'Admin access required',
                ErrorCodes.AUTHZ_ADMIN_REQUIRED
            );
        });
    });

    describe('unexpected (non-AuthzError) errors', () => {
        test('re-throws plain Error without calling sendError', () => {
            // Arrange — the interceptor only translates AuthzError into sendError;
            // any other exception bubbles up so the caller's outer try/catch (which
            // logs + sends a generic "Internal server error") handles it.
            const service = makeService({ clientData: validClientData });
            const boom = new Error('redis exploded');
            checkChannelPermission.mockImplementation(() => {
                throw boom;
            });

            // Act & Assert
            expect(() => enforceChannelPermission(service, 'client-1', 'team:eng'))
                .toThrow(boom);
            expect(service.sendError).not.toHaveBeenCalled();
        });

        test('re-throws TypeError / unexpected subclass without translating to sendError', () => {
            // Arrange
            const service = makeService({ clientData: validClientData });
            checkChannelPermission.mockImplementation(() => {
                throw new TypeError('bad shape');
            });

            // Act & Assert
            expect(() => enforceChannelPermission(service, 'client-1', 'team:eng'))
                .toThrow(TypeError);
            expect(service.sendError).not.toHaveBeenCalled();
        });
    });
});
