/**
 * WebSocket Gateway Client SDK
 * Unified interface for all WebSocket Gateway services
 * Supports cursor, chat, presence, reaction, and extensible for future services
 */

class WebSocketGatewaySDK {
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || 'ws://localhost:8080';
        this.reconnectInterval = options.reconnectInterval || 3000;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
        this.debug = options.debug || false;
        this.autoConnect = options.autoConnect !== false;
        
        // Connection state
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.clientId = null;
        this.nodeId = null;
        this.enabledServices = [];
        
        // Service handlers and event emitters
        this.messageHandlers = new Map();
        this.errorHandlers = new Map();
        this.eventEmitters = new Map();
        
        // Service-specific state
        this.serviceState = {
            cursor: {
                subscriptions: new Set(),
                cursors: new Map(), // clientId -> cursor data
                mode: 'freeform',
                config: {}
            },
            chat: {
                channels: new Set(),
                history: new Map(), // channel -> Array of messages
                activeUsers: new Map() // channel -> Set of user IDs
            },
            presence: {
                subscriptions: new Set(),
                users: new Map(), // clientId -> presence data
                channels: new Map() // channel -> Map of users
            },
            reaction: {
                subscriptions: new Set(),
                recentReactions: new Map(), // channel -> Array of recent reactions
                availableReactions: new Map() // emoji -> effect data
            }
        };
        
        // Initialize message handlers
        this.setupMessageHandlers();
        
        // Initialize connection if auto-connect is enabled
        if (this.autoConnect) {
            this.connect();
        }
    }

    // Core WebSocket connection methods
    connect() {
        try {
            this.ws = new WebSocket(this.wsUrl);
            this.setupEventHandlers();
            this.log('Connecting to WebSocket Gateway...');
        } catch (error) {
            this.logError('Failed to create WebSocket connection:', error);
            this.scheduleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.log('Connected to WebSocket Gateway');
            this.emit('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                this.logError('Failed to parse message:', error);
            }
        };

        this.ws.onclose = (event) => {
            this.connected = false;
            this.log('WebSocket connection closed:', event.code, event.reason);
            this.emit('disconnected');
            
            if (event.code !== 1000) { // Not a normal closure
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            this.logError('WebSocket error:', error);
            this.emit('error', error);
        };
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.log(`Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), this.reconnectInterval);
        } else {
            this.logError('Max reconnection attempts reached');
            this.emit('maxReconnectAttemptsReached');
        }
    }

    handleMessage(message) {
        this.log('Received message:', message);
        
        // Handle connection confirmation
        if (message.type === 'connection') {
            this.clientId = message.clientId;
            this.nodeId = message.nodeId;
            this.enabledServices = message.enabledServices || [];
            this.log('Client connected:', { clientId: this.clientId, nodeId: this.nodeId, services: this.enabledServices });
            this.emit('connected', { clientId: this.clientId, nodeId: this.nodeId, enabledServices: this.enabledServices });
            return;
        }

        // Handle error messages
        if (message.type === 'error') {
            this.logError('Server error:', message.message);
            this.emit('error', { message: message.message, availableServices: message.availableServices });
            return;
        }

        // Route message to appropriate service handler
        const serviceType = message.type;
        if (this.messageHandlers.has(serviceType)) {
            const serviceHandlers = this.messageHandlers.get(serviceType);
            serviceHandlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    this.logError(`Error in ${serviceType} handler:`, error);
                }
            });
        } else {
            this.log('No handler for message type:', serviceType);
        }

        // Emit service-specific events
        this.emit(serviceType, message);
        this.emit(`${serviceType}:${message.action}`, message);
    }

    send(message) {
        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            this.log('Sent message:', message);
        } else {
            this.logError('Cannot send message: WebSocket not connected');
        }
    }

    // Event handling system
    on(event, handler) {
        if (!this.eventEmitters.has(event)) {
            this.eventEmitters.set(event, []);
        }
        this.eventEmitters.get(event).push(handler);
        return this; // Allow chaining
    }

    off(event, handler) {
        const handlers = this.eventEmitters.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
        return this; // Allow chaining
    }

    once(event, handler) {
        const onceHandler = (data) => {
            handler(data);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
        return this; // Allow chaining
    }

    emit(event, data) {
        const handlers = this.eventEmitters.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.logError(`Error in ${event} handler:`, error);
                }
            });
        }
        
        // Also emit to message handlers for backward compatibility
        const messageHandlers = this.messageHandlers.get(event);
        if (messageHandlers) {
            messageHandlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.logError(`Error in ${event} message handler:`, error);
                }
            });
        }
    }

    // Service registration methods
    registerMessageHandler(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    unregisterMessageHandler(messageType, handler) {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    // Chat Service Methods
    chat = {
        // Join a chat channel
        join: (channel, metadata = {}) => {
            if (!channel) {
                this.logError('Chat join: channel is required');
                return;
            }
            
            this.serviceState.chat.channels.add(channel);
            this.send({
                service: 'chat',
                action: 'join',
                channel,
                metadata
            });
        },

        // Leave a chat channel
        leave: (channel) => {
            if (!channel) {
                this.logError('Chat leave: channel is required');
                return;
            }
            
            this.serviceState.chat.channels.delete(channel);
            this.send({
                service: 'chat',
                action: 'leave',
                channel
            });
        },

        // Send a message to a channel
        send: (channel, message, metadata = {}) => {
            if (!channel || !message) {
                this.logError('Chat send: channel and message are required');
                return;
            }
            
            this.send({
                service: 'chat',
                action: 'send',
                channel,
                message,
                metadata
            });
        },

        // Get chat history for a channel
        getHistory: (channel, limit = 50) => {
            if (!channel) {
                this.logError('Chat getHistory: channel is required');
                return;
            }
            
            this.send({
                service: 'chat',
                action: 'history',
                channel,
                limit
            });
        },

        // Get current chat state
        getState: () => ({
            channels: Array.from(this.serviceState.chat.channels),
            history: Object.fromEntries(this.serviceState.chat.history),
            activeUsers: Object.fromEntries(this.serviceState.chat.activeUsers)
        })
    };

    // Presence Service Methods
    presence = {
        // Set user presence status
        set: (status, metadata = {}, channels = []) => {
            if (!status) {
                this.logError('Presence set: status is required');
                return;
            }
            
            this.send({
                service: 'presence',
                action: 'set',
                status,
                metadata,
                channels
            });
        },

        // Get presence for a channel or user
        get: (channel) => {
            this.send({
                service: 'presence',
                action: 'get',
                channel
            });
        },

        // Subscribe to presence updates
        subscribe: (channel) => {
            if (!channel) {
                this.logError('Presence subscribe: channel is required');
                return;
            }
            
            this.serviceState.presence.subscriptions.add(channel);
            this.send({
                service: 'presence',
                action: 'subscribe',
                channel
            });
        },

        // Unsubscribe from presence updates
        unsubscribe: (channel) => {
            if (!channel) {
                this.logError('Presence unsubscribe: channel is required');
                return;
            }
            
            this.serviceState.presence.subscriptions.delete(channel);
            this.send({
                service: 'presence',
                action: 'unsubscribe',
                channel
            });
        },

        // Send heartbeat
        heartbeat: (channels = []) => {
            this.send({
                service: 'presence',
                action: 'heartbeat',
                channels
            });
        },

        // Get current presence state
        getState: () => ({
            subscriptions: Array.from(this.serviceState.presence.subscriptions),
            users: Object.fromEntries(this.serviceState.presence.users),
            channels: Object.fromEntries(this.serviceState.presence.channels)
        })
    };

    // Reaction Service Methods
    reaction = {
        // Subscribe to reactions in a channel
        subscribe: (channel) => {
            if (!channel) {
                this.logError('Reaction subscribe: channel is required');
                return;
            }
            
            this.serviceState.reaction.subscriptions.add(channel);
            this.send({
                service: 'reaction',
                action: 'subscribe',
                channel
            });
        },

        // Unsubscribe from reactions
        unsubscribe: (channel) => {
            if (!channel) {
                this.logError('Reaction unsubscribe: channel is required');
                return;
            }
            
            this.serviceState.reaction.subscriptions.delete(channel);
            this.send({
                service: 'reaction',
                action: 'unsubscribe',
                channel
            });
        },

        // Send a reaction
        send: (channel, emoji, metadata = {}) => {
            if (!channel || !emoji) {
                this.logError('Reaction send: channel and emoji are required');
                return;
            }
            
            this.send({
                service: 'reaction',
                action: 'send',
                channel,
                emoji,
                metadata
            });
        },

        // Get available reactions
        getAvailable: () => {
            this.send({
                service: 'reaction',
                action: 'getAvailable'
            });
        },

        // Get current reaction state
        getState: () => ({
            subscriptions: Array.from(this.serviceState.reaction.subscriptions),
            recentReactions: Object.fromEntries(this.serviceState.reaction.recentReactions),
            availableReactions: Object.fromEntries(this.serviceState.reaction.availableReactions)
        })
    };

    // Cursor Service Methods
    cursor = {
        // Subscribe to cursor updates for a channel
        subscribe: (channel, mode = 'freeform') => {
            this.serviceState.cursor.subscriptions.add(channel);
            this.send({
                service: 'cursor',
                action: 'subscribe',
                channel,
                mode
            });
        },

        // Unsubscribe from cursor updates
        unsubscribe: (channel) => {
            this.serviceState.cursor.subscriptions.delete(channel);
            this.send({
                service: 'cursor',
                action: 'unsubscribe',
                channel
            });
        },

        // Update cursor position
        update: (channel, position, metadata = {}) => {
            this.send({
                service: 'cursor',
                action: 'update',
                channel,
                position,
                metadata: {
                    ...metadata,
                    mode: this.serviceState.cursor.mode
                }
            });
        },

        // Get current cursors in channel
        get: (channel) => {
            this.send({
                service: 'cursor',
                action: 'get',
                channel
            });
        },

        // Get supported cursor modes
        getModes: () => {
            this.send({
                service: 'cursor',
                action: 'modes'
            });
        },

        // Configure cursor mode and settings
        configure: (mode, config = {}) => {
            this.serviceState.cursor.mode = mode;
            this.serviceState.cursor.config = { ...this.serviceState.cursor.config, ...config };
        },

        // Get current cursor state
        getState: () => ({
            mode: this.serviceState.cursor.mode,
            config: this.serviceState.cursor.config,
            subscriptions: Array.from(this.serviceState.cursor.subscriptions),
            cursors: Object.fromEntries(this.serviceState.cursor.cursors)
        }),

        // Cursor mode-specific utilities
        freeform: {
            update: (channel, x, y, metadata = {}) => {
                this.send({
                    service: 'cursor',
                    action: 'update',
                    channel,
                    position: { x, y },
                    metadata: { ...metadata, mode: 'freeform' }
                });
            }
        },

        table: {
            update: (channel, row, col, metadata = {}) => {
                this.send({
                    service: 'cursor',
                    action: 'update',
                    channel,
                    position: { row, col },
                    metadata: { ...metadata, mode: 'table' }
                });
            }
        },

        text: {
            update: (channel, position, selectionData = null, hasSelection = false, metadata = {}) => {
                this.send({
                    service: 'cursor',
                    action: 'update',
                    channel,
                    position: { position },
                    metadata: { 
                        ...metadata, 
                        mode: 'text',
                        selection: selectionData,
                        hasSelection: hasSelection
                    }
                });
            }
        },

        canvas: {
            update: (channel, x, y, tool, color, size, metadata = {}) => {
                this.send({
                    service: 'cursor',
                    action: 'update',
                    channel,
                    position: { x, y },
                    metadata: { 
                        ...metadata, 
                        mode: 'canvas',
                        tool,
                        color,
                        size
                    }
                });
            }
        }
    };

    setupMessageHandlers() {
        // Register cursor message handler
        this.on('cursor', (message) => {
            this.handleCursorMessage(message);
        });

        // Register chat message handler
        this.on('chat', (message) => {
            this.handleChatMessage(message);
        });

        // Register presence message handler
        this.on('presence', (message) => {
            this.handlePresenceMessage(message);
        });

        // Register reaction message handler
        this.on('reaction', (message) => {
            this.handleReactionMessage(message);
        });
    }

    handleCursorMessage(message) {
        this.log('Handling cursor message:', message);
        
        switch (message.action) {
            case 'update':
                this.serviceState.cursor.cursors.set(message.cursor.clientId, message.cursor);
                this.emit('cursorUpdate', message.cursor);
                this.emit('cursor:update', message.cursor);
                break;
                
            case 'remove':
                this.serviceState.cursor.cursors.delete(message.clientId);
                this.emit('cursorRemove', message.clientId);
                this.emit('cursor:remove', { clientId: message.clientId });
                break;
                
            case 'subscribed':
                this.log('Cursor subscribed message:', message);
                this.log('Cursors in response:', message.cursors);
                this.emit('cursorSubscribed', message.channel, message.cursors || []);
                this.emit('cursor:subscribed', { channel: message.channel, cursors: message.cursors || [], mode: message.mode });
                // Store existing cursors
                if (message.cursors && Array.isArray(message.cursors)) {
                    message.cursors.forEach(cursor => {
                        this.serviceState.cursor.cursors.set(cursor.clientId, cursor);
                    });
                }
                break;
                
            case 'unsubscribed':
                this.emit('cursorUnsubscribed', message.channel);
                this.emit('cursor:unsubscribed', { channel: message.channel });
                break;
                
            case 'cursors':
                this.emit('cursorList', message.channel, message.cursors || []);
                break;
                
            case 'modes':
                this.emit('cursorModes', message.modes);
                break;
                
            case 'error':
                this.emit('cursorError', message.error);
                break;
                
            default:
                this.log('Unknown cursor action:', message.action);
        }
    }

    handleChatMessage(message) {
        this.log('Handling chat message:', message);
        
        switch (message.action) {
            case 'message':
                // Store message in history
                const channel = message.channel;
                if (!this.serviceState.chat.history.has(channel)) {
                    this.serviceState.chat.history.set(channel, []);
                }
                this.serviceState.chat.history.get(channel).push(message);
                
                this.emit('chatMessage', message);
                this.emit('chat:message', message);
                break;
                
            case 'joined':
                this.emit('chatJoined', { channel: message.channel });
                this.emit('chat:joined', { channel: message.channel });
                break;
                
            case 'left':
                this.emit('chatLeft', { channel: message.channel });
                this.emit('chat:left', { channel: message.channel });
                break;
                
            case 'history':
                // Store history
                if (message.messages) {
                    this.serviceState.chat.history.set(message.channel, message.messages);
                }
                this.emit('chatHistory', { channel: message.channel, messages: message.messages });
                this.emit('chat:history', { channel: message.channel, messages: message.messages });
                break;
                
            case 'error':
                this.emit('chatError', { message: message.message });
                this.emit('chat:error', { message: message.message });
                break;
                
            default:
                this.log('Unknown chat action:', message.action);
        }
    }

    handlePresenceMessage(message) {
        this.log('Handling presence message:', message);
        
        switch (message.action) {
            case 'update':
                this.serviceState.presence.users.set(message.clientId, message.presence);
                this.emit('presenceUpdate', { clientId: message.clientId, presence: message.presence });
                this.emit('presence:update', { clientId: message.clientId, presence: message.presence });
                break;
                
            case 'offline':
                this.serviceState.presence.users.delete(message.clientId);
                this.emit('presenceOffline', { clientId: message.clientId });
                this.emit('presence:offline', { clientId: message.clientId });
                break;
                
            case 'subscribed':
                if (message.users) {
                    message.users.forEach(user => {
                        this.serviceState.presence.users.set(user.clientId, user);
                    });
                }
                this.emit('presenceSubscribed', { channel: message.channel, users: message.users });
                this.emit('presence:subscribed', { channel: message.channel, users: message.users });
                break;
                
            case 'unsubscribed':
                this.emit('presenceUnsubscribed', { channel: message.channel });
                this.emit('presence:unsubscribed', { channel: message.channel });
                break;
                
            case 'get':
                this.emit('presenceGet', { channel: message.channel, users: message.users });
                this.emit('presence:get', { channel: message.channel, users: message.users });
                break;
                
            case 'error':
                this.emit('presenceError', { message: message.message });
                this.emit('presence:error', { message: message.message });
                break;
                
            default:
                this.log('Unknown presence action:', message.action);
        }
    }

    handleReactionMessage(message) {
        this.log('Handling reaction message:', message);
        
        switch (message.action) {
            case 'received':
                // Store reaction in recent reactions
                const channel = message.channel;
                if (!this.serviceState.reaction.recentReactions.has(channel)) {
                    this.serviceState.reaction.recentReactions.set(channel, []);
                }
                this.serviceState.reaction.recentReactions.get(channel).push(message);
                
                this.emit('reactionReceived', message);
                this.emit('reaction:received', message);
                break;
                
            case 'subscribed':
                this.emit('reactionSubscribed', { channel: message.channel });
                this.emit('reaction:subscribed', { channel: message.channel });
                break;
                
            case 'unsubscribed':
                this.emit('reactionUnsubscribed', { channel: message.channel });
                this.emit('reaction:unsubscribed', { channel: message.channel });
                break;
                
            case 'available':
                // Store available reactions
                if (message.reactions) {
                    message.reactions.forEach(reaction => {
                        this.serviceState.reaction.availableReactions.set(reaction.emoji, reaction);
                    });
                }
                this.emit('reactionAvailable', { reactions: message.reactions });
                this.emit('reaction:available', { reactions: message.reactions });
                break;
                
            case 'error':
                this.emit('reactionError', { message: message.message });
                this.emit('reaction:error', { message: message.message });
                break;
                
            default:
                this.log('Unknown reaction action:', message.action);
        }
    }

    // Utility methods
    log(...args) {
        if (this.debug) {
            console.log('[WebSocketGatewaySDK]', ...args);
        }
    }

    logError(...args) {
        console.error('[WebSocketGatewaySDK]', ...args);
    }

    // Cleanup
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Client disconnecting');
        }
    }

    destroy() {
        this.disconnect();
        this.messageHandlers.clear();
        this.errorHandlers.clear();
        this.eventEmitters.clear();
        
        // Clear all service state
        this.serviceState.cursor.subscriptions.clear();
        this.serviceState.cursor.cursors.clear();
        this.serviceState.chat.channels.clear();
        this.serviceState.chat.history.clear();
        this.serviceState.chat.activeUsers.clear();
        this.serviceState.presence.subscriptions.clear();
        this.serviceState.presence.users.clear();
        this.serviceState.presence.channels.clear();
        this.serviceState.reaction.subscriptions.clear();
        this.serviceState.reaction.recentReactions.clear();
        this.serviceState.reaction.availableReactions.clear();
    }
}

// Initialize cursor handlers when SDK is created
WebSocketGatewaySDK.prototype.constructor = function(options) {
    WebSocketGatewaySDK.call(this, options);
    this.initializeCursorHandlers();
};

// Cursor Utility Classes for different use cases
class CursorUtilities {
    
    // Freeform cursor utility (Miro, Figma, etc.)
    static createFreeformCursor(sdk, options = {}) {
        const config = {
            bounds: options.bounds || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
            trailEffect: options.trailEffect || false,
            trailLength: options.trailLength || 10,
            throttleMs: options.throttleMs || 50,
            showUserInfo: options.showUserInfo !== false,
            persistence: options.persistence || { enabled: true, ttl: 30000 }
        };

        sdk.cursor.configure('freeform', config);

        let throttleTimeout = null;
        let trailPositions = [];

        const updateCursor = (channel, x, y, metadata = {}) => {
            // Apply bounds checking
            const boundedX = Math.max(config.bounds.x, Math.min(x, config.bounds.x + config.bounds.width));
            const boundedY = Math.max(config.bounds.y, Math.min(y, config.bounds.y + config.bounds.height));

            // Throttle updates
            if (throttleTimeout) return;
            throttleTimeout = setTimeout(() => {
                throttleTimeout = null;
            }, config.throttleMs);

            // Add to trail if enabled
            if (config.trailEffect) {
                trailPositions.push({ x: boundedX, y: boundedY, timestamp: Date.now() });
                if (trailPositions.length > config.trailLength) {
                    trailPositions.shift();
                }
            }

            sdk.cursor.update(channel, { x: boundedX, y: boundedY }, {
                ...metadata,
                trail: config.trailEffect ? trailPositions : undefined,
                viewport: options.viewport,
                zoom: options.zoom
            });
        };

        const renderCursor = (cursor, container) => {
            const cursorElement = document.createElement('div');
            cursorElement.className = 'cursor-freeform';
            cursorElement.style.cssText = `
                position: absolute;
                left: ${cursor.position.x}px;
                top: ${cursor.position.y}px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: ${cursor.metadata.userColor || '#007bff'};
                pointer-events: none;
                z-index: 9999;
                transform: translate(-50%, -50%);
                transition: left 0.1s ease, top 0.1s ease;
            `;

            if (config.showUserInfo) {
                const userInfo = document.createElement('div');
                userInfo.className = 'cursor-user-info';
                userInfo.textContent = cursor.metadata.userInitials || 'U';
                userInfo.style.cssText = `
                    position: absolute;
                    top: -25px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: ${cursor.metadata.userColor || '#007bff'};
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                    white-space: nowrap;
                `;
                cursorElement.appendChild(userInfo);
            }

            // Render trail if enabled
            if (config.trailEffect && cursor.metadata.trail) {
                cursor.metadata.trail.forEach((pos, index) => {
                    const trailDot = document.createElement('div');
                    trailDot.className = 'cursor-trail-dot';
                    trailDot.style.cssText = `
                        position: absolute;
                        left: ${pos.x}px;
                        top: ${pos.y}px;
                        width: ${4 + index * 2}px;
                        height: ${4 + index * 2}px;
                        border-radius: 50%;
                        background: ${cursor.metadata.userColor || '#007bff'};
                        opacity: ${0.1 + (index / cursor.metadata.trail.length) * 0.9};
                        pointer-events: none;
                        z-index: 9998;
                        transform: translate(-50%, -50%);
                    `;
                    container.appendChild(trailDot);
                });
            }

            return cursorElement;
        };

        return {
            updateCursor,
            renderCursor,
            setBounds: (bounds) => { config.bounds = bounds; },
            setTrailEffect: (enabled) => { config.trailEffect = enabled; },
            getConfig: () => config
        };
    }

    // Table cursor utility (Excel, Google Sheets, etc.)
    static createTableCursor(sdk, options = {}) {
        const config = {
            rows: options.rows || 100,
            cols: options.cols || 26,
            cellWidth: options.cellWidth || 100,
            cellHeight: options.cellHeight || 30,
            showSelection: options.showSelection !== false,
            multiSelect: options.multiSelect || false,
            persistence: options.persistence || { enabled: true, ttl: 30000 }
        };

        sdk.cursor.configure('table', config);

        const updateCursor = (channel, row, col, metadata = {}) => {
            // Validate bounds
            const boundedRow = Math.max(0, Math.min(row, config.rows - 1));
            const boundedCol = Math.max(0, Math.min(col, config.cols - 1));

            sdk.cursor.update(channel, { row: boundedRow, col: boundedCol }, {
                ...metadata,
                sheet: options.sheet,
                range: options.range
            });
        };

        const renderCursor = (cursor, tableElement) => {
            const cellElement = tableElement.querySelector(
                `[data-row="${cursor.position.row}"][data-col="${cursor.position.col}"]`
            );
            
            if (!cellElement) return null;

            const cursorElement = document.createElement('div');
            cursorElement.className = 'cursor-table';
            cursorElement.style.cssText = `
                position: absolute;
                border: 2px solid ${cursor.metadata.userColor || '#007bff'};
                background: ${cursor.metadata.userColor || '#007bff'}20;
                pointer-events: none;
                z-index: 9999;
            `;

            const rect = cellElement.getBoundingClientRect();
            const tableRect = tableElement.getBoundingClientRect();
            
            cursorElement.style.left = `${rect.left - tableRect.left}px`;
            cursorElement.style.top = `${rect.top - tableRect.top}px`;
            cursorElement.style.width = `${rect.width}px`;
            cursorElement.style.height = `${rect.height}px`;

            if (config.showSelection) {
                const userInfo = document.createElement('div');
                userInfo.className = 'cursor-user-info';
                userInfo.textContent = cursor.metadata.userInitials || 'U';
                userInfo.style.cssText = `
                    position: absolute;
                    top: -20px;
                    left: 0;
                    background: ${cursor.metadata.userColor || '#007bff'};
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                `;
                cursorElement.appendChild(userInfo);
            }

            return cursorElement;
        };

        return {
            updateCursor,
            renderCursor,
            setTableSize: (rows, cols) => { config.rows = rows; config.cols = cols; },
            getConfig: () => config
        };
    }

    // Text cursor utility (Google Docs, Word, etc.)
    static createTextCursor(sdk, options = {}) {
        const config = {
            showSelection: options.showSelection !== false,
            showUserInfo: options.showUserInfo !== false,
            selectionColor: options.selectionColor || '#007bff',
            persistence: options.persistence || { enabled: true, ttl: 30000 }
        };

        sdk.cursor.configure('text', config);

        const updateCursor = (channel, position, metadata = {}) => {
            sdk.cursor.update(channel, { position }, {
                ...metadata,
                paragraph: options.paragraph,
                line: options.line,
                selection: metadata.selection
            });
        };

        const renderCursor = (cursor, textContainer) => {
            const cursorElement = document.createElement('div');
            cursorElement.className = 'cursor-text';
            
            // Create text cursor line
            const cursorLine = document.createElement('div');
            cursorLine.style.cssText = `
                position: absolute;
                width: 2px;
                height: 20px;
                background: ${cursor.metadata.userColor || '#007bff'};
                animation: blink 1s infinite;
            `;

            // Position cursor at text position
            const range = document.createRange();
            const textNode = textContainer.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                const pos = Math.min(cursor.position.position, textNode.textContent.length);
                range.setStart(textNode, pos);
                range.setEnd(textNode, pos);
                
                const rect = range.getBoundingClientRect();
                const containerRect = textContainer.getBoundingClientRect();
                
                cursorLine.style.left = `${rect.left - containerRect.left}px`;
                cursorLine.style.top = `${rect.top - containerRect.top}px`;
            }

            cursorElement.appendChild(cursorLine);

            // Handle selection highlighting
            if (config.showSelection && cursor.metadata.selection) {
                const selectionElement = document.createElement('div');
                selectionElement.className = 'cursor-selection';
                
                const { start, end } = cursor.metadata.selection;
                const selectionRange = document.createRange();
                
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    const startPos = Math.min(start, textNode.textContent.length);
                    const endPos = Math.min(end, textNode.textContent.length);
                    
                    selectionRange.setStart(textNode, startPos);
                    selectionRange.setEnd(textNode, endPos);
                    
                    const selectionRect = selectionRange.getBoundingClientRect();
                    const containerRect = textContainer.getBoundingClientRect();
                    
                    selectionElement.style.cssText = `
                        position: absolute;
                        left: ${selectionRect.left - containerRect.left}px;
                        top: ${selectionRect.top - containerRect.top}px;
                        width: ${selectionRect.width}px;
                        height: ${selectionRect.height}px;
                        background: ${cursor.metadata.userColor || config.selectionColor}40;
                        pointer-events: none;
                        z-index: 9998;
                    `;
                }
                
                cursorElement.appendChild(selectionElement);
            }

            // User info
            if (config.showUserInfo) {
                const userInfo = document.createElement('div');
                userInfo.className = 'cursor-user-info';
                userInfo.textContent = cursor.metadata.userInitials || 'U';
                userInfo.style.cssText = `
                    position: absolute;
                    top: -25px;
                    left: 0;
                    background: ${cursor.metadata.userColor || '#007bff'};
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                `;
                cursorElement.appendChild(userInfo);
            }

            return cursorElement;
        };

        return {
            updateCursor,
            renderCursor,
            getConfig: () => config
        };
    }

    // Canvas cursor utility (Drawing apps, etc.)
    static createCanvasCursor(sdk, options = {}) {
        const config = {
            showTool: options.showTool !== false,
            toolSize: options.toolSize || 10,
            trailEffect: options.trailEffect || false,
            trailLength: options.trailLength || 5,
            persistence: options.persistence || { enabled: true, ttl: 30000 }
        };

        sdk.cursor.configure('canvas', config);

        const updateCursor = (channel, x, y, metadata = {}) => {
            sdk.cursor.update(channel, { x, y }, {
                ...metadata,
                tool: options.tool,
                brush: options.brush,
                layer: options.layer
            });
        };

        const renderCursor = (cursor, canvasContainer) => {
            const cursorElement = document.createElement('div');
            cursorElement.className = 'cursor-canvas';
            
            const tool = cursor.metadata.tool || 'brush';
            const toolSize = config.toolSize;
            
            cursorElement.style.cssText = `
                position: absolute;
                left: ${cursor.position.x}px;
                top: ${cursor.position.y}px;
                width: ${toolSize}px;
                height: ${toolSize}px;
                border: 2px solid ${cursor.metadata.userColor || '#007bff'};
                border-radius: ${tool === 'brush' ? '50%' : '0'};
                background: ${cursor.metadata.userColor || '#007bff'}40;
                pointer-events: none;
                z-index: 9999;
                transform: translate(-50%, -50%);
            `;

            if (config.showTool) {
                const toolInfo = document.createElement('div');
                toolInfo.className = 'cursor-tool-info';
                toolInfo.textContent = `${cursor.metadata.userInitials || 'U'} (${tool})`;
                toolInfo.style.cssText = `
                    position: absolute;
                    top: -30px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: ${cursor.metadata.userColor || '#007bff'};
                    color: white;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    white-space: nowrap;
                `;
                cursorElement.appendChild(toolInfo);
            }

            return cursorElement;
        };

        return {
            updateCursor,
            renderCursor,
            setTool: (tool) => { options.tool = tool; },
            setToolSize: (size) => { config.toolSize = size; },
            getConfig: () => config
        };
    }
}

// Export for use in different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebSocketGatewaySDK, CursorUtilities };
} else if (typeof window !== 'undefined') {
    window.WebSocketGatewaySDK = WebSocketGatewaySDK;
    window.CursorUtilities = CursorUtilities;
}
