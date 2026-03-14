// core/websocket-manager.js
const WebSocket = require('ws');

class WebSocketManager {
  constructor() {
    this.clients = new Map(); // clientId -> { ws, metadata }
    this.channels = new Map(); // channel -> Set of clientIds
  }

  addClient(ws, clientId = null) {
    // Generate clientId if not provided
    if (!clientId) {
      clientId = this.generateClientId();
    }

    // Store client with metadata
    this.clients.set(clientId, {
      ws,
      connectedAt: new Date(),
      channels: new Set(),
      metadata: {}
    });

    // Add WebSocket event handlers
    ws.on('close', () => {
      this.removeClient(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.removeClient(clientId);
    });

    console.log(`Client ${clientId} connected. Total clients: ${this.clients.size}`);
    return clientId;
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all channels
    client.channels.forEach(channel => {
      this.leaveChannel(clientId, channel);
    });

    // Remove from clients map
    this.clients.delete(clientId);
    console.log(`Client ${clientId} disconnected. Total clients: ${this.clients.size}`);
  }

  joinChannel(clientId, channel) {
    const client = this.clients.get(clientId);
    if (!client) return false;

    // Add client to channel
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel).add(clientId);

    // Add channel to client
    client.channels.add(channel);

    console.log(`Client ${clientId} joined channel ${channel}`);
    return true;
  }

  leaveChannel(clientId, channel) {
    const client = this.clients.get(clientId);
    if (!client) return false;

    // Remove client from channel
    const channelClients = this.channels.get(channel);
    if (channelClients) {
      channelClients.delete(clientId);
      // Clean up empty channels
      if (channelClients.size === 0) {
        this.channels.delete(channel);
      }
    }

    // Remove channel from client
    client.channels.delete(channel);

    console.log(`Client ${clientId} left channel ${channel}`);
    return true;
  }

  broadcastToChannel(channel, message, excludeClientId = null) {
    const channelClients = this.channels.get(channel);
    if (!channelClients) return 0;

    // Collect recipients first
    const recipients = [];
    channelClients.forEach(clientId => {
      if (clientId !== excludeClientId) {
        recipients.push(clientId);
      }
    });

    if (recipients.length === 0) return 0;

    // Helper to send to a single client
    const sendToOne = (clientId) => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
          return true;
        } catch (error) {
          console.error(`Error sending to client ${clientId}:`, error);
          this.removeClient(clientId);
        }
      }
      return false;
    };

    // For small recipient lists (<=50), send synchronously (no overhead)
    if (recipients.length <= 50) {
      let sentCount = 0;
      for (const clientId of recipients) {
        if (sendToOne(clientId)) {
          sentCount++;
        }
      }
      console.log(`Broadcasted to ${sentCount} clients in channel ${channel}`);
      return sentCount;
    }

    // For large recipient lists, batch with setImmediate to yield event loop
    const BATCH_SIZE = 50;
    let sentCount = 0;
    let index = 0;

    const sendBatch = () => {
      const end = Math.min(index + BATCH_SIZE, recipients.length);
      for (; index < end; index++) {
        if (sendToOne(recipients[index])) {
          sentCount++;
        }
      }

      if (index < recipients.length) {
        setImmediate(sendBatch);
      } else {
        console.log(`Broadcasted to ${sentCount}/${recipients.length} clients in channel ${channel} (batched)`);
      }
    };

    sendBatch();
    return recipients.length; // Return expected count (actual may differ due to closed connections)
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.ws.send(message);
      return true;
    } catch (error) {
      console.error(`Error sending to client ${clientId}:`, error);
      this.removeClient(clientId);
      return false;
    }
  }

  updateClientMetadata(clientId, metadata) {
    const client = this.clients.get(clientId);
    if (!client) return false;

    client.metadata = { ...client.metadata, ...metadata };
    return true;
  }

  getClientInfo(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return null;

    return {
      clientId,
      connectedAt: client.connectedAt,
      channels: Array.from(client.channels),
      metadata: client.metadata
    };
  }

  getChannelInfo(channel) {
    const channelClients = this.channels.get(channel);
    if (!channelClients) return null;

    return {
      channel,
      clientCount: channelClients.size,
      clients: Array.from(channelClients)
    };
  }

  getStats() {
    return {
      totalClients: this.clients.size,
      totalChannels: this.channels.size,
      channels: Array.from(this.channels.keys()).map(channel => ({
        name: channel,
        clientCount: this.channels.get(channel).size
      }))
    };
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = WebSocketManager;
