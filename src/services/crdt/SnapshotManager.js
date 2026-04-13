// services/crdt/SnapshotManager.js
/**
 * Snapshot / version management for CRDT documents.
 *
 * Handles writing snapshots (debounced, periodic, immediate), retrieving
 * snapshots from DynamoDB, listing version history, restoring historical
 * versions, and saving named (manual) versions.
 *
 * Extracted from the monolithic CRDTService so it can be tested and
 * evolved independently.  The orchestrator delegates to this module
 * for all snapshot-related operations.
 */

const Y = require('yjs');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const {
    PutItemCommand,
    QueryCommand,
    CreateTableCommand,
    DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');
const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const {
    SNAPSHOTS_TABLE,
    SNAPSHOT_DEBOUNCE_MS,
    REDIS_SNAPSHOT_TTL_SEC,
    TTL_30_DAYS_SEC,
    TTL_90_DAYS_SEC,
    EVENT_BUS_NAME,
} = require('./config');

class SnapshotManager {
    /**
     * @param {object} opts
     * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient}       opts.dynamoClient
     * @param {import('redis').RedisClientType|null}                     opts.redisClient
     * @param {import('@aws-sdk/client-eventbridge').EventBridgeClient}  opts.eventBridgeClient
     * @param {object}                                                   opts.logger
     * @param {Function}                                                 opts.getChannelState  - (channelId) => { ydoc, operationsSinceSnapshot, subscriberCount } | undefined
     * @param {Function}                                                 [opts.isRedisAvailable] - () => boolean
     */
    constructor({ dynamoClient, redisClient, eventBridgeClient, logger, getChannelState, isRedisAvailable }) {
        this.dynamoClient = dynamoClient;
        this.redisClient = redisClient;
        this.eventBridgeClient = eventBridgeClient;
        this.logger = logger;
        this.getChannelState = getChannelState;
        this._isRedisAvailable = isRedisAvailable || (() => !!this.redisClient);

        this.snapshotsTableName = SNAPSHOTS_TABLE;
        this.eventBusName = EVENT_BUS_NAME;

        // Debounced snapshot timers per channel
        this.snapshotDebounceTimers = new Map(); // channelId -> timeout
        this.SNAPSHOT_DEBOUNCE_MS = SNAPSHOT_DEBOUNCE_MS;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Ensure the DynamoDB snapshots table exists (local dev only).
     */
    async ensureTable() {
        const tableName = this.snapshotsTableName;
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
                this.logger.error('Error checking DynamoDB table:', err.message);
            }
        }
    }

    /**
     * Write a snapshot for a channel to DynamoDB (direct or via EventBridge).
     *
     * @param {string} channelId
     * @param {object} [meta]           - Optional version metadata
     * @param {string} [meta.author]    - userId/displayName or 'auto'
     * @param {string} [meta.name]      - Optional user-provided version name
     * @param {string} [meta.type]      - 'auto' | 'manual' | 'pre-restore' | 'pre-clear'
     */
    async writeSnapshot(channelId, meta = {}) {
        const state = this.getChannelState(channelId);
        if (!state || !state.ydoc) {
            return; // No snapshot to write
        }

        try {
            // Encode full state from Y.Doc and gzip compress
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
                    documentId: { S: channelId },
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
                    TableName: this.snapshotsTableName,
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
     * Retrieve the latest snapshot for a channel from DynamoDB.
     *
     * @param {string} channelId
     * @returns {Promise<{data: string|null, timestamp: number|null}>}
     */
    async retrieveLatestSnapshot(channelId) {
        try {
            const command = new QueryCommand({
                TableName: this.snapshotsTableName,
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
                return { data: null, timestamp: null };
            }

            const item = result.Items[0];
            const compressedSnapshot = item.snapshot.B;
            const timestamp = parseInt(item.timestamp.N, 10);

            // Decompress gzip
            const decompressed = await gunzip(Buffer.from(compressedSnapshot));
            const base64Snapshot = decompressed.toString('base64');

            return { data: base64Snapshot, timestamp };
        } catch (error) {
            this.logger.error(`Failed to retrieve snapshot for ${channelId}:`, error.message);
            return { data: null, timestamp: null };
        }
    }

    /**
     * List recent snapshots for a channel (version history).
     *
     * @param {string} channel
     * @param {number} [limit=20]
     * @returns {Promise<object[]>}
     */
    async handleListSnapshots(channel, limit = 20) {
        try {
            const command = new QueryCommand({
                TableName: this.snapshotsTableName,
                KeyConditionExpression: 'documentId = :docId',
                ExpressionAttributeValues: {
                    ':docId': { S: channel }
                },
                ScanIndexForward: false, // Newest first
                Limit: limit,
                ProjectionExpression: '#ts, versionType, author, versionName, sizeBytes',
                ExpressionAttributeNames: {
                    '#ts': 'timestamp'
                }
            });

            const result = await this.dynamoClient.send(command);
            const now = Date.now();
            return (result.Items || []).map(item => {
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
        } catch (error) {
            this.logger.error(`Failed to list snapshots for ${channel}:`, error.message);
            return [];
        }
    }

    /**
     * Retrieve a specific snapshot by timestamp (version).
     *
     * @param {string} channel
     * @param {number} timestamp
     * @returns {Promise<{base64: string, timestamp: number}|null>}
     */
    async handleGetSnapshotAtVersion(channel, timestamp) {
        const command = new QueryCommand({
            TableName: this.snapshotsTableName,
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
            return null;
        }

        const item = result.Items[0];
        const compressedSnapshot = item.snapshot.B;
        const decompressed = await gunzip(Buffer.from(compressedSnapshot));
        const base64 = decompressed.toString('base64');

        return { base64, timestamp };
    }

    /**
     * Restore a historical snapshot as the current channel state.
     * Creates a pre-restore checkpoint first, then replaces the Y.Doc.
     *
     * @param {string} channel
     * @param {number} timestamp
     * @returns {Promise<{base64State: string, restoredTimestamp: number}|null>}
     */
    async handleRestoreSnapshot(channel, timestamp) {
        // Load the historical snapshot from DynamoDB
        const command = new QueryCommand({
            TableName: this.snapshotsTableName,
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
            return null;
        }

        // Decompress to get raw Y.js update bytes
        const item = result.Items[0];
        const compressedSnapshot = item.snapshot.B;
        const decompressed = await gunzip(Buffer.from(compressedSnapshot));
        const historicalUpdate = new Uint8Array(decompressed);

        // Get or create the channel state
        let state = this.getChannelState(channel);
        if (!state) {
            return null; // Orchestrator must have a channel state
        }

        // Pre-restore checkpoint: save current state so the operation is reversible
        try {
            const currentState = Y.encodeStateAsUpdate(state.ydoc);
            if (currentState.byteLength > 0) {
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

        const base64State = Buffer.from(fullState).toString('base64');

        // Write a new snapshot for the restored state
        await this.writeSnapshot(channel, { type: 'auto', author: 'system' });

        this.logger.info(`Restored snapshot at version ${timestamp} for channel ${channel}`);

        return { base64State, restoredTimestamp: timestamp };
    }

    /**
     * Save a named version (manual checkpoint) of the current document state.
     *
     * @param {string} channel
     * @param {string} name     - user-provided version name
     * @param {string} [userId] - who triggered the save
     * @returns {Promise<{name: string, author: string, timestamp: number}|null>}
     */
    async handleSaveVersion(channel, name, userId) {
        const state = this.getChannelState(channel);
        if (!state || !state.ydoc) {
            return null;
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
        this.logger.info(`Named version "${name.trim()}" saved for channel ${channel} by ${author}`);

        return { name: name.trim(), author, timestamp: ts };
    }

    /**
     * Write periodic snapshots for all channels with pending operations.
     * Called on a timer by the orchestrator.
     *
     * @param {Map<string, object>} channelStates - the orchestrator's channelStates map
     */
    async writePeriodicSnapshots(channelStates) {
        for (const [channelId, state] of channelStates.entries()) {
            if (state.operationsSinceSnapshot > 0) {
                await this.writeSnapshot(channelId);
            }
        }
    }

    /**
     * Schedule a debounced snapshot write for a channel.
     * Writes after SNAPSHOT_DEBOUNCE_MS of inactivity.
     *
     * @param {string} channelId
     */
    scheduleDebouncedSnapshot(channelId) {
        const existing = this.snapshotDebounceTimers.get(channelId);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(async () => {
            this.snapshotDebounceTimers.delete(channelId);
            const state = this.getChannelState(channelId);
            if (state && state.operationsSinceSnapshot > 0) {
                await this.writeSnapshot(channelId);
            }
        }, this.SNAPSHOT_DEBOUNCE_MS);
        this.snapshotDebounceTimers.set(channelId, timer);
    }

    /**
     * Cancel a pending debounced snapshot for a channel.
     *
     * @param {string} channelId
     */
    cancelDebouncedSnapshot(channelId) {
        const timer = this.snapshotDebounceTimers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.snapshotDebounceTimers.delete(channelId);
        }
    }

    /**
     * Clear all debounce timers and flush pending snapshots (for shutdown).
     *
     * @param {Map<string, object>} channelStates
     */
    async flushAndClearTimers(channelStates) {
        for (const [channelId, timer] of this.snapshotDebounceTimers.entries()) {
            clearTimeout(timer);
            const state = channelStates.get(channelId);
            if (state && state.operationsSinceSnapshot > 0) {
                try {
                    await this.writeSnapshot(channelId);
                } catch (err) {
                    this.logger.error(`Failed to write final snapshot for ${channelId} during shutdown:`, err.message);
                }
            }
        }
        this.snapshotDebounceTimers.clear();
    }

    // ------------------------------------------------------------------
    // Y.Doc hydration (Redis → DynamoDB fallback)
    // ------------------------------------------------------------------

    /**
     * Hydrate a Y.Doc from persisted state (Redis hot-cache first, DynamoDB fallback).
     *
     * @param {string} channel
     * @param {object} state - { ydoc, operationsSinceSnapshot, subscriberCount }
     */
    async hydrateYDoc(channel, state) {
        let base64 = null;
        let source = 'none';

        // Try Redis hot-cache first
        try {
            base64 = await this.getSnapshotFromRedis(channel);
            if (base64) source = 'redis';
        } catch (err) {
            this.logger.error(`Redis hydration failed for ${channel}, falling back to DynamoDB:`, err.message);
        }

        // Fall back to DynamoDB
        if (!base64) {
            try {
                const dbResult = await this.retrieveLatestSnapshot(channel);
                if (dbResult.data) {
                    base64 = dbResult.data;
                    source = 'dynamodb';
                }
            } catch (err) {
                this.logger.error(`DynamoDB hydration failed for ${channel}:`, err.message);
            }
        }

        if (base64) {
            try {
                const update = new Uint8Array(Buffer.from(base64, 'base64'));
                Y.applyUpdate(state.ydoc, update);
                this.logger.info(`Y.Doc hydrated from ${source} for channel ${channel}`);
            } catch (err) {
                this.logger.error(`Failed to apply hydration update for ${channel}:`, err.message);
            }
        } else {
            this.logger.info(`No existing snapshot for channel ${channel} — starting fresh`);
        }
    }

    // ------------------------------------------------------------------
    // handleClearDocument
    // ------------------------------------------------------------------

    /**
     * Clear a document's content, saving a pre-clear checkpoint first.
     *
     * @param {string} clientId
     * @param {object} data         - { channel }
     * @param {Map}    channelStates
     * @param {Function} sendToClient - (clientId, message) => void
     * @param {Function} sendError    - (clientId, message) => void
     */
    async handleClearDocument(clientId, data, channelStates, sendToClient, sendError) {
        const channel = data.channel;
        if (!channel) {
            sendError(clientId, 'Channel name is required');
            return;
        }

        const state = channelStates.get(channel);
        if (!state || !state.ydoc) {
            sendError(clientId, 'No active document for channel');
            return;
        }

        // Pre-clear checkpoint so the operation is reversible
        try {
            const currentState = Y.encodeStateAsUpdate(state.ydoc);
            if (currentState.byteLength > 0) {
                state.operationsSinceSnapshot = 1;
                await this.writeSnapshot(channel, { type: 'pre-clear', author: clientId });
                this.logger.info(`Pre-clear checkpoint saved for channel ${channel}`);
            }
        } catch (err) {
            this.logger.error(`Failed pre-clear checkpoint for ${channel}:`, err.message);
        }

        // Replace with fresh Y.Doc
        state.ydoc.destroy();
        state.ydoc = new Y.Doc();
        state.operationsSinceSnapshot = 0;

        const emptyState = Buffer.from(Y.encodeStateAsUpdate(state.ydoc)).toString('base64');

        // Persist the cleared state
        await this.writeSnapshot(channel, { type: 'auto', author: clientId });

        // Update Redis hot-cache
        await this._saveSnapshotToRedis(channel, emptyState);

        sendToClient(clientId, {
            type: 'crdt',
            action: 'documentCleared',
            channel,
            update: emptyState,
        });

        this.logger.info(`Document cleared for channel ${channel} by ${clientId}`);
    }

    // ------------------------------------------------------------------
    // Shutdown
    // ------------------------------------------------------------------

    /**
     * Graceful shutdown — flush all pending snapshots and clear timers.
     *
     * @param {Map<string, object>} channelStates
     */
    async shutdown(channelStates) {
        return this.flushAndClearTimers(channelStates);
    }

    // ------------------------------------------------------------------
    // Redis hot-cache helpers (private)
    // ------------------------------------------------------------------

    /**
     * Save a snapshot to Redis hot-cache.
     *
     * @param {string} channelId
     * @param {string} base64Snapshot
     */
    async _saveSnapshotToRedis(channelId, base64Snapshot) {
        if (!this._isRedisAvailable()) return;
        try {
            const key = `crdt:snapshot:${channelId}`;
            await this.redisClient.setEx(key, REDIS_SNAPSHOT_TTL_SEC, base64Snapshot);
            this.logger.info(`Redis snapshot cached for channel ${channelId}`);
        } catch (err) {
            this.logger.error(`Failed to cache snapshot in Redis for ${channelId}:`, err.message);
        }
    }

    /**
     * Retrieve a snapshot from Redis hot-cache.
     *
     * @param {string} channelId
     * @returns {Promise<string|null>}
     */
    async getSnapshotFromRedis(channelId) {
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
     * Save to Redis (non-blocking, fire-and-forget from caller).
     *
     * @param {string} channelId
     * @param {string} base64Snapshot
     * @returns {Promise<void>}
     */
    async saveSnapshotToRedis(channelId, base64Snapshot) {
        return this._saveSnapshotToRedis(channelId, base64Snapshot);
    }

    // ------------------------------------------------------------------
    // TTL helper (private)
    // ------------------------------------------------------------------

    /**
     * Compute TTL (epoch seconds) based on version type.
     * - 'manual' (named versions): no TTL (kept indefinitely)
     * - 'pre-restore' / 'pre-clear': 90-day TTL
     * - 'auto' / default: 30-day TTL
     *
     * @param {string} versionType
     * @returns {number|null}
     */
    _computeTtl(versionType) {
        const nowSec = Math.floor(Date.now() / 1000);
        switch (versionType) {
            case 'manual':
                return null;
            case 'pre-restore':
            case 'pre-clear':
                return nowSec + TTL_90_DAYS_SEC;
            default:
                return nowSec + TTL_30_DAYS_SEC;
        }
    }
}

module.exports = SnapshotManager;
