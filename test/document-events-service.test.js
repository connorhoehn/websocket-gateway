// test/document-events-service.test.js
/**
 * Integration tests for DocumentEventsService
 * Validates WebSocket subscription management for real-time document events
 */

const DocumentEventsService = require('../src/services/document-events-service');

// Mock MessageRouter
class MockMessageRouter {
  constructor() {
    this.subscriptions = new Map(); // clientId -> Set of channels
    this.sentMessages = [];
    this.channelMessages = [];
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
    this.channelMessages = [];
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

describe('DocumentEventsService', () => {
  let service;
  let mockRouter;
  let mockLogger;

  beforeEach(() => {
    mockRouter = new MockMessageRouter();
    mockLogger = new MockLogger();
    service = new DocumentEventsService(mockRouter, mockLogger);
  });

  afterEach(() => {
    mockRouter.reset();
    mockLogger.reset();
  });

  describe('handleAction - subscribe', () => {
    test('subscribes client to doc-comments and doc channels with valid documentId', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.has(`doc-comments:${documentId}`)).toBe(true);
      expect(subscriptions.has(`doc:${documentId}`)).toBe(true);
      expect(subscriptions.size).toBe(2);
    });

    test('sends subscribed confirmation to client', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });

      const messages = mockRouter.sentMessages.filter(m => m.clientId === clientId);
      expect(messages.length).toBe(1);
      expect(messages[0].message.type).toBe('document-events');
      expect(messages[0].message.action).toBe('subscribed');
      expect(messages[0].message.documentId).toBe(documentId);
      expect(messages[0].message.timestamp).toBeDefined();
    });

    test('tracks subscription locally for disconnect cleanup', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(1);
      expect(stats.totalSubscriptions).toBe(2); // doc-comments + doc
    });

    test('logs subscription event', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });

      expect(mockLogger.hasLog('info', clientId)).toBe(true);
      expect(mockLogger.hasLog('info', documentId)).toBe(true);
      expect(mockLogger.hasLog('info', 'subscribed')).toBe(true);
    });

    test('rejects subscribe with missing documentId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', {});

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('documentId is required');
      expect(errorMessages[0].message.service).toBe('document-events');
    });

    test('rejects subscribe with non-string documentId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', { documentId: 123 });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('documentId is required');
    });

    test('rejects subscribe with empty documentId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'subscribe', { documentId: '' });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('documentId is required');
    });

    test('rejects subscribe with documentId exceeding 100 chars', async () => {
      const clientId = 'client-1';
      const longDocumentId = 'a'.repeat(101);

      await service.handleAction(clientId, 'subscribe', { documentId: longDocumentId });

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('max 100 chars');
    });
  });

  describe('handleAction - unsubscribe', () => {
    test('unsubscribes client from doc channels', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });
      await service.handleAction(clientId, 'unsubscribe', { documentId });

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.size).toBe(0);
    });

    test('sends unsubscribed confirmation to client', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });
      mockRouter.reset();
      await service.handleAction(clientId, 'unsubscribe', { documentId });

      const messages = mockRouter.sentMessages.filter(m => m.clientId === clientId);
      expect(messages.length).toBe(1);
      expect(messages[0].message.type).toBe('document-events');
      expect(messages[0].message.action).toBe('unsubscribed');
      expect(messages[0].message.documentId).toBe(documentId);
    });

    test('cleans up local tracking when all subscriptions removed', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });
      await service.handleAction(clientId, 'unsubscribe', { documentId });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    test('rejects unsubscribe with missing documentId', async () => {
      const clientId = 'client-1';

      await service.handleAction(clientId, 'unsubscribe', {});

      const errorMessages = mockRouter.sentMessages.filter(m =>
        m.clientId === clientId && m.message.type === 'error'
      );
      expect(errorMessages.length).toBe(1);
      expect(errorMessages[0].message.message).toContain('documentId is required');
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
      expect(errorMessages[0].message.message).toContain('Unknown document-events action');
      expect(errorMessages[0].message.message).toContain('invalid-action');
    });
  });

  describe('handleDisconnect', () => {
    test('unsubscribes from all tracked channels on disconnect', async () => {
      const clientId = 'client-1';
      const doc1 = 'doc-abc';
      const doc2 = 'doc-xyz';

      await service.handleAction(clientId, 'subscribe', { documentId: doc1 });
      await service.handleAction(clientId, 'subscribe', { documentId: doc2 });
      await service.handleDisconnect(clientId);

      const subscriptions = mockRouter.getSubscriptions(clientId);
      expect(subscriptions.size).toBe(0);
    });

    test('cleans up client tracking on disconnect', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });
      await service.handleDisconnect(clientId);

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    test('logs disconnect event', async () => {
      const clientId = 'client-1';
      const documentId = 'doc-abc123';

      await service.handleAction(clientId, 'subscribe', { documentId });
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
      await service.handleAction('client-1', 'subscribe', { documentId: 'doc-a' });
      await service.handleAction('client-2', 'subscribe', { documentId: 'doc-b' });

      const stats = service.getStats();
      expect(stats.subscribedClients).toBe(2);
      expect(stats.totalSubscriptions).toBe(4); // 2 clients × 2 channels each
    });
  });
});
