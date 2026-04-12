// services/crdt/IdleEvictionManager.js
/**
 * Manages idle Y.Doc eviction timers. When a CRDT channel has 0 subscribers,
 * a timer starts. After IDLE_EVICTION_MS (default 10 minutes), the provided
 * callback fires to write a final snapshot and evict the Y.Doc from memory.
 */

const { IDLE_EVICTION_MS } = require('./config');

class IdleEvictionManager {
    /**
     * @param {Object} logger
     * @param {Object} [config]
     * @param {number} [config.idleEvictionMs] - override for IDLE_EVICTION_MS
     */
    constructor(logger, config = {}) {
        this.logger = logger;
        this.IDLE_EVICTION_MS = config.idleEvictionMs || IDLE_EVICTION_MS;

        // channelId -> NodeJS.Timeout
        this.idleEvictionTimers = new Map();
    }

    /**
     * Start an idle eviction timer for a channel.
     * After IDLE_EVICTION_MS the callback is invoked with the channel name.
     * No-ops if a timer is already running for the channel.
     *
     * @param {string} channel
     * @param {function(string): Promise<void>} callback - receives the channel; should handle snapshot + cleanup
     */
    startEviction(channel, callback) {
        // Don't start a duplicate timer
        if (this.idleEvictionTimers.has(channel)) return;

        const timer = setTimeout(async () => {
            this.idleEvictionTimers.delete(channel);
            try {
                await callback(channel);
            } catch (err) {
                this.logger.error(`Error during idle eviction callback for channel ${channel}:`, err.message);
            }
        }, this.IDLE_EVICTION_MS);

        this.idleEvictionTimers.set(channel, timer);
        this.logger.debug(`Idle eviction timer started for channel ${channel} (${this.IDLE_EVICTION_MS / 1000}s)`);
    }

    /**
     * Cancel an idle eviction timer for a channel (e.g. when a new subscriber joins).
     *
     * @param {string} channel
     */
    cancelEviction(channel) {
        const timer = this.idleEvictionTimers.get(channel);
        if (timer) {
            clearTimeout(timer);
            this.idleEvictionTimers.delete(channel);
            this.logger.debug(`Idle eviction timer cancelled for channel ${channel}`);
        }
    }

    /**
     * Clear all pending eviction timers. Called during service shutdown.
     */
    shutdown() {
        for (const [channel, timer] of this.idleEvictionTimers.entries()) {
            clearTimeout(timer);
        }
        this.idleEvictionTimers.clear();
        this.logger.debug('IdleEvictionManager shut down');
    }

    /**
     * @returns {number} number of channels with active eviction timers
     */
    get pendingCount() {
        return this.idleEvictionTimers.size;
    }
}

module.exports = IdleEvictionManager;
module.exports.IDLE_EVICTION_MS = IDLE_EVICTION_MS;
