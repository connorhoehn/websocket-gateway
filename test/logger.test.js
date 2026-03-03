// test/logger.test.js

const Logger = require('../src/utils/logger');

describe('Logger', () => {
    let logger;
    let consoleLogSpy;
    let consoleErrorSpy;
    let consoleWarnSpy;

    beforeEach(() => {
        // Spy on console methods
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        logger = new Logger('TestLogger');
    });

    afterAll(() => {
        // Restore console methods after all tests
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('Test 1: Logger.info() outputs valid JSON with required fields', () => {
        test('should output valid JSON with timestamp, level, name, message', () => {
            logger.info('Test message');

            expect(consoleLogSpy).toHaveBeenCalled();
            const output = consoleLogSpy.mock.calls[0][0];

            // Should be valid JSON
            const parsed = JSON.parse(output);

            expect(parsed.timestamp).toBeDefined();
            expect(parsed.level).toBe('info');
            expect(parsed.name).toBe('TestLogger');
            expect(parsed.message).toBe('Test message');
        });

        test('should include ISO timestamp', () => {
            logger.info('Test message');

            const output = consoleLogSpy.mock.calls[0][0];
            const parsed = JSON.parse(output);

            // Check timestamp is valid ISO 8601
            expect(new Date(parsed.timestamp)).toBeInstanceOf(Date);
            expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    describe('Test 2: Logger.error() includes context object in JSON output', () => {
        test('should include context object when provided', () => {
            const context = {
                clientId: 'abc123',
                errorCode: 'ERR_500'
            };

            logger.error('Error occurred', context);

            expect(consoleErrorSpy).toHaveBeenCalled();
            const output = consoleErrorSpy.mock.calls[0][0];
            const parsed = JSON.parse(output);

            expect(parsed.context).toEqual(context);
            expect(parsed.message).toBe('Error occurred');
            expect(parsed.level).toBe('error');
        });

        test('should work without context', () => {
            logger.error('Error without context');

            const output = consoleErrorSpy.mock.calls[0][0];
            const parsed = JSON.parse(output);

            expect(parsed.message).toBe('Error without context');
            expect(parsed.context).toBeUndefined();
        });
    });

    describe('Test 3: Logger.withCorrelation() returns logger with correlationId', () => {
        test('should add correlationId to all log entries', () => {
            const correlationId = 'test-correlation-123';
            const correlatedLogger = logger.withCorrelation(correlationId);

            correlatedLogger.info('Correlated message');

            const output = consoleLogSpy.mock.calls[0][0];
            const parsed = JSON.parse(output);

            expect(parsed.correlationId).toBe(correlationId);
            expect(parsed.message).toBe('Correlated message');
        });

        test('should return a new logger instance', () => {
            const correlationId = 'test-correlation-456';
            const correlatedLogger = logger.withCorrelation(correlationId);

            expect(correlatedLogger).toBeInstanceOf(Logger);
            expect(correlatedLogger).not.toBe(logger);
        });

        test('should not affect original logger', () => {
            const correlatedLogger = logger.withCorrelation('corr-123');

            correlatedLogger.info('From correlated');
            logger.info('From original');

            const correlatedOutput = consoleLogSpy.mock.calls[0][0];
            const originalOutput = consoleLogSpy.mock.calls[1][0];

            const correlatedParsed = JSON.parse(correlatedOutput);
            const originalParsed = JSON.parse(originalOutput);

            expect(correlatedParsed.correlationId).toBe('corr-123');
            expect(originalParsed.correlationId).toBeUndefined();
        });
    });

    describe('Test 4: JSON parsing of log output succeeds', () => {
        test('should produce valid JSON for all log levels', () => {
            consoleLogSpy.mockClear();
            consoleWarnSpy.mockClear();
            consoleErrorSpy.mockClear();
            // Set log level to debug to ensure all messages are logged
            const oldLevel = process.env.LOG_LEVEL;
            process.env.LOG_LEVEL = 'debug';
            const debugLogger = new Logger('DebugLogger');

            debugLogger.debug('Debug message');
            debugLogger.info('Info message');
            debugLogger.warn('Warn message');
            debugLogger.error('Error message');

            // Restore
            process.env.LOG_LEVEL = oldLevel;

            // All should parse successfully
            expect(() => JSON.parse(consoleLogSpy.mock.calls[0][0])).not.toThrow();
            expect(() => JSON.parse(consoleLogSpy.mock.calls[1][0])).not.toThrow();
            expect(() => JSON.parse(consoleWarnSpy.mock.calls[0][0])).not.toThrow();
            expect(() => JSON.parse(consoleErrorSpy.mock.calls[0][0])).not.toThrow();
        });

        test('should handle special characters in message', () => {
            const freshLogger = new Logger('FreshLogger');
            freshLogger.info('Message with "quotes" and \n newlines');

            expect(consoleLogSpy).toHaveBeenCalled();
            const calls = consoleLogSpy.mock.calls;
            const output = calls[calls.length - 1][0]; // Get last call
            const parsed = JSON.parse(output);

            expect(parsed.message).toContain('quotes');
        });
    });

    describe('Test 5: Nested object context serializes correctly', () => {
        test('should serialize nested objects', () => {
            const freshLogger = new Logger('FreshLogger');
            const context = {
                user: {
                    id: 123,
                    profile: {
                        name: 'John Doe',
                        roles: ['admin', 'user']
                    }
                }
            };

            freshLogger.info('Nested context', context);

            expect(consoleLogSpy).toHaveBeenCalled();
            const calls = consoleLogSpy.mock.calls;
            const output = calls[calls.length - 1][0]; // Get last call
            const parsed = JSON.parse(output);

            expect(parsed.context).toEqual(context);
            expect(parsed.context.user.profile.name).toBe('John Doe');
        });

        test('should handle circular references', () => {
            const freshLogger = new Logger('FreshLogger');
            const circular = { name: 'test' };
            circular.self = circular;

            // Should not throw
            expect(() => {
                freshLogger.info('Circular reference', circular);
            }).not.toThrow();

            expect(consoleLogSpy).toHaveBeenCalled();
            const calls = consoleLogSpy.mock.calls;
            const output = calls[calls.length - 1][0]; // Get last call

            // Should still produce valid JSON
            expect(() => JSON.parse(output)).not.toThrow();
        });

        test('should handle undefined and null values', () => {
            const freshLogger = new Logger('FreshLogger');
            const context = {
                defined: 'value',
                nullValue: null,
                undefinedValue: undefined
            };

            freshLogger.info('Mixed values', context);

            expect(consoleLogSpy).toHaveBeenCalled();
            const calls = consoleLogSpy.mock.calls;
            const output = calls[calls.length - 1][0]; // Get last call
            const parsed = JSON.parse(output);

            expect(parsed.context.defined).toBe('value');
            expect(parsed.context.nullValue).toBeNull();
            // undefined values are typically omitted in JSON serialization
        });
    });

    describe('Log level filtering', () => {
        test('should respect LOG_LEVEL environment variable', () => {
            // Create logger with warn level
            const oldLevel = process.env.LOG_LEVEL;
            process.env.LOG_LEVEL = 'warn';

            const warnLogger = new Logger('WarnLogger');

            warnLogger.debug('Should not log');
            warnLogger.info('Should not log');
            warnLogger.warn('Should log');

            // Restore
            process.env.LOG_LEVEL = oldLevel;

            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalled();
        });
    });
});
