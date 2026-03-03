const { IvschatClient, CreateChatTokenCommand, SendMessageCommand, ListMessagesCommand } = require('@aws-sdk/client-ivschat');

/**
 * IVS Chat Service - AWS IVS Chat integration for persistent chat with Lambda-based moderation
 *
 * Replaces in-memory LRU chat history with AWS managed service for channels requiring:
 * - Persistent chat beyond ephemeral collaboration
 * - Delivery guarantees
 * - Moderation workflows without custom infrastructure
 *
 * When IVS_CHAT_ROOM_ARN is configured:
 * - Generates chat tokens for client-side IVS SDK authentication
 * - Sends messages via IVS API (fallback/testing endpoint)
 * - Retrieves chat history from IVS backend (not local cache)
 *
 * When IVS_CHAT_ROOM_ARN is not configured:
 * - Feature gracefully disabled
 * - Clients fall back to standard ChatService
 */
class IvsChatService {
  constructor(messageRouter, logger, config = {}) {
    this.messageRouter = messageRouter;
    this.logger = logger;
    this.ivsClient = new IvschatClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.roomArn = process.env.IVS_CHAT_ROOM_ARN;
    this.enabled = !!this.roomArn; // Only enabled if room ARN configured

    if (!this.enabled) {
      this.logger.info('IVS Chat not configured, feature disabled');
    }
  }

  /**
   * Handle IVS chat action from WebSocket client
   * @param {string} clientId - WebSocket client ID
   * @param {string} action - Action type (send, history, token)
   * @param {Object} data - Action payload
   */
  async handleAction(clientId, action, data) {
    if (!this.enabled) {
      this.sendError(clientId, 'IVS Chat not enabled for this deployment');
      return;
    }

    try {
      switch (action) {
        case 'send':
          return await this.handleSendMessage(clientId, data);
        case 'history':
          return await this.handleGetHistory(clientId, data);
        case 'token':
          return await this.handleGetChatToken(clientId, data);
        default:
          this.sendError(clientId, `Unknown IVS chat action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`IVS Chat error for client ${clientId}:`, error);
      this.sendError(clientId, 'IVS Chat service error');
    }
  }

  /**
   * Generate IVS Chat token for authenticated user
   * Clients use this token to connect to IVS room via client SDK
   *
   * @param {string} clientId - WebSocket client ID
   * @param {Object} data - { channel }
   */
  async handleGetChatToken(clientId, { channel }) {
    const userContext = this.messageRouter.getClientData(clientId)?.userContext;
    if (!userContext) {
      this.sendError(clientId, 'Authentication required for chat token');
      return;
    }

    const command = new CreateChatTokenCommand({
      roomIdentifier: this.roomArn,
      userId: userContext.sub || clientId,
      capabilities: ['SEND_MESSAGE', 'DELETE_MESSAGE'],
      sessionDurationInMinutes: 60
    });

    const response = await this.ivsClient.send(command);

    this.messageRouter.sendToClient(clientId, {
      type: 'ivs-chat',
      action: 'token',
      token: response.token,
      tokenExpirationTime: response.tokenExpirationTime
    });
  }

  /**
   * Send message to IVS Chat room
   * NOTE: In production, clients send directly to IVS via SDK
   * This endpoint exists for fallback/testing
   *
   * @param {string} clientId - WebSocket client ID
   * @param {Object} data - { channel, message }
   */
  async handleSendMessage(clientId, { channel, message }) {
    const command = new SendMessageCommand({
      roomIdentifier: this.roomArn,
      content: message,
      attributes: {
        channel,
        clientId
      }
    });

    await this.ivsClient.send(command);
    this.logger.debug(`Message sent to IVS Chat room for channel ${channel}`);
  }

  /**
   * Retrieve chat history from IVS room
   * Fetches from IVS backend (not local LRU cache)
   * Filters by channel attribute
   *
   * @param {string} clientId - WebSocket client ID
   * @param {Object} data - { channel, limit }
   */
  async handleGetHistory(clientId, { channel, limit = 50 }) {
    const command = new ListMessagesCommand({
      roomIdentifier: this.roomArn,
      maxResults: limit
    });

    const response = await this.ivsClient.send(command);

    // Filter by channel attribute
    const messages = response.messages
      .filter(msg => msg.Attributes?.channel === channel)
      .map(msg => ({
        id: msg.Id,
        clientId: msg.Attributes?.clientId || msg.SenderId,
        message: msg.Content,
        timestamp: msg.SendTime
      }));

    this.messageRouter.sendToClient(clientId, {
      type: 'ivs-chat',
      action: 'history',
      channel,
      messages
    });
  }

  /**
   * Send error message to WebSocket client
   * @param {string} clientId - WebSocket client ID
   * @param {string} message - Error message
   */
  sendError(clientId, message) {
    this.messageRouter.sendToClient(clientId, {
      type: 'error',
      service: 'ivs-chat',
      message
    });
  }
}

module.exports = IvsChatService;
