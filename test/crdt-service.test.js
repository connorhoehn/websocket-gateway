// test/crdt-service.test.js

const CRDTService = require('../src/services/crdt-service');

describe('CRDTService', () => {
    let crdtService;
    let mockMessageRouter;
    let mockLogger;
    let sentMessages;

    beforeEach(() => {
        sentMessages = [];

        // Mock message router
        mockMessageRouter = {
            subscribeToChannel: jest.fn().mockResolvedValue(true),
            unsubscribeFromChannel: jest.fn().mockResolvedValue(true),
            sendToChannel: jest.fn((channel, message) => {
                sentMessages.push({ channel, message });
                return Promise.resolve();
            }),
            sendToClient: jest.fn((clientId, message) => {
                sentMessages.push({ clientId, message });
                return Promise.resolve();
            }),
            getClientData: jest.fn((clientId) => ({
                clientId,
                userContext: {
                    userId: 'user123',
                    channels: ['doc:test', 'doc:public']
                },
                channels: [],
                joinedAt: new Date()
            }))
        };

        // Mock logger
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        crdtService = new CRDTService(mockMessageRouter, mockLogger);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Test 1: handleAction update broadcasts operation to subscribed clients except sender', () => {
        test('should broadcast base64 operation to all subscribed clients excluding sender', async () => {
            const clientId = 'client1';
            const channel = 'doc:test';
            const update = 'YmFzZTY0X2VuY29kZWRfZGF0YQ=='; // base64 encoded data

            await crdtService.handleAction(clientId, 'update', { channel, update });

            // Wait for batch window to complete
            await new Promise(resolve => setTimeout(resolve, 15));

            // Should have called sendToChannel with the batched operations
            expect(mockMessageRouter.sendToChannel).toHaveBeenCalled();
            const call = mockMessageRouter.sendToChannel.mock.calls[0];

            expect(call[0]).toBe(channel);
            expect(call[1].type).toBe('crdt');
            expect(call[1].action).toBe('operations');
            expect(call[1].channel).toBe(channel);
            expect(call[1].operations).toHaveLength(1);
            expect(call[1].operations[0].update).toBe(update);
            expect(call[1].operations[0].timestamp).toBeDefined();
            expect(call[2]).toBe(clientId); // excludeClientId parameter
        });
    });

    describe('Test 2: handleAction subscribe subscribes client and sends confirmation', () => {
        test('should subscribe client to channel and send confirmation message', async () => {
            const clientId = 'client1';
            const channel = 'doc:test';

            await crdtService.handleAction(clientId, 'subscribe', { channel });

            // Should have subscribed via message router
            expect(mockMessageRouter.subscribeToChannel).toHaveBeenCalledWith(clientId, channel);

            // Should have sent confirmation to client
            expect(mockMessageRouter.sendToClient).toHaveBeenCalled();
            const confirmationCall = mockMessageRouter.sendToClient.mock.calls[0];

            expect(confirmationCall[0]).toBe(clientId);
            expect(confirmationCall[1].type).toBe('crdt');
            expect(confirmationCall[1].action).toBe('subscribed');
            expect(confirmationCall[1].channel).toBe(channel);
            expect(confirmationCall[1].timestamp).toBeDefined();
        });
    });

    describe('Test 3: Batching collects operations within 10ms window', () => {
        test('should batch multiple operations and broadcast as array', async () => {
            const clientId = 'client1';
            const channel = 'doc:test';
            const update1 = 'YmFzZTY0X2RhdGFfMQ==';
            const update2 = 'YmFzZTY0X2RhdGFfMg==';
            const update3 = 'YmFzZTY0X2RhdGFfMw==';

            // Send three updates rapidly (within batch window)
            await crdtService.handleAction(clientId, 'update', { channel, update: update1 });
            await crdtService.handleAction(clientId, 'update', { channel, update: update2 });
            await crdtService.handleAction(clientId, 'update', { channel, update: update3 });

            // Wait for batch window to complete
            await new Promise(resolve => setTimeout(resolve, 15));

            // Should have called sendToChannel only once with all three operations
            expect(mockMessageRouter.sendToChannel).toHaveBeenCalledTimes(1);
            const call = mockMessageRouter.sendToChannel.mock.calls[0];

            expect(call[1].operations).toHaveLength(3);
            expect(call[1].operations[0].update).toBe(update1);
            expect(call[1].operations[1].update).toBe(update2);
            expect(call[1].operations[2].update).toBe(update3);
        });
    });

    describe('Test 4: Invalid channel name returns error', () => {
        test('should reject empty channel name', async () => {
            const clientId = 'client1';

            await crdtService.handleAction(clientId, 'subscribe', { channel: '' });

            // Should have sent error to client
            expect(mockMessageRouter.sendToClient).toHaveBeenCalled();
            const errorCall = mockMessageRouter.sendToClient.mock.calls[0];

            expect(errorCall[1].type).toBe('error');
            expect(errorCall[1].service).toBe('crdt');
        });

        test('should reject channel name over 50 characters', async () => {
            const clientId = 'client1';
            const longChannel = 'a'.repeat(51);

            await crdtService.handleAction(clientId, 'subscribe', { channel: longChannel });

            // Should have sent error to client
            expect(mockMessageRouter.sendToClient).toHaveBeenCalled();
            const errorCall = mockMessageRouter.sendToClient.mock.calls[0];

            expect(errorCall[1].type).toBe('error');
            expect(errorCall[1].service).toBe('crdt');
        });
    });

    describe('Test 5: Missing update payload returns error', () => {
        test('should reject update action without update payload', async () => {
            const clientId = 'client1';
            const channel = 'doc:test';

            await crdtService.handleAction(clientId, 'update', { channel });

            // Should have sent error to client
            expect(mockMessageRouter.sendToClient).toHaveBeenCalled();
            const errorCall = mockMessageRouter.sendToClient.mock.calls[0];

            expect(errorCall[1].type).toBe('error');
            expect(errorCall[1].service).toBe('crdt');
        });

        test('should reject update action with non-string update payload', async () => {
            const clientId = 'client1';
            const channel = 'doc:test';

            await crdtService.handleAction(clientId, 'update', { channel, update: 12345 });

            // Should have sent error to client
            expect(mockMessageRouter.sendToClient).toHaveBeenCalled();
            const errorCall = mockMessageRouter.sendToClient.mock.calls[0];

            expect(errorCall[1].type).toBe('error');
            expect(errorCall[1].service).toBe('crdt');
        });
    });
});
