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

    describe('Snapshot Persistence Tests', () => {
        let mockDynamoClient;

        beforeEach(() => {
            // Mock DynamoDB client
            mockDynamoClient = {
                send: jest.fn().mockResolvedValue({})
            };

            // Override CRDTService with mock DynamoDB client
            crdtService.dynamoClient = mockDynamoClient;
            crdtService.channelStates = new Map();
        });

        describe('Test 6: writeSnapshot gzips data and writes to DynamoDB with TTL', () => {
            test('should write gzipped snapshot to DynamoDB with documentId, timestamp, and 7-day TTL', async () => {
                const channelId = 'doc:test';
                const snapshotData = Buffer.from('test snapshot data');

                // Setup channel state
                crdtService.channelStates.set(channelId, {
                    currentSnapshot: snapshotData,
                    operationsSinceSnapshot: 5,
                    subscriberCount: 2
                });

                await crdtService.writeSnapshot(channelId);

                // Verify DynamoDB send was called
                expect(mockDynamoClient.send).toHaveBeenCalledTimes(1);

                const command = mockDynamoClient.send.mock.calls[0][0];
                expect(command.input.TableName).toBe('crdt-snapshots');
                expect(command.input.Item.documentId.S).toBe(channelId);
                expect(command.input.Item.timestamp.N).toBeDefined();
                expect(command.input.Item.snapshot.B).toBeDefined(); // Gzipped snapshot
                expect(command.input.Item.ttl.N).toBeDefined();

                // Verify TTL is approximately 7 days from now
                const ttl = parseInt(command.input.Item.ttl.N);
                const expectedTtl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
                expect(Math.abs(ttl - expectedTtl)).toBeLessThan(5); // Allow 5 second variance

                // Verify operation counter was reset
                const state = crdtService.channelStates.get(channelId);
                expect(state.operationsSinceSnapshot).toBe(0);
            });
        });

        describe('Test 7: After 50 operations, snapshot auto-triggers', () => {
            test('should trigger snapshot and reset counter after 50 operations', async () => {
                const channelId = 'doc:test';
                const clientId = 'client1';

                // Initialize channel state
                crdtService.channelStates.set(channelId, {
                    currentSnapshot: Buffer.from('initial'),
                    operationsSinceSnapshot: 49,
                    subscriberCount: 1
                });

                // Mock writeSnapshot to track calls
                const writeSnapshotSpy = jest.spyOn(crdtService, 'writeSnapshot').mockResolvedValue();

                // Send one more update to trigger the 50th operation
                await crdtService.handleUpdate(clientId, { channel: channelId, update: 'YmFzZTY0' });

                // Wait for batch window
                await new Promise(resolve => setTimeout(resolve, 15));

                // Snapshot should have been triggered
                expect(writeSnapshotSpy).toHaveBeenCalledWith(channelId);
            });
        });

        describe('Test 8: Every 5 minutes, snapshot triggers for channels with pending operations', () => {
            test('should write snapshots for all channels with operations > 0', async () => {
                // Setup multiple channels with different operation counts
                crdtService.channelStates.set('doc:channel1', {
                    currentSnapshot: Buffer.from('data1'),
                    operationsSinceSnapshot: 10,
                    subscriberCount: 1
                });

                crdtService.channelStates.set('doc:channel2', {
                    currentSnapshot: Buffer.from('data2'),
                    operationsSinceSnapshot: 0, // No operations
                    subscriberCount: 1
                });

                crdtService.channelStates.set('doc:channel3', {
                    currentSnapshot: Buffer.from('data3'),
                    operationsSinceSnapshot: 25,
                    subscriberCount: 1
                });

                // Mock writeSnapshot
                const writeSnapshotSpy = jest.spyOn(crdtService, 'writeSnapshot').mockResolvedValue();

                // Trigger periodic snapshots
                await crdtService.writePeriodicSnapshots();

                // Should have written snapshots for channel1 and channel3 only
                expect(writeSnapshotSpy).toHaveBeenCalledTimes(2);
                expect(writeSnapshotSpy).toHaveBeenCalledWith('doc:channel1');
                expect(writeSnapshotSpy).toHaveBeenCalledWith('doc:channel3');
            });
        });

        describe('Test 9: When last client unsubscribes, final snapshot is written', () => {
            test('should write final snapshot when subscriber count reaches 0', async () => {
                const channelId = 'doc:test';
                const clientId = 'client1';

                // Setup channel state with 1 subscriber
                crdtService.channelStates.set(channelId, {
                    currentSnapshot: Buffer.from('final data'),
                    operationsSinceSnapshot: 5,
                    subscriberCount: 1
                });

                // Mock writeSnapshot
                const writeSnapshotSpy = jest.spyOn(crdtService, 'writeSnapshot').mockResolvedValue();

                // Unsubscribe last client
                await crdtService.handleUnsubscribe(clientId, { channel: channelId });

                // Should have written final snapshot
                expect(writeSnapshotSpy).toHaveBeenCalledWith(channelId);
            });
        });

        describe('Test 10: DynamoDB write failure logs error but does not crash', () => {
            test('should gracefully handle DynamoDB write failures', async () => {
                const channelId = 'doc:test';

                // Setup channel state
                crdtService.channelStates.set(channelId, {
                    currentSnapshot: Buffer.from('test data'),
                    operationsSinceSnapshot: 5,
                    subscriberCount: 1
                });

                // Mock DynamoDB to throw error
                mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB connection failed'));

                // writeSnapshot should not throw
                await expect(crdtService.writeSnapshot(channelId)).resolves.not.toThrow();

                // Error should be logged
                expect(mockLogger.error).toHaveBeenCalled();
                const errorCall = mockLogger.error.mock.calls[0];
                expect(errorCall[0]).toContain('Failed to write snapshot');
            });
        });
    });
});
