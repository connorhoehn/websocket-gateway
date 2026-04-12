// services/crdt-service.js
/**
 * CRDT Service - Handles Y.js CRDT operation broadcasting
 * Provides low-latency (<50ms) operation broadcasting via Redis pub/sub
 */

const crypto = require('crypto');
const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, DeleteItemCommand, CreateTableCommand, DescribeTableCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
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

        // Awareness coalescing: buffer awareness updates per channel for 50ms,
        // then broadcast a single merged payload instead of one per client.
        this.awarenessBatches = new Map(); // channelId -> { updates: Map<clientId, update>, timeout: null }
        this.AWARENESS_BATCH_WINDOW_MS = 50;

        // Debounced snapshot timers per channel (write after 5s of inactivity)
        this.snapshotDebounceTimers = new Map(); // channelId -> timeout
        this.SNAPSHOT_DEBOUNCE_MS = parseInt(process.env.SNAPSHOT_DEBOUNCE_MS || '5000', 10);

        // Idle Y.Doc eviction: when a channel has 0 subscribers, start a 10-min timer.
        // After 10 minutes, write a final snapshot and evict the Y.Doc from memory.
        this.idleEvictionTimers = new Map(); // channelId -> timeout
        this.IDLE_EVICTION_MS = parseInt(process.env.IDLE_EVICTION_MS || '600000', 10); // 10 minutes

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

        // DynamoDB table names
        this.snapshotsTableName = process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots';
        this.documentsTableName = process.env.DYNAMODB_DOCUMENTS_TABLE || 'crdt-documents';

        // Ensure DynamoDB tables exist in local dev
        if (process.env.DIRECT_DYNAMO_WRITE === 'true') {
            this._ensureTable().catch(err => this.logger.error('Failed to ensure DynamoDB table:', err.message));
            this._ensureDocumentsTable().catch(err => this.logger.error('Failed to ensure DynamoDB documents table:', err.message));
        }

        // Register SIGTERM/SIGINT handlers to flush dirty snapshots before exit
        this._registerShutdownHandlers();

        // Document metadata: in-memory fallback when Redis is unavailable
        this.docMetaFallback = new Map(); // documentId -> meta object
        this.docListFallback = [];        // sorted array of { id, updatedAt }

        // Register interceptor to apply remote CRDT updates to local Y.Doc
        // This prevents cross-node divergence where remote updates were only relayed
        // to WebSocket clients but not applied to the in-memory Y.Doc.
        if (this.messageRouter && typeof this.messageRouter.onRemoteChannelMessage === 'function') {
            this.messageRouter.onRemoteChannelMessage('crdt-sync', (channel, message, _fromNode) => {
                if (message && message.type === 'crdt:update' && message.update) {
                    const state = this.channelStates.get(channel);
                    if (state && state.ydoc) {
                        try {
                            const updateBytes = new Uint8Array(Buffer.from(message.update, 'base64'));
                            // Apply remote update to local Y.Doc without re-broadcasting
                            // (the message router already relayed it to local clients)
                            Y.applyUpdate(state.ydoc, updateBytes);
                            state.operationsSinceSnapshot++;
                            this._scheduleDebouncedSnapshot(channel);
                            this.logger.debug(`Applied remote CRDT update to local Y.Doc for channel ${channel}`);
                        } catch (err) {
                            this.logger.error(`Failed to apply remote CRDT update for ${channel}:`, err.message);
                        }
                    }
                }
            });
        }

        // Push-based document presence tracking
        // documentPresenceMap: Map<channelId, Map<clientId, {userId, displayName, color, idle}>>
        this.documentPresenceMap = new Map();
        // clientDocChannels: Map<clientId, Set<channelId>> — reverse index for disconnect cleanup
        this.clientDocChannels = new Map();

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

    async _ensureDocumentsTable() {
        try {
            await this.dynamoClient.send(new DescribeTableCommand({ TableName: this.documentsTableName }));
            this.logger.info(`DynamoDB table ${this.documentsTableName} exists`);
        } catch (err) {
            if (err.name === 'ResourceNotFoundException') {
                this.logger.info(`Creating DynamoDB table ${this.documentsTableName}...`);
                await this.dynamoClient.send(new CreateTableCommand({
                    TableName: this.documentsTableName,
                    AttributeDefinitions: [
                        { AttributeName: 'documentId', AttributeType: 'S' },
                    ],
                    KeySchema: [
                        { AttributeName: 'documentId', KeyType: 'HASH' },
                    ],
                    BillingMode: 'PAY_PER_REQUEST',
                }));
                this.logger.info(`DynamoDB table ${this.documentsTableName} created`);
            } else {
                this.logger.error(`Error checking DynamoDB documents table:`, err.message);
            }
        }
    }

    /**
     * Register SIGTERM/SIGINT handlers to flush all dirty Y.Doc snapshots
     * before the process exits (e.g. rolling deploy pod restart).
     */
    _registerShutdownHandlers() {
        const flushAndExit = async (signal) => {
            this.logger.info(`${signal} received — flushing dirty CRDT snapshots before exit`);
            const promises = [];
            for (const [channelId, state] of this.channelStates.entries()) {
                if (state && state.operationsSinceSnapshot > 0) {
                    promises.push(
                        this.writeSnapshot(channelId).catch(err =>
                            this.logger.error(`Failed to flush snapshot for ${channelId} on ${signal}:`, err.message)
                        )
                    );
                }
            }
            if (promises.length > 0) {
                await Promise.allSettled(promises);
                this.logger.info(`Flushed ${promises.length} dirty snapshots on ${signal}`);
            }
            // NOTE: we don't call process.exit() here — the server.js handlers do that.
        };

        process.on('SIGTERM', () => flushAndExit('SIGTERM'));
        process.on('SIGINT', () => flushAndExit('SIGINT'));
    }

    // -----------------------------------------------------------------
    // DynamoDB document metadata persistence helpers
    // -----------------------------------------------------------------

    /**
     * Persist document metadata to DynamoDB (crdt-documents table).
     * Called alongside Redis writes so metadata survives Redis restarts.
     */
    async _persistDocumentMeta(document) {
        try {
            const item = {
                documentId: { S: document.id },
                title: { S: document.title },
                type: { S: document.type || 'custom' },
                status: { S: document.status || 'draft' },
                createdBy: { S: document.createdBy || 'unknown' },
                createdAt: { S: document.createdAt },
                updatedAt: { S: document.updatedAt },
            };
            // Optional fields
            if (document.icon) item.icon = { S: document.icon };
            if (document.description) item.description = { S: document.description };

            await this.dynamoClient.send(new PutItemCommand({
                TableName: this.documentsTableName,
                Item: item,
            }));
            this.logger.debug(`Document metadata persisted to DynamoDB: ${document.id}`);
        } catch (err) {
            this.logger.error(`Failed to persist document metadata to DynamoDB for ${document.id}:`, err.message);
        }
    }

    /**
     * Load a single document metadata from DynamoDB.
     */
    async _loadDocumentMetaFromDynamo(documentId) {
        try {
            const result = await this.dynamoClient.send(new GetItemCommand({
                TableName: this.documentsTableName,
                Key: { documentId: { S: documentId } },
            }));
            if (!result.Item) return null;
            return this._dynamoItemToDocument(result.Item);
        } catch (err) {
            this.logger.error(`Failed to load document meta from DynamoDB for ${documentId}:`, err.message);
            return null;
        }
    }

    /**
     * Load all document metadata from DynamoDB (used to hydrate Redis on startup).
     */
    async _loadAllDocumentsFromDynamo() {
        try {
            const result = await this.dynamoClient.send(new ScanCommand({
                TableName: this.documentsTableName,
            }));
            if (!result.Items || result.Items.length === 0) return [];
            return result.Items.map(item => this._dynamoItemToDocument(item));
        } catch (err) {
            this.logger.error('Failed to scan documents from DynamoDB:', err.message);
            return [];
        }
    }

    /**
     * Convert a DynamoDB item to a plain document metadata object.
     */
    _dynamoItemToDocument(item) {
        return {
            id: item.documentId.S,
            title: item.title ? item.title.S : 'Untitled',
            type: item.type ? item.type.S : 'custom',
            status: item.status ? item.status.S : 'draft',
            createdBy: item.createdBy ? item.createdBy.S : 'unknown',
            createdAt: item.createdAt ? item.createdAt.S : new Date().toISOString(),
            updatedAt: item.updatedAt ? item.updatedAt.S : new Date().toISOString(),
            icon: item.icon ? item.icon.S : '',
            description: item.description ? item.description.S : '',
        };
    }

    /**
     * Delete document metadata from DynamoDB.
     */
    async _deleteDocumentMetaFromDynamo(documentId) {
        try {
            await this.dynamoClient.send(new DeleteItemCommand({
                TableName: this.documentsTableName,
                Key: { documentId: { S: documentId } },
            }));
            this.logger.debug(`Document metadata deleted from DynamoDB: ${documentId}`);
        } catch (err) {
            this.logger.error(`Failed to delete document metadata from DynamoDB for ${documentId}:`, err.message);
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
                case 'saveVersion':
                    return await this.handleSaveVersion(clientId, data);
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

            // Cancel idle eviction timer if someone is subscribing
            this._cancelIdleEviction(channel);

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

            // Track document presence and broadcast to all clients
            this._addToDocumentPresence(clientId, channel);

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

                // If last client is unsubscribing, write final snapshot and start eviction timer
                if (state.subscriberCount <= 0) {
                    state.subscriberCount = 0; // clamp
                    if (state.operationsSinceSnapshot > 0) {
                        await this.writeSnapshot(channel);
                    }
                    // Start idle eviction timer — Y.Doc will be evicted after 10 minutes
                    this._startIdleEviction(channel);
                }
            }

            await this.messageRouter.unsubscribeFromChannel(clientId, channel);

            // Remove from document presence and broadcast
            this._removeFromDocumentPresence(clientId, channel);

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
     * Relay awareness updates to all other channel subscribers (no persistence).
     * Awareness carries ephemeral state like cursor positions, user names, online status.
     *
     * Updates are coalesced in a 50ms window: multiple clients' awareness updates
     * for the same channel are buffered and broadcast as a single merged message,
     * reducing Redis pub/sub volume significantly at scale.
     */
    async handleAwareness(clientId, { channel, update, idle }) {
        this.logger.info(`[awareness-entry] client=${clientId} channel=${channel} hasUpdate=${!!update} idle=${idle} isDoc=${channel?.startsWith?.('doc:')}`);
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        if (!update || typeof update !== 'string') {
            this.sendError(clientId, 'Awareness update must be a base64 string');
            return;
        }

        try {
            // Backfill presence map if this client isn't tracked yet (e.g. after pod restart)
            if (channel.startsWith('doc:')) {
                const channelMap = this.documentPresenceMap.get(channel);
                if (!channelMap || !channelMap.has(clientId)) {
                    this.logger.info(`[presence-backfill] Adding ${clientId} to presence for ${channel}`);
                    this._addToDocumentPresence(clientId, channel);
                    this.logger.info(`[presence-backfill] documentPresenceMap size: ${this.documentPresenceMap.size}, channel entries: ${this.documentPresenceMap.get(channel)?.size ?? 0}`);
                }

                // Update idle state if provided
                if (typeof idle === 'boolean') {
                    const updatedMap = this.documentPresenceMap.get(channel);
                    if (updatedMap) {
                        const userInfo = updatedMap.get(clientId);
                        if (userInfo && userInfo.idle !== idle) {
                            userInfo.idle = idle;
                            this._broadcastDocumentPresence();
                        }
                    }
                }
            }

            // Buffer awareness update for coalescing
            let batch = this.awarenessBatches.get(channel);
            if (!batch) {
                batch = { updates: new Map(), timeout: null };
                this.awarenessBatches.set(channel, batch);
            }

            // Store latest update per client (overwrites previous — only latest matters)
            batch.updates.set(clientId, update);

            // Schedule broadcast if not already scheduled
            if (!batch.timeout) {
                batch.timeout = setTimeout(() => {
                    this._flushAwarenessBatch(channel);
                }, this.AWARENESS_BATCH_WINDOW_MS);
            }

            this.logger.debug(`Awareness buffered for channel ${channel} from client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error buffering awareness for channel ${channel}:`, error);
        }
    }

    /**
     * Flush coalesced awareness updates for a channel.
     * Broadcasts a single message containing all buffered client awareness states.
     */
    async _flushAwarenessBatch(channel) {
        const batch = this.awarenessBatches.get(channel);
        if (!batch || batch.updates.size === 0) {
            this.awarenessBatches.delete(channel);
            return;
        }

        try {
            // Build merged awareness payload: array of { clientId, update }
            const merged = [];
            for (const [cid, upd] of batch.updates) {
                merged.push({ clientId: cid, update: upd });
            }

            // Broadcast merged awareness to channel (exclude no one — each entry
            // already identifies its source client so the frontend can skip self)
            await this.messageRouter.sendToChannel(channel, {
                type: 'crdt:awareness',
                channel,
                updates: merged  // array of {clientId, update} for merged broadcast
            });

            this.logger.debug(`Awareness flushed for channel ${channel}: ${merged.length} client(s)`);
        } catch (error) {
            this.logger.error(`Error flushing awareness batch for channel ${channel}:`, error);
        } finally {
            this.awarenessBatches.delete(channel);
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
     * Compute TTL (epoch seconds) based on version type.
     * - 'manual' (named versions): no TTL (kept indefinitely)
     * - 'pre-restore': 90-day TTL
     * - 'auto' / 'pre-clear' / default: 30-day TTL
     */
    _computeTtl(versionType) {
        const nowSec = Math.floor(Date.now() / 1000);
        switch (versionType) {
            case 'manual':
                return null; // No TTL — kept indefinitely
            case 'pre-restore':
                return nowSec + (90 * 24 * 60 * 60); // 90 days
            case 'pre-clear':
                return nowSec + (90 * 24 * 60 * 60); // 90 days
            default: // 'auto' and anything else
                return nowSec + (30 * 24 * 60 * 60); // 30 days
        }
    }

    /**
     * Publish snapshot checkpoint to EventBridge (decoupled persistence via crdt-snapshot Lambda)
     * @param {string} channelId
     * @param {Object} [meta] - Optional version metadata
     * @param {string} [meta.author] - userId/displayName of who triggered the save, or 'auto'
     * @param {string} [meta.name] - Optional user-provided version name
     * @param {string} [meta.type] - 'auto' | 'manual' | 'pre-restore' | 'pre-clear'
     */
    async writeSnapshot(channelId, meta = {}) {
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

            // Version metadata defaults
            const versionType = meta.type || 'auto';
            const author = meta.author || 'auto';
            const versionName = meta.name || null;
            const sizeBytes = compressed.length;

            // Direct DynamoDB write path (bypasses EventBridge + Lambda)
            if (process.env.DIRECT_DYNAMO_WRITE === 'true') {
                const item = {
                    channelId: { S: channelId },
                    timestamp: { N: String(Date.now()) },
                    snapshot: { B: compressed },
                    versionType: { S: versionType },
                    author: { S: author },
                    sizeBytes: { N: String(sizeBytes) },
                };

                // TTL based on version type
                const ttl = this._computeTtl(versionType);
                if (ttl !== null) {
                    item.ttl = { N: String(ttl) };
                }

                // Optional version name (only set when provided)
                if (versionName) {
                    item.versionName = { S: versionName };
                }

                await this.dynamoClient.send(new PutItemCommand({
                    TableName: process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots',
                    Item: item,
                }));
                state.operationsSinceSnapshot = 0;
                this.logger.info(`Snapshot written directly to DynamoDB for channel ${channelId} (type=${versionType}, author=${author})`);
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
                        timestamp: new Date().toISOString(),
                        versionType,
                        author,
                        versionName,
                        sizeBytes,
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

            this.logger.info(`Snapshot published to EventBridge for channel ${channelId} (type=${versionType}, author=${author})`);
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
                ProjectionExpression: 'documentId, #ts, versionType, author, versionName, sizeBytes',
                ExpressionAttributeNames: {
                    '#ts': 'timestamp'
                }
            });

            const result = await this.dynamoClient.send(command);
            const now = Date.now();
            const snapshots = (result.Items || []).map(item => {
                const timestamp = parseInt(item.timestamp.N, 10);
                return {
                    timestamp,
                    age: now - timestamp,
                    type: item.versionType ? item.versionType.S : 'auto',
                    author: item.author ? item.author.S : 'auto',
                    name: item.versionName ? item.versionName.S : null,
                    sizeBytes: item.sizeBytes ? parseInt(item.sizeBytes.N, 10) : null,
                };
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

            // Pre-restore checkpoint: save current state so the operation is reversible
            try {
                const currentState = Y.encodeStateAsUpdate(state.ydoc);
                if (currentState.byteLength > 0) {
                    // Force a snapshot write of the current state before overwriting
                    state.operationsSinceSnapshot = 1; // Ensure writeSnapshot actually writes
                    await this.writeSnapshot(channel, { type: 'pre-restore', author: 'system' });
                    this.logger.info(`Pre-restore checkpoint saved for channel ${channel}`);
                }
            } catch (checkpointErr) {
                this.logger.error(`Failed to save pre-restore checkpoint for ${channel}:`, checkpointErr.message);
                // Continue with restore even if checkpoint fails
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
            await this.writeSnapshot(channel, { type: 'auto', author: 'system' });

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

            // Pre-clear checkpoint: save current state so the operation is reversible
            try {
                const currentState = Y.encodeStateAsUpdate(state.ydoc);
                if (currentState.byteLength > 0) {
                    state.operationsSinceSnapshot = 1; // Ensure writeSnapshot actually writes
                    await this.writeSnapshot(channel, { type: 'pre-clear', author: 'system' });
                    this.logger.info(`Pre-clear checkpoint saved for channel ${channel}`);
                }
            } catch (checkpointErr) {
                this.logger.error(`Failed to save pre-clear checkpoint for ${channel}:`, checkpointErr.message);
                // Continue with clear even if checkpoint fails
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
            await this.writeSnapshot(channel, { type: 'auto', author: 'system' });

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

    /**
     * Save a named version (manual checkpoint) of the current document state.
     * The snapshot is written immediately with type 'manual' and no TTL.
     */
    async handleSaveVersion(clientId, { channel, name, userId }) {
        if (!this.validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            this.sendError(clientId, 'Version name is required and must be a non-empty string');
            return;
        }

        try {
            const state = this.channelStates.get(channel);
            if (!state || !state.ydoc) {
                this.sendError(clientId, 'No active document found for this channel');
                return;
            }

            const author = userId || 'unknown';

            // Force a snapshot write even if operationsSinceSnapshot is 0
            state.operationsSinceSnapshot = 1;
            await this.writeSnapshot(channel, {
                type: 'manual',
                author,
                name: name.trim(),
            });

            const ts = Date.now();
            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'versionSaved',
                channel,
                name: name.trim(),
                author,
                timestamp: ts,
            });

            this.logger.info(`Named version "${name.trim()}" saved for channel ${channel} by ${author}`);
        } catch (error) {
            this.logger.error(`Error saving named version for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to save named version');
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

                // If Redis is empty, hydrate from DynamoDB (e.g. after Redis restart)
                if (documents.length === 0) {
                    this.logger.info('Redis doc list empty — hydrating from DynamoDB');
                    documents = await this._loadAllDocumentsFromDynamo();
                    // Re-populate Redis cache from DynamoDB
                    for (const doc of documents) {
                        try {
                            await this.redisClient.set(`doc:meta:${doc.id}`, JSON.stringify(doc));
                            await this.redisClient.zAdd('doc:list', {
                                score: new Date(doc.updatedAt).getTime(),
                                value: doc.id,
                            });
                        } catch (cacheErr) {
                            this.logger.error(`Failed to re-cache doc ${doc.id} in Redis:`, cacheErr.message);
                        }
                    }
                    // Sort newest first after hydration
                    documents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
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

            // Persist to DynamoDB so metadata survives Redis restarts
            await this._persistDocumentMeta(document);

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

            // Remove from DynamoDB as well
            await this._deleteDocumentMetaFromDynamo(documentId);

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

            // Persist updated metadata to DynamoDB
            await this._persistDocumentMeta(existing);

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

            // Primary source: in-memory documentPresenceMap (populated by subscribe)
            for (const [channelId, usersMap] of this.documentPresenceMap) {
                const usersByUserId = new Map();
                for (const userInfo of usersMap.values()) {
                    const existing = usersByUserId.get(userInfo.userId);
                    if (!existing || (!userInfo.idle && existing.idle)) {
                        usersByUserId.set(userInfo.userId, userInfo);
                    }
                }
                const users = Array.from(usersByUserId.values());
                if (users.length > 0) {
                    presence[channelId] = users;
                }
            }

            // Fallback: also check channelStates for doc: channels not in the presence map
            // This handles the case where clients reconnected without re-subscribing
            for (const [channelId, state] of this.channelStates) {
                if (!channelId.startsWith('doc:') || presence[channelId]) continue;
                if (state.subscribers && state.subscribers.size > 0) {
                    const users = [];
                    for (const subClientId of state.subscribers) {
                        const cd = this.messageRouter.getClientData(subClientId);
                        const ctx = cd?.userContext || cd?.metadata?.userContext || {};
                        users.push({
                            userId: ctx.userId || ctx.sub || subClientId,
                            displayName: ctx.displayName || ctx.email || subClientId.slice(0, 8),
                            color: ctx.color || '#3b82f6',
                            idle: false,
                        });
                        // Backfill the presence map for future push broadcasts
                        this._addToDocumentPresence(subClientId, channelId);
                    }
                    if (users.length > 0) {
                        presence[channelId] = users;
                    }
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

    // -----------------------------------------------------------------
    // Push-based document presence helpers
    // -----------------------------------------------------------------

    /**
     * Add a client to the document presence map for a doc: channel.
     * Broadcasts updated presence to all connected clients.
     */
    _addToDocumentPresence(clientId, channel) {
        if (!channel.startsWith('doc:')) return;

        const clientData = this.messageRouter.getClientData(clientId);
        const ctx = clientData?.userContext || clientData?.metadata?.userContext || {};

        const userInfo = {
            userId: ctx.userId || ctx.sub || clientId,
            displayName: ctx.displayName || ctx.email || clientId.slice(0, 8),
            color: ctx.color || '#3b82f6',
            idle: false,
        };

        // Add to documentPresenceMap
        if (!this.documentPresenceMap.has(channel)) {
            this.documentPresenceMap.set(channel, new Map());
        }
        this.documentPresenceMap.get(channel).set(clientId, userInfo);

        // Update reverse index
        if (!this.clientDocChannels.has(clientId)) {
            this.clientDocChannels.set(clientId, new Set());
        }
        this.clientDocChannels.get(clientId).add(channel);

        // Broadcast updated presence
        this._broadcastDocumentPresence();
    }

    /**
     * Remove a client from a specific doc: channel's presence map.
     * Broadcasts updated presence to all connected clients.
     */
    _removeFromDocumentPresence(clientId, channel) {
        if (!channel.startsWith('doc:')) return;

        const channelMap = this.documentPresenceMap.get(channel);
        if (channelMap) {
            channelMap.delete(clientId);
            if (channelMap.size === 0) {
                this.documentPresenceMap.delete(channel);
            }
        }

        // Update reverse index
        const channels = this.clientDocChannels.get(clientId);
        if (channels) {
            channels.delete(channel);
            if (channels.size === 0) {
                this.clientDocChannels.delete(clientId);
            }
        }

        // Broadcast updated presence
        this._broadcastDocumentPresence();
    }

    /**
     * Remove a client from ALL document presence maps (on disconnect).
     * Broadcasts updated presence to all connected clients.
     */
    _removeClientFromAllDocPresence(clientId) {
        const channels = this.clientDocChannels.get(clientId);
        if (!channels || channels.size === 0) return;

        for (const channel of channels) {
            const channelMap = this.documentPresenceMap.get(channel);
            if (channelMap) {
                channelMap.delete(clientId);
                if (channelMap.size === 0) {
                    this.documentPresenceMap.delete(channel);
                }
            }
        }
        this.clientDocChannels.delete(clientId);

        // Broadcast updated presence
        this._broadcastDocumentPresence();
    }

    /**
     * Build and broadcast a documents:presence message to all connected clients.
     * Format: { type: 'documents:presence', documents: [{ documentId, users }] }
     */
    _broadcastDocumentPresence() {
        const documents = [];

        for (const [channelId, usersMap] of this.documentPresenceMap) {
            // Deduplicate by userId (same user could have multiple tabs)
            const usersByUserId = new Map();
            for (const userInfo of usersMap.values()) {
                // Keep the most recent entry per userId (last write wins for idle)
                const existing = usersByUserId.get(userInfo.userId);
                if (!existing || (!userInfo.idle && existing.idle)) {
                    usersByUserId.set(userInfo.userId, userInfo);
                }
            }

            documents.push({
                documentId: channelId,
                users: Array.from(usersByUserId.values()),
            });
        }

        const message = {
            type: 'documents:presence',
            documents,
            timestamp: new Date().toISOString(),
        };

        // Broadcast to all connected local clients
        if (this.messageRouter) {
            this.messageRouter.broadcastToLocalClients(message);
        }
    }

    // -----------------------------------------------------------------
    // Idle Y.Doc eviction
    // -----------------------------------------------------------------

    /**
     * Start an idle eviction timer for a channel.
     * After IDLE_EVICTION_MS (default 10 min) with no subscribers, write a final
     * snapshot and evict the Y.Doc from memory to reclaim resources.
     */
    _startIdleEviction(channel) {
        // Don't start a duplicate timer
        if (this.idleEvictionTimers.has(channel)) return;

        const timer = setTimeout(async () => {
            this.idleEvictionTimers.delete(channel);
            const state = this.channelStates.get(channel);
            if (!state) return;

            // Double-check that no subscribers have arrived during the grace period
            if (state.subscriberCount > 0) return;

            try {
                // Write final snapshot if there are pending operations
                if (state.operationsSinceSnapshot > 0) {
                    await this.writeSnapshot(channel);
                    this.logger.info(`Final snapshot written before evicting Y.Doc for channel ${channel}`);
                }

                // Destroy Y.Doc and remove channel state
                if (state.ydoc) {
                    state.ydoc.destroy();
                }
                this.channelStates.delete(channel);

                // Clean up any snapshot debounce timer
                const debounceTimer = this.snapshotDebounceTimers.get(channel);
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    this.snapshotDebounceTimers.delete(channel);
                }

                this.logger.info(`Y.Doc evicted for idle channel ${channel} (no subscribers for ${this.IDLE_EVICTION_MS / 1000}s)`);
            } catch (err) {
                this.logger.error(`Error during idle eviction for channel ${channel}:`, err.message);
            }
        }, this.IDLE_EVICTION_MS);

        this.idleEvictionTimers.set(channel, timer);
        this.logger.debug(`Idle eviction timer started for channel ${channel} (${this.IDLE_EVICTION_MS / 1000}s)`);
    }

    /**
     * Cancel an idle eviction timer for a channel (e.g. when a new subscriber joins).
     */
    _cancelIdleEviction(channel) {
        const timer = this.idleEvictionTimers.get(channel);
        if (timer) {
            clearTimeout(timer);
            this.idleEvictionTimers.delete(channel);
            this.logger.debug(`Idle eviction timer cancelled for channel ${channel}`);
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
    // Alias for server.js handleClientDisconnect which calls service.handleDisconnect()
    async handleDisconnect(clientId) {
        return this.onClientDisconnect(clientId);
    }

    async onClientDisconnect(clientId) {
        // Remove from all document presence maps and broadcast update
        this._removeClientFromAllDocPresence(clientId);
        this.logger.debug(`Client ${clientId} disconnected from CRDT service`);
    }

    // Service lifecycle methods
    async shutdown() {
        // Clear periodic snapshot timer
        if (this.periodicSnapshotTimer) {
            clearInterval(this.periodicSnapshotTimer);
        }

        // Clear all pending CRDT operation batches
        for (const [channel, batch] of this.operationBatches.entries()) {
            if (batch.timeout) {
                clearTimeout(batch.timeout);
            }
        }
        this.operationBatches.clear();

        // Clear all pending awareness batches
        for (const [channel, batch] of this.awarenessBatches.entries()) {
            if (batch.timeout) {
                clearTimeout(batch.timeout);
            }
        }
        this.awarenessBatches.clear();

        // Clear idle eviction timers
        for (const [channel, timer] of this.idleEvictionTimers.entries()) {
            clearTimeout(timer);
        }
        this.idleEvictionTimers.clear();

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
            pendingBatches: this.operationBatches.size,
            pendingAwarenessBatches: this.awarenessBatches.size,
            idleEvictionTimers: this.idleEvictionTimers.size,
            activeChannels: this.channelStates.size
        };
    }
}

module.exports = CRDTService;
