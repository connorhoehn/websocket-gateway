// services/crdt/DocumentPresenceService.js
/**
 * Tracks which users are present in which document channels.
 * Maintains a forward index (channel -> clients) and reverse index (client -> channels)
 * for efficient disconnect cleanup. Broadcasts aggregated presence to all clients
 * whenever the map changes.
 */

class DocumentPresenceService {
    /**
     * @param {Object} messageRouter - message router for getClientData / broadcastToAll
     * @param {Object} logger
     */
    constructor(messageRouter, logger) {
        this.messageRouter = messageRouter;
        this.logger = logger;

        // Map<channelId, Map<clientId, {userId, displayName, color, idle}>>
        this.documentPresenceMap = new Map();

        // Map<clientId, Set<channelId>> — reverse index for disconnect cleanup
        this.clientDocChannels = new Map();
    }

    /**
     * Add a client to the document presence map for a doc: channel.
     * Broadcasts updated presence to all connected clients.
     *
     * @param {string} clientId
     * @param {string} channel
     */
    addClient(clientId, channel) {
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
        this.broadcastPresence();
    }

    /**
     * Remove a client from a specific doc: channel's presence map.
     * Broadcasts updated presence to all connected clients.
     *
     * @param {string} clientId
     * @param {string} channel
     */
    removeClient(clientId, channel) {
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
        this.broadcastPresence();
    }

    /**
     * Remove a client from ALL document presence maps (on disconnect).
     * Broadcasts updated presence to all connected clients.
     *
     * @param {string} clientId
     */
    removeAllForClient(clientId) {
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
        this.broadcastPresence();
    }

    /**
     * Check whether a client is tracked in a given channel.
     *
     * @param {string} clientId
     * @param {string} channel
     * @returns {boolean}
     */
    hasClient(clientId, channel) {
        const channelMap = this.documentPresenceMap.get(channel);
        return !!(channelMap && channelMap.has(clientId));
    }

    /**
     * Update a client's idle state in a channel. Returns true if changed.
     *
     * @param {string} clientId
     * @param {string} channel
     * @param {boolean} idle
     * @returns {boolean} whether the value changed
     */
    setIdle(clientId, channel, idle) {
        const channelMap = this.documentPresenceMap.get(channel);
        if (!channelMap) return false;
        const userInfo = channelMap.get(clientId);
        if (!userInfo || userInfo.idle === idle) return false;
        userInfo.idle = idle;
        return true;
    }

    /**
     * Return the raw presence map (for use in handleGetDocumentPresence).
     * @returns {Map<string, Map<string, Object>>}
     */
    getPresence() {
        return this.documentPresenceMap;
    }

    /**
     * Build and broadcast a documents:presence message to all connected clients.
     * Format: { type: 'documents:presence', documents: [{ documentId, users }] }
     */
    broadcastPresence() {
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

        // Broadcast to all connected clients across all nodes
        if (this.messageRouter) {
            this.messageRouter.broadcastToAll(message);
        }
    }
}

module.exports = DocumentPresenceService;
