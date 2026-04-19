/**
 * Tests for activity-log Lambda handler.
 *
 * The handler consumes EventBridge events (directly or wrapped in SQS records).
 * For each event it:
 *   1. Writes a user-activity DynamoDB row keyed by userId + "timestamp#uuid"
 *   2. Looks up Redis set `websocket:channel:activity:<userId>:nodes` and, if
 *      any WebSocket nodes are subscribed, publishes a fan-out envelope to
 *      `websocket:route:activity:<userId>`.
 *
 * Mocks: DocumentClient.send, redis.createClient (sMembers / publish / connect).
 * Redis connect failures must NOT break the DynamoDB write path.
 */

const ddbSendMock = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      ...actual.DynamoDBDocumentClient,
      from: jest.fn().mockReturnValue({ send: ddbSendMock }),
    },
  };
});

// Redis client mock: configurable per-test via mockRedisClient.
const mockRedisClient: {
  isReady: boolean;
  connect: jest.Mock;
  on: jest.Mock;
  sMembers: jest.Mock;
  publish: jest.Mock;
} = {
  isReady: true,
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  sMembers: jest.fn().mockResolvedValue([]),
  publish: jest.fn().mockResolvedValue(1),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './handler';

function makeEvent(detailType: string, detail: Record<string, unknown>, time?: string) {
  return {
    source: 'social-api',
    'detail-type': detailType,
    detail,
    ...(time ? { time } : {}),
  };
}

function makeSqsRecord(body: unknown, messageId = 'm-1') {
  return {
    messageId,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    receiptHandle: 'rh',
    attributes: {},
    messageAttributes: {},
    md5OfBody: 'x',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn',
    awsRegion: 'us-east-1',
  };
}

describe('activity-log handler', () => {
  beforeEach(() => {
    ddbSendMock.mockReset();
    ddbSendMock.mockResolvedValue({});
    mockRedisClient.isReady = true;
    mockRedisClient.connect.mockReset().mockResolvedValue(undefined);
    mockRedisClient.on.mockReset();
    mockRedisClient.sMembers.mockReset().mockResolvedValue([]);
    mockRedisClient.publish.mockReset().mockResolvedValue(1);
  });

  test('happy path (direct EventBridge): writes user-activity row with composite SK timestamp#uuid', async () => {
    const result = await handler(
      makeEvent(
        'social.follow',
        { followerId: 'alice', followeeId: 'bob' },
        '2026-03-18T12:00:00.000Z',
      ),
    );

    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(ddbSendMock).toHaveBeenCalledTimes(1);

    const cmd = ddbSendMock.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutCommand);
    expect(cmd.input.TableName).toBe('user-activity');
    // `followerId` wins over missing userId (see handler.ts line 108)
    expect(cmd.input.Item.userId).toBe('alice');
    expect(cmd.input.Item.eventType).toBe('social.follow');

    // Composite SK: <timestamp>#<uuid>
    const sk: string = cmd.input.Item.timestamp;
    expect(sk.startsWith('2026-03-18T12:00:00.000Z#')).toBe(true);
    expect(sk.length).toBeGreaterThan('2026-03-18T12:00:00.000Z#'.length);

    // detail is JSON-stringified
    expect(JSON.parse(cmd.input.Item.detail)).toEqual({
      followerId: 'alice',
      followeeId: 'bob',
    });
  });

  test('userId resolution precedence: userId > followerId > authorId > "unknown"', async () => {
    // only authorId present
    await handler(makeEvent('social.post.created', { authorId: 'charlie', postId: 'p1' }));
    expect(ddbSendMock.mock.calls[0][0].input.Item.userId).toBe('charlie');

    // no identifying fields
    await handler(makeEvent('misc.event', { foo: 'bar' }));
    expect(ddbSendMock.mock.calls[1][0].input.Item.userId).toBe('unknown');

    // userId wins over followerId
    await handler(makeEvent('x', { userId: 'u-win', followerId: 'f-lose', authorId: 'a' }));
    expect(ddbSendMock.mock.calls[2][0].input.Item.userId).toBe('u-win');
  });

  test('SQS batch happy path: all records processed, batch size respected', async () => {
    await handler({
      Records: [
        makeSqsRecord(makeEvent('e1', { userId: 'u1' }), 'm-1'),
        makeSqsRecord(makeEvent('e2', { userId: 'u2' }), 'm-2'),
        makeSqsRecord(makeEvent('e3', { userId: 'u3' }), 'm-3'),
      ],
    });

    expect(ddbSendMock).toHaveBeenCalledTimes(3);
    const users = ddbSendMock.mock.calls.map((c) => c[0].input.Item.userId);
    expect(users).toEqual(['u1', 'u2', 'u3']);
  });

  test('empty SQS batch is a no-op', async () => {
    const result = await handler({ Records: [] });
    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(ddbSendMock).not.toHaveBeenCalled();
  });

  test('malformed SQS record body does NOT fail the batch; good records still processed', async () => {
    await handler({
      Records: [
        makeSqsRecord('{malformed json', 'bad-1'),
        makeSqsRecord(makeEvent('good', { userId: 'u-good' }), 'good-1'),
      ],
    });

    // only the good record writes to DDB
    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    expect(ddbSendMock.mock.calls[0][0].input.Item.userId).toBe('u-good');
  });

  test('SQS batch: DDB failure on one record does NOT fail the whole batch', async () => {
    // 3 calls expected; middle one fails.
    ddbSendMock.mockReset();
    ddbSendMock.mockResolvedValueOnce({});
    ddbSendMock.mockRejectedValueOnce(new Error('DDB throttle'));
    ddbSendMock.mockResolvedValueOnce({});

    const result = await handler({
      Records: [
        makeSqsRecord(makeEvent('e1', { userId: 'u1' }), 'm-1'),
        makeSqsRecord(makeEvent('e2', { userId: 'u2' }), 'm-2'),
        makeSqsRecord(makeEvent('e3', { userId: 'u3' }), 'm-3'),
      ],
    });

    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(ddbSendMock).toHaveBeenCalledTimes(3);
  });

  test('Redis publish: when no subscribers → skips publish but still writes DDB', async () => {
    mockRedisClient.sMembers.mockResolvedValue([]);

    await handler(makeEvent('social.follow', { userId: 'u1' }));

    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.sMembers).toHaveBeenCalledWith(
      'websocket:channel:activity:u1:nodes',
    );
    expect(mockRedisClient.publish).not.toHaveBeenCalled();
  });

  test('Redis publish: when nodes are subscribed → publishes envelope with correct shape', async () => {
    mockRedisClient.sMembers.mockResolvedValue(['node-a', 'node-b']);

    await handler(
      makeEvent('social.follow', { userId: 'u1', followerId: 'fx' }, '2026-03-18T00:00:00Z'),
    );

    expect(mockRedisClient.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = mockRedisClient.publish.mock.calls[0];
    expect(channel).toBe('websocket:route:activity:u1');

    const envelope = JSON.parse(payload);
    expect(envelope).toEqual(
      expect.objectContaining({
        type: 'channel_message',
        channel: 'activity:u1',
        fromNode: 'activity-log-lambda',
        targetNodes: ['node-a', 'node-b'],
      }),
    );
    expect(envelope.message).toEqual(
      expect.objectContaining({
        type: 'activity:event',
        channel: 'activity:u1',
        payload: expect.objectContaining({
          eventType: 'social.follow',
          detail: { userId: 'u1', followerId: 'fx' },
          timestamp: '2026-03-18T00:00:00Z',
        }),
      }),
    );
  });

  test('Redis failure during publish does NOT fail the handler (DDB write still returns success)', async () => {
    mockRedisClient.sMembers.mockResolvedValue(['node-a']);
    mockRedisClient.publish.mockRejectedValue(new Error('redis down'));

    const result = await handler(makeEvent('e', { userId: 'u1' }));
    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(ddbSendMock).toHaveBeenCalledTimes(1);
  });
});
