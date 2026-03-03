// test/metrics-collector.test.js

// Mock the AWS SDK - must be defined before require
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cloudwatch', () => {
    const mockSendFn = mockSend;
    return {
        CloudWatchClient: jest.fn().mockImplementation(() => {
            return {
                send: mockSendFn
            };
        }),
        PutMetricDataCommand: jest.fn().mockImplementation((input) => {
            return { input };
        })
    };
});

const MetricsCollector = require('../src/utils/metrics-collector');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

describe('MetricsCollector', () => {
    let metricsCollector;
    let mockLogger;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        mockSend.mockClear();
        mockSend.mockResolvedValue({});

        // Create mock logger
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        metricsCollector = new MetricsCollector(mockLogger);
    });

    describe('Test 1: recordConnection increments activeConnections gauge', () => {
        test('should increment active connections when delta is positive', () => {
            metricsCollector.recordConnection(1);
            metricsCollector.recordConnection(1);
            metricsCollector.recordConnection(1);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.activeConnections).toBe(3);
        });

        test('should decrement active connections when delta is negative', () => {
            metricsCollector.recordConnection(1);
            metricsCollector.recordConnection(1);
            metricsCollector.recordConnection(1);
            metricsCollector.recordConnection(-1);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.activeConnections).toBe(2);
        });

        test('should not go below zero', () => {
            metricsCollector.recordConnection(-5);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.activeConnections).toBe(0);
        });
    });

    describe('Test 2: recordMessage increments messageCount and updates P95 latency', () => {
        test('should increment message count', () => {
            metricsCollector.recordMessage(10);
            metricsCollector.recordMessage(20);
            metricsCollector.recordMessage(30);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.messageCount).toBe(3);
        });

        test('should track latency values for P95 calculation', () => {
            // Record messages with various latencies
            metricsCollector.recordMessage(5);
            metricsCollector.recordMessage(15);
            metricsCollector.recordMessage(25);
            metricsCollector.recordMessage(45);
            metricsCollector.recordMessage(75);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.p95Latency).toBeGreaterThan(0);
            expect(summary.messageCount).toBe(5);
        });
    });

    describe('Test 3: flush sends batched metrics to CloudWatch PutMetricData API', () => {
        test('should send metrics to CloudWatch with correct namespace and dimensions', async () => {
            metricsCollector.recordConnection(5);
            metricsCollector.recordMessage(10);
            metricsCollector.recordMessage(20);

            await metricsCollector.flush();

            expect(mockSend).toHaveBeenCalled();
            const callArg = mockSend.mock.calls[0][0];

            // Check that it has input property (mocked PutMetricDataCommand)
            expect(callArg.input).toBeDefined();

            const input = callArg.input;
            expect(input.Namespace).toBe('WebSocketGateway');
            expect(input.MetricData).toBeDefined();
            expect(input.MetricData.length).toBeGreaterThan(0);

            // Check dimensions
            const metric = input.MetricData[0];
            expect(metric.Dimensions).toBeDefined();
            expect(metric.Dimensions[0].Name).toBe('NodeId');
        });

        test('should reset message count after flush', async () => {
            metricsCollector.recordMessage(10);
            metricsCollector.recordMessage(20);

            let summary = metricsCollector.getMetricsSummary();
            expect(summary.messageCount).toBe(2);

            await metricsCollector.flush();

            summary = metricsCollector.getMetricsSummary();
            expect(summary.messageCount).toBe(0);
        });

        test('should calculate messages per second based on flush interval', async () => {
            // Record 60 messages
            for (let i = 0; i < 60; i++) {
                metricsCollector.recordMessage(10);
            }

            await metricsCollector.flush();

            expect(mockSend).toHaveBeenCalled();
            const callArg = mockSend.mock.calls[0][0];
            const input = callArg.input;

            // Find messagesPerSecond metric
            const msgPerSecMetric = input.MetricData.find(m => m.MetricName === 'messagesPerSecond');
            expect(msgPerSecMetric).toBeDefined();
            expect(msgPerSecMetric.Value).toBe(1); // 60 messages / 60 seconds = 1/sec
        });
    });

    describe('Test 4: handles CloudWatch API failures gracefully', () => {
        test('should log error and not throw when CloudWatch API fails', async () => {
            mockSend.mockRejectedValueOnce(new Error('CloudWatch API Error'));

            metricsCollector.recordConnection(1);
            metricsCollector.recordMessage(10);

            // Should not throw
            await expect(metricsCollector.flush()).resolves.not.toThrow();

            // Should log error
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to send metrics'),
                expect.any(String)
            );
        });

        test('should continue to collect metrics after CloudWatch failure', async () => {
            mockSend.mockRejectedValueOnce(new Error('CloudWatch API Error'));

            metricsCollector.recordConnection(1);
            await metricsCollector.flush();

            // Record more metrics after failure
            metricsCollector.recordConnection(1);
            const summary = metricsCollector.getMetricsSummary();

            expect(summary.activeConnections).toBe(2);
        });
    });

    describe('Test 5: Latency percentile calculation (P95) works correctly', () => {
        test('should calculate P95 from histogram buckets', async () => {
            // Create a distribution: mostly low latencies, some high
            // 0-10ms: 85 messages
            for (let i = 0; i < 85; i++) {
                metricsCollector.recordMessage(Math.random() * 10);
            }

            // 10-50ms: 10 messages
            for (let i = 0; i < 10; i++) {
                metricsCollector.recordMessage(10 + Math.random() * 40);
            }

            // 50-100ms: 5 messages (95th percentile should be in this range)
            for (let i = 0; i < 5; i++) {
                metricsCollector.recordMessage(50 + Math.random() * 50);
            }

            const summary = metricsCollector.getMetricsSummary();

            // P95 should be > 10ms since 95th percentile falls after the 0-10ms bucket
            expect(summary.p95Latency).toBeGreaterThan(10);
            expect(summary.p95Latency).toBeLessThan(100);
        });

        test('should handle edge case with no messages', () => {
            const summary = metricsCollector.getMetricsSummary();
            expect(summary.p95Latency).toBe(0);
        });

        test('should handle single message', () => {
            metricsCollector.recordMessage(42);

            const summary = metricsCollector.getMetricsSummary();
            expect(summary.p95Latency).toBeGreaterThan(0);
        });
    });

    describe('Test 6: recordMetric adds custom metric to queue', () => {
        test('should add metric with correct structure to customMetrics array', () => {
            // Arrange & Act
            metricsCollector.recordMetric('ConnectionFailures', 1);

            // Assert
            expect(metricsCollector.customMetrics).toHaveLength(1);
            const metric = metricsCollector.customMetrics[0];
            expect(metric.MetricName).toBe('ConnectionFailures');
            expect(metric.Value).toBe(1);
            expect(metric.Unit).toBe('Count');
        });

        test('should respect a custom unit parameter', () => {
            metricsCollector.recordMetric('Latency', 42, 'Milliseconds');

            const metric = metricsCollector.customMetrics[0];
            expect(metric.Unit).toBe('Milliseconds');
        });

        test('should include ServiceName dimension', () => {
            metricsCollector.recordMetric('TestMetric', 5);

            const metric = metricsCollector.customMetrics[0];
            expect(metric.Dimensions).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ Name: 'ServiceName', Value: 'websocket-gateway' })
                ])
            );
        });
    });

    describe('Test 7: recordError maps error codes to CloudWatch metric names', () => {
        test('AUTHZ_ prefix maps to AuthorizationDenials', () => {
            metricsCollector.recordError('AUTHZ_CHANNEL_DENIED');

            expect(metricsCollector.customMetrics[0].MetricName).toBe('AuthorizationDenials');
        });

        test('INVALID_ prefix maps to ValidationErrors', () => {
            metricsCollector.recordError('INVALID_MESSAGE_STRUCTURE');

            expect(metricsCollector.customMetrics[0].MetricName).toBe('ValidationErrors');
        });

        test('RATE_LIMIT_ prefix maps to RateLimitExceeded', () => {
            metricsCollector.recordError('RATE_LIMIT_MESSAGE_QUOTA');

            expect(metricsCollector.customMetrics[0].MetricName).toBe('RateLimitExceeded');
        });

        test('SERVICE_ prefix maps to ServiceErrors', () => {
            metricsCollector.recordError('SERVICE_REDIS_ERROR');

            expect(metricsCollector.customMetrics[0].MetricName).toBe('ServiceErrors');
        });

        test('unknown error code maps to UnknownErrors', () => {
            metricsCollector.recordError('SOMETHING_TOTALLY_UNKNOWN');

            expect(metricsCollector.customMetrics[0].MetricName).toBe('UnknownErrors');
        });
    });

    describe('Test 8: flush includes custom metrics and resets the queue', () => {
        test('should include custom metrics in CloudWatch PutMetricData payload', async () => {
            // Arrange
            metricsCollector.recordError('AUTHZ_CHANNEL_DENIED');

            // Act
            await metricsCollector.flush();

            // Assert
            const callArg = mockSend.mock.calls[0][0];
            const metricNames = callArg.input.MetricData.map(m => m.MetricName);
            expect(metricNames).toContain('AuthorizationDenials');
        });

        test('should reset customMetrics array after successful flush', async () => {
            // Arrange
            metricsCollector.recordMetric('ConnectionFailures', 3);
            expect(metricsCollector.customMetrics).toHaveLength(1);

            // Act
            await metricsCollector.flush();

            // Assert
            expect(metricsCollector.customMetrics).toHaveLength(0);
        });
    });
});
