/**
 * Tests for crdt-snapshot Lambda handler.
 *
 * The handler receives EventBridge events (directly or wrapped in SQS records)
 * carrying a base64-encoded gzip CRDT snapshot blob. It writes the buffer to
 * the crdt-snapshots DynamoDB table with a 7-day TTL.
 *
 * AWS SDK clients are module-mocked so we can capture the PutCommand inputs
 * without any real network calls.
 */

// Capture send calls via a shared mock.
const sendMock = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      ...actual.DynamoDBDocumentClient,
      from: jest.fn().mockReturnValue({ send: sendMock }),
    },
  };
});

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './handler';

function makeEvent(detail: Record<string, unknown>) {
  return {
    source: 'websocket-gateway',
    'detail-type': 'crdt.snapshot.created',
    detail,
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

describe('crdt-snapshot handler', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  test('happy path (direct EventBridge invoke): writes PutCommand with decoded snapshot + 7-day TTL', async () => {
    const b64 = Buffer.from('hello-crdt').toString('base64');

    const result = await handler(
      makeEvent({ channelId: 'doc-abc', snapshotData: b64, timestamp: '2026-01-01T00:00:00Z' }),
    );

    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutCommand);
    expect(cmd.input.TableName).toBe('crdt-snapshots');
    expect(cmd.input.Item.documentId).toBe('doc-abc');
    expect(Buffer.isBuffer(cmd.input.Item.snapshot)).toBe(true);
    expect((cmd.input.Item.snapshot as Buffer).toString('utf8')).toBe('hello-crdt');

    const nowSec = Math.floor(Date.now() / 1000);
    const sevenDays = 7 * 24 * 60 * 60;
    expect(cmd.input.Item.ttl).toBeGreaterThanOrEqual(nowSec + sevenDays - 5);
    expect(cmd.input.Item.ttl).toBeLessThanOrEqual(nowSec + sevenDays + 5);
    expect(typeof cmd.input.Item.timestamp).toBe('number');
  });

  test('happy path (SQS-wrapped): parses record body and writes once per record', async () => {
    const b64a = Buffer.from('A').toString('base64');
    const b64b = Buffer.from('B').toString('base64');

    await handler({
      Records: [
        makeSqsRecord(makeEvent({ channelId: 'a', snapshotData: b64a }), 'm-1'),
        makeSqsRecord(makeEvent({ channelId: 'b', snapshotData: b64b }), 'm-2'),
      ],
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    const ids = sendMock.mock.calls.map((c) => c[0].input.Item.documentId);
    expect(ids).toEqual(['a', 'b']);
  });

  test('empty SQS Records array is a no-op', async () => {
    const result = await handler({ Records: [] });
    expect(result).toEqual({ statusCode: 200, body: 'ok' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  test('malformed SQS record body does NOT fail the batch; other records still process', async () => {
    const goodB64 = Buffer.from('ok').toString('base64');

    await handler({
      Records: [
        makeSqsRecord('{not valid json', 'bad-1'),
        makeSqsRecord(makeEvent({ channelId: 'good', snapshotData: goodB64 }), 'good-1'),
      ],
    });

    // Only the good record should have produced a write
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input.Item.documentId).toBe('good');
  });

  test('downstream DynamoDB failure in SQS batch is swallowed (record stays in queue for retry)', async () => {
    sendMock.mockRejectedValueOnce(new Error('DDB throttle'));
    const b64 = Buffer.from('x').toString('base64');

    // Should NOT throw — handler catches per-record errors for SQS batches.
    await expect(
      handler({ Records: [makeSqsRecord(makeEvent({ channelId: 'c', snapshotData: b64 }))] }),
    ).resolves.toEqual({ statusCode: 200, body: 'ok' });
  });

  test('direct EventBridge invoke: downstream failure bubbles up (no per-record catch)', async () => {
    sendMock.mockRejectedValueOnce(new Error('boom'));
    const b64 = Buffer.from('x').toString('base64');

    await expect(handler(makeEvent({ channelId: 'c', snapshotData: b64 }))).rejects.toThrow('boom');
  });

  test('timestamp defaults to now if detail.timestamp is absent (does not throw)', async () => {
    const b64 = Buffer.from('z').toString('base64');
    await handler(makeEvent({ channelId: 'doc-no-ts', snapshotData: b64 }));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input.Item.documentId).toBe('doc-no-ts');
  });
});
