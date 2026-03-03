// services/crdt-service.js
/**
 * CRDT Service - Handles Y.js CRDT operation broadcasting
 * Provides low-latency (<50ms) operation broadcasting via Redis pub/sub
 */

const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');

class CRDTService {
    constructor(messageRouter, logger, metricsCollector = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        // Operation batching for reduced Redis message volume
        this.operationBatches = new Map(); // channelId -> {operations: [], timeout: null, senderClientId: string}
        this.BATCH_WINDOW_MS = 10; // 10ms batch window for <50ms total latency
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
