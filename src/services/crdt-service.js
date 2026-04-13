// services/crdt-service.js
/**
 * CRDT Service — Slim orchestrator that delegates to extracted sub-modules.
 *
 * Responsibilities kept here:
 *   - handleAction dispatch (switch)
 *   - handleSubscribe / handleUpdate / handleUnsubscribe (need channelStates)
 *   - handleAwareness (delegates to AwarenessCoalescer + DocumentPresenceService)
 *   - handleGetSnapshot (auth check + delegation)
 *   - onClientDisconnect
 *   - Cross-node sync interceptor registration
 *   - Constructor wiring + shutdown + getStats
 *
 * Everything else (metadata CRUD, snapshot persistence, presence maps,
 * idle eviction, awareness coalescing) lives in ./crdt/*.
 */

const { checkChannelPermission, AuthzError } = require('../middleware/authz-middleware');
const { ErrorCodes, createErrorResponse } = require('../utils/error-codes');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');
const Y = require('yjs');
const { mergeUpdates } = Y;

// Sub-modules (may not exist on disk yet — that's OK for wait-free decomposition)
const DocumentMetadataService = require('./crdt/DocumentMetadataService');
const SnapshotManager = require('./crdt/SnapshotManager');
const AwarenessCoalescer = require('./crdt/AwarenessCoalescer');
const DocumentPresenceService = require('./crdt/DocumentPresenceService');
const IdleEvictionManager = require('./crdt/IdleEvictionManager');
const config = require('./crdt/config');

class CRDTService {
    constructor(messageRouter, logger, metricsCollector = null, redisClient = null) {
        this.messageRouter = messageRouter;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.redisClient = redisClient;

        // ---------------------------------------------------------------
        // AWS clients
        // ---------------------------------------------------------------
        const dynamoOpts = { region: process.env.AWS_REGION || 'us-east-1' };
        if (process.env.LOCALSTACK_ENDPOINT) {
            dynamoOpts.endpoint = process.env.LOCALSTACK_ENDPOINT;
            dynamoOpts.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
            };
        }
        this.dynamoClient = new DynamoDBClient(dynamoOpts);

        this.eventBridgeClient = new EventBridgeClient({
            region: process.env.AWS_REGION || 'us-east-1',
            ...(process.env.LOCALSTACK_ENDPOINT ? {
                endpoint: process.env.LOCALSTACK_ENDPOINT,
                credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
            } : {})
        });

        // ---------------------------------------------------------------
        // Core state — stays in orchestrator (handlers need direct access)
        // ---------------------------------------------------------------
        // channelId -> { ydoc: Y.Doc, operationsSinceSnapshot: number, subscriberCount: number }
        this.channelStates = new Map();

        // Operation batching for reduced Redis message volume
        this.operationBatches = new Map();

        // ---------------------------------------------------------------
        // Sub-services
        // ---------------------------------------------------------------
        this.metadataService = new DocumentMetadataService({
            dynamoClient: this.dynamoClient,
            redisClient: this.redisClient,
            logger: this.logger,
            isRedisAvailable: () => !!(this.redisClient && this.redisClient.isReady),
        });

        this.snapshotManager = new SnapshotManager({
            dynamoClient: this.dynamoClient,
            redisClient: this.redisClient,
            eventBridgeClient: this.eventBridgeClient,
            logger: this.logger,
            getChannelState: (ch) => this.channelStates.get(ch),
            isRedisAvailable: () => !!(this.redisClient && this.redisClient.isReady),
        });

        this.awarenessCoalescer = new AwarenessCoalescer(this.messageRouter, this.logger);

        this.presenceService = new DocumentPresenceService(this.messageRouter, this.logger);

        this.evictionManager = new IdleEvictionManager(this.logger, config);
        // Eviction callback: when the eviction timer fires, flush snapshot + destroy Y.Doc
        this._evictionCallback = async (channel) => {
            const state = this.channelStates.get(channel);
            if (!state) return;
            if (state.subscriberCount > 0) return; // someone re-joined during grace period

            if (state.operationsSinceSnapshot > 0) {
                await this.snapshotManager.writeSnapshot(channel, state);
                this.logger.info(`Final snapshot written before evicting Y.Doc for channel ${channel}`);
            }
            if (state.ydoc) state.ydoc.destroy();
            this.channelStates.delete(channel);
            this.snapshotManager.cancelDebouncedSnapshot(channel);
            this.logger.info(`Y.Doc evicted for idle channel ${channel}`);
        };

        // ---------------------------------------------------------------
        // Periodic snapshot sweep
        // ---------------------------------------------------------------
        this.periodicSnapshotTimer = setInterval(() => {
            this._writePeriodicSnapshots();
        }, config.SNAPSHOT_INTERVAL_MS);
        this.logger.info(`Periodic snapshots every ${config.SNAPSHOT_INTERVAL_MS / 1000}s`);

        // ---------------------------------------------------------------
        // Ensure DynamoDB tables exist in local dev
        // ---------------------------------------------------------------
        if (process.env.DIRECT_DYNAMO_WRITE === 'true') {
            this.snapshotManager.ensureTable().catch(err =>
                this.logger.error('Failed to ensure snapshots table:', err.message));
            this.metadataService.ensureTable().catch(err =>
                this.logger.error('Failed to ensure documents table:', err.message));
        }

        // ---------------------------------------------------------------
        // Shutdown hooks (flush dirty snapshots before exit)
        // ---------------------------------------------------------------
        this._registerShutdownHandlers();

        // ---------------------------------------------------------------
        // Cross-node sync interceptor
        // ---------------------------------------------------------------
        if (this.messageRouter && typeof this.messageRouter.onRemoteChannelMessage === 'function') {
            this.messageRouter.onRemoteChannelMessage('crdt-sync', (channel, message, _fromNode) => {
                if (message && message.type === 'crdt:update' && message.update) {
                    const state = this.channelStates.get(channel);
                    if (state && state.ydoc) {
                        try {
                            const updateBytes = new Uint8Array(Buffer.from(message.update, 'base64'));
                            Y.applyUpdate(state.ydoc, updateBytes);
                            state.operationsSinceSnapshot++;
                            this.snapshotManager.scheduleDebouncedSnapshot(channel, state);
                            this.logger.debug(`Applied remote CRDT update to local Y.Doc for channel ${channel}`);
                        } catch (err) {
                            this.logger.error(`Failed to apply remote CRDT update for ${channel}:`, err.message);
                        }
                    }
                }
            });
        }
    }

    // ===================================================================
    // Shutdown helpers
    // ===================================================================

    _registerShutdownHandlers() {
        const flushAndExit = async (signal) => {
            this.logger.info(`${signal} received — flushing dirty CRDT snapshots before exit`);
            const promises = [];
            for (const [channelId, state] of this.channelStates.entries()) {
                if (state && state.operationsSinceSnapshot > 0) {
                    promises.push(
                        this.snapshotManager.writeSnapshot(channelId, state).catch(err =>
                            this.logger.error(`Failed to flush snapshot for ${channelId} on ${signal}:`, err.message)
                        )
                    );
                }
            }
            if (promises.length > 0) {
                await Promise.allSettled(promises);
                this.logger.info(`Flushed ${promises.length} dirty snapshots on ${signal}`);
            }
        };

        process.on('SIGTERM', () => flushAndExit('SIGTERM'));
        process.on('SIGINT', () => flushAndExit('SIGINT'));
    }

    // ===================================================================
    // Action dispatch
    // ===================================================================

    async handleAction(clientId, action, data) {
        const startTime = Date.now();
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

                // Delegated to SnapshotManager
                case 'listSnapshots': {
                    const snapshots = await this.snapshotManager.handleListSnapshots(data.channel, data.limit || 20);
                    this.sendToClient(clientId, { type: 'crdt', action: 'snapshotList', channel: data.channel, snapshots });
                    return;
                }
                case 'getSnapshotAtVersion': {
                    const result = await this.snapshotManager.handleGetSnapshotAtVersion(data.channel, data.timestamp);
                    if (result) {
                        this.sendToClient(clientId, { type: 'crdt', action: 'snapshot', channel: data.channel, version: true, update: result.base64, timestamp: result.timestamp });
                    } else {
                        this.sendError(clientId, 'Snapshot not found');
                    }
                    return;
                }
                case 'restoreSnapshot': {
                    if (!this._requireAuth(clientId, 'restoreSnapshot')) return;
                    const restored = await this.snapshotManager.handleRestoreSnapshot(data.channel, data.timestamp);
                    if (restored) {
                        // Broadcast restored state to all subscribers on this channel
                        this.messageRouter.sendToChannel(data.channel, {
                            type: 'crdt', action: 'snapshot', channel: data.channel, update: restored.base64State
                        });
                        this.sendToClient(clientId, { type: 'crdt', action: 'snapshotRestored', channel: data.channel, timestamp: restored.restoredTimestamp });
                    } else {
                        this.sendError(clientId, 'Snapshot not found or restore failed');
                    }
                    return;
                }
                case 'clearDocument':
                    if (!this._requireAuth(clientId, 'clearDocument')) return;
                    return await this.snapshotManager.handleClearDocument(clientId, data,
                        this.channelStates,
                        (cid, msg) => this.sendToClient(cid, msg),
                        (cid, msg) => this.sendError(cid, msg));
                case 'saveVersion': {
                    const saved = await this.snapshotManager.handleSaveVersion(data.channel, data.name, clientId);
                    if (saved) {
                        this.sendToClient(clientId, { type: 'crdt', action: 'versionSaved', channel: data.channel, name: saved.name, timestamp: saved.timestamp });
                    } else {
                        this.sendError(clientId, 'Failed to save version');
                    }
                    return;
                }

                // Delegated to DocumentMetadataService
                case 'listDocuments': {
                    const docs = await this.metadataService.handleListDocuments();
                    this.sendToClient(clientId, { type: 'crdt', action: 'documentList', documents: docs });
                    return;
                }
                case 'createDocument': {
                    const doc = await this.metadataService.handleCreateDocument({
                        meta: data.meta,
                        createdBy: clientId,
                    });
                    // Broadcast to all clients so document lists update
                    this.messageRouter.broadcastToAll({ type: 'crdt', action: 'documentCreated', document: doc });
                    return;
                }
                case 'deleteDocument': {
                    if (!this._requireAuth(clientId, 'deleteDocument')) return;
                    const docId = data.documentId;
                    await this.metadataService.handleDeleteDocument(docId);
                    // Clean up CRDT state if exists
                    const channel = `doc:${docId}`;
                    const state = this.channelStates.get(channel);
                    if (state) {
                        if (state.ydoc) state.ydoc.destroy();
                        this.channelStates.delete(channel);
                        this.snapshotManager.cancelDebouncedSnapshot(channel);
                    }
                    this.messageRouter.broadcastToAll({ type: 'crdt', action: 'documentDeleted', documentId: docId });
                    return;
                }
                case 'updateDocumentMeta': {
                    const updated = await this.metadataService.handleUpdateDocumentMeta(data.documentId, data.meta);
                    this.messageRouter.broadcastToAll({ type: 'crdt', action: 'documentMetaUpdated', documentId: data.documentId, meta: updated });
                    return;
                }

                // Delegated to DocumentPresenceService
                case 'getDocumentPresence': {
                    const presence = {};
                    const presenceMap = this.presenceService.getPresence();
                    for (const [ch, usersMap] of presenceMap) {
                        const users = Array.from(usersMap.values());
                        if (users.length > 0) presence[ch] = users;
                    }
                    this.sendToClient(clientId, { type: 'crdt', action: 'documentPresence', presence });
                    return;
                }

                default:
                    this.sendError(clientId, `Unknown CRDT action: ${action}`);
            }
        } catch (error) {
            this.logger.error(`Error handling CRDT action ${action} for client ${clientId}:`, error);
            this.sendError(clientId, 'Internal server error');
        } finally {
            const duration = Date.now() - startTime;
            this.logger.info(`[crdt] ${action}`, { clientId, channel: data.channel, duration });
            if (duration > 500) {
                this.logger.warn(`Slow message handler: crdt/${action} took ${duration}ms`, { clientId });
            }
        }
    }

    // ===================================================================
    // handleSubscribe — channel state init, Y.Doc hydration, subscriber mgmt
    // ===================================================================

    async handleSubscribe(clientId, { channel }) {
        if (!this._validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }

        try {
            // Auth check
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

            await this.messageRouter.subscribeToChannel(clientId, channel);

            // Cancel idle eviction if someone is subscribing
            this.evictionManager.cancelEviction(channel);

            // Initialize or reuse channel state
            let state = this.channelStates.get(channel);
            if (!state) {
                state = { ydoc: new Y.Doc(), operationsSinceSnapshot: 0, subscriberCount: 0 };
                this.channelStates.set(channel, state);

                // Hydrate Y.Doc: Redis hot-cache first, then DynamoDB
                await this.snapshotManager.hydrateYDoc(channel, state);
            }
            state.subscriberCount++;

            // Send confirmation
            this.sendToClient(clientId, {
                type: 'crdt',
                action: 'subscribed',
                channel,
                timestamp: new Date().toISOString()
            });

            // Push current state to reconnecting client (CRDT-02: reconnect recovery)
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
                this.logger.error(`Failed to push Y.Doc state for ${channel} to ${clientId}:`, syncError.message);
            }

            // Track document presence
            this.presenceService.addClient(clientId, channel);

            this.logger.info(`Client ${clientId} subscribed to CRDT channel: ${channel}`);
        } catch (error) {
            this.logger.error(`Error subscribing to channel ${channel} for client ${clientId}:`, error);
            this.sendError(clientId, 'Failed to subscribe to channel');
        }
    }

    // ===================================================================
    // handleUpdate — apply Y.js update, batch operations, broadcast
    // ===================================================================

    async handleUpdate(clientId, { channel, update }) {
        if (!this._validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }
        if (!update || typeof update !== 'string') {
            this.sendError(clientId, 'Update payload must be a base64 string');
            return;
        }

        try {
            let state = this.channelStates.get(channel);
            if (!state) {
                state = { ydoc: new Y.Doc(), operationsSinceSnapshot: 0, subscriberCount: 0 };
                this.channelStates.set(channel, state);
            }

            // Apply update to the channel's Y.Doc (proper CRDT merge)
            const updateBytes = new Uint8Array(Buffer.from(update, 'base64'));
            Y.applyUpdate(state.ydoc, updateBytes);
            state.operationsSinceSnapshot++;

            // Snapshot trigger: immediate after N ops, debounced otherwise
            if (state.operationsSinceSnapshot >= config.OPERATIONS_BEFORE_SNAPSHOT) {
                await this.snapshotManager.writeSnapshot(channel, state);
            } else {
                this.snapshotManager.scheduleDebouncedSnapshot(channel, state);
            }

            // Update Redis hot-cache (non-blocking)
            const latestState = Y.encodeStateAsUpdate(state.ydoc);
            if (latestState.byteLength > 0) {
                this.snapshotManager.saveSnapshotToRedis(channel, Buffer.from(latestState).toString('base64'))
                    .catch(err => this.logger.error(`Non-blocking Redis cache update failed for ${channel}:`, err.message));
            }

            // Batch the operation for broadcast
            this._batchOperation(channel, { update, timestamp: new Date().toISOString() }, clientId);

            this.logger.debug(`CRDT update batched for channel ${channel} from client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error handling CRDT update for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to process CRDT update');
        }
    }

    // ===================================================================
    // handleUnsubscribe — decrement subscribers, cleanup
    // ===================================================================

    async handleUnsubscribe(clientId, { channel }) {
        if (!channel) {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

        try {
            const state = this.channelStates.get(channel);
            if (state) {
                state.subscriberCount--;
                if (state.subscriberCount <= 0) {
                    state.subscriberCount = 0;
                    if (state.operationsSinceSnapshot > 0) {
                        await this.snapshotManager.writeSnapshot(channel, state);
                    }
                    this.evictionManager.startEviction(channel, this._evictionCallback);
                }
            }

            await this.messageRouter.unsubscribeFromChannel(clientId, channel);
            this.presenceService.removeClient(clientId, channel);

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

    // ===================================================================
    // handleGetSnapshot — auth check + delegate to SnapshotManager
    // ===================================================================

    async handleGetSnapshot(clientId, { channel }) {
        if (!channel || typeof channel !== 'string') {
            this.sendError(clientId, 'Channel name is required');
            return;
        }

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

            const snapshot = await this.snapshotManager.retrieveLatestSnapshot(channel);

            this.sendToClient(clientId, {
                type: 'crdt:snapshot',
                channel,
                snapshot: snapshot.data,
                timestamp: snapshot.timestamp,
                age: snapshot.timestamp ? Date.now() - snapshot.timestamp : null
            });

            this.logger.debug(`Snapshot retrieved for channel ${channel}, timestamp: ${snapshot.timestamp}`);
        } catch (error) {
            this.logger.error(`Error handling getSnapshot for channel ${channel}:`, error);
            this.sendError(clientId, 'Failed to retrieve snapshot');
        }
    }

    // ===================================================================
    // handleAwareness — delegate to AwarenessCoalescer + presence backfill
    // ===================================================================

    async handleAwareness(clientId, { channel, update, idle }) {
        this.logger.info(`[awareness-entry] client=${clientId} channel=${channel} hasUpdate=${!!update} idle=${idle} isDoc=${channel?.startsWith?.('doc:')}`);

        if (!this._validateChannel(channel)) {
            this.sendError(clientId, 'Channel name must be a string between 1 and 50 characters');
            return;
        }
        if (!update || typeof update !== 'string') {
            this.sendError(clientId, 'Awareness update must be a base64 string');
            return;
        }

        try {
            // Backfill presence map for doc: channels (e.g. after pod restart)
            if (channel.startsWith('doc:')) {
                if (!this.presenceService.hasClient(clientId, channel)) {
                    this.logger.info(`[presence-backfill] Adding ${clientId} to presence for ${channel}`);
                    this.presenceService.addClient(clientId, channel);
                }

                // Update idle state if provided
                if (typeof idle === 'boolean') {
                    this.presenceService.setIdle(clientId, channel, idle);
                }
            }

            // Buffer awareness update for coalescing
            this.awarenessCoalescer.bufferUpdate(clientId, channel, update);

            this.logger.debug(`Awareness buffered for channel ${channel} from client ${clientId}`);
        } catch (error) {
            this.logger.error(`Error buffering awareness for channel ${channel}:`, error);
        }
    }

    // ===================================================================
    // onClientDisconnect — presence + decrement subscribers
    // ===================================================================

    async handleDisconnect(clientId) {
        return this.onClientDisconnect(clientId);
    }

    async onClientDisconnect(clientId) {
        const clientData = this.messageRouter?.getClientData(clientId);
        if (clientData && clientData.channels) {
            for (const channel of clientData.channels) {
                const state = this.channelStates.get(channel);
                if (state) {
                    state.subscriberCount--;
                    if (state.subscriberCount <= 0) {
                        state.subscriberCount = 0;
                        if (state.operationsSinceSnapshot > 0) {
                            try {
                                await this.snapshotManager.writeSnapshot(channel, state);
                            } catch (err) {
                                this.logger.error(`Error writing snapshot on disconnect for channel ${channel}:`, err.message);
                            }
                        }
                        this.evictionManager.startEviction(channel, this._evictionCallback);
                    }
                }
            }
        }

        this.presenceService.removeAllForClient(clientId);
        this.logger.debug(`Client ${clientId} disconnected from CRDT service`);
    }

    // ===================================================================
    // Operation batching (kept in orchestrator — tightly coupled to broadcast)
    // ===================================================================

    _batchOperation(channel, operation, senderClientId) {
        let batch = this.operationBatches.get(channel);
        if (!batch) {
            batch = { operations: [], timeout: null, senderClientId };
            this.operationBatches.set(channel, batch);
        }
        batch.operations.push(operation);

        if (!batch.timeout) {
            batch.timeout = setTimeout(() => {
                this._broadcastBatch(channel);
            }, config.OPERATION_BATCH_WINDOW_MS);
        }
    }

    async _broadcastBatch(channel) {
        const batch = this.operationBatches.get(channel);
        if (!batch || batch.operations.length === 0) return;

        try {
            const buffers = batch.operations.map(op => new Uint8Array(Buffer.from(op.update, 'base64')));
            const merged = buffers.length === 1 ? buffers[0] : mergeUpdates(buffers);
            const mergedBase64 = Buffer.from(merged).toString('base64');

            await this.messageRouter.sendToChannel(channel, {
                type: 'crdt:update',
                channel,
                update: mergedBase64
            }, batch.senderClientId);

            this.logger.debug(`Broadcasted ${batch.operations.length} CRDT operations for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Error broadcasting CRDT operations for channel ${channel}:`, error);
        } finally {
            this.operationBatches.delete(channel);
        }
    }

    // ===================================================================
    // Periodic snapshot sweep
    // ===================================================================

    async _writePeriodicSnapshots() {
        for (const [channelId, state] of this.channelStates.entries()) {
            if (state.operationsSinceSnapshot > 0) {
                await this.snapshotManager.writeSnapshot(channelId, state);
            }
        }
    }

    // ===================================================================
    // Utility / messaging helpers
    // ===================================================================

    _validateChannel(channel) {
        return typeof channel === 'string' && channel.length > 0 && channel.length <= 50;
    }

    /**
     * Require that the requesting client is authenticated (has userContext).
     * Returns true if authorized, false if not (and sends an error to the client).
     *
     * @param {string} clientId
     * @param {string} actionName - for logging
     * @returns {boolean}
     */
    _requireAuth(clientId, actionName) {
        const clientData = this.messageRouter.getClientData(clientId);
        if (!clientData || !clientData.userContext) {
            this.logger.warn(`Unauthorized ${actionName} attempt from client ${clientId} — no userContext`);
            this.sendError(clientId, `Authentication required for ${actionName}`, ErrorCodes.AUTH_FAILED);
            return false;
        }
        return true;
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
        if (this.metricsCollector) {
            this.metricsCollector.recordError(errorCode);
        }
    }

    // ===================================================================
    // Lifecycle
    // ===================================================================

    async shutdown() {
        if (this.periodicSnapshotTimer) {
            clearInterval(this.periodicSnapshotTimer);
        }

        // Clear pending operation batches
        for (const [, batch] of this.operationBatches.entries()) {
            if (batch.timeout) clearTimeout(batch.timeout);
        }
        this.operationBatches.clear();

        // Delegate sub-service shutdown
        this.awarenessCoalescer.shutdown();
        this.evictionManager.shutdown();

        // Flush pending debounced snapshots
        await this.snapshotManager.shutdown(this.channelStates);

        this.logger.info('CRDT service shut down');
    }

    getStats() {
        return {
            pendingBatches: this.operationBatches.size,
            pendingAwarenessBatches: this.awarenessCoalescer.pendingCount,
            idleEvictionTimers: this.evictionManager.pendingCount,
            activeChannels: this.channelStates.size,
            trackedPresenceChannels: this.presenceService.channelCount,
        };
    }
}

module.exports = CRDTService;
