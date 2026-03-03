// test/message-validator.test.js

const { MessageValidator, ValidationError } = require('../src/validators/message-validator');
const { ErrorCodes } = require('../src/utils/error-codes');

describe('MessageValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new MessageValidator();
    });

    describe('validateStructure', () => {
        test('throws INVALID_MESSAGE_STRUCTURE when service is missing', () => {
            // Arrange
            const message = { action: 'send' };

            // Act & Assert
            expect(() => validator.validateStructure(message))
                .toThrow(ValidationError);
            expect(() => validator.validateStructure(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE_STRUCTURE }));
        });

        test('throws INVALID_MESSAGE_STRUCTURE when action is missing', () => {
            const message = { service: 'chat' };

            expect(() => validator.validateStructure(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE_STRUCTURE }));
        });

        test('throws INVALID_MESSAGE_STRUCTURE when service is not a string', () => {
            const message = { service: 42, action: 'send' };

            expect(() => validator.validateStructure(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE_STRUCTURE }));
        });

        test('throws INVALID_MESSAGE_STRUCTURE when action is not a string', () => {
            const message = { service: 'chat', action: true };

            expect(() => validator.validateStructure(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE_STRUCTURE }));
        });

        test('throws INVALID_MESSAGE_SERVICE for unlisted service', () => {
            const message = { service: 'billing', action: 'charge' };

            expect(() => validator.validateStructure(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE_SERVICE }));
        });

        test('does not throw for valid messages across all allowed services', () => {
            const allowedServices = ['chat', 'presence', 'cursor', 'reaction'];

            allowedServices.forEach(service => {
                expect(() => validator.validateStructure({ service, action: 'test' }))
                    .not.toThrow();
            });
        });
    });

    describe('validatePayloadSize', () => {
        test('throws PAYLOAD_TOO_LARGE when message exceeds 64KB', () => {
            // Arrange — build a message slightly over 64KB
            const bigPayload = 'x'.repeat(65537);
            const message = { service: 'chat', action: 'send', data: bigPayload };

            // Act & Assert
            expect(() => validator.validatePayloadSize(message))
                .toThrow(expect.objectContaining({ code: ErrorCodes.PAYLOAD_TOO_LARGE }));
        });

        test('does not throw for normal-sized messages', () => {
            const message = { service: 'chat', action: 'send', data: 'hello world' };

            expect(() => validator.validatePayloadSize(message)).not.toThrow();
        });
    });

    describe('validateChannelName', () => {
        test('throws INVALID_CHANNEL_NAME for null', () => {
            expect(() => validator.validateChannelName(null))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_CHANNEL_NAME }));
        });

        test('throws INVALID_CHANNEL_NAME for undefined', () => {
            expect(() => validator.validateChannelName(undefined))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_CHANNEL_NAME }));
        });

        test('throws INVALID_CHANNEL_NAME for invalid characters (spaces)', () => {
            expect(() => validator.validateChannelName('my channel'))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_CHANNEL_NAME }));
        });

        test('throws INVALID_CHANNEL_NAME for invalid characters (@ symbol)', () => {
            expect(() => validator.validateChannelName('room@123'))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_CHANNEL_NAME }));
        });

        test('throws INVALID_CHANNEL_NAME for names longer than 50 characters', () => {
            const longName = 'a'.repeat(51);
            expect(() => validator.validateChannelName(longName))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_CHANNEL_NAME }));
        });

        test('accepts valid channel names with alphanumeric chars', () => {
            expect(() => validator.validateChannelName('room1')).not.toThrow();
            expect(() => validator.validateChannelName('public:room1')).not.toThrow();
            expect(() => validator.validateChannelName('team_chat-01')).not.toThrow();
            expect(() => validator.validateChannelName('admin:ops')).not.toThrow();
        });
    });

    describe('sanitizeString', () => {
        test('trims whitespace from strings', () => {
            // Arrange
            const input = '  hello world  ';

            // Act
            const result = validator.sanitizeString(input);

            // Assert
            expect(result).toBe('hello world');
        });

        test('throws INVALID_MESSAGE when string contains null bytes', () => {
            const input = 'hello\0world';

            expect(() => validator.sanitizeString(input))
                .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_MESSAGE }));
        });

        test('passes through non-string values unchanged', () => {
            expect(validator.sanitizeString(42)).toBe(42);
            expect(validator.sanitizeString(null)).toBe(null);
            expect(validator.sanitizeString({ key: 'val' })).toEqual({ key: 'val' });
        });
    });
});
