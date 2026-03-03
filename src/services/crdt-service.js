// services/crdt-service.js
/**
 * CRDT Service - Handles Y.js CRDT operation broadcasting
 * Provides low-latency (<50ms) operation broadcasting via Redis pub/sub
 */

const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

class CRDTService {
    constructor(messageRouter, logger, metricsCollector = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        // Operation batching for reduced Redis message volume
        this.operationBatches = new Map(); // channelId -> {operations: [], timeout: null, senderClientId: string}
        this.BATCH_WINDOW_MS = 10; // 10ms batch window for <50ms total latency

        // DynamoDB client for snapshot persistence
        this.dynamoClient = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1'
        });

        // Channel state tracking for snapshots
        this.channelStates = new Map(); // channelId -> {currentSnapshot: Buffer, operationsSinceSnapshot: number, subscriberCount: number}

        // Schedule periodic snapshot timer (every 5 minutes)
        this.periodicSnapshotTimer = setInterval(() => {
            this.writePeriodicSnapshots();
        }, 300000); // 300,000ms = 5 minutes
    }

    async handleAction(clientId, action, data) {
        try {
            switch (action) {
                case 'subscribe':
                    return await this.handleSubscribe(clientId, data);
                case 'update':
                    return await this.handleUpdate(clientId, data);
                case 'unsubscribe':
                    return await this.handleUnsubscribe(clientId, data);
                default:
                    this.sendError(clientId, `Unknown CRDT action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling CRDT action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        }
    }

    async handleSubscribe(clientId, { channel }) {
        // Validate channel name
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
            // Check channel authorization
            const clientData = this.messageRouter.getClientData(clientId);
            if (!clientData || !clientData.userContext) {
                this.sendError(clientId, 'User context not found');
                return;
            }

            try {
                checkChannelPermission(clientData.userContext, channel, this.logger, this.metricsCollector);
            } catch (error) {
                if (error instanceof AuthzError) {
                    this.sendError(clientId, error.message, error.code);
                    return;
                }
                throw error;
            }

            // Subscribe to channel through message router
            await this.messageRouter.subscribeToChannel(clientId, channel);

            // Initialize or update channel state
            let state = this.channelStates.get(channel);
            if (!state) {
                state = {
                    currentSnapshot: Buffer.alloc(0),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);
            }
            state.subscriberCount++;

            // Send confirmation to client
            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'subscribed',
                channel,
                timestamp: new Date().toISOString()
            });

            this.logger.info(`Client ${clientId} subscribed to CRDT channel: ${channel}`);
        } catch (error) {
            this.logger.error(`Error subscribing to channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to subscribe to channel');
        }
    }

    async handleUpdate(clientId, { channel, update }) {
        // Validate channel
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        // Validate update payload
        if (!update || typeof update !== 'string') {
            this.sendError(clientId, 'Update payload must be a base64 string');
            return;
        }

        try {
            // Create operation object
            const operation = {
                update,
                timestamp: new Date().toISOString()
            };

            // Update channel state for snapshot tracking
            let state = this.channelStates.get(channel);
            if (!state) {
                state = {
                    currentSnapshot: Buffer.alloc(0),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);
            }

            // Append update to current snapshot (Y.js updates are cumulative)
            const updateBuffer = Buffer.from(update, 'base64');
            state.currentSnapshot = Buffer.concat([state.currentSnapshot, updateBuffer]);
            state.operationsSinceSnapshot++;

            // Check if we should trigger snapshot (after 50 operations)
            if (state.operationsSinceSnapshot >= 50) {
                await this.writeSnapshot(channel);
            }

            // Batch the operation for this channel
            this.batchOperation(channel, operation, clientId);

            this.logger.debug(`CRDT update batched for channel ${channel} from client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error handling CRDT update for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to process CRDT update');
        }
    }

    async handleUnsubscribe(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        try {
            // Update channel state
            const state = this.channelStates.get(channel);
            if (state) {
                state.subscriberCount--;

                // If last client is unsubscribing, write final snapshot
                if (state.subscriberCount === 0 && state.operationsSinceSnapshot > 0) {
                    await this.writeSnapshot(channel);
                }
            }

            await this.messageRouter.unsubscribeFromChannel(clientId, channel);

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'unsubscribed',
                channel,
                timestamp: new Date().toISOString()
            });

            this.logger.info(`Client ${clientId} unsubscribed from CRDT channel: ${channel}`);
        } catch (error) {
            this.logger.error(`Error unsubscribing from channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to unsubscribe from channel');
        }
    }

    /**
     * Batch operation for a channel and schedule broadcast
     */
    batchOperation(channel, operation, senderClientId) {
        // Get or create batch for this channel
        let batch = this.operationBatches.get(channel);

        if (!batch) {
            batch = {
                operations: [],
                timeout: null,
                senderClientId
            };
            this.operationBatches.set(channel, batch);
        }

        // Add operation to batch
        batch.operations.push(operation);

        // Schedule broadcast if not already scheduled
        if (!batch.timeout) {
            batch.timeout = setTimeout(() => {
                this.broadcastBatch(channel);
            }, this.BATCH_WINDOW_MS);
        }
    }

    /**
     * Broadcast batched operations to channel subscribers
     */
    async broadcastBatch(channel) {
        const batch = this.operationBatches.get(channel);
        if (!batch || batch.operations.length === 0) {
            return;
        }

        try {
            const message = {
                type: 'crdt',
                action: 'operations',
                channel,
                operations: batch.operations,
                timestamp: new Date().toISOString()
            };

            // Broadcast to channel, excluding the sender to prevent echo
            await this.messageRouter.sendToChannel(channel, message, batch.senderClientId);

            this.logger.debug(`Broadcasted ${batch.operations.length} CRDT operations for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error broadcasting CRDT operations for channel ${channel}:`, error);
        } finally {
            // Clear the batch
            this.operationBatches.delete(channel);
        }
    }

    /**
     * Write snapshot to DynamoDB
     */
    async writeSnapshot(channelId) {
        const state = this.channelStates.get(channelId);
        if (!state || !state.currentSnapshot || state.currentSnapshot.length === 0) {
            return; // No snapshot to write
        }

        try {
            // Gzip compress snapshot
            const compressed = await gzip(state.currentSnapshot);

            // Calculate TTL (7 days from now)
            const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

            // Write to DynamoDB
            const command = new PutItemCommand({
                TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                Item: {
                    documentId: { S: channelId },
                    timestamp: { N: String(Date.now()) },
                    snapshot: { B: compressed },
                    ttl: { N: String(ttl) }
                }
            });

            await this.dynamoClient.send(command);

            // Reset operation counter
            state.operationsSinceSnapshot = 0;

            this.logger.info(`Snapshot written for channel ${channelId}`);
        } catch (error) {
            // Graceful degradation: log error but don't crash
            this.logger.error(`Failed to write snapshot for ${channelId}:`, error.message);
        }
    }

    /**
     * Write periodic snapshots for all channels with pending operations
     */
    async writePeriodicSnapshots() {
        for (const [channelId, state] of this.channelStates.entries()) {
            if (state.operationsSinceSnapshot > 0) {
                await this.writeSnapshot(channelId);
            }
        }
    }

    /**
     * Validate channel name
     */
    validateChannel(channel) {
        return typeof channel === 'string' && channel.length > 0 && channel.length <= 50;
    }

    sendToClient(clientId, message) {
        if (this.messageRouter) {
            this.messageRouter.sendToClient(clientId, message);
        } else {
            this.logger.warn(`Cannot send message to client ${clientId}: no message router`);
        }
    }

    sendError(clientId, message, errorCode = ErrorCodes.SERVICE_INTERNAL_ERROR) {
        const errorResponse = createErrorResponse(errorCode, message, {
            service: 'crdt',
            clientId,
        });

        this.sendToClient(clientId, {
            type: 'error',
            service: 'crdt',
            ...errorResponse,
        });

        // Record error metric
        if (this.metricsCollector) {
            this.metricsCollector.recordError(errorCode);
        }
    }

    // Client lifecycle methods
    async onClientDisconnect(clientId) {
        this.logger.debug(`Client ${clientId} disconnected from CRDT service`);
    }

    // Service lifecycle methods
    async shutdown() {
        // Clear periodic snapshot timer
        if (this.periodicSnapshotTimer) {
            clearInterval(this.periodicSnapshotTimer);
        }

        // Clear all pending batches
        for (const [channel, batch] of this.operationBatches.entries()) {
            if (batch.timeout) {
                clearTimeout(batch.timeout);
            }
        }
        this.operationBatches.clear();

        this.logger.info('CRDT service shut down');
    }

    // Utility methods for debugging/monitoring
    getStats() {
        return {
            pendingBatches: this.operationBatches.size
        };
    }
}

module.exports = CRDTService;
