/**
 * Tests for outbox-relay Lambda handler.
 *
 * The handler queries the social-outbox DynamoDB table (status-index GSI) for
 * status=UNPROCESSED rows, relays each row to the appropriate SQS queue based on
 * `queueName`, then updates the row to status=PROCESSED. On SQS/DDB failure the
 * row stays UNPROCESSED so a later invocation retries it.
 *
 * We mock the two SDK client send() methods; the DocumentClient uses the same
 * underlying send so we share one mock and dispatch on the command class.
 */

const ddbSendMock = jest.fn();
const sqsSendMock = jest.fn();

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

jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({ send: sqsSendMock })),
  };
});

import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

// Provide queue URLs via env BEFORE requiring the handler (module-level constants).
process.env.SQS_FOLLOWS_URL = 'https://sqs.local/q/social-follows';
process.env.SQS_ROOMS_URL = 'https://sqs.local/q/social-rooms';
process.env.SQS_POSTS_URL = 'https://sqs.local/q/social-posts';
process.env.SQS_REACTIONS_URL = 'https://sqs.local/q/social-reactions';

// Use require after env setup so the module reads these on import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('./handler');

function mockQueryResult(items: Record<string, unknown>[]) {
  ddbSendMock.mockImplementationOnce(async (cmd: unknown) => {
    if (cmd instanceof QueryCommand) return { Items: items };
    throw new Error('Expected QueryCommand first');
  });
}

describe('outbox-relay handler', () => {
  beforeEach(() => {
    ddbSendMock.mockReset();
    sqsSendMock.mockReset();
  });

  test('empty outbox → no SQS calls, no updates, relayed=0', async () => {
    mockQueryResult([]);

    const result = await handler({});

    expect(result).toEqual({ statusCode: 200, relayed: 0 });
    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    const queryCmd = ddbSendMock.mock.calls[0][0];
    expect(queryCmd).toBeInstanceOf(QueryCommand);
    expect(queryCmd.input.TableName).toBe('social-outbox');
    expect(queryCmd.input.IndexName).toBe('status-index');
    expect(queryCmd.input.ExpressionAttributeValues).toEqual({ ':u': 'UNPROCESSED' });
    expect(sqsSendMock).not.toHaveBeenCalled();
  });

  test('happy path: each row → SQS SendMessage + DDB Update to PROCESSED', async () => {
    mockQueryResult([
      {
        outboxId: 'o1',
        eventType: 'social.follow',
        queueName: 'social-follows',
        payload: JSON.stringify({ followerId: 'u1', followeeId: 'u2' }),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        outboxId: 'o2',
        eventType: 'social.post.created',
        queueName: 'social-posts',
        payload: JSON.stringify({ postId: 'p1' }),
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ]);
    sqsSendMock.mockResolvedValue({});
    // Two UpdateCommand calls after query.
    ddbSendMock.mockResolvedValue({});

    const result = await handler({});

    expect(result).toEqual({ statusCode: 200, relayed: 2 });
    expect(sqsSendMock).toHaveBeenCalledTimes(2);

    const send1 = sqsSendMock.mock.calls[0][0];
    expect(send1).toBeInstanceOf(SendMessageCommand);
    expect(send1.input.QueueUrl).toBe('https://sqs.local/q/social-follows');
    const body1 = JSON.parse(send1.input.MessageBody);
    expect(body1).toEqual({
      source: 'social-api',
      'detail-type': 'social.follow',
      detail: { followerId: 'u1', followeeId: 'u2' },
      time: '2026-01-01T00:00:00.000Z',
    });

    const send2 = sqsSendMock.mock.calls[1][0];
    expect(send2.input.QueueUrl).toBe('https://sqs.local/q/social-posts');

    // Two UpdateCommands on ddb after the initial QueryCommand.
    const updateCalls = ddbSendMock.mock.calls.slice(1);
    expect(updateCalls).toHaveLength(2);
    for (const [cmd] of updateCalls) {
      expect(cmd).toBeInstanceOf(UpdateCommand);
      expect(cmd.input.TableName).toBe('social-outbox');
      expect(cmd.input.ExpressionAttributeValues[':p']).toBe('PROCESSED');
      expect(typeof cmd.input.ExpressionAttributeValues[':now']).toBe('string');
    }
    expect(updateCalls[0][0].input.Key).toEqual({ outboxId: 'o1' });
    expect(updateCalls[1][0].input.Key).toEqual({ outboxId: 'o2' });
  });

  test('unknown queueName → skipped; row NOT updated, relayed count unaffected', async () => {
    mockQueryResult([
      {
        outboxId: 'bad-1',
        eventType: 'social.mystery',
        queueName: 'not-a-real-queue',
        payload: '{}',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const result = await handler({});

    expect(result).toEqual({ statusCode: 200, relayed: 0 });
    expect(sqsSendMock).not.toHaveBeenCalled();
    // Only the initial QueryCommand — no Update.
    expect(ddbSendMock).toHaveBeenCalledTimes(1);
  });

  test('SQS send failure → row stays UNPROCESSED (no UpdateCommand), handler keeps going', async () => {
    mockQueryResult([
      {
        outboxId: 'fail-1',
        eventType: 'social.follow',
        queueName: 'social-follows',
        payload: '{}',
        createdAt: 't',
      },
      {
        outboxId: 'ok-1',
        eventType: 'social.follow',
        queueName: 'social-follows',
        payload: '{}',
        createdAt: 't',
      },
    ]);
    sqsSendMock.mockRejectedValueOnce(new Error('SQS throttled'));
    sqsSendMock.mockResolvedValueOnce({});
    ddbSendMock.mockResolvedValue({});

    const result = await handler({});

    expect(result).toEqual({ statusCode: 200, relayed: 1 });
    expect(sqsSendMock).toHaveBeenCalledTimes(2);

    // Only ONE UpdateCommand (for ok-1). The failed row is left UNPROCESSED.
    const updateCalls = ddbSendMock.mock.calls
      .slice(1)
      .filter(([c]) => c instanceof UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].input.Key).toEqual({ outboxId: 'ok-1' });
  });

  test('DDB Update failure after successful SQS send → row not marked PROCESSED, does not crash handler', async () => {
    mockQueryResult([
      {
        outboxId: 'o1',
        eventType: 'social.follow',
        queueName: 'social-follows',
        payload: '{}',
        createdAt: 't',
      },
    ]);
    sqsSendMock.mockResolvedValue({});
    // The Update call fails
    ddbSendMock.mockRejectedValueOnce(new Error('DDB throttle'));

    const result = await handler({});

    // relayed was incremented only after BOTH send + update succeed (see handler.ts).
    expect(result).toEqual({ statusCode: 200, relayed: 0 });
  });

  test('all four known queue names are routed correctly', async () => {
    mockQueryResult([
      { outboxId: '1', eventType: 'e', queueName: 'social-follows',   payload: '{}', createdAt: 't' },
      { outboxId: '2', eventType: 'e', queueName: 'social-rooms',     payload: '{}', createdAt: 't' },
      { outboxId: '3', eventType: 'e', queueName: 'social-posts',     payload: '{}', createdAt: 't' },
      { outboxId: '4', eventType: 'e', queueName: 'social-reactions', payload: '{}', createdAt: 't' },
    ]);
    sqsSendMock.mockResolvedValue({});
    ddbSendMock.mockResolvedValue({});

    const result = await handler({});

    expect(result.relayed).toBe(4);
    const urls = sqsSendMock.mock.calls.map((c) => c[0].input.QueueUrl);
    expect(urls).toEqual([
      'https://sqs.local/q/social-follows',
      'https://sqs.local/q/social-rooms',
      'https://sqs.local/q/social-posts',
      'https://sqs.local/q/social-reactions',
    ]);
  });
});
