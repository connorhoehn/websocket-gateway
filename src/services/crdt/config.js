// services/crdt/config.js
/**
 * Shared configuration constants for CRDT subsystem modules.
 * All magic numbers and table names live here so they can be tuned in one place.
 */

// ---------------------------------------------------------------------------
// Timing / batching
// ---------------------------------------------------------------------------

/** Debounce window before writing a snapshot after the last CRDT update (ms). */
const SNAPSHOT_DEBOUNCE_MS = parseInt(process.env.SNAPSHOT_DEBOUNCE_MS || '5000', 10);

/** Interval for periodic snapshot sweeps across all active channels (ms). */
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '300000', 10);

/** Grace period before evicting an idle (0-subscriber) Y.Doc from memory (ms). */
const IDLE_EVICTION_MS = parseInt(process.env.IDLE_EVICTION_MS || '600000', 10);

/** Window for coalescing awareness updates before broadcasting (ms). */
const AWARENESS_BATCH_WINDOW_MS = 50;

/** Window for coalescing CRDT operation broadcasts (ms). */
const OPERATION_BATCH_WINDOW_MS = 10;

/** Number of operations before an immediate snapshot is triggered. */
const OPERATIONS_BEFORE_SNAPSHOT = 50;

// ---------------------------------------------------------------------------
// DynamoDB table names
// ---------------------------------------------------------------------------

const { tableName } = require('../../lib/ddb-table-name');

const SNAPSHOTS_TABLE = tableName(process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots');
const DOCUMENTS_TABLE = tableName(process.env.DYNAMODB_DOCUMENTS_TABLE || 'crdt-documents');

// ---------------------------------------------------------------------------
// Redis cache settings
// ---------------------------------------------------------------------------

/** TTL for Redis snapshot hot-cache entries (seconds). */
const REDIS_SNAPSHOT_TTL_SEC = 3600; // 1 hour

// ---------------------------------------------------------------------------
// DynamoDB TTL values (seconds from now)
// ---------------------------------------------------------------------------

const TTL_30_DAYS_SEC = 30 * 24 * 60 * 60;
const TTL_90_DAYS_SEC = 90 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// EventBridge
// ---------------------------------------------------------------------------

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'social-events';

// ---------------------------------------------------------------------------
// Default document type icons
// ---------------------------------------------------------------------------

const TYPE_ICONS = {
    meeting: '\u{1F4DD}', sprint: '\u{1F680}', design: '\u{1F3A8}', project: '\u{1F4CB}',
    decision: '\u2696\uFE0F', retro: '\u{1F504}', custom: '\u{1F4C4}',
};

module.exports = {
    SNAPSHOT_DEBOUNCE_MS,
    SNAPSHOT_INTERVAL_MS,
    IDLE_EVICTION_MS,
    AWARENESS_BATCH_WINDOW_MS,
    OPERATION_BATCH_WINDOW_MS,
    OPERATIONS_BEFORE_SNAPSHOT,
    SNAPSHOTS_TABLE,
    DOCUMENTS_TABLE,
    REDIS_SNAPSHOT_TTL_SEC,
    TTL_30_DAYS_SEC,
    TTL_90_DAYS_SEC,
    EVENT_BUS_NAME,
    TYPE_ICONS,
};
