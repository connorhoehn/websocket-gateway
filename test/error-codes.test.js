// test/error-codes.test.js

const { ErrorCodes, ErrorCodeToStatus, createErrorResponse } = require('../src/utils/error-codes');

describe('ErrorCodes', () => {
    describe('constants', () => {
        test('AUTH codes use AUTH_ prefix', () => {
            expect(ErrorCodes.AUTH_TOKEN_MISSING).toBe('AUTH_TOKEN_MISSING');
            expect(ErrorCodes.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
            expect(ErrorCodes.AUTH_TOKEN_INVALID).toBe('AUTH_TOKEN_INVALID');
            expect(ErrorCodes.AUTH_FAILED).toBe('AUTH_FAILED');
        });

        test('AUTHZ codes use AUTHZ_ prefix', () => {
            expect(ErrorCodes.AUTHZ_FORBIDDEN).toBe('AUTHZ_FORBIDDEN');
            expect(ErrorCodes.AUTHZ_CHANNEL_DENIED).toBe('AUTHZ_CHANNEL_DENIED');
            expect(ErrorCodes.AUTHZ_ADMIN_REQUIRED).toBe('AUTHZ_ADMIN_REQUIRED');
        });

        test('RATE_LIMIT codes use RATE_LIMIT_ prefix', () => {
            expect(ErrorCodes.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
            expect(ErrorCodes.RATE_LIMIT_MESSAGE_QUOTA).toBe('RATE_LIMIT_MESSAGE_QUOTA');
            expect(ErrorCodes.RATE_LIMIT_CURSOR_QUOTA).toBe('RATE_LIMIT_CURSOR_QUOTA');
        });

        test('INVALID codes use INVALID_ prefix', () => {
            expect(ErrorCodes.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
            expect(ErrorCodes.INVALID_MESSAGE_STRUCTURE).toBe('INVALID_MESSAGE_STRUCTURE');
            expect(ErrorCodes.INVALID_MESSAGE_SERVICE).toBe('INVALID_MESSAGE_SERVICE');
            expect(ErrorCodes.INVALID_CHANNEL_NAME).toBe('INVALID_CHANNEL_NAME');
            expect(ErrorCodes.PAYLOAD_TOO_LARGE).toBe('PAYLOAD_TOO_LARGE');
        });

        test('SERVICE and CONNECTION codes use correct prefixes', () => {
            expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
            expect(ErrorCodes.SERVICE_REDIS_ERROR).toBe('SERVICE_REDIS_ERROR');
            expect(ErrorCodes.SERVICE_INTERNAL_ERROR).toBe('SERVICE_INTERNAL_ERROR');
            expect(ErrorCodes.CONNECTION_LIMIT_EXCEEDED).toBe('CONNECTION_LIMIT_EXCEEDED');
            expect(ErrorCodes.CONNECTION_IP_LIMIT_EXCEEDED).toBe('CONNECTION_IP_LIMIT_EXCEEDED');
        });
    });
});

describe('ErrorCodeToStatus', () => {
    test('AUTH codes map to HTTP 401', () => {
        expect(ErrorCodeToStatus['AUTH_TOKEN_MISSING']).toBe(401);
        expect(ErrorCodeToStatus['AUTH_TOKEN_EXPIRED']).toBe(401);
        expect(ErrorCodeToStatus['AUTH_TOKEN_INVALID']).toBe(401);
        expect(ErrorCodeToStatus['AUTH_FAILED']).toBe(401);
    });

    test('AUTHZ codes map to HTTP 403', () => {
        expect(ErrorCodeToStatus['AUTHZ_FORBIDDEN']).toBe(403);
        expect(ErrorCodeToStatus['AUTHZ_CHANNEL_DENIED']).toBe(403);
        expect(ErrorCodeToStatus['AUTHZ_ADMIN_REQUIRED']).toBe(403);
    });

    test('RATE_LIMIT codes map to HTTP 429', () => {
        expect(ErrorCodeToStatus['RATE_LIMIT_EXCEEDED']).toBe(429);
        expect(ErrorCodeToStatus['RATE_LIMIT_MESSAGE_QUOTA']).toBe(429);
        expect(ErrorCodeToStatus['RATE_LIMIT_CURSOR_QUOTA']).toBe(429);
    });

    test('INVALID codes map to HTTP 400', () => {
        expect(ErrorCodeToStatus['INVALID_MESSAGE']).toBe(400);
        expect(ErrorCodeToStatus['INVALID_MESSAGE_STRUCTURE']).toBe(400);
        expect(ErrorCodeToStatus['INVALID_MESSAGE_SERVICE']).toBe(400);
        expect(ErrorCodeToStatus['INVALID_CHANNEL_NAME']).toBe(400);
        expect(ErrorCodeToStatus['PAYLOAD_TOO_LARGE']).toBe(400);
    });

    test('SERVICE codes map to HTTP 500', () => {
        expect(ErrorCodeToStatus['SERVICE_UNAVAILABLE']).toBe(500);
        expect(ErrorCodeToStatus['SERVICE_REDIS_ERROR']).toBe(500);
        expect(ErrorCodeToStatus['SERVICE_INTERNAL_ERROR']).toBe(500);
    });

    test('CONNECTION codes map to HTTP 503', () => {
        expect(ErrorCodeToStatus['CONNECTION_LIMIT_EXCEEDED']).toBe(503);
        expect(ErrorCodeToStatus['CONNECTION_IP_LIMIT_EXCEEDED']).toBe(503);
    });
});

describe('createErrorResponse', () => {
    test('returns object with error.code and error.message', () => {
        const response = createErrorResponse('AUTH_FAILED', 'Authentication failed');

        expect(response.error).toBeDefined();
        expect(response.error.code).toBe('AUTH_FAILED');
        expect(response.error.message).toBe('Authentication failed');
    });

    test('includes a valid ISO 8601 timestamp', () => {
        const response = createErrorResponse('AUTH_FAILED', 'Authentication failed');

        expect(response.error.timestamp).toBeDefined();
        expect(new Date(response.error.timestamp).toISOString()).toBe(response.error.timestamp);
    });

    test('merges context fields into the error object', () => {
        const context = { channelId: 'room-1', userId: 'user-42' };
        const response = createErrorResponse('AUTHZ_CHANNEL_DENIED', 'No permission', context);

        expect(response.error.channelId).toBe('room-1');
        expect(response.error.userId).toBe('user-42');
    });

    test('works without context argument', () => {
        const response = createErrorResponse('INVALID_MESSAGE_STRUCTURE', 'Missing fields');

        expect(response.error.code).toBe('INVALID_MESSAGE_STRUCTURE');
        expect(response.error.message).toBe('Missing fields');
    });
});
