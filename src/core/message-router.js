// core/message-router.js

const { ValidationError, MessageValidator } = require('../validators/message-validator');
const RateLimiter = require('../middleware/rate-limiter');
const { BROADCAST_BATCH_SIZE } = require('../config/constants');

/**
 * Handles intelligent message routing in a distributed WebSocket system
 * Routes messages only to nodes that have clients subscribed to specific channels
 */
class MessageRouter {
    constructor(nodeManager, redisPublisher, redisSubscriber, logger, sessionService = null) {
        this.nodeManager = nodeManager;
        this.redisPublisher = redisPublisher;
        this.redisSubscriber = redisSubscriber;
        this.logger = logger;
        this.sessionService = sessionService; // Optional session service for subscription tracking
        this.validator = new MessageValidator();
        this.rateLimiter = new RateLimiter(logger);
        this.localClients = new Map(); // clientId -> WebSocket connection
        this.subscribedChannels = new Set();
        this.channelSequences = new Map(); // channel -> monotonic sequence counter

        // Redis health tracking
        this.redisAvailable = true; // Assume Redis is available initially

        // Message types for node-to-node communication
        this.messageTypes = {
            DIRECT_MESSAGE: 'direct_message',
            BROADCAST: 'broadcast',
            CHANNEL_MESSAGE: 'channel_message',
            PRESENCE_UPDATE: 'presence_update',
            CURSOR_UPDATE: 'cursor_update'
        };

        // Interceptors called when a remote channel message is received via Redis pub/sub.
        // Map of callback functions keyed by a label: (channel, message, fromNode) => void
        this.channelMessageInterceptors = new Map();

        // ---- DC-PIPELINE-7 receive side ----------------------------------
        // PeerMessaging instance (attached post-bootstrap via attachPeerMessaging).
        // When wired, every locally-subscribed channel also gets an exact-match
        // `wsg.channel.<channel>` handler so peer-addressed envelopes from
        // other nodes fan out locally instead of being silently auto-acked.
        // PeerMessaging.onPeerMessage is exact-match only (no wildcards), so
        // handlers are registered per-channel as channels are subscribed.
        this.peerMessaging = null;
        // channel -> Unsubscribe fn returned by peerMessaging.onPeerMessage
        this._peerMessageUnsubs = new Map();

        this.setupRedisHealthMonitoring();
        this.setupNodeMessageHandlers();
    }

    /**
     * Register a callback to be invoked when a remote channel message arrives via Redis pub/sub.
     * Useful for services that need to apply remote updates to local state (e.g. CRDT Y.Doc sync).
     * @param {string} label - Unique label for the interceptor
     * @param {function} callback - (channel, message, fromNode) => void
     */
    onRemoteChannelMessage(label, callback) {
        this.channelMessageInterceptors.set(label, callback);
    }

    /**
     * Register a local WebSocket connection
     */
    registerLocalClient(clientId, ws, metadata = {}) {
        this.localClients.set(clientId, {
            ws,
            metadata,
            channels: new Set(),
            joinedAt: new Date()
        });

        // Register with node manager
        this.nodeManager.registerClient(clientId, metadata);

        this.logger.debug(`Registered local client ${clientId}`);
    }

    /**
     * Get client data including userContext
     */
    getClientData(clientId) {
        const client = this.localClients.get(clientId);
        if (!client) {
            return null;
        }
        return {
            clientId,
            metadata: client.metadata,
            userContext: client.metadata.userContext,
            channels: Array.from(client.channels),
            joinedAt: client.joinedAt
        };
    }

    /**
     * Unregister a local WebSocket connection
     */
    async unregisterLocalClient(clientId) {
        const client = this.localClients.get(clientId);
        if (client) {
            // Collect channels before deletion to ensure cleanup
            const channels = Array.from(client.channels);

            // Unsubscribe from all channels with error isolation
            const failures = [];
            for (const channel of channels) {
                try {
                    await this.unsubscribeFromChannel(clientId, channel);
                } catch (error) {
                    failures.push({ channel, error: error.message });
                    // Force-remove from local tracking even if Redis unsubscribe fails
                    client.channels.delete(channel);
                    // Also clean the reverse index for this channel
                    const reverseSet = this.nodeManager.getClientsForChannel(channel);
                    if (reverseSet.size > 0) {
                        reverseSet.delete(clientId);
                        if (reverseSet.size === 0) {
                            this.nodeManager.channelToClients.delete(channel);
                        }
                    }
                }
            }

            if (failures.length > 0) {
                this.logger.warn(`Cleanup failures for client ${clientId}`, { failures });
            }

            this.localClients.delete(clientId);
            this.rateLimiter.removeClient(clientId);

            try {
                await this.nodeManager.unregisterClient(clientId);
            } catch (error) {
                this.logger.warn(`Failed to unregister client ${clientId} from node manager`, { error: error.message });
            }

            this.logger.debug(`Unregistered local client ${clientId}`);
        }
    }

    /**
     * Subscribe a client to a channel
     */
    async subscribeToChannel(clientId, channel) {
        const client = this.localClients.get(clientId);
        if (!client) {
            this.logger.warn(`Attempted to subscribe unknown client ${clientId} to ${channel}`);
            return false;
        }

        client.channels.add(channel);
        await this.nodeManager.subscribeClientToChannel(clientId, channel);

        // Subscribe to Redis channel if not already subscribed
        if (!this.subscribedChannels.has(channel)) {
            await this.subscribeToRedisChannel(channel);
        }

        // Update session subscriptions if session service is available
        await this.updateSessionSubscriptions(clientId);

        this.logger.debug(`Client ${clientId} subscribed to channel ${channel}`);
        return true;
    }

    /**
     * Unsubscribe a client from a channel
     */
    async unsubscribeFromChannel(clientId, channel) {
        const client = this.localClients.get(clientId);
        if (client) {
            client.channels.delete(channel);
            await this.nodeManager.unsubscribeClientFromChannel(clientId, channel);

            // Check if we still need to listen to this channel
            const stillNeeded = Array.from(this.localClients.values())
                .some(c => c.channels.has(channel));

            if (!stillNeeded) {
                await this.unsubscribeFromRedisChannel(channel);
                // Also clean up channelSequences even if Redis unsubscribe was skipped
                // (e.g. when redisSubscriber is null). unsubscribeFromRedisChannel
                // handles its own delete, so this is a no-op when it already ran.
                this.channelSequences.delete(channel);
            }

            // Update session subscriptions if session service is available
            await this.updateSessionSubscriptions(clientId);

            this.logger.debug(`Client ${clientId} unsubscribed from channel ${channel}`);
        }
    }

    /**
     * Update session subscriptions for a client
     * Called after channel join/leave to keep session state in sync
     */
    async updateSessionSubscriptions(clientId) {
        if (!this.sessionService) {
            return; // Session tracking not enabled
        }

        const client = this.localClients.get(clientId);
        if (!client) {
            return;
        }

        // Get session token from client metadata
        const sessionToken = client.metadata?.sessionToken;
        if (!sessionToken) {
            this.logger.debug(`No session token for client ${clientId}, skipping subscription update`);
            return;
        }

        // Update session with current channels
        const channels = Array.from(client.channels);
        await this.sessionService.updateSubscriptions(sessionToken, channels);
        this.logger.debug(`Updated session subscriptions for client ${clientId}: ${channels.length} channels`);
    }

    /**
     * Get next monotonic sequence number for a channel
     */
    getNextSequence(channel) {
        const current = this.channelSequences.get(channel) || 0;
        const next = current + 1;
        this.channelSequences.set(channel, next);
        return next;
    }

    /**
     * Validate and rate-limit a message before processing
     * @param {string} clientId - Client identifier
     * @param {string} rawMessage - Raw message string from client
     * @returns {Promise<object|null>} - Parsed and validated message, or null if rejected
     */
    async validateAndRateLimit(clientId, rawMessage) {
        try {
            // Parse JSON
            const message = JSON.parse(rawMessage);

            // Validate structure (service + action required, service whitelist)
            this.validator.validateStructure(message);

            // Validate payload size (64KB limit)
            this.validator.validatePayloadSize(message);

            // Validate channel name if present
            if (message.channelId) {
                this.validator.validateChannelName(message.channelId);
            }

            // Detect message type for rate limiting
            const messageType = this.rateLimiter.detectMessageType(message);

            // Check rate limit
            const rateLimitResult = await this.rateLimiter.checkLimit(clientId, messageType);
            if (!rateLimitResult.allowed) {
                this.sendError(clientId, 'RATE_LIMIT_EXCEEDED',
                    `Rate limit exceeded: ${rateLimitResult.current}/${rateLimitResult.limit} msgs/sec`);
                return null;
            }

            return message;
        } catch (error) {
            if (error instanceof ValidationError) {
                // Log sanitized payload summary for debugging malformed clients
                let message = null;
                try { message = JSON.parse(rawMessage); } catch (e) { /* ignore parse errors */ }
                this.logger.warn('Message validation failed', {
                    clientId,
                    code: error.code,
                    message: error.message,
                    context: error.context,
                    payloadPreview: {
                        service: message?.service,
                        action: message?.action,
                        size: typeof rawMessage === 'string' ? rawMessage.length : Buffer.byteLength(rawMessage)
                    }
                });
                this.sendError(clientId, error.code, error.message);
            } else if (error instanceof SyntaxError) {
                this.logger.warn('Message validation failed', {
                    clientId,
                    code: 'INVALID_JSON',
                    message: error.message,
                    payloadPreview: {
                        size: typeof rawMessage === 'string' ? rawMessage.length : Buffer.byteLength(rawMessage)
                    }
                });
                this.sendError(clientId, 'INVALID_JSON', 'Message must be valid JSON');
            } else {
                this.logger.error(`Message validation error for ${clientId}:`, { message: error.message, stack: error.stack, rawPreview: typeof rawMessage === 'string' ? rawMessage.slice(0, 200) : 'binary' });
                this.sendError(clientId, 'INTERNAL_ERROR', 'Failed to process message');
            }
            return null;
        }
    }

    /**
     * Send an error message to a client
     * @param {string} clientId - Client identifier
     * @param {string} code - Error code
     * @param {string} message - Error message
     */
    sendError(clientId, code, message) {
        this.sendToClient(clientId, {
            type: 'error',
            code,
            message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Send a message to a specific channel with intelligent routing
     */
    async sendToChannel(channel, message, excludeClientId = null) {
        // ---- Wave 4c step 2: owner-aware routing (flag-gated) ----------------
        // The env-var pre-check below is the *only* code that runs on the
        // hot path when WSG_ENABLE_OWNERSHIP_ROUTING is unset/false — so the
        // flag-off behavior is byte-identical to today (no require, no
        // singleton bootstrap, no logger calls, no allocations beyond the
        // single string read).
        //
        // When the flag IS on, we lazy-require room-ownership-service inside
        // the method (NEVER at the top of the file) so that tests which do
        // not exercise the flag never transitively instantiate the gateway
        // cluster singleton. We memoize the resolved service on `this` after
        // the first successful resolution; the first hot-path call after
        // flag-on simply kicks off bootstrap and falls through. Subsequent
        // calls do an O(1) Map lookup via getOwner().
        //
        // distributed-core v0.4.3 shipped peer-addressed delivery via
        // `PeerMessaging.sendToPeer(peerId, topic, payload)`, and v0.5.1
        // added at-least-once delivery semantics. When the resolved service
        // exposes a PeerMessaging instance (`getPeerMessaging()`), we forward
        // cross-node ownership messages directly to the owning peer with
        // `deliverySemantics: 'at-least-once'` — this is the production
        // unicast path that closes DC-PIPELINE-7. Any peer-send failure
        // (PeerNotFoundError / PeerNotAliveError / transport throw) falls
        // through to the Redis fan-out below so messages are NEVER dropped.
        const ownershipFlagRaw = process.env.WSG_ENABLE_OWNERSHIP_ROUTING;
        if (ownershipFlagRaw && String(ownershipFlagRaw).trim().toLowerCase() === 'true') {
            try {
                const svc = this._roomOwnershipServiceCached;
                if (svc && svc.isEnabled && svc.isEnabled()) {
                    const ownership = svc.getOwner(channel);
                    if (ownership && ownership.isLocal === false) {
                        const peerMessaging = svc.getPeerMessaging && svc.getPeerMessaging();
                        if (peerMessaging && typeof peerMessaging.sendToPeer === 'function') {
                            // Build a topic-addressed envelope mirroring the
                            // Redis CHANNEL_MESSAGE shape so the receiving
                            // node's onPeerMessage handler can dispatch to
                            // local subscribers identically. We do NOT
                            // include `targetNodes` here — peer-send is
                            // already point-to-point.
                            const seq = this.getNextSequence(channel);
                            const peerPayload = {
                                type: this.messageTypes.CHANNEL_MESSAGE,
                                channel,
                                message,
                                excludeClientId,
                                fromNode: this.nodeManager.nodeId,
                                seq,
                                timestamp: new Date().toISOString(),
                            };
                            try {
                                await peerMessaging.sendToPeer(
                                    ownership.ownerId,
                                    `wsg.channel.${channel}`,
                                    peerPayload,
                                    { deliverySemantics: 'at-least-once' },
                                );
                                // Best-effort metrics. Lazy-require so this
                                // module remains importable in environments
                                // (tests) that don't init the metrics layer.
                                try {
                                    // eslint-disable-next-line global-require
                                    const m = require('../observability/metrics');
                                    if (m && typeof m.recordPeerRoutedOk === 'function') {
                                        m.recordPeerRoutedOk();
                                    }
                                } catch (_metricsErr) { /* metrics optional */ }
                                this.logger.debug && this.logger.debug(
                                    `owner-aware route: delivered to ${ownership.ownerId}`,
                                    { channelId: channel },
                                );
                                // Locally also deliver to any subscribers on
                                // THIS node — the owner is responsible for
                                // its own local fan-out, but the sender's
                                // locally-subscribed clients (if any) still
                                // need the message. Mirror Redis semantics:
                                // the publishing node gets local-broadcast
                                // via the route channel handler; here we do
                                // it inline.
                                this.broadcastToLocalChannel(channel, message, excludeClientId);
                                return;
                            } catch (peerErr) {
                                this.logger.warn(
                                    `peer-send to ${ownership.ownerId} failed; falling back to Redis fan-out`,
                                    { channelId: channel, error: peerErr && peerErr.message },
                                );
                                try {
                                    // eslint-disable-next-line global-require
                                    const m = require('../observability/metrics');
                                    if (m && typeof m.recordPeerRoutedFallback === 'function') {
                                        m.recordPeerRoutedFallback();
                                    }
                                } catch (_metricsErr) { /* metrics optional */ }
                                // Fall through to Redis fan-out below.
                            }
                        } else {
                            // Service is wired but no PeerMessaging available
                            // (older distributed-core, or test wiring). Keep
                            // the previous log-only behavior so we still see
                            // intent in logs and Redis still fans out.
                            this.logger.info(
                                `owner-aware route: would forward to ${ownership.ownerId} (peer-send unavailable)`,
                                { channelId: channel },
                            );
                        }
                    }
                } else if (svc === undefined) {
                    // First flag-on call: kick off lazy resolution and cache
                    // the resolved instance. We do not await — broadcasts
                    // must not block on cluster bootstrap. Subsequent calls
                    // see the cached instance.
                    this._roomOwnershipServiceCached = null; // pending sentinel
                    // eslint-disable-next-line global-require
                    const { getRoomOwnershipService } = require('../services/room-ownership-service');
                    Promise.resolve()
                        .then(() => getRoomOwnershipService({ logger: this.logger }))
                        .then((resolved) => { this._roomOwnershipServiceCached = resolved; })
                        .catch(() => { this._roomOwnershipServiceCached = null; });
                }
            } catch (_e) {
                // Never let scaffolding break the broadcast path.
            }
        }
        // ---------------------------------------------------------------------

        if (!this.redisPublisher || !this.redisAvailable) {
            // Fallback to local broadcast when Redis is unavailable
            this.logger.debug(`Redis unavailable, broadcasting to local channel ${channel} only`);
            return this.broadcastToLocalChannel(channel, message, excludeClientId);
        }

        try {
            // Get nodes that have clients subscribed to this channel
            const targetNodes = await this.nodeManager.getNodesForChannel(channel);

            if (targetNodes.length === 0) {
                this.logger.debug(`No nodes found for channel ${channel}`);
                return;
            }

            const seq = this.getNextSequence(channel);
            const routedMessage = {
                type: this.messageTypes.CHANNEL_MESSAGE,
                channel,
                message,
                excludeClientId,
                fromNode: this.nodeManager.nodeId,
                seq,
                timestamp: new Date().toISOString(),
                targetNodes
            };

            // Publish to Redis with node targeting
            const redisChannel = `websocket:route:${channel}`;
            await this.redisPublisher.publish(redisChannel, JSON.stringify(routedMessage));

            this.logger.debug(`Message routed to ${targetNodes.length} nodes for channel ${channel}`);
        } catch (error) {
            this.logger.error(`Failed to route message to channel ${channel}:`, error);
            // Fallback to local broadcast
            this.broadcastToLocalChannel(channel, message, excludeClientId);
        }
    }

    /**
     * Send a direct message to a specific client
     */
    async sendToClient(clientId, message) {
        // Check if client is connected locally
        if (this.localClients.has(clientId)) {
            return this.sendToLocalClient(clientId, message);
        }

        if (!this.redisPublisher) {
            this.logger.warn(`Client ${clientId} not found locally and Redis not available`);
            return false;
        }

        try {
            // Find which node the client is connected to
            const targetNode = await this.nodeManager.getClientNode(clientId);

            if (!targetNode) {
                this.logger.warn(`Client ${clientId} not found in any node`);
                return false;
            }

            const routedMessage = {
                type: this.messageTypes.DIRECT_MESSAGE,
                clientId,
                message,
                fromNode: this.nodeManager.nodeId,
                targetNode,
                timestamp: new Date().toISOString()
            };

            // Publish to the specific node's direct message channel
            const redisChannel = `websocket:direct:${targetNode}`;
            await this.redisPublisher.publish(redisChannel, JSON.stringify(routedMessage));

            this.logger.debug(`Direct message sent to client ${clientId} on node ${targetNode}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send message to client ${clientId}:`, error);
            return false;
        }
    }

    /**
     * Broadcast a message to all connected clients
     */
    async broadcastToAll(message, excludeClientId = null) {
        // Always deliver to local clients first
        this.broadcastToLocalClients(message, excludeClientId);

        if (!this.redisPublisher) {
            return;
        }

        try {
            const routedMessage = {
                type: this.messageTypes.BROADCAST,
                message,
                excludeClientId,
                fromNode: this.nodeManager.nodeId,
                timestamp: new Date().toISOString()
            };

            // Broadcast to all nodes (remote nodes only — local already handled above)
            await this.redisPublisher.publish('websocket:broadcast:all', JSON.stringify(routedMessage));

            this.logger.debug('Message broadcasted to all nodes');
        } catch (error) {
            this.logger.error('Failed to broadcast message to remote nodes:', error);
            // Local clients already received the message above
        }
    }

    /**
     * Setup Redis connection health monitoring
     * Monitors error and ready events to track Redis availability
     */
    setupRedisHealthMonitoring() {
        if (!this.redisPublisher || !this.redisSubscriber) {
            this.redisAvailable = false;
            return;
        }

        // Monitor redisPublisher errors
        this.redisPublisher.on('error', (err) => {
            const connectionErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
            if (connectionErrors.includes(err.code)) {
                this.redisAvailable = false;
                this.logger.warn('Redis unavailable, using local cache');
            }
        });

        // Monitor redisPublisher ready state
        this.redisPublisher.on('ready', () => {
            this.redisAvailable = true;
            this.logger.info('Redis connection restored');
        });

        // Monitor redisSubscriber errors
        this.redisSubscriber.on('error', (err) => {
            const connectionErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
            if (connectionErrors.includes(err.code)) {
                this.redisAvailable = false;
                this.logger.warn('Redis unavailable, using local cache');
            }
        });

        // Monitor redisSubscriber ready state
        this.redisSubscriber.on('ready', () => {
            this.redisAvailable = true;
            this.logger.info('Redis connection restored');
        });

        this.logger.debug('Redis health monitoring initialized');
    }

    /**
     * Setup Redis message handlers for node-to-node communication
     */
    async setupNodeMessageHandlers() {
        if (!this.redisSubscriber) return;

        try {
            // Subscribe to direct messages for this node
            const directChannel = `websocket:direct:${this.nodeManager.nodeId}`;
            await this.redisSubscriber.subscribe(directChannel, this.handleDirectMessage.bind(this));

            // Subscribe to broadcast messages
            await this.redisSubscriber.subscribe('websocket:broadcast:all', this.handleBroadcastMessage.bind(this));

            this.logger.info(`Node message handlers setup for node ${this.nodeManager.nodeId}`);
        } catch (error) {
            this.logger.error('Failed to setup node message handlers:', error);
        }
    }

    /**
     * Subscribe to a Redis channel for routing messages
     */
    async subscribeToRedisChannel(channel) {
        // DC-PIPELINE-7: register the peer-receive handler regardless of
        // Redis state — peer delivery operates over the cluster transport
        // and is independent of Redis availability.
        this._registerPeerChannelHandler(channel);

        if (!this.redisSubscriber || this.subscribedChannels.has(channel)) return;

        // Track subscription attempt even if Redis is unavailable
        if (!this.redisAvailable) {
            this.logger.debug(`Redis unavailable, deferring subscription to channel: ${channel}`);
            // Still add to subscribedChannels to prevent repeated attempts
            this.subscribedChannels.add(channel);
            return;
        }

        try {
            const redisChannel = `websocket:route:${channel}`;
            await this.redisSubscriber.subscribe(redisChannel, this.handleChannelMessage.bind(this));
            this.subscribedChannels.add(channel);

            this.logger.debug(`Subscribed to Redis channel: ${redisChannel}`);
        } catch (error) {
            this.logger.error(`Failed to subscribe to Redis channel ${channel}:`, error);
            // Still add to subscribedChannels to mark the attempt
            this.subscribedChannels.add(channel);
        }
    }

    /**
     * Unsubscribe from a Redis channel
     */
    async unsubscribeFromRedisChannel(channel) {
        // DC-PIPELINE-7: drop the peer-receive handler regardless of Redis
        // state so we don't accumulate stale registrations.
        this._unregisterPeerChannelHandler(channel);

        if (!this.redisSubscriber || !this.subscribedChannels.has(channel)) return;

        try {
            const redisChannel = `websocket:route:${channel}`;
            await this.redisSubscriber.unsubscribe(redisChannel);
            this.subscribedChannels.delete(channel);
            this.channelSequences.delete(channel);

            this.logger.debug(`Unsubscribed from Redis channel: ${redisChannel}`);
        } catch (error) {
            this.logger.error(`Failed to unsubscribe from Redis channel ${channel}:`, error);
        }
    }

    // -------------------------------------------------------------------------
    // DC-PIPELINE-7: peer-addressed receive-side fan-out.
    //
    // Sender side (this same module above) calls
    //   peerMessaging.sendToPeer(ownerId, `wsg.channel.${channel}`, payload, …)
    // when room ownership resolves to a remote node. PeerMessaging's
    // `onPeerMessage(topic, handler)` is exact-match (no prefix/wildcard), so
    // we register one handler per locally-subscribed channel — driven by the
    // existing subscribeToRedisChannel / unsubscribeFromRedisChannel flow.
    //
    // PeerMessaging auto-acks at-least-once envelopes regardless of handler
    // outcome, so we MUST log + meter handler errors locally; the sender
    // will not retry. We still call broadcastToLocalChannel synchronously
    // and reuse the same `(channel, message, excludeClientId)` shape the
    // Redis route handler uses (handleChannelMessage above) so subscribers
    // see byte-identical payloads from either path.
    // -------------------------------------------------------------------------

    /**
     * Wire a distributed-core PeerMessaging instance into this router.
     * Idempotent: a second call with the SAME instance is a no-op; a call
     * with a different instance detaches old handlers first.
     *
     * Should be called at gateway startup once `bootstrapGatewayCluster()`
     * resolves (see server.js initialize()). Safe to call when no channels
     * have been subscribed yet — handlers register lazily as channels join.
     *
     * @param {object} peerMessaging - distributed-core PeerMessaging instance
     */
    attachPeerMessaging(peerMessaging) {
        if (!peerMessaging || typeof peerMessaging.onPeerMessage !== 'function') {
            this.logger.debug && this.logger.debug(
                'attachPeerMessaging: instance missing or onPeerMessage unavailable; skipping',
            );
            return;
        }
        if (this.peerMessaging === peerMessaging) {
            // Already attached to this same instance — nothing to do.
            return;
        }
        if (this.peerMessaging) {
            // Replace: detach old handlers cleanly first.
            this.detachPeerMessaging();
        }
        this.peerMessaging = peerMessaging;

        // Backfill: for any channels already locally subscribed, register
        // their peer handler now so a hot-attach (e.g. tests, or the
        // bootstrap resolving after the first client subscribes) doesn't
        // miss messages.
        for (const channel of this.subscribedChannels) {
            this._registerPeerChannelHandler(channel);
        }

        this.logger.info && this.logger.info(
            'PeerMessaging attached for channel receive-side fan-out',
            { backfilled: this.subscribedChannels.size },
        );
    }

    /**
     * Drop all per-channel peer handlers and forget the PeerMessaging
     * instance. Safe to call when not attached.
     */
    detachPeerMessaging() {
        for (const [, unsub] of this._peerMessageUnsubs) {
            try { if (typeof unsub === 'function') unsub(); } catch (_e) { /* noop */ }
        }
        this._peerMessageUnsubs.clear();
        this.peerMessaging = null;
    }

    /**
     * Register a `wsg.channel.<channel>` handler with the attached
     * PeerMessaging. Idempotent per channel. No-op when no PeerMessaging
     * is attached yet (attachPeerMessaging will backfill).
     */
    _registerPeerChannelHandler(channel) {
        if (!this.peerMessaging || typeof this.peerMessaging.onPeerMessage !== 'function') return;
        if (this._peerMessageUnsubs.has(channel)) return; // already registered

        const topic = `wsg.channel.${channel}`;
        try {
            const unsub = this.peerMessaging.onPeerMessage(topic, (ctx) => {
                this._handlePeerChannelMessage(channel, ctx);
            });
            this._peerMessageUnsubs.set(channel, unsub);
            this.logger.debug && this.logger.debug(
                `peer-receive: registered handler for topic ${topic}`,
            );
        } catch (err) {
            this.logger.warn && this.logger.warn(
                `peer-receive: onPeerMessage(${topic}) failed`,
                { error: err && err.message },
            );
        }
    }

    /**
     * Drop the handler for a channel (called from unsubscribeFromRedisChannel).
     * Idempotent. No-op when not registered.
     */
    _unregisterPeerChannelHandler(channel) {
        const unsub = this._peerMessageUnsubs.get(channel);
        if (!unsub) return;
        try {
            if (typeof unsub === 'function') unsub();
        } catch (_e) { /* noop */ }
        this._peerMessageUnsubs.delete(channel);
    }

    /**
     * Inbound `wsg.channel.<channel>` envelope dispatcher.
     *
     * The sender wraps a CHANNEL_MESSAGE payload that mirrors the Redis
     * fan-out shape: { type, channel, message, excludeClientId, fromNode,
     * seq, timestamp }. We attach the same `_meta` block the Redis path
     * uses so client-side gap detection sees identical sequencing
     * regardless of which transport carried the frame.
     *
     * Handler errors are caught + metered (handler_error). PeerMessaging
     * auto-acks at-least-once envelopes regardless, so a throw here does
     * NOT trigger a sender retry — emit the metric so we can alert on
     * silent fan-out drops.
     */
    _handlePeerChannelMessage(channel, ctx) {
        try {
            const payload = (ctx && ctx.payload) || {};
            const fromNode = payload.fromNode || (ctx && ctx.from) || null;

            // Skip self-loops: a node should never receive its own broadcast.
            // (PeerMessaging supports loopback — be defensive.)
            if (fromNode && fromNode === this.nodeManager.nodeId) {
                return;
            }

            const inner = (payload.message !== undefined) ? payload.message : payload;
            const messageWithMeta = (typeof inner === 'object' && inner !== null)
                ? { ...inner, _meta: { seq: payload.seq, nodeId: fromNode, timestamp: payload.timestamp } }
                : { data: inner, _meta: { seq: payload.seq, nodeId: fromNode, timestamp: payload.timestamp } };

            this.broadcastToLocalChannel(channel, messageWithMeta, payload.excludeClientId || null);

            // Notify interceptors (e.g. CRDT service applies remote updates
            // to local Y.Doc) — mirror the Redis path's behavior.
            for (const [, callback] of this.channelMessageInterceptors) {
                try {
                    callback(channel, payload.message, fromNode);
                } catch (interceptorErr) {
                    this.logger.error('Channel message interceptor error (peer path):', interceptorErr);
                }
            }

            this.logger.debug && this.logger.debug(
                `peer-receive: fanned out channel ${channel} from ${fromNode}`,
                { seq: payload.seq },
            );

            try {
                // eslint-disable-next-line global-require
                const m = require('../observability/metrics');
                if (m && typeof m.recordPeerReceivedOk === 'function') {
                    m.recordPeerReceivedOk();
                }
            } catch (_metricsErr) { /* metrics optional */ }
        } catch (err) {
            this.logger.error && this.logger.error(
                `peer-receive: handler error on channel ${channel}`,
                { error: err && err.message, stack: err && err.stack },
            );
            try {
                // eslint-disable-next-line global-require
                const m = require('../observability/metrics');
                if (m && typeof m.recordPeerReceivedHandlerError === 'function') {
                    m.recordPeerReceivedHandlerError();
                }
            } catch (_metricsErr) { /* metrics optional */ }
        }
    }

    /**
     * Handle direct messages from other nodes
     */
    handleDirectMessage(message, channel) {
        try {
            const data = JSON.parse(message);

            if (data.type === this.messageTypes.DIRECT_MESSAGE) {
                this.sendToLocalClient(data.clientId, data.message);
            }
        } catch (error) {
            this.logger.error('Failed to handle direct message:', error);
        }
    }

    /**
     * Handle broadcast messages from other nodes
     */
    handleBroadcastMessage(message, channel) {
        try {
            const data = JSON.parse(message);

            if (data.type === this.messageTypes.BROADCAST && data.fromNode !== this.nodeManager.nodeId) {
                this.broadcastToLocalClients(data.message, data.excludeClientId);
            }
        } catch (error) {
            this.logger.error('Failed to handle broadcast message:', error);
        }
    }

    /**
     * Handle channel messages from other nodes
     */
    handleChannelMessage(message, redisChannel) {
        try {
            const data = JSON.parse(message);

            if (data.type === this.messageTypes.CHANNEL_MESSAGE) {
                // Only process if this node is in the target nodes list
                if (data.targetNodes.includes(this.nodeManager.nodeId)) {
                    // Attach _meta with ordering info for client-side gap detection
                    const messageWithMeta = typeof data.message === 'object' && data.message !== null
                        ? { ...data.message, _meta: { seq: data.seq, nodeId: data.fromNode, timestamp: data.timestamp } }
                        : { data: data.message, _meta: { seq: data.seq, nodeId: data.fromNode, timestamp: data.timestamp } };
                    this.broadcastToLocalChannel(data.channel, messageWithMeta, data.excludeClientId);

                    // Notify interceptors (e.g. CRDT service applies remote updates to local Y.Doc)
                    if (data.fromNode !== this.nodeManager.nodeId) {
                        for (const [, callback] of this.channelMessageInterceptors) {
                            try {
                                callback(data.channel, data.message, data.fromNode);
                            } catch (interceptorErr) {
                                this.logger.error('Channel message interceptor error:', interceptorErr);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error('Failed to handle channel message:', error);
        }
    }

    /**
     * Send message to a local client
     */
    sendToLocalClient(clientId, message) {
        const client = this.localClients.get(clientId);
        if (client && client.ws.readyState === 1) { // WebSocket.OPEN
            try {
                const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
                client.ws.send(messageStr);
                return true;
            } catch (error) {
                this.logger.error(`Failed to send to local client ${clientId}:`, error);
                // Remove dead connection
                this.unregisterLocalClient(clientId);
            }
        }
        return false;
    }

    /**
     * Broadcast to local clients on a specific channel
     * Uses batched sends with setImmediate for large recipient lists (>50)
     * to avoid blocking the event loop.
     */
    broadcastToLocalChannel(channel, message, excludeClientId = null) {
        // Use the nodeManager reverse index for O(1) channel -> clients lookup
        // instead of iterating all local clients.
        const channelClients = this.nodeManager.getClientsForChannel(channel);
        const recipients = [];

        for (const clientId of channelClients) {
            if (clientId === excludeClientId) continue;
            recipients.push(clientId);
        }

        if (recipients.length === 0) return 0;

        // For small recipient lists, send synchronously (no overhead)
        if (recipients.length <= BROADCAST_BATCH_SIZE) {
            let sentCount = 0;
            for (const clientId of recipients) {
                if (this.sendToLocalClient(clientId, message)) {
                    sentCount++;
                }
            }
            this.logger.debug(`Broadcasted to ${sentCount} local clients on channel ${channel}`);
            return sentCount;
        }

        // For large recipient lists, batch with setImmediate to yield event loop
        let sentCount = 0;
        let index = 0;

        const sendBatch = () => {
            const end = Math.min(index + BROADCAST_BATCH_SIZE, recipients.length);
            for (; index < end; index++) {
                if (this.sendToLocalClient(recipients[index], message)) {
                    sentCount++;
                }
            }

            if (index < recipients.length) {
                setImmediate(sendBatch);
            } else {
                this.logger.debug(`Broadcasted to ${sentCount}/${recipients.length} local clients on channel ${channel} (batched)`);
            }
        };

        sendBatch();
        return recipients.length; // Return expected count (actual may differ due to closed connections)
    }

    /**
     * Broadcast to all local clients
     * Uses batched sends with setImmediate for large recipient lists (>50)
     * to avoid blocking the event loop.
     */
    broadcastToLocalClients(message, excludeClientId = null) {
        const recipients = [];

        for (const [clientId] of this.localClients) {
            if (clientId === excludeClientId) continue;
            recipients.push(clientId);
        }

        if (recipients.length === 0) return 0;

        // For small recipient lists, send synchronously (no overhead)
        if (recipients.length <= BROADCAST_BATCH_SIZE) {
            let sentCount = 0;
            for (const clientId of recipients) {
                if (this.sendToLocalClient(clientId, message)) {
                    sentCount++;
                }
            }
            this.logger.debug(`Broadcasted to ${sentCount} local clients`);
            return sentCount;
        }

        // For large recipient lists, batch with setImmediate to yield event loop
        let sentCount = 0;
        let index = 0;

        const sendBatch = () => {
            const end = Math.min(index + BROADCAST_BATCH_SIZE, recipients.length);
            for (; index < end; index++) {
                if (this.sendToLocalClient(recipients[index], message)) {
                    sentCount++;
                }
            }

            if (index < recipients.length) {
                setImmediate(sendBatch);
            } else {
                this.logger.debug(`Broadcasted to ${sentCount}/${recipients.length} local clients (batched)`);
            }
        };

        sendBatch();
        return recipients.length; // Return expected count (actual may differ due to closed connections)
    }

    /**
     * Get statistics about this node's routing
     */
    getStats() {
        return {
            nodeId: this.nodeManager.nodeId,
            localClients: this.localClients.size,
            subscribedChannels: this.subscribedChannels.size,
            channelDistribution: this.getChannelDistribution()
        };
    }

    /**
     * Get the set of local client IDs subscribed to a given channel
     * @param {string} channel
     * @returns {string[]} Array of clientIds subscribed to the channel
     */
    getChannelClients(channel) {
        return Array.from(this.nodeManager.getClientsForChannel(channel));
    }

    /**
     * Get distribution of clients across channels
     */
    getChannelDistribution() {
        const distribution = {};

        for (const client of this.localClients.values()) {
            for (const channel of client.channels) {
                distribution[channel] = (distribution[channel] || 0) + 1;
            }
        }

        return distribution;
    }

    /**
     * Cleanup when shutting down
     */
    async cleanup() {
        this.logger.info('Cleaning up message router...');

        // Unregister all local clients
        const clientIds = Array.from(this.localClients.keys());
        for (const clientId of clientIds) {
            try {
                await this.unregisterLocalClient(clientId);
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn(`Error unregistering client ${clientId} during cleanup:`, error.message);
                }
            }
        }

        // Unsubscribe from all Redis channels
        for (const channel of this.subscribedChannels) {
            try {
                await this.unsubscribeFromRedisChannel(channel);
            } catch (error) {
                if (error.name !== 'ClientClosedError') {
                    this.logger.warn(`Error unsubscribing from channel ${channel} during cleanup:`, error.message);
                }
            }
        }

        // DC-PIPELINE-7: drop peer-receive handlers so we don't leak
        // listeners or fire callbacks against a torn-down router.
        this.detachPeerMessaging();

        this.localClients.clear();
        this.subscribedChannels.clear();
        this.channelSequences.clear();

        this.logger.info('Message router cleanup completed');
    }
}

module.exports = MessageRouter;
