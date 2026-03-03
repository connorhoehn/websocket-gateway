// test/session-recovery.test.js
const { handleReconnection } = require('../src/middleware/reconnection-handler');

describe('Session Recovery (Reconnection Handler)', () => {
  let mockWs;
  let mockReq;
  let mockSessionService;
  let mockMessageRouter;
  let mockLogger;

  beforeEach(() => {
    mockWs = {};
    mockReq = {
      url: '/ws',
      headers: {}
    };

    mockSessionService = {
      createSession: jest.fn(),
      restoreSession: jest.fn(),
      updateSubscriptions: jest.fn()
    };

    mockMessageRouter = {
      subscribeToChannel: jest.fn().mockResolvedValue(true)
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('New connection without sessionToken', () => {
    it('should generate new clientId and return restored=false', async () => {
      mockReq.url = '/ws'; // No sessionToken query param

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      // Verify new client ID was generated
      expect(result.clientId).toBeDefined();
      expect(result.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Verify not restored
      expect(result.restored).toBe(false);
      expect(result.sessionToken).toBeNull();
      expect(result.userContext).toBeNull();

      // Session service should NOT be called for new connections
      expect(mockSessionService.restoreSession).not.toHaveBeenCalled();
    });
  });

  describe('Connection with valid sessionToken', () => {
    it('should restore clientId and subscriptions', async () => {
      const sessionToken = 'valid-token-123';
      const sessionData = {
        clientId: 'client-original-456',
        userContext: { userId: 'user-789', email: 'test@example.com' },
        subscriptions: ['channel-1', 'channel-2', 'channel-3']
      };

      mockReq.url = `/ws?sessionToken=${sessionToken}`;
      mockSessionService.restoreSession.mockResolvedValue(sessionData);

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      // Verify session was restored
      expect(mockSessionService.restoreSession).toHaveBeenCalledWith(sessionToken);

      // Verify original clientId was restored
      expect(result.clientId).toBe('client-original-456');
      expect(result.restored).toBe(true);
      expect(result.sessionToken).toBe(sessionToken);
      expect(result.userContext).toEqual(sessionData.userContext);

      // Verify subscriptions were restored via MessageRouter
      expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledTimes(3);
      expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledWith('client-original-456', 'channel-1');
      expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledWith('client-original-456', 'channel-2');
      expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledWith('client-original-456', 'channel-3');

      // Verify log message
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Client reconnecting'));
    });

    it('should handle sessions with no subscriptions', async () => {
      const sessionToken = 'token-no-subs';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-789' },
        subscriptions: [] // No subscriptions
      };

      mockReq.url = `/ws?sessionToken=${sessionToken}`;
      mockSessionService.restoreSession.mockResolvedValue(sessionData);

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      expect(result.restored).toBe(true);
      expect(result.clientId).toBe('client-123');

      // No subscriptions to restore
      expect(mockMessageRouter.subscribeToChannel).not.toHaveBeenCalled();
    });
  });

  describe('Connection with expired sessionToken', () => {
    it('should treat as new connection when session expired', async () => {
      const sessionToken = 'expired-token-123';
      mockReq.url = `/ws?sessionToken=${sessionToken}`;

      // SessionService returns null for expired tokens
      mockSessionService.restoreSession.mockResolvedValue(null);

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      // Verify session restoration was attempted
      expect(mockSessionService.restoreSession).toHaveBeenCalledWith(sessionToken);

      // Verify treated as new connection
      expect(result.restored).toBe(false);
      expect(result.clientId).toBeDefined();
      expect(result.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.sessionToken).toBeNull();

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid or expired'));
    });

    it('should treat as new connection when session not found', async () => {
      const sessionToken = 'non-existent-token';
      mockReq.url = `/ws?sessionToken=${sessionToken}`;

      mockSessionService.restoreSession.mockResolvedValue(null);

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      expect(result.restored).toBe(false);
      expect(result.clientId).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid or expired'));
    });
  });

  describe('Reconnected client message flow', () => {
    it('should allow reconnected client to send/receive messages on restored channels', async () => {
      const sessionToken = 'valid-token-456';
      const sessionData = {
        clientId: 'client-restored-789',
        userContext: { userId: 'user-123' },
        subscriptions: ['test-room']
      };

      mockReq.url = `/ws?sessionToken=${sessionToken}`;
      mockSessionService.restoreSession.mockResolvedValue(sessionData);

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      // Verify client was re-subscribed to channel
      expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledWith('client-restored-789', 'test-room');

      // Verify clientId is available for message routing
      expect(result.clientId).toBe('client-restored-789');
      expect(result.restored).toBe(true);
    });
  });

  describe('Query parameter parsing', () => {
    it('should parse sessionToken from query string correctly', async () => {
      const sessionToken = 'query-token-123';
      mockReq.url = `/ws?sessionToken=${sessionToken}&other=param`;

      mockSessionService.restoreSession.mockResolvedValue(null);

      await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      expect(mockSessionService.restoreSession).toHaveBeenCalledWith(sessionToken);
    });

    it('should handle URL without query params', async () => {
      mockReq.url = '/ws';

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      expect(mockSessionService.restoreSession).not.toHaveBeenCalled();
      expect(result.restored).toBe(false);
    });

    it('should handle empty sessionToken query param', async () => {
      mockReq.url = '/ws?sessionToken=';

      const result = await handleReconnection(mockWs, mockReq, mockSessionService, mockMessageRouter, mockLogger);

      // Empty token should be treated as no token
      expect(result.restored).toBe(false);
    });
  });
});
