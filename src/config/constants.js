// config/constants.js
/**
 * Centralized configuration constants for the WebSocket Gateway.
 *
 * All magic numbers that were previously scattered across services, middleware,
 * and core modules live here so they can be tuned in one place.
 *
 * CRDT-specific constants (snapshot debounce, batch windows, DynamoDB tables, etc.)
 * remain in src/services/crdt/config.js to keep that subsystem self-contained.
 */

// ---------------------------------------------------------------------------
// Timing / keepalive
// ---------------------------------------------------------------------------

/** WebSocket ping/pong keepalive interval (ms). */
const KEEPALIVE_INTERVAL_MS = 30000;

/** Node heartbeat interval — how often each node pings Redis (ms). */
const HEARTBEAT_INTERVAL_MS = 30000;

/** Node heartbeat key expiry in Redis (seconds). Stale nodes expire after this. */
const HEARTBEAT_EXPIRE_SEC = 90;

/** Metrics flush interval (ms). CloudWatch metrics are emitted this often. */
const METRICS_FLUSH_INTERVAL_MS = 60000;

/** Redis reconnect retry delay (ms). */
const REDIS_RETRY_DELAY_MS = 2000;

/** Redis reconnect strategy — base multiplier per retry (ms). */
const REDIS_RECONNECT_BASE_MS = 50;

/** Redis reconnect strategy — max backoff cap (ms). */
const REDIS_RECONNECT_MAX_MS = 1000;

// ---------------------------------------------------------------------------
// Rate limits (messages per second per client)
// ---------------------------------------------------------------------------

const RATE_LIMITS = {
    cursor: 40,
    crdt: 500,
    awareness: 60,
    general: 100,
};

/** Rate limiter cleanup interval — remove stale buckets (ms). */
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60000;

/** Rate limiter — buckets older than this are garbage-collected (ms). */
const RATE_LIMIT_STALE_WINDOW_MS = 5000;

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/** Presence heartbeat check interval (ms). */
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;

/** Mark a client as offline after this period of inactivity (ms). */
const PRESENCE_TIMEOUT_MS = 60000;

/** Stale-client cleanup threshold (ms). */
const PRESENCE_STALE_THRESHOLD_MS = 90000;

/** Stale-client cleanup sweep interval (ms). */
const PRESENCE_CLEANUP_INTERVAL_MS = 30000;

/** Delay before fully removing a disconnected client's presence data (ms). */
const PRESENCE_DISCONNECT_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Metadata validation (shared by chat + presence services)
// ---------------------------------------------------------------------------

/** Maximum number of keys allowed in a metadata object. */
const MAX_METADATA_KEYS = 20;

/** Maximum serialized size of a metadata object (bytes). */
const MAX_METADATA_SIZE = 4096;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Max messages kept in per-channel LRU cache. */
const CHAT_MAX_MESSAGES_PER_CHANNEL = 100;

/** Interval for cleaning up empty channel caches (ms). */
const CHAT_CACHE_CLEANUP_INTERVAL_MS = 300000;

/** Default number of history messages returned on join. */
const CHAT_DEFAULT_HISTORY_LIMIT = 50;

/** Number of history messages sent when a client first joins a channel. */
const CHAT_JOIN_HISTORY_LIMIT = 20;

/** Maximum length of a single chat message (characters). */
const CHAT_MAX_MESSAGE_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/** Throttle interval for cursor updates (ms). */
const CURSOR_THROTTLE_INTERVAL_MS = 250;

/** TTL for cursor data before it's considered stale (ms). */
const CURSOR_TTL_MS = 30000;

/** Stale-cursor cleanup sweep interval (ms). */
const CURSOR_CLEANUP_INTERVAL_MS = 10000;

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Maximum recent reactions kept in memory per channel. */
const REACTION_MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Session TTL (seconds). Sessions expire after 24 hours. */
const SESSION_TTL_SEC = 86400;

/** Max sessions held in the local LRU cache. */
const SESSION_LRU_MAX = 10000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Maximum WebSocket message payload size (bytes). */
const MAX_PAYLOAD_SIZE_BYTES = 65536;

/** Maximum channel name length (characters). */
const MAX_CHANNEL_NAME_LENGTH = 50;

// ---------------------------------------------------------------------------
// Broadcast batching
// ---------------------------------------------------------------------------

/** Number of recipients before switching to batched (setImmediate) broadcast. */
const BROADCAST_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Node Manager — Redis cache
// ---------------------------------------------------------------------------

/** Local cache TTL for channel-to-nodes mapping (ms). */
const CHANNEL_NODES_CACHE_TTL_MS = 5000;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** JWKS client cache max age (ms). */
const JWKS_CACHE_MAX_AGE_MS = 3600000;

/** JWKS rate limit — max requests per minute. */
const JWKS_REQUESTS_PER_MINUTE = 10;

/** IVS Chat token session duration (minutes). */
const IVS_SESSION_DURATION_MINUTES = 60;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** Max activity history items kept in Redis per channel. */
const ACTIVITY_MAX_HISTORY_ITEMS = 200;

/** TTL for activity history lists in Redis (seconds). */
const ACTIVITY_HISTORY_TTL_SEC = 86400;

// ---------------------------------------------------------------------------
// Redis key prefixes
// ---------------------------------------------------------------------------

const REDIS_KEY_PREFIXES = {
    session: 'session:',
    presence: 'presence:',
    cursor: 'cursor:',
    crdtSnapshot: 'crdt:snapshot:',
    docMeta: 'doc:meta:',
    docList: 'doc:list',
    activityHistory: 'activity:history:',
    websocketNodes: 'websocket:nodes',
    websocketNode: 'websocket:node:',
    websocketClient: 'websocket:client:',
    websocketChannel: 'websocket:channel:',
    websocketRoute: 'websocket:route:',
    websocketDirect: 'websocket:direct:',
    websocketBroadcast: 'websocket:broadcast:all',
};

module.exports = {
    // Timing
    KEEPALIVE_INTERVAL_MS,
    HEARTBEAT_INTERVAL_MS,
    HEARTBEAT_EXPIRE_SEC,
    METRICS_FLUSH_INTERVAL_MS,
    REDIS_RETRY_DELAY_MS,
    REDIS_RECONNECT_BASE_MS,
    REDIS_RECONNECT_MAX_MS,

    // Rate limits
    RATE_LIMITS,
    RATE_LIMIT_CLEANUP_INTERVAL_MS,
    RATE_LIMIT_STALE_WINDOW_MS,

    // Presence
    PRESENCE_HEARTBEAT_INTERVAL_MS,
    PRESENCE_TIMEOUT_MS,
    PRESENCE_STALE_THRESHOLD_MS,
    PRESENCE_CLEANUP_INTERVAL_MS,
    PRESENCE_DISCONNECT_DELAY_MS,

    // Metadata
    MAX_METADATA_KEYS,
    MAX_METADATA_SIZE,

    // Chat
    CHAT_MAX_MESSAGES_PER_CHANNEL,
    CHAT_CACHE_CLEANUP_INTERVAL_MS,
    CHAT_DEFAULT_HISTORY_LIMIT,
    CHAT_JOIN_HISTORY_LIMIT,
    CHAT_MAX_MESSAGE_LENGTH,

    // Cursor
    CURSOR_THROTTLE_INTERVAL_MS,
    CURSOR_TTL_MS,
    CURSOR_CLEANUP_INTERVAL_MS,

    // Reactions
    REACTION_MAX_HISTORY,

    // Session
    SESSION_TTL_SEC,
    SESSION_LRU_MAX,

    // Validation
    MAX_PAYLOAD_SIZE_BYTES,
    MAX_CHANNEL_NAME_LENGTH,

    // Broadcast
    BROADCAST_BATCH_SIZE,

    // Node Manager
    CHANNEL_NODES_CACHE_TTL_MS,

    // Auth
    JWKS_CACHE_MAX_AGE_MS,
    JWKS_REQUESTS_PER_MINUTE,
    IVS_SESSION_DURATION_MINUTES,

    // Activity
    ACTIVITY_MAX_HISTORY_ITEMS,
    ACTIVITY_HISTORY_TTL_SEC,

    // Redis
    REDIS_KEY_PREFIXES,
};
