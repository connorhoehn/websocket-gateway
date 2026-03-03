// Mock AWS SDK before importing the service
const mockSend = jest.fn();
const mockIvschatClient = jest.fn();
const mockCreateChatTokenCommand = jest.fn();
const mockSendMessageCommand = jest.fn();
const mockListMessagesCommand = jest.fn();

jest.mock('@aws-sdk/client-ivschat', () => ({
  IvschatClient: mockIvschatClient,
  CreateChatTokenCommand: mockCreateChatTokenCommand,
  SendMessageCommand: mockSendMessageCommand,
  ListMessagesCommand: mockListMessagesCommand
}));

const IvsChatService = require('../src/services/ivs-chat-service');

describe('IvsChatService', () => {
  let service;
  let mockMessageRouter;
  let mockLogger;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockSend.mockReset();

    // Setup AWS SDK client mock
    mockIvschatClient.mockImplementation(() => ({
      send: mockSend
    }));

    // Setup command mocks to return objects with input property
    mockCreateChatTokenCommand.mockImplementation((input) => ({ input }));
    mockSendMessageCommand.mockImplementation((input) => ({ input }));
    mockListMessagesCommand.mockImplementation((input) => ({ input }));

    // Mock MessageRouter
    mockMessageRouter = {
      sendToClient: jest.fn(),
      getClientData: jest.fn()
    };

    // Mock Logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };

    // Set environment variable for IVS room ARN
    process.env.IVS_CHAT_ROOM_ARN = 'arn:aws:ivschat:us-east-1:123456789012:room/test-room';
    process.env.AWS_REGION = 'us-east-1';
  });

  afterEach(() => {
    delete process.env.IVS_CHAT_ROOM_ARN;
    delete process.env.AWS_REGION;
  });

  describe('Test 1: IvsChatService generates chat tokens for authenticated users', () => {
    it('should generate chat token for authenticated user', async () => {
      // Arrange
      const clientId = 'client-123';
      const userContext = { sub: 'user-456', email: 'test@example.com' };

      mockMessageRouter.getClientData.mockReturnValue({ userContext });
      mockSend.mockResolvedValue({
        token: 'mock-ivs-token',
        tokenExpirationTime: new Date('2026-03-03T15:00:00Z')
      });

      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleGetChatToken(clientId, { channel: 'test-channel' });

      // Assert
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.any(Object) })
      );

      const command = mockSend.mock.calls[0][0];
      expect(command.input.roomIdentifier).toBe('arn:aws:ivschat:us-east-1:123456789012:room/test-room');
      expect(command.input.userId).toBe('user-456');
      expect(command.input.capabilities).toContain('SEND_MESSAGE');
      expect(command.input.sessionDurationInMinutes).toBe(60);

      expect(mockMessageRouter.sendToClient).toHaveBeenCalledWith(clientId, {
        type: 'ivs-chat',
        action: 'token',
        token: 'mock-ivs-token',
        tokenExpirationTime: expect.any(Date)
      });
    });

    it('should send error if user not authenticated', async () => {
      // Arrange
      mockMessageRouter.getClientData.mockReturnValue(null);
      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleGetChatToken('client-123', { channel: 'test' });

      // Assert
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessageRouter.sendToClient).toHaveBeenCalledWith('client-123', {
        type: 'error',
        service: 'ivs-chat',
        message: 'Authentication required for chat token'
      });
    });
  });

  describe('Test 2: handleSendMessage sends to IVS API (not local LRU cache)', () => {
    it('should send message via IVS API', async () => {
      // Arrange
      const clientId = 'client-123';
      const channel = 'test-channel';
      const message = 'Hello from IVS';

      mockSend.mockResolvedValue({});
      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleSendMessage(clientId, { channel, message });

      // Assert
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.any(Object) })
      );

      const command = mockSend.mock.calls[0][0];
      expect(command.input.roomIdentifier).toBe('arn:aws:ivschat:us-east-1:123456789012:room/test-room');
      expect(command.input.content).toBe('Hello from IVS');
      expect(command.input.attributes).toEqual({
        channel: 'test-channel',
        clientId: 'client-123'
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Message sent to IVS Chat room')
      );
    });
  });

  describe('Test 3: handleGetHistory fetches from IVS room history', () => {
    it('should fetch and filter messages by channel', async () => {
      // Arrange
      const clientId = 'client-123';
      const channel = 'test-channel';

      mockSend.mockResolvedValue({
        messages: [
          {
            Id: 'msg-1',
            Content: 'Hello',
            SenderId: 'user-1',
            SendTime: new Date('2026-03-03T14:00:00Z'),
            Attributes: { channel: 'test-channel', clientId: 'client-1' }
          },
          {
            Id: 'msg-2',
            Content: 'World',
            SenderId: 'user-2',
            SendTime: new Date('2026-03-03T14:01:00Z'),
            Attributes: { channel: 'other-channel', clientId: 'client-2' }
          },
          {
            Id: 'msg-3',
            Content: 'IVS Chat',
            SenderId: 'user-3',
            SendTime: new Date('2026-03-03T14:02:00Z'),
            Attributes: { channel: 'test-channel', clientId: 'client-3' }
          }
        ]
      });

      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleGetHistory(clientId, { channel, limit: 50 });

      // Assert
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.any(Object) })
      );

      const command = mockSend.mock.calls[0][0];
      expect(command.input.roomIdentifier).toBe('arn:aws:ivschat:us-east-1:123456789012:room/test-room');
      expect(command.input.maxResults).toBe(50);

      expect(mockMessageRouter.sendToClient).toHaveBeenCalledWith(clientId, {
        type: 'ivs-chat',
        action: 'history',
        channel: 'test-channel',
        messages: [
          {
            id: 'msg-1',
            clientId: 'client-1',
            message: 'Hello',
            timestamp: expect.any(Date)
          },
          {
            id: 'msg-3',
            clientId: 'client-3',
            message: 'IVS Chat',
            timestamp: expect.any(Date)
          }
        ]
      });
    });
  });

  describe('Test 4: Service falls back to ChatService when IVS disabled for channel', () => {
    it('should log info and mark as disabled when no room ARN configured', () => {
      // Arrange
      delete process.env.IVS_CHAT_ROOM_ARN;

      // Act
      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Assert
      expect(service.enabled).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('IVS Chat not configured, feature disabled');
    });

    it('should send error when action called but IVS disabled', async () => {
      // Arrange
      delete process.env.IVS_CHAT_ROOM_ARN;
      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleAction('client-123', 'send', { channel: 'test', message: 'Hello' });

      // Assert
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessageRouter.sendToClient).toHaveBeenCalledWith('client-123', {
        type: 'error',
        service: 'ivs-chat',
        message: 'IVS Chat not enabled for this deployment'
      });
    });
  });

  describe('Error handling', () => {
    it('should handle IVS API errors gracefully', async () => {
      // Arrange
      mockMessageRouter.getClientData.mockReturnValue({ userContext: { sub: 'user-1' } });
      mockSend.mockRejectedValue(new Error('IVS API Error'));
      service = new IvsChatService(mockMessageRouter, mockLogger);

      // Act
      await service.handleAction('client-123', 'token', { channel: 'test' });

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('IVS Chat error for client client-123'),
        expect.any(Error)
      );
      expect(mockMessageRouter.sendToClient).toHaveBeenCalledWith('client-123', {
        type: 'error',
        service: 'ivs-chat',
        message: 'IVS Chat service error'
      });
    });
  });
});
