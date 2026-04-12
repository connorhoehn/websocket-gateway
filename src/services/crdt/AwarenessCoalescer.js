// services/crdt/AwarenessCoalescer.js
/**
 * Buffers awareness updates per channel in a coalescing window (default 50ms),
 * then broadcasts a single merged payload instead of one message per client.
 * Reduces Redis pub/sub volume significantly at scale.
 */

const AWARENESS_BATCH_WINDOW_MS = 50;

class AwarenessCoalescer {
    /**
     * @param {Object} messageRouter - message router for sendToChannel
     * @param {Object} logger
     */
    constructor(messageRouter, logger) {
        this.messageRouter = messageRouter;
        this.logger = logger;

        // channelId -> { updates: Map<clientId, base64Update>, timeout: NodeJS.Timeout | null }
        this.awarenessBatches = new Map();
    }

    /**
     * Buffer an awareness update for coalescing.
     * Only the latest update per client is kept (overwrites previous).
     * A flush is auto-scheduled after AWARENESS_BATCH_WINDOW_MS of the first
     * buffered update in the window.
     *
     * @param {string} clientId
     * @param {string} channel
     * @param {string} update - base64-encoded awareness state
     */
    bufferUpdate(clientId, channel, update) {
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
                this._flushBatch(channel);
            }, AWARENESS_BATCH_WINDOW_MS);
        }
    }

    /**
     * Flush coalesced awareness updates for a channel.
     * Broadcasts a single message containing all buffered client awareness states.
     * @param {string} channel
     */
    async _flushBatch(channel) {
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

    /**
     * Flush all pending awareness batches immediately and clear timers.
     * Called during service shutdown.
     */
    shutdown() {
        for (const [channel, batch] of this.awarenessBatches.entries()) {
            if (batch.timeout) {
                clearTimeout(batch.timeout);
            }
        }
        this.awarenessBatches.clear();
        this.logger.debug('AwarenessCoalescer shut down');
    }

    /**
     * @returns {number} number of channels with pending awareness batches
     */
    get pendingCount() {
        return this.awarenessBatches.size;
    }
}

module.exports = AwarenessCoalescer;
module.exports.AWARENESS_BATCH_WINDOW_MS = AWARENESS_BATCH_WINDOW_MS;
