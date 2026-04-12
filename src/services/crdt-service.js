// services/crdt-service.js
/**
 * CRDT Service - Handles Y.js CRDT operation broadcasting
 * Provides low-latency (<50ms) operation broadcasting via Redis pub/sub
 */

const crypto = require('crypto');
const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const { DynamoDBClient, PutItemCommand, QueryCommand, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const Y = require('yjs');
const { mergeUpdates } = Y;
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class CRDTService {
    constructor(messageRouter, logger, metricsCollector = null, redisClient = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.redisClient = redisClient;

        // Operation batching for reduced Redis message volume
        this.operationBatches = new Map(); // channelId -> {operations: [], timeout: null, senderClientId: string}
        this.BATCH_WINDOW_MS = 10; // 10ms batch window for <50ms total latency

        // Debounced snapshot timers per channel (write after 5s of inactivity)
        this.snapshotDebounceTimers = new Map(); // channelId -> timeout
        this.SNAPSHOT_DEBOUNCE_MS = parseInt(process.env.SNAPSHOT_DEBOUNCE_MS || '5000', 10);

        // DynamoDB client for snapshot retrieval
        const dynamoOpts = { region: process.env.AWS_REGION || 'us-east-1' };
        if (process.env.LOCALSTACK_ENDPOINT) {
            dynamoOpts.endpoint = process.env.LOCALSTACK_ENDPOINT;
            dynamoOpts.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
            };
        }
        this.dynamoClient = new DynamoDBClient(dynamoOpts);

        // EventBridge client for publishing snapshot checkpoints
        this.eventBridgeClient = new EventBridgeClient({
            region: process.env.AWS_REGION || 'us-east-1',
            ...(process.env.LOCALSTACK_ENDPOINT ? {
                endpoint: process.env.LOCALSTACK_ENDPOINT,
                credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
            } : {})
        });
        this.eventBusName = process.env.EVENT_BUS_NAME || 'social-events';

        // Channel state tracking with Y.Doc per channel for proper CRDT sync
        this.channelStates = new Map(); // channelId -> {ydoc: Y.Doc, operationsSinceSnapshot: number, subscriberCount: number}

        // Schedule periodic snapshot timer
        const snapshotInterval = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '300000', 10);
        this.periodicSnapshotTimer = setInterval(() => {
            this.writePeriodicSnapshots();
        }, snapshotInterval);
        this.logger.info(`Periodic snapshots every ${snapshotInterval / 1000}s`);

        // Ensure DynamoDB table exists in local dev
        if (process.env.DIRECT_DYNAMO_WRITE === 'true') {
            this._ensureTable().catch(err => this.logger.error('Failed to ensure DynamoDB table:', err.message));
        }

        // Document metadata: in-memory fallback when Redis is unavailable
        this.docMetaFallback = new Map(); // documentId -> meta object
        this.docListFallback = [];        // sorted array of { id, updatedAt }

        // Default icons by document type
        this.TYPE_ICONS = {
            meeting: '\u{1F4DD}', sprint: '\u{1F680}', design: '\u{1F3A8}', project: '\u{1F4CB}',
            decision: '\u2696\uFE0F', retro: '\u{1F504}', custom: '\u{1F4C4}',
        };
    }

    async _ensureTable() {
        const tableName = process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots';
        try {
            await this.dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
            this.logger.info(`DynamoDB table ${tableName} exists`);
        } catch (err) {
            if (err.name === 'ResourceNotFoundException') {
                this.logger.info(`Creating DynamoDB table ${tableName}...`);
                await this.dynamoClient.send(new CreateTableCommand({
                    TableName: tableName,
                    AttributeDefinitions: [
                        { AttributeName: 'documentId', AttributeType: 'S' },
                        { AttributeName: 'timestamp', AttributeType: 'N' },
                    ],
                    KeySchema: [
                        { AttributeName: 'documentId', KeyType: 'HASH' },
                        { AttributeName: 'timestamp', KeyType: 'RANGE' },
                    ],
                    BillingMode: 'PAY_PER_REQUEST',
                }));
                this.logger.info(`DynamoDB table ${tableName} created`);
            } else {
                this.logger.error(`Error checking DynamoDB table:`, err.message);
            }
        }
    }

    // -----------------------------------------------------------------
    // Redis snapshot hot-cache helpers
    // -----------------------------------------------------------------

    /**
     * Check if Redis is available for caching
     */
    _isRedisAvailable() {
        return this.redisClient && this.messageRouter && this.messageRouter.redisAvailable !== false;
    }

    /**
     * Save a snapshot to Redis hot-cache (key: crdt:snapshot:{channel}, TTL: 1 hour)
     * @param {string} channelId
     * @param {string} base64Snapshot - base64-encoded Y.js state
     */
    async _saveSnapshotToRedis(channelId, base64Snapshot) {
        if (!this._isRedisAvailable()) return;
        try {
            const key = `crdt:snapshot:${channelId}`;
            await this.redisClient.setEx(key, 3600, base64Snapshot); // TTL 1 hour
            this.logger.info(`Redis snapshot cached for channel ${channelId}`);
        } catch (err) {
            this.logger.error(`Failed to cache snapshot in Redis for ${channelId}:`, err.message);
        }
    }

    /**
     * Retrieve a snapshot from Redis hot-cache
     * @param {string} channelId
     * @returns {Promise<string|null>} base64 snapshot or null
     */
    async _getSnapshotFromRedis(channelId) {
        if (!this._isRedisAvailable()) return null;
        try {
            const key = `crdt:snapshot:${channelId}`;
            const data = await this.redisClient.get(key);
            if (data) {
                this.logger.info(`Redis snapshot hit for channel ${channelId}`);
            }
            return data;
        } catch (err) {
            this.logger.error(`Failed to read snapshot from Redis for ${channelId}:`, err.message);
            return null;
        }
    }

    /**
     * Schedule a debounced snapshot write for a channel.
     * Writes after SNAPSHOT_DEBOUNCE_MS of inactivity.
     */
    _scheduleDebouncedSnapshot(channelId) {
        // Clear any pending debounce timer for this channel
        const existing = this.snapshotDebounceTimers.get(channelId);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(async () => {
            this.snapshotDebounceTimers.delete(channelId);
            const state = this.channelStates.get(channelId);
            if (state && state.operationsSinceSnapshot > 0) {
                await this.writeSnapshot(channelId);
            }
        }, this.SNAPSHOT_DEBOUNCE_MS);
        this.snapshotDebounceTimers.set(channelId, timer);
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
                case 'getSnapshot':
                    return await this.handleGetSnapshot(clientId, data);
                case 'awareness':
                    return await this.handleAwareness(clientId, data);
                case 'listSnapshots':
                    return await this.handleListSnapshots(clientId, data);
                case 'getSnapshotAtVersion':
                    return await this.handleGetSnapshotAtVersion(clientId, data);
                case 'restoreSnapshot':
                    return await this.handleRestoreSnapshot(clientId, data);
                case 'clearDocument':
                    return await this.handleClearDocument(clientId, data);
                case 'listDocuments':
                    return await this.handleListDocuments(clientId, data);
                case 'createDocument':
                    return await this.handleCreateDocument(clientId, data);
                case 'deleteDocument':
                    return await this.handleDeleteDocument(clientId, data);
                case 'updateDocumentMeta':
                    return await this.handleUpdateDocumentMeta(clientId, data);
                case 'getDocumentPresence':
                    return await this.handleGetDocumentPresence(clientId, data);
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
                    ydoc: new Y.Doc(),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);

                // Hydrate Y.Doc: try Redis hot-cache first, then DynamoDB
                let hydrated = false;
                try {
                    const redisSnapshot = await this._getSnapshotFromRedis(channel);
                    if (redisSnapshot) {
                        const snapshotBytes = new Uint8Array(Buffer.from(redisSnapshot, 'base64'));
                        Y.applyUpdate(state.ydoc, snapshotBytes);
                        this.logger.info(`Hydrated Y.Doc for channel ${channel} from Redis cache`);
                        hydrated = true;
                    }
                } catch (redisErr) {
                    this.logger.error(`Redis hydration failed for ${channel}:`, redisErr.message);
                }

                if (!hydrated) {
                    try {
                        const snapshot = await this.retrieveLatestSnapshot(channel);
                        if (snapshot.data) {
                            const snapshotBytes = new Uint8Array(Buffer.from(snapshot.data, 'base64'));
                            Y.applyUpdate(state.ydoc, snapshotBytes);
                            this.logger.info(`Hydrated Y.Doc for channel ${channel} from DynamoDB snapshot`);
                            // Warm the Redis cache with the DynamoDB snapshot
                            await this._saveSnapshotToRedis(channel, snapshot.data);
                        }
                    } catch (snapshotError) {
                        // Non-fatal: Y.Doc starts empty if snapshot retrieval fails
                        this.logger.error(`Failed to hydrate Y.Doc for ${channel}:`, snapshotError.message);
                    }
                }
            }
            state.subscriberCount++;

            // Send confirmation to client
            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'subscribed',
                channel,
                timestamp: new Date().toISOString()
            });

            // Push current state to client on subscribe (CRDT-02: reconnect recovery)
            // Send differential sync from in-memory Y.Doc (faster than DynamoDB round-trip)
            try {
                const stateUpdate = Y.encodeStateAsUpdate(state.ydoc);
                if (stateUpdate.byteLength > 0) {
                    this.sendToClient(clientId, {
                        type: 'crdt:snapshot',
                        channel,
                        snapshot: Buffer.from(stateUpdate).toString('base64'),
                        timestamp: new Date().toISOString(),
                    });
                    this.logger.info(`Y.Doc state pushed to client ${clientId} for channel ${channel}`);
                }
            } catch (syncError) {
                // Non-fatal: client starts with empty doc if sync fails
                this.logger.error(`Failed to push Y.Doc state for ${channel} to ${clientId}:`, syncError.message);
            }

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
                    ydoc: new Y.Doc(),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);
            }

            // Apply update to the channel's Y.Doc (proper CRDT merge)
            const updateBytes = new Uint8Array(Buffer.from(update, 'base64'));
            Y.applyUpdate(state.ydoc, updateBytes);
            state.operationsSinceSnapshot++;

            // Check if we should trigger immediate snapshot (after 50 operations)
            if (state.operationsSinceSnapshot >= 50) {
                await this.writeSnapshot(channel);
            } else {
                // Schedule a debounced snapshot write (after 5s of inactivity)
                this._scheduleDebouncedSnapshot(channel);
            }

            // Update Redis hot-cache with latest state (non-blocking)
            const latestState = Y.encodeStateAsUpdate(state.ydoc);
            if (latestState.byteLength > 0) {
                this._saveSnapshotToRedis(channel, Buffer.from(latestState).toString('base64'))
                    .catch(err => this.logger.error(`Non-blocking Redis cache update failed for ${channel}:`, err.message));
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

    async handleGetSnapshot(clientId, { channel }) {
        // Validate channel
        if (!channel || typeof channel !== 'string') {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        // Check authorization
        try {
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

            // Retrieve latest snapshot
            const snapshot = await this.retrieveLatestSnapshot(channel);

            // Send response
            this.sendToClient(clientId, {
                type: 'crdt:snapshot',
                channel,
                snapshot: snapshot.data, // base64 string or null
                timestamp: snapshot.timestamp, // epoch milliseconds or null
                age: snapshot.timestamp ? Date.now() - snapshot.timestamp : null // for debugging
            });

            this.logger.debug(`Snapshot retrieved for channel ${channel}, timestamp: ${snapshot.timestamp}`);
        } catch (error) {
            this.logger.error(`Error handling getSnapshot for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to retrieve snapshot');
        }
    }

    /**
     * Relay awareness updates to all other channel subscribers (no persistence)
     * Awareness carries ephemeral state like cursor positions, user names, online status.
     */
    async handleAwareness(clientId, { channel, update }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        if (!update || typeof update !== 'string') {
            this.sendError(clientId, 'Awareness update must be a base64 string');
            return;
        }

        try {
            // Relay awareness to all other subscribers — no persistence, no batching
            await this.messageRouter.sendToChannel(channel, {
                type: 'crdt:awareness',
                channel,
                update  // base64 awareness state
            }, clientId);  // exclude sender

            this.logger.debug(`Awareness relayed for channel ${channel} from client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error relaying awareness for channel ${channel}:`, error);
        }
    }

    async retrieveLatestSnapshot(channelId) {
        try {
            const command = new QueryCommand({
                TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                KeyConditionExpression: 'documentId = :docId',
                ExpressionAttributeValues: {
                    ':docId': { S: channelId }
                },
                ScanIndexForward: false, // Descending order (newest first)
                Limit: 1,
                ProjectionExpression: '#snap, #ts',
                ExpressionAttributeNames: {
                    '#ts': 'timestamp',
                    '#snap': 'snapshot'
                }
            });

            const result = await this.dynamoClient.send(command);

            if (!result.Items || result.Items.length === 0) {
                // No snapshot exists - new document
                return { data: null, timestamp: null };
            }

            // Extract snapshot binary and timestamp
            const item = result.Items[0];
            const compressedSnapshot = item.snapshot.B; // Binary data
            const timestamp = parseInt(item.timestamp.N, 10);

            // Decompress gzip
            const decompressed = await gunzip(Buffer.from(compressedSnapshot));

            // Encode as base64 for WebSocket transmission
            const base64Snapshot = decompressed.toString('base64');

            return { data: base64Snapshot, timestamp };

        } catch (error) {
            // Graceful degradation: log error, return null
            this.logger.error(`Failed to retrieve snapshot for ${channelId}:`, error.message);
            return { data: null, timestamp: null };
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
            // Decode each base64 operation update into a Uint8Array buffer
            const buffers = batch.operations.map(op => new Uint8Array(Buffer.from(op.update, 'base64')));

            // Merge all operation buffers into a single Y.js update
            const merged = buffers.length === 1 ? buffers[0] : mergeUpdates(buffers);
            const mergedBase64 = Buffer.from(merged).toString('base64');

            const message = {
                type: 'crdt:update',
                channel,
                update: mergedBase64
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
     * Publish snapshot checkpoint to EventBridge (decoupled persistence via crdt-snapshot Lambda)
     */
    async writeSnapshot(channelId) {
        const state = this.channelStates.get(channelId);
        if (!state || !state.ydoc) {
            return; // No snapshot to write
        }

        try {
            // Encode full state from Y.Doc and gzip compress (Lambda consumer stores compressed)
            const stateUpdate = Y.encodeStateAsUpdate(state.ydoc);
            if (stateUpdate.byteLength === 0) {
                return; // Empty doc, nothing to persist
            }

            // Always update Redis hot-cache with uncompressed base64
            const stateBase64 = Buffer.from(stateUpdate).toString('base64');
            await this._saveSnapshotToRedis(channelId, stateBase64);

            const compressed = await gzip(Buffer.from(stateUpdate));

            // Direct DynamoDB write path (bypasses EventBridge + Lambda)
            if (process.env.DIRECT_DYNAMO_WRITE === 'true') {
                const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
                await this.dynamoClient.send(new PutItemCommand({
                    TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                    Item: {
                        documentId: { S: channelId },
                        timestamp: { N: String(Date.now()) },
                        snapshot: { B: compressed },
                        ttl: { N: String(ttl) },
                    }
                }));
                state.operationsSinceSnapshot = 0;
                this.logger.info(`Snapshot written directly to DynamoDB for channel ${channelId}`);
                return;
            }

            const snapshotBase64 = compressed.toString('base64');

            const response = await this.eventBridgeClient.send(new PutEventsCommand({
                Entries: [{
                    Source: 'crdt-service',
                    DetailType: 'crdt.checkpoint',
                    Detail: JSON.stringify({
                        channelId,
                        snapshotData: snapshotBase64,
                        timestamp: new Date().toISOString()
                    }),
                    EventBusName: this.eventBusName,
                }]
            }));

            if (response.FailedEntryCount && response.FailedEntryCount > 0) {
                const failed = (response.Entries || []).filter(e => e.ErrorCode);
                this.logger.error(`EventBridge rejected crdt.checkpoint for channel ${channelId}:`, failed);
            }

            // Reset operation counter
            state.operationsSinceSnapshot = 0;

            this.logger.info(`Snapshot published to EventBridge for channel ${channelId}`);
        } catch (error) {
            // Log-and-continue: publish failure must not crash the gateway
            this.logger.error(`Failed to publish snapshot for ${channelId}:`, error.message);
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
     * List recent snapshots for a channel (version history)
     */
    async handleListSnapshots(clientId, { channel, limit = 20 }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
            const command = new QueryCommand({
                TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                KeyConditionExpression: 'documentId = :docId',
                ExpressionAttributeValues: {
                    ':docId': { S: channel }
                },
                ScanIndexForward: false, // Newest first
                Limit: limit,
                ProjectionExpression: 'documentId, #ts',
                ExpressionAttributeNames: {
                    '#ts': 'timestamp'
                }
            });

            const result = await this.dynamoClient.send(command);
            const now = Date.now();
            const snapshots = (result.Items || []).map(item => {
                const timestamp = parseInt(item.timestamp.N, 10);
                return { timestamp, age: now - timestamp };
            });

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'snapshotList',
                channel,
                snapshots,
            });

            this.logger.info(`Listed ${snapshots.length} snapshots for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error listing snapshots for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to list snapshots');
        }
    }

    /**
     * Retrieve a specific snapshot by timestamp (version)
     */
    async handleGetSnapshotAtVersion(clientId, { channel, timestamp }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        if (!timestamp || typeof timestamp !== 'number') {
            this.sendError(clientId, 'Timestamp is required and must be a number');
            return;
        }

        try {
            const command = new QueryCommand({
                TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                KeyConditionExpression: 'documentId = :docId AND #ts = :ts',
                ExpressionAttributeValues: {
                    ':docId': { S: channel },
                    ':ts': { N: String(timestamp) }
                },
                ExpressionAttributeNames: {
                    '#ts': 'timestamp'
                },
                Limit: 1,
            });

            const result = await this.dynamoClient.send(command);

            if (!result.Items || result.Items.length === 0) {
                this.sendError(clientId, 'Snapshot not found for the given timestamp');
                return;
            }

            const item = result.Items[0];
            const compressedSnapshot = item.snapshot.B;
            const decompressed = await gunzip(Buffer.from(compressedSnapshot));
            const base64 = decompressed.toString('base64');

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'snapshot',
                channel,
                update: base64,
                version: true,
                versionTimestamp: timestamp,
            });

            this.logger.info(`Retrieved snapshot at version ${timestamp} for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error retrieving snapshot at version for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to retrieve snapshot at version');
        }
    }

    /**
     * Restore a historical snapshot as the current channel state
     */
    async handleRestoreSnapshot(clientId, { channel, timestamp }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        if (!timestamp || typeof timestamp !== 'number') {
            this.sendError(clientId, 'Timestamp is required and must be a number');
            return;
        }

        try {
            // Load the historical snapshot from DynamoDB
            const command = new QueryCommand({
                TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                KeyConditionExpression: 'documentId = :docId AND #ts = :ts',
                ExpressionAttributeValues: {
                    ':docId': { S: channel },
                    ':ts': { N: String(timestamp) }
                },
                ExpressionAttributeNames: {
                    '#ts': 'timestamp'
                },
                Limit: 1,
            });

            const result = await this.dynamoClient.send(command);

            if (!result.Items || result.Items.length === 0) {
                this.sendError(clientId, 'Snapshot not found for the given timestamp');
                return;
            }

            // Decompress to get raw Y.js update bytes
            const item = result.Items[0];
            const compressedSnapshot = item.snapshot.B;
            const decompressed = await gunzip(Buffer.from(compressedSnapshot));
            const historicalUpdate = new Uint8Array(decompressed);

            // Get or create the channel state
            let state = this.channelStates.get(channel);
            if (!state) {
                state = {
                    ydoc: new Y.Doc(),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);
            }

            // Create a fresh Y.Doc and apply the historical update
            const freshDoc = new Y.Doc();
            Y.applyUpdate(freshDoc, historicalUpdate);
            const fullState = Y.encodeStateAsUpdate(freshDoc);

            // Replace the live channel's Y.Doc
            state.ydoc.destroy();
            state.ydoc = freshDoc;

            // Broadcast restored state to all channel subscribers
            const base64State = Buffer.from(fullState).toString('base64');
            await this.messageRouter.sendToChannel(channel, {
                type: 'crdt',
                action: 'snapshot',
                channel,
                update: base64State,
                restored: true,
                restoredTimestamp: timestamp,
            });

            // Write a new snapshot for the restored state
            await this.writeSnapshot(channel);

            this.logger.info(`Restored snapshot at version ${timestamp} for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error restoring snapshot for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to restore snapshot');
        }
    }

    /**
     * Clear all document content — replaces the in-memory Y.Doc with a fresh
     * empty one and broadcasts the empty state to all subscribers.
     */
    async handleClearDocument(clientId, { channel }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
            let state = this.channelStates.get(channel);
            if (!state) {
                state = {
                    ydoc: new Y.Doc(),
                    operationsSinceSnapshot: 0,
                    subscriberCount: 0
                };
                this.channelStates.set(channel, state);
            }

            // Replace the live Y.Doc with a fresh empty one
            const freshDoc = new Y.Doc({ gc: false });
            state.ydoc.destroy();
            state.ydoc = freshDoc;
            state.operationsSinceSnapshot = 0;

            // Broadcast empty state to all subscribers
            const emptyState = Y.encodeStateAsUpdate(freshDoc);
            const base64 = Buffer.from(emptyState).toString('base64');
            await this.messageRouter.sendToChannel(channel, {
                type: 'crdt',
                action: 'snapshot',
                channel,
                update: base64,
                cleared: true,
            });

            // Write the empty snapshot to DynamoDB
            await this.writeSnapshot(channel);

            // Send confirmation to the requesting client
            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentCleared',
                channel,
                timestamp: new Date().toISOString(),
            });

            this.logger.info(`Document cleared for channel ${channel} by client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error clearing document for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to clear document');
        }
    }

    // -----------------------------------------------------------------
    // Document metadata CRUD helpers
    // -----------------------------------------------------------------

    /**
     * List all documents, returning metadata for each.
     */
    async handleListDocuments(clientId, _data) {
        try {
            let documents = [];

            if (this._isRedisAvailable()) {
                // Read document IDs from sorted set (newest first)
                const docIds = await this.redisClient.zRange('doc:list', 0, -1, { REV: true });
                if (docIds && docIds.length > 0) {
                    const metas = await Promise.all(
                        docIds.map(id => this.redisClient.get(`doc:meta:${id}`))
                    );
                    documents = metas
                        .filter(Boolean)
                        .map(raw => JSON.parse(raw));
                }
            } else {
                // In-memory fallback
                documents = [...this.docMetaFallback.values()]
                    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            }

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentList',
                documents,
            });

            this.logger.info(`Listed ${documents.length} documents for client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error listing documents for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to list documents');
        }
    }

    /**
     * Create a new document with metadata stored in Redis (or in-memory fallback).
     */
    async handleCreateDocument(clientId, data) {
        try {
            const meta = data.meta || {};
            if (!meta.title || typeof meta.title !== 'string' || meta.title.trim().length === 0) {
                this.sendError(clientId, 'Document title is required');
                return;
            }

            const documentId = crypto.randomUUID();
            const now = new Date().toISOString();
            const docType = meta.type || 'custom';

            // Resolve creator info from client context
            let createdBy = 'unknown';
            try {
                const clientData = this.messageRouter.getClientData(clientId);
                if (clientData && clientData.userContext) {
                    createdBy = clientData.userContext.userId || clientData.userContext.sub || 'unknown';
                }
            } catch (_) { /* use default */ }

            const document = {
                id: documentId,
                title: meta.title.trim(),
                type: docType,
                status: 'draft',
                createdBy,
                createdAt: now,
                updatedAt: now,
                icon: meta.icon || this.TYPE_ICONS[docType] || this.TYPE_ICONS.custom,
                description: meta.description || '',
            };

            if (this._isRedisAvailable()) {
                await this.redisClient.set(`doc:meta:${documentId}`, JSON.stringify(document));
                await this.redisClient.zAdd('doc:list', { score: Date.now(), value: documentId });

                // Broadcast to activity channel so other users see the new doc
                try {
                    await this.redisClient.publish('activity:broadcast', JSON.stringify({
                        type: 'activity',
                        event: 'doc.created',
                        documentId,
                        title: document.title,
                        createdBy,
                        timestamp: now,
                    }));
                } catch (pubErr) {
                    this.logger.error('Failed to publish doc.created activity:', pubErr.message);
                }
            } else {
                // In-memory fallback
                this.docMetaFallback.set(documentId, document);
                this.docListFallback.push({ id: documentId, updatedAt: Date.now() });
                this.docListFallback.sort((a, b) => b.updatedAt - a.updatedAt);
            }

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentCreated',
                document,
            });

            this.logger.info(`Document created: ${documentId} (${document.title}) by client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error creating document for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to create document');
        }
    }

    /**
     * Delete a document and clean up its CRDT channel state.
     */
    async handleDeleteDocument(clientId, data) {
        try {
            const { documentId } = data;
            if (!documentId || typeof documentId !== 'string') {
                this.sendError(clientId, 'documentId is required');
                return;
            }

            if (this._isRedisAvailable()) {
                await this.redisClient.del(`doc:meta:${documentId}`);
                await this.redisClient.zRem('doc:list', documentId);
            } else {
                this.docMetaFallback.delete(documentId);
                this.docListFallback = this.docListFallback.filter(e => e.id !== documentId);
            }

            // Clean up in-memory CRDT channel state if it exists
            const channelKey = `doc:${documentId}`;
            const state = this.channelStates.get(channelKey);
            if (state) {
                if (state.ydoc) {
                    state.ydoc.destroy();
                }
                this.channelStates.delete(channelKey);
            }

            // Also remove snapshot debounce timer if pending
            const debounceTimer = this.snapshotDebounceTimers.get(channelKey);
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                this.snapshotDebounceTimers.delete(channelKey);
            }

            // Remove Redis snapshot cache if available
            if (this._isRedisAvailable()) {
                try {
                    await this.redisClient.del(`crdt:snapshot:${channelKey}`);
                } catch (_) { /* best effort */ }
            }

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentDeleted',
                documentId,
            });

            this.logger.info(`Document deleted: ${documentId} by client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error deleting document ${data.documentId} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to delete document');
        }
    }

    /**
     * Update metadata fields on an existing document.
     */
    async handleUpdateDocumentMeta(clientId, data) {
        try {
            const { documentId, meta } = data;
            if (!documentId || typeof documentId !== 'string') {
                this.sendError(clientId, 'documentId is required');
                return;
            }
            if (!meta || typeof meta !== 'object') {
                this.sendError(clientId, 'meta object is required');
                return;
            }

            let existing = null;

            if (this._isRedisAvailable()) {
                const raw = await this.redisClient.get(`doc:meta:${documentId}`);
                if (!raw) {
                    this.sendError(clientId, 'Document not found');
                    return;
                }
                existing = JSON.parse(raw);
            } else {
                existing = this.docMetaFallback.get(documentId);
                if (!existing) {
                    this.sendError(clientId, 'Document not found');
                    return;
                }
                existing = { ...existing }; // shallow copy for safe merge
            }

            // Merge only allowed fields
            const allowedFields = ['title', 'status', 'description', 'icon', 'type'];
            for (const field of allowedFields) {
                if (meta[field] !== undefined) {
                    existing[field] = meta[field];
                }
            }
            existing.updatedAt = new Date().toISOString();

            if (this._isRedisAvailable()) {
                await this.redisClient.set(`doc:meta:${documentId}`, JSON.stringify(existing));
                await this.redisClient.zAdd('doc:list', { score: Date.now(), value: documentId });
            } else {
                this.docMetaFallback.set(documentId, existing);
                const entry = this.docListFallback.find(e => e.id === documentId);
                if (entry) entry.updatedAt = Date.now();
                this.docListFallback.sort((a, b) => b.updatedAt - a.updatedAt);
            }

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentMetaUpdated',
                document: existing,
            });

            this.logger.info(`Document metadata updated: ${documentId} by client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error updating document meta ${data.documentId} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to update document metadata');
        }
    }

    /**
     * Return aggregated presence for all document channels.
     * Iterates channelStates and extracts awareness data for channels starting with 'doc:'.
     */
    async handleGetDocumentPresence(clientId, _data) {
        try {
            const presence = {};

            for (const [channelId, state] of this.channelStates.entries()) {
                if (!channelId.startsWith('doc:')) continue;

                // Extract awareness states from the Y.Doc if any awareness data exists
                const users = [];

                // The message router tracks which clients are subscribed to which channels.
                // We can pull client metadata to build a presence list.
                if (this.messageRouter && typeof this.messageRouter.getChannelClients === 'function') {
                    const clientIds = this.messageRouter.getChannelClients(channelId);
                    if (clientIds) {
                        for (const cid of clientIds) {
                            try {
                                const cd = this.messageRouter.getClientData(cid);
                                if (cd && cd.userContext) {
                                    users.push({
                                        userId: cd.userContext.userId || cd.userContext.sub || cid,
                                        displayName: cd.userContext.displayName || cd.userContext.email || 'Anonymous',
                                        color: cd.userContext.color || null,
                                        mode: 'editing',
                                    });
                                }
                            } catch (_) { /* skip */ }
                        }
                    }
                }

                if (users.length > 0) {
                    presence[channelId] = users;
                }
            }

            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'documentPresence',
                presence,
            });

            this.logger.debug(`Document presence sent to client ${clientId}: ${Object.keys(presence).length} channels`);
        } catch (error) {
            this.logger.error(`Error getting document presence for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to get document presence');
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

        // Clear debounce timers and flush pending snapshots
        for (const [channelId, timer] of this.snapshotDebounceTimers.entries()) {
            clearTimeout(timer);
            // Write final snapshot for channels with pending operations
            const state = this.channelStates.get(channelId);
            if (state && state.operationsSinceSnapshot > 0) {
                try {
                    await this.writeSnapshot(channelId);
                } catch (err) {
                    this.logger.error(`Failed to write final snapshot for ${channelId} during shutdown:`, err.message);
                }
            }
        }
        this.snapshotDebounceTimers.clear();

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
