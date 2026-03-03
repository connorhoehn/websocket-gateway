// Mock Redis client
const mockConnect = jest.fn();
const mockPublish = jest.fn();
const mockCreateClient = jest.fn();

jest.mock('redis', () => ({
  createClient: mockCreateClient
}));

// Import handler after mocking
const { handler } = require('../src/lambda/message-review-handler');

describe('Lambda Message Review Handler', () => {
  let mockRedisClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockConnect.mockReset();
    mockPublish.mockReset();

    // Setup Redis client mock
    mockRedisClient = {
      connect: mockConnect,
      publish: mockPublish
    };

    mockCreateClient.mockReturnValue(mockRedisClient);
    mockConnect.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(1);

    // Set environment variables
    process.env.REDIS_ENDPOINT = 'localhost';
    process.env.REDIS_PORT = '6379';

    // Clear any cached Redis client
    delete require.cache[require.resolve('../src/lambda/message-review-handler')];
  });

  afterEach(() => {
    delete process.env.REDIS_ENDPOINT;
    delete process.env.REDIS_PORT;
  });

  describe('Test 1: Handler approves messages without profanity', () => {
    it('should approve clean message', async () => {
      // Arrange
      const event = {
        Content: 'Hello, this is a clean message',
        MessageId: 'msg-123',
        Sender: { UserId: 'user-456' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'general',
          clientId: 'client-789'
        }
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.ReviewResult).toBe('ALLOW');
      expect(result.Content).toBe('Hello, this is a clean message');
      expect(result.Attributes).toEqual(event.Attributes);
    });
  });

  describe('Test 2: Handler denies messages containing banned keywords', () => {
    it('should deny message with spam keyword', async () => {
      // Arrange
      const event = {
        Content: 'This is spam content',
        MessageId: 'msg-456',
        Sender: { UserId: 'user-789' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'general',
          clientId: 'client-123'
        }
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.ReviewResult).toBe('DENY');
      expect(result.Content).toBe('This is spam content');
      expect(result.Attributes.Reason).toBe('Message contains inappropriate content');
    });

    it('should be case-insensitive for profanity check', async () => {
      // Arrange
      const event = {
        Content: 'This is SPAM content',
        MessageId: 'msg-789',
        Sender: { UserId: 'user-123' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'test',
          clientId: 'client-456'
        }
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.ReviewResult).toBe('DENY');
    });
  });

  describe('Test 3: Approved messages published to Redis websocket:route:{channel} pattern', () => {
    it('should publish approved message to Redis with correct channel pattern', async () => {
      // Arrange
      const event = {
        Content: 'Good message',
        MessageId: 'msg-abc',
        Sender: { UserId: 'user-def' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'team-chat',
          clientId: 'client-ghi'
        }
      };

      // Need to re-require handler to get fresh instance
      delete require.cache[require.resolve('../src/lambda/message-review-handler')];
      const { handler: freshHandler } = require('../src/lambda/message-review-handler');

      // Act
      const result = await freshHandler(event);

      // Assert
      expect(result.ReviewResult).toBe('ALLOW');

      // Verify Redis publish was called
      expect(mockPublish).toHaveBeenCalledWith(
        'websocket:route:team-chat',
        expect.stringContaining('"type":"chat"')
      );

      // Parse published message
      const publishedMessage = JSON.parse(mockPublish.mock.calls[0][1]);
      expect(publishedMessage).toEqual({
        type: 'chat',
        action: 'message',
        message: {
          id: 'msg-abc',
          clientId: 'client-ghi',
          message: 'Good message',
          timestamp: expect.any(String)
        }
      });
    });

    it('should use "general" as default channel if not provided', async () => {
      // Arrange
      const event = {
        Content: 'Message without channel',
        MessageId: 'msg-xyz',
        Sender: { UserId: 'user-123' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {}
      };

      delete require.cache[require.resolve('../src/lambda/message-review-handler')];
      const { handler: freshHandler } = require('../src/lambda/message-review-handler');

      // Act
      await freshHandler(event);

      // Assert
      expect(mockPublish).toHaveBeenCalledWith(
        'websocket:route:general',
        expect.any(String)
      );
    });
  });

  describe('Test 4: Handler returns ALLOW with fallback on errors (fail-open)', () => {
    it('should fail-open when Redis publish fails', async () => {
      // Arrange
      mockPublish.mockRejectedValue(new Error('Redis connection failed'));

      const event = {
        Content: 'Message during Redis outage',
        MessageId: 'msg-error',
        Sender: { UserId: 'user-error' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'test',
          clientId: 'client-error'
        }
      };

      delete require.cache[require.resolve('../src/lambda/message-review-handler')];
      const { handler: freshHandler } = require('../src/lambda/message-review-handler');

      // Act
      const result = await freshHandler(event);

      // Assert - Should still allow message even though Redis failed
      expect(result.ReviewResult).toBe('ALLOW');
      expect(result.Content).toBe('Message during Redis outage');
    });

    it('should fail-open when Redis connection fails', async () => {
      // Arrange
      mockConnect.mockRejectedValue(new Error('Cannot connect to Redis'));

      const event = {
        Content: 'Message during connection error',
        MessageId: 'msg-conn-error',
        Sender: { UserId: 'user-conn' },
        RoomArn: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
        Attributes: {
          channel: 'test',
          clientId: 'client-conn'
        }
      };

      delete require.cache[require.resolve('../src/lambda/message-review-handler')];
      const { handler: freshHandler } = require('../src/lambda/message-review-handler');

      // Act
      const result = await freshHandler(event);

      // Assert - Should still allow message
      expect(result.ReviewResult).toBe('ALLOW');
      expect(result.Content).toBe('Message during connection error');
    });
  });
});
