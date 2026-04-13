// services/crdt/DocumentMetadataService.js
/**
 * Document metadata CRUD — creating, listing, updating, and deleting
 * document metadata in Redis (hot) + DynamoDB (durable).
 *
 * Extracted from the monolithic CRDTService so it can be tested and
 * evolved independently.  The orchestrator delegates to this module
 * for all document-level metadata operations.
 */

const crypto = require('crypto');
const {
    PutItemCommand,
    GetItemCommand,
    DeleteItemCommand,
    ScanCommand,
    CreateTableCommand,
    DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');

const { DOCUMENTS_TABLE, TYPE_ICONS } = require('./config');

class DocumentMetadataService {
    /**
     * @param {object} opts
     * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} opts.dynamoClient
     * @param {import('redis').RedisClientType|null}              opts.redisClient
     * @param {object}                                            opts.logger
     * @param {Function}                                          [opts.isRedisAvailable] - () => boolean
     */
    constructor({ dynamoClient, redisClient, logger, isRedisAvailable }) {
        this.dynamoClient = dynamoClient;
        this.redisClient = redisClient;
        this.logger = logger;
        this._isRedisAvailable = isRedisAvailable || (() => !!this.redisClient);

        this.documentsTableName = DOCUMENTS_TABLE;

        // In-memory fallback when Redis is unavailable
        this.docMetaFallback = new Map();   // documentId -> meta object
        this.docListFallback = [];          // sorted array of { id, updatedAt }
    }

    // ------------------------------------------------------------------
    // Public API — called by the orchestrator
    // ------------------------------------------------------------------

    /**
     * Ensure the DynamoDB documents table exists (local dev only).
     */
    async ensureTable() {
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
                this.logger.error('Error checking DynamoDB documents table:', err.message);
            }
        }
    }

    /**
     * Create a new document with metadata stored in Redis + DynamoDB.
     * Returns the created document object.
     *
     * @param {object} params
     * @param {object} params.meta            - { title, type?, icon?, description? }
     * @param {string} params.createdBy       - userId of creator
     * @returns {Promise<object>}             - the created document
     */
    async handleCreateDocument({ meta, createdBy }) {
        const documentId = crypto.randomUUID();
        const now = new Date().toISOString();
        const docType = (meta && meta.type) || 'custom';

        const document = {
            id: documentId,
            title: meta.title.trim(),
            type: docType,
            status: 'draft',
            createdBy: createdBy || 'unknown',
            createdAt: now,
            updatedAt: now,
            icon: (meta && meta.icon) || TYPE_ICONS[docType] || TYPE_ICONS.custom,
            description: (meta && meta.description) || '',
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
                    createdBy: document.createdBy,
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

        this.logger.info(`Document created: ${documentId} (${document.title})`);
        return document;
    }

    /**
     * List all documents, returning metadata for each.
     * Reads from Redis first, falls back to DynamoDB, then in-memory.
     *
     * @returns {Promise<object[]>}
     */
    async handleListDocuments() {
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
                this.logger.info('Redis doc list empty -- hydrating from DynamoDB');
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

        return documents;
    }

    /**
     * Delete a document's metadata from Redis + DynamoDB.
     *
     * @param {string} documentId
     * @returns {Promise<void>}
     */
    async handleDeleteDocument(documentId) {
        if (this._isRedisAvailable()) {
            await this.redisClient.del(`doc:meta:${documentId}`);
            await this.redisClient.zRem('doc:list', documentId);
        } else {
            this.docMetaFallback.delete(documentId);
            this.docListFallback = this.docListFallback.filter(e => e.id !== documentId);
        }

        // Remove from DynamoDB as well
        await this._deleteDocumentMetaFromDynamo(documentId);

        // Also remove Redis snapshot cache if available
        if (this._isRedisAvailable()) {
            try {
                await this.redisClient.del(`crdt:snapshot:doc:${documentId}`);
            } catch (_) { /* best effort */ }
        }

        this.logger.info(`Document deleted: ${documentId}`);
    }

    /**
     * Update metadata fields on an existing document.
     *
     * @param {string} documentId
     * @param {object} meta - fields to merge (title, status, description, icon, type)
     * @returns {Promise<object|null>} - updated document or null if not found
     */
    async handleUpdateDocumentMeta(documentId, meta) {
        let existing = null;

        if (this._isRedisAvailable()) {
            const raw = await this.redisClient.get(`doc:meta:${documentId}`);
            if (raw) existing = JSON.parse(raw);
        }

        if (!existing) {
            existing = this.docMetaFallback.get(documentId);
            if (existing) existing = { ...existing }; // shallow copy for safe merge
        }

        // DynamoDB fallback when both Redis and in-memory miss
        if (!existing) {
            existing = await this._loadDocumentMetaFromDynamo(documentId);
        }

        if (!existing) return null;

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

        this.logger.info(`Document metadata updated: ${documentId}`);
        return existing;
    }

    // ------------------------------------------------------------------
    // DynamoDB persistence helpers (private)
    // ------------------------------------------------------------------

    /**
     * Persist document metadata to DynamoDB (crdt-documents table).
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
}

module.exports = DocumentMetadataService;
