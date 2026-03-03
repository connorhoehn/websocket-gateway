// test/authz-middleware.test.js

const { checkChannelPermission, AuthzError } = require('../src/middleware/authz-middleware');
const { ErrorCodes } = require('../src/utils/error-codes');

describe('checkChannelPermission', () => {
    const baseUser = {
        userId: 'user-123',
        email: 'user@example.com',
        channels: ['team:eng', 'team:design'],
        isAdmin: false
    };

    const adminUser = { ...baseUser, isAdmin: true };

    describe('public channels', () => {
        test('allows any authenticated user on public: channels', () => {
            // Arrange
            const userWithNoChannels = { ...baseUser, channels: [] };

            // Act & Assert
            expect(checkChannelPermission(userWithNoChannels, 'public:announcements')).toBe(true);
        });

        test('allows admin users on public: channels too', () => {
            expect(checkChannelPermission(adminUser, 'public:general')).toBe(true);
        });
    });

    describe('admin channels', () => {
        test('allows isAdmin users on admin: channels', () => {
            expect(checkChannelPermission(adminUser, 'admin:config')).toBe(true);
        });

        test('throws AuthzError(AUTHZ_ADMIN_REQUIRED) for non-admin on admin: channel', () => {
            expect(() => checkChannelPermission(baseUser, 'admin:config'))
                .toThrow(AuthzError);
            expect(() => checkChannelPermission(baseUser, 'admin:config'))
                .toThrow(expect.objectContaining({ code: ErrorCodes.AUTHZ_ADMIN_REQUIRED }));
        });

        test('emits AuthorizationDenials metric when admin access is denied', () => {
            // Arrange
            const mockMetrics = { recordMetric: jest.fn() };

            // Act
            expect(() => checkChannelPermission(baseUser, 'admin:ops', null, mockMetrics))
                .toThrow(AuthzError);

            // Assert
            expect(mockMetrics.recordMetric).toHaveBeenCalledWith('AuthorizationDenials', 1);
        });
    });

    describe('user channel list', () => {
        test('allows access when channel is in userContext.channels', () => {
            expect(checkChannelPermission(baseUser, 'team:eng')).toBe(true);
        });

        test('throws AuthzError(AUTHZ_CHANNEL_DENIED) when channel not in user list', () => {
            expect(() => checkChannelPermission(baseUser, 'team:finance'))
                .toThrow(AuthzError);
            expect(() => checkChannelPermission(baseUser, 'team:finance'))
                .toThrow(expect.objectContaining({ code: ErrorCodes.AUTHZ_CHANNEL_DENIED }));
        });

        test('emits AuthorizationDenials metric when channel is denied', () => {
            // Arrange
            const mockMetrics = { recordMetric: jest.fn() };

            // Act
            expect(() => checkChannelPermission(baseUser, 'team:finance', null, mockMetrics))
                .toThrow(AuthzError);

            // Assert
            expect(mockMetrics.recordMetric).toHaveBeenCalledWith('AuthorizationDenials', 1);
        });
    });

    describe('optional parameters', () => {
        test('works without metricsCollector (no crash)', () => {
            expect(() => checkChannelPermission(baseUser, 'admin:ops')).toThrow(AuthzError);
        });

        test('works without logger (no crash)', () => {
            expect(() => checkChannelPermission(baseUser, 'team:finance', null, null)).toThrow(AuthzError);
        });
    });
});
