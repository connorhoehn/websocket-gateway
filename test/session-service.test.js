// test/session-service.test.js
const SessionService = require('../src/services/session-service');

describe('SessionService', () => {
  let sessionService;
  let mockRedisClient;
  let mockLogger;
  let mockMessageRouter;

  beforeEach(() => {
    // Mock Redis client
    mockRedisClient = {
      setEx: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1)
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Mock message router
    mockMessageRouter = {
      redisAvailable: true
    };

    sessionService = new SessionService(mockRedisClient, mockLogger, mockMessageRouter);
  });

  describe('createSession', () => {
    it('should generate UUID token and store in Redis with 24hr TTL', async () => {
      const clientId = 'client-123';
      const userContext = { userId: 'user-456', email: 'test@example.com' };

      const sessionToken = await sessionService.createSession(clientId, userContext);

      // Verify token is a UUID
      expect(sessionToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Verify Redis setEx was called with correct TTL (24 hours = 86400 seconds)
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `session:${sessionToken}`,
        86400,
        expect.stringContaining(clientId)
      );

      // Verify session data structure
      const storedData = JSON.parse(mockRedisClient.setEx.mock.calls[0][2]);
      expect(storedData).toMatchObject({
        clientId,
        userContext,
        subscriptions: []
      });
      expect(storedData.createdAt).toBeDefined();
      expect(storedData.expiresAt).toBeDefined();
    });
  });

  describe('restoreSession', () => {
    it('should retrieve valid session data before expiry', async () => {
      const sessionToken = 'valid-token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: ['channel-1', 'channel-2'],
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000 // Expires in 10 seconds (valid)
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toEqual(sessionData);
      expect(mockRedisClient.get).toHaveBeenCalledWith(`session:${sessionToken}`);
    });

    it('should return null for expired sessions', async () => {
      const sessionToken = 'expired-token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: [],
        createdAt: Date.now() - 100000,
        expiresAt: Date.now() - 10000 // Expired 10 seconds ago
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toBeNull();
      // Verify expired session was deleted
      expect(mockRedisClient.del).toHaveBeenCalledWith(`session:${sessionToken}`);
    });

    it('should return null for non-existent tokens', async () => {
      const sessionToken = 'non-existent-token';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toBeNull();
    });

    it('should fall back to local Map when Redis unavailable', async () => {
      const sessionToken = 'local-token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000
      };

      // Mark Redis as unavailable
      mockMessageRouter.redisAvailable = false;

      // Pre-populate local cache
      sessionService.localSessionStore.set(`session:${sessionToken}`, sessionData);

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toEqual(sessionData);
      // Redis should NOT be called when unavailable
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('should fall back to local cache when Redis errors', async () => {
      const sessionToken = 'fallback-token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000
      };

      // Redis throws error
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection lost'));

      // Pre-populate local cache
      sessionService.localSessionStore.set(`session:${sessionToken}`, sessionData);

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toEqual(sessionData);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis error'));
    });

    it('should return null for expired sessions in local cache', async () => {
      const sessionToken = 'expired-local-token';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: [],
        createdAt: Date.now() - 100000,
        expiresAt: Date.now() - 10000 // Expired
      };

      mockMessageRouter.redisAvailable = false;
      sessionService.localSessionStore.set(`session:${sessionToken}`, sessionData);

      const result = await sessionService.restoreSession(sessionToken);

      expect(result).toBeNull();
      // Verify expired session was removed from local cache
      expect(sessionService.localSessionStore.has(`session:${sessionToken}`)).toBe(false);
    });
  });

  describe('updateSubscriptions', () => {
    it('should add new channels to session state', async () => {
      const sessionToken = 'token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: ['channel-1'],
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));

      const newSubscriptions = ['channel-1', 'channel-2', 'channel-3'];
      const result = await sessionService.updateSubscriptions(sessionToken, newSubscriptions);

      expect(result).toBe(true);

      // Verify Redis was updated with new subscriptions
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `session:${sessionToken}`,
        86400,
        expect.stringContaining('"subscriptions":["channel-1","channel-2","channel-3"]')
      );
    });

    it('should return false for non-existent sessions', async () => {
      const sessionToken = 'invalid-token';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await sessionService.updateSubscriptions(sessionToken, ['channel-1']);

      expect(result).toBe(false);
    });

    it('should update local cache when Redis unavailable', async () => {
      const sessionToken = 'token-123';
      const sessionData = {
        clientId: 'client-123',
        userContext: { userId: 'user-456' },
        subscriptions: ['channel-1'],
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000
      };

      mockMessageRouter.redisAvailable = false;
      sessionService.localSessionStore.set(`session:${sessionToken}`, sessionData);

      const newSubscriptions = ['channel-1', 'channel-2'];
      const result = await sessionService.updateSubscriptions(sessionToken, newSubscriptions);

      expect(result).toBe(true);

      // Verify local cache was updated
      const updatedSession = sessionService.localSessionStore.get(`session:${sessionToken}`);
      expect(updatedSession.subscriptions).toEqual(newSubscriptions);
    });
  });

  describe('isRedisAvailable', () => {
    it('should return true when messageRouter indicates Redis is available', () => {
      mockMessageRouter.redisAvailable = true;
      expect(sessionService.isRedisAvailable()).toBe(true);
    });

    it('should return false when messageRouter indicates Redis is unavailable', () => {
      mockMessageRouter.redisAvailable = false;
      expect(sessionService.isRedisAvailable()).toBe(false);
    });

    it('should default to true when messageRouter is not provided', () => {
      const standaloneService = new SessionService(mockRedisClient, mockLogger, null);
      expect(standaloneService.isRedisAvailable()).toBe(true);
    });
  });

  describe('Session falls back to local Map if Redis unavailable', () => {
    it('should create session in local cache only when Redis unavailable', async () => {
      mockMessageRouter.redisAvailable = false;

      const clientId = 'client-123';
      const userContext = { userId: 'user-456' };

      const sessionToken = await sessionService.createSession(clientId, userContext);

      // Verify token was generated
      expect(sessionToken).toBeDefined();

      // Redis should NOT be called
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();

      // Verify local cache was populated
      const localSession = sessionService.localSessionStore.get(`session:${sessionToken}`);
      expect(localSession).toBeDefined();
      expect(localSession.clientId).toBe(clientId);
    });
  });
});
