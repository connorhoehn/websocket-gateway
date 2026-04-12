// validators/message-validator.js

const { ErrorCodes } = require('../utils/error-codes');

/**
 * Custom validation error with code and message
 */
class ValidationError extends Error {
    constructor(code, message, context = null) {
        super(message);
        this.name = 'ValidationError';
        this.code = code;
        this.context = context;
    }
}

/**
 * Message validation for schema, size limits, and input sanitization
 */
class MessageValidator {
    constructor() {
        // Service whitelist - only these services are allowed
        this.allowedServices = ['chat', 'presence', 'cursor', 'reaction', 'social', 'activity', 'crdt'];

        // Payload size limit (64KB)
        this.maxPayloadSize = 65536;

        // Channel name validation pattern
        this.channelNamePattern = /^[a-zA-Z0-9_:-]{1,50}$/;
    }

    /**
     * Validate message structure (required fields and service whitelist)
     * @param {object} message - Message object to validate
     * @throws {ValidationError} if validation fails
     */
    validateStructure(message) {
        // Check for required fields
        if (!message.service || !message.action) {
            throw new ValidationError(
                ErrorCodes.INVALID_MESSAGE_STRUCTURE,
                'Missing required fields: service and action are required',
                { receivedService: typeof message.service, receivedAction: typeof message.action }
            );
        }

        // Validate field types
        if (typeof message.service !== 'string' || typeof message.action !== 'string') {
            throw new ValidationError(
                ErrorCodes.INVALID_MESSAGE_STRUCTURE,
                'Invalid field types: service and action must be strings',
                { receivedService: typeof message.service, receivedAction: typeof message.action }
            );
        }

        // Check service whitelist
        if (!this.allowedServices.includes(message.service)) {
            throw new ValidationError(
                ErrorCodes.INVALID_MESSAGE_SERVICE,
                `Invalid service: '${message.service}' is not in allowed services [${this.allowedServices.join(', ')}]`
            );
        }
    }

    /**
     * Validate payload size (must not exceed 64KB)
     * @param {object} message - Message object to validate
     * @throws {ValidationError} if payload exceeds size limit
     */
    validatePayloadSize(message) {
        const payloadSize = Buffer.byteLength(JSON.stringify(message), 'utf8');

        if (payloadSize > this.maxPayloadSize) {
            throw new ValidationError(
                ErrorCodes.PAYLOAD_TOO_LARGE,
                `Message exceeds 64KB limit: ${payloadSize} bytes > ${this.maxPayloadSize} bytes`,
                { payloadSize, limit: this.maxPayloadSize }
            );
        }
    }

    /**
     * Validate channel name format
     * @param {string} channelId - Channel identifier to validate
     * @throws {ValidationError} if channel name is invalid
     */
    validateChannelName(channelId) {
        if (!channelId || typeof channelId !== 'string') {
            throw new ValidationError(
                ErrorCodes.INVALID_CHANNEL_NAME,
                'Channel name is required and must be a string'
            );
        }

        if (!this.channelNamePattern.test(channelId)) {
            throw new ValidationError(
                ErrorCodes.INVALID_CHANNEL_NAME,
                'Invalid channel name format: must be 1-50 characters, alphanumeric with hyphens/underscores/colons only'
            );
        }
    }

    /**
     * Sanitize string fields (trim whitespace, reject null bytes)
     * @param {string} str - String to sanitize
     * @returns {string} - Sanitized string
     * @throws {ValidationError} if string contains null bytes
     */
    sanitizeString(str) {
        if (typeof str !== 'string') {
            return str;
        }

        // Trim whitespace
        const trimmed = str.trim();

        // Reject null bytes (security issue)
        if (trimmed.includes('\0')) {
            throw new ValidationError(
                ErrorCodes.INVALID_MESSAGE,
                'String contains null bytes which are not allowed'
            );
        }

        return trimmed;
    }
}

module.exports = { MessageValidator, ValidationError };
