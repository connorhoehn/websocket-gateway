// utils/metrics-collector.js

const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const os = require('os');

/**
 * MetricsCollector - Collects and emits metrics to AWS CloudWatch
 *
 * Tracks:
 * - activeConnections: Current number of WebSocket connections
 * - messagesPerSecond: Rate of message processing
 * - p95Latency: 95th percentile message processing latency
 *
 * Emits metrics to CloudWatch every 60 seconds via flush() method.
 */
class MetricsCollector {
    constructor(logger) {
        this.logger = logger;

        // Initialize CloudWatch client
        this.cloudWatchClient = new CloudWatchClient({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
        });

        // Metric state
        this.activeConnections = 0;
        this.messageCount = 0;

        // Latency histogram buckets (in milliseconds)
        // Buckets: 0-10ms, 10-50ms, 50-100ms, 100-500ms, 500ms+
        this.latencyBuckets = {
            '0-10': 0,
            '10-50': 0,
            '50-100': 0,
            '100-500': 0,
            '500+': 0
        };

        // Configuration
        this.namespace = 'WebSocketGateway';
        this.nodeId = process.env.NODE_ID || os.hostname();
        this.flushIntervalSeconds = 60; // Metrics are flushed every 60 seconds

        // Track last emission time for cost optimization
        this.lastEmittedValues = {
            activeConnections: null,
            messagesPerSecond: null,
            p95Latency: null
        };
        this.lastEmissionTime = null;
    }

    /**
     * Record a connection change (connect: +1, disconnect: -1)
     * @param {number} delta - Change in connection count
     */
    recordConnection(delta) {
        this.activeConnections = Math.max(0, this.activeConnections + delta);
    }

    /**
     * Record a message with its processing latency
     * @param {number} latencyMs - Message processing latency in milliseconds
     */
    recordMessage(latencyMs) {
        this.messageCount++;

        // Update histogram buckets for P95 calculation
        if (latencyMs < 10) {
            this.latencyBuckets['0-10']++;
        } else if (latencyMs < 50) {
            this.latencyBuckets['10-50']++;
        } else if (latencyMs < 100) {
            this.latencyBuckets['50-100']++;
        } else if (latencyMs < 500) {
            this.latencyBuckets['100-500']++;
        } else {
            this.latencyBuckets['500+']++;
        }
    }

    /**
     * Calculate P95 latency from histogram buckets
     * @returns {number} P95 latency in milliseconds
     */
    calculateP95Latency() {
        const totalMessages = Object.values(this.latencyBuckets).reduce((sum, count) => sum + count, 0);

        if (totalMessages === 0) {
            return 0;
        }

        const p95Index = Math.ceil(totalMessages * 0.95);
        let accumulatedCount = 0;

        // Iterate through buckets to find P95
        const bucketRanges = [
            { name: '0-10', max: 10 },
            { name: '10-50', max: 50 },
            { name: '50-100', max: 100 },
            { name: '100-500', max: 500 },
            { name: '500+', max: 500 }
        ];

        for (const bucket of bucketRanges) {
            accumulatedCount += this.latencyBuckets[bucket.name];
            if (accumulatedCount >= p95Index) {
                // P95 falls in this bucket - return the bucket's max value as approximation
                return bucket.max;
            }
        }

        return 500; // Default to max if somehow we didn't find it
    }

    /**
     * Get current metrics summary
     * @returns {Object} Current metrics
     */
    getMetricsSummary() {
        return {
            activeConnections: this.activeConnections,
            messageCount: this.messageCount,
            p95Latency: this.calculateP95Latency(),
            nodeId: this.nodeId
        };
    }

    /**
     * Flush metrics to CloudWatch
     * Sends batched metrics and resets per-interval counters
     */
    async flush() {
        try {
            const summary = this.getMetricsSummary();

            // Calculate messages per second (messageCount / 60 seconds)
            const messagesPerSecond = this.messageCount / this.flushIntervalSeconds;

            // Build metric data array
            const metricData = [];

            // Common dimensions for all metrics
            const dimensions = [
                {
                    Name: 'NodeId',
                    Value: this.nodeId
                }
            ];

            // Add activeConnections metric
            metricData.push({
                MetricName: 'activeConnections',
                Value: summary.activeConnections,
                Unit: 'Count',
                Timestamp: new Date(),
                Dimensions: dimensions,
                StorageResolution: 60 // Standard resolution
            });

            // Add messagesPerSecond metric
            metricData.push({
                MetricName: 'messagesPerSecond',
                Value: messagesPerSecond,
                Unit: 'Count/Second',
                Timestamp: new Date(),
                Dimensions: dimensions,
                StorageResolution: 60
            });

            // Add p95Latency metric
            metricData.push({
                MetricName: 'p95Latency',
                Value: summary.p95Latency,
                Unit: 'Milliseconds',
                Timestamp: new Date(),
                Dimensions: dimensions,
                StorageResolution: 60
            });

            // Send metrics to CloudWatch (batched)
            const command = new PutMetricDataCommand({
                Namespace: this.namespace,
                MetricData: metricData
            });

            await this.cloudWatchClient.send(command);

            this.logger.debug('Metrics sent to CloudWatch', JSON.stringify(summary));

            // Reset per-interval counters after successful flush
            this.messageCount = 0;

            // Reset latency histogram for next interval
            for (const bucket in this.latencyBuckets) {
                this.latencyBuckets[bucket] = 0;
            }

            // Update last emission tracking
            this.lastEmittedValues = {
                activeConnections: summary.activeConnections,
                messagesPerSecond: messagesPerSecond,
                p95Latency: summary.p95Latency
            };
            this.lastEmissionTime = Date.now();

        } catch (error) {
            // Fail open - log error but don't throw
            // This ensures metrics failures don't break the application
            this.logger.error('Failed to send metrics to CloudWatch:', error.message);
        }
    }
}

module.exports = MetricsCollector;
