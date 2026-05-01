// test/social-service.test.js
/**
 * Integration tests for SocialService
 * Validates WebSocket subscription management for real-time social events
 */

const SocialService = require('../src/services/social-service');

// Mock MessageRouter
class MockMessageRouter {
  constructor() {
    this.subscriptions = new Map(); // clientId -> Set of channels
    this.sentMessages = [];
  }

  async subscribeToChannel(clientId, channel) {
    if (!this.subscriptions.has(clientId)) {
      this.subscriptions.set(clientId, new Set());
    }
    this.subscriptions.get(clientId).add(channel);
  }

  async unsubscribeFromChannel(clientId, channel) {
    const channels = this.subscriptions.get(clientId);
    if (channels) {
      channels.delete(channel);
      if (channels.size === 0) {
        this.subscriptions.delete(clientId);
      }
    }
  }

  sendToClient(clientId, message) {
    this.sentMessages.push({ clientId, message });
  }

  reset() {
    this.sentMessages = [];
  }

  getSubscriptions(clientId) {
    return this.subscriptions.get(clientId) || new Set();
  }
}

// Mock Logger
class MockLogger {
  constructor() {
    this.logs = { debug: [], info: [], warn: [], error: [] };
  }

  debug(msg, ...args) { this.logs.debug.push({ msg, args }); }
  info(msg, ...args) { this.logs.info.push({ msg, args }); }
  warn(msg, ...args) { this.logs.warn.push({ msg, args }); }
  error(msg, ...args) { this.logs.error.push({ msg, args }); }

  hasLog(level, searchTerm) {
    return this.logs[level].some(log =>
      JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  reset() {
    this.logs = { debug: [], info: [], warn: [], error: [] };
  }
}

describe('SocialService', () => {
  let service;
  let mockRouter;
  let mockLogger;

  beforeEach(() => {
    mockRouter = new MockMessageRouter();
    mockLogger = new MockLogger();
    service = new SocialService(mockRouter, mockLogger);
  });

  afterEach(() => {
    mockRouter.reset();
    mockLogger.reset();
  });

  describe('handleAction - subscribe', () => {
    test('subscribes client to social channel with valid channelId', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.has(channelId)).toBe(true);
      expect(subscriptions.size).toBe(1);
    });

    test('sends subscribed confirmation to client', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });

      const messages = mockRouter.sentMessages.filter(m => m.clientId === clientId);
      expect(messages.length).toBe(1);
      expect(messages[0].message.type).toBe('social');
      expect(messages[0].message.action).toBe('subscribed');
      expect(messages[0].message.channelId).toBe(channelId);
      expect(messages[0].message.timestamp).toBeDefined();
    });

    test('tracks subscription locally for disconnect cleanup', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(1);
      expect(stats.totalSubscriptions).toBe(1);
    });

    test('logs subscription event', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });

      expect(mockLogger.hasLog('info', clientId)).toBe(true);
      expect(mockLogger.hasLog('info', channelId)).toBe(true);
      expect(mockLogger.hasLog('info', 'subscribed')).toBe(true);
    });

    test('allows client to subscribe to multiple channels', async () => {
      const clientId = 'client-1';
      const channel1 = 'room-abc';
      const channel2 = 'room-xyz';

      await service.handleAction(clientId, 'subscribe', { channelId: channel1 });
      await service.handleAction(clientId, 'subscribe', { channelId: channel2 });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.has(channel1)).toBe(true);
      expect(subscriptions.has(channel2)).toBe(true);
      expect(subscriptions.size).toBe(2);

      const stats = service.getStats();
      expect(stats.totalSubscriptions).toBe(2);
    });

    test('rejects subscribe with missing channelId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', {});

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('channelId is required');
      expect(errorMessages[0].message.service).toBe('social');
    });

    test('rejects subscribe with non-string channelId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', { channelId: 123 });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('channelId is required');
    });

    test('rejects subscribe with empty channelId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', { channelId: '' });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('channelId is required');
    });

    test('rejects subscribe with channelId exceeding 100 chars', async () => {
      const clientId = 'client-1';
      const longChannelId = 'a'.repeat(101);

      await service.handleAction(clientId, 'subscribe', { channelId: longChannelId });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('max 100 chars');
    });
  });

  describe('handleAction - unsubscribe', () => {
    test('unsubscribes client from social channel', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });
      await service.handleAction(clientId, 'unsubscribe', { channelId });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.size).toBe(0);
    });

    test('sends unsubscribed confirmation to client', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });
      mockRouter.reset();
      await service.handleAction(clientId, 'unsubscribe', { channelId });

      const messages = mockRouter.sentMessages.filter(m => m.clientId === clientId);
      expect(messages.length).toBe(1);
      expect(messages[0].message.type).toBe('social');
      expect(messages[0].message.action).toBe('unsubscribed');
      expect(messages[0].message.channelId).toBe(channelId);
    });

    test('cleans up local tracking when all subscriptions removed', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });
      await service.handleAction(clientId, 'unsubscribe', { channelId });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    test('unsubscribes from one channel while maintaining others', async () => {
      const clientId = 'client-1';
      const channel1 = 'room-abc';
      const channel2 = 'room-xyz';

      await service.handleAction(clientId, 'subscribe', { channelId: channel1 });
      await service.handleAction(clientId, 'subscribe', { channelId: channel2 });
      await service.handleAction(clientId, 'unsubscribe', { channelId: channel1 });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.has(channel1)).toBe(false);
      expect(subscriptions.has(channel2)).toBe(true);
      expect(subscriptions.size).toBe(1);
    });

    test('rejects unsubscribe with missing channelId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'unsubscribe', {});

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('channelId is required');
    });
  });

  describe('handleAction - unknown action', () => {
    test('sends error for unknown action', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'invalid-action', {});

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('Unknown social action');
      expect(errorMessages[0].message.message).toContain('invalid-action');
    });
  });

  describe('handleDisconnect', () => {
    test('unsubscribes from all tracked channels on disconnect', async () => {
      const clientId = 'client-1';
      const channel1 = 'room-abc';
      const channel2 = 'room-xyz';

      await service.handleAction(clientId, 'subscribe', { channelId: channel1 });
      await service.handleAction(clientId, 'subscribe', { channelId: channel2 });
      await service.handleDisconnect(clientId);

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.size).toBe(0);
    });

    test('cleans up client tracking on disconnect', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });
      await service.handleDisconnect(clientId);

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    test('logs disconnect event', async () => {
      const clientId = 'client-1';
      const channelId = 'room-abc123';

      await service.handleAction(clientId, 'subscribe', { channelId });
      mockLogger.reset();
      await service.handleDisconnect(clientId);

      expect(mockLogger.hasLog('debug', clientId)).toBe(true);
      expect(mockLogger.hasLog('debug', 'disconnected')).toBe(true);
    });

    test('handles disconnect for client with no subscriptions gracefully', async () => {
      const clientId = 'client-unknown';

      await expect(service.handleDisconnect(clientId)).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    test('returns zero stats when no subscriptions', () => {
      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    test('counts multiple clients and subscriptions correctly', async () => {
      await service.handleAction('client-1', 'subscribe', { channelId: 'room-a' });
      await service.handleAction('client-1', 'subscribe', { channelId: 'room-b' });
      await service.handleAction('client-2', 'subscribe', { channelId: 'room-c' });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(2);
      expect(stats.totalSubscriptions).toBe(3); // client-1 has 2, client-2 has 1
    });
  });
});
