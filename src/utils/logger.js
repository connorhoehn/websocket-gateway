// utils/logger.js

/**
 * JSON-structured logger with correlation ID support
 */
class Logger {
    constructor(name, correlationId = null) {
        this.name = name;
        this.level = process.env.LOG_LEVEL || 'info';
        this.correlationId = correlationId;

        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.level];
    }

    /**
     * Create a new logger instance with a correlation ID
     * @param {string} correlationId - Correlation ID for request tracing
     * @returns {Logger} New logger instance with correlation ID
     */
    withCorrelation(correlationId) {
        return new Logger(this.name, correlationId);
    }

    /**
     * Format log entry as JSON
     * @param {string} level - Log level
     * @param {string|object} message - Log message or object
     * @param {object} context - Optional context object
     * @returns {string} JSON-formatted log entry
     */
    formatMessage(level, message, context) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            name: this.name,
            message: typeof message === 'string' ? message : JSON.stringify(message)
        };

        // Add correlation ID if present
        if (this.correlationId) {
            logEntry.correlationId = this.correlationId;
        }

        // Add context if provided
        if (context !== undefined) {
            // Handle circular references safely
            try {
                logEntry.context = JSON.parse(JSON.stringify(context));
            } catch (error) {
                // Circular reference detected - use safe serialization
                logEntry.context = this.safeStringify(context);
            }
        }

        return JSON.stringify(logEntry);
    }

    /**
     * Safely stringify objects with circular references
     * @param {*} obj - Object to stringify
     * @returns {string} Safe string representation
     */
    safeStringify(obj) {
        const seen = new WeakSet();
        return JSON.parse(JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            return value;
        }));
    }

    error(message, context) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, context));
        }
    }

    warn(message, context) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, context));
        }
    }

    info(message, context) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info', message, context));
        }
    }

    debug(message, context) {
        if (this.shouldLog('debug')) {
            console.log(this.formatMessage('debug', message, context));
        }
    }
}

module.exports = Logger;
