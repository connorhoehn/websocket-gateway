import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createClient, RedisClientType } from 'redis';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const localstackConfig = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ddb = new DynamoDBClient({ region, ...localstackConfig });
const docClient = DynamoDBDocumentClient.from(ddb);

const TABLE = 'user-activity';

const REDIS_URL = `redis://${process.env.REDIS_ENDPOINT ?? 'redis'}:${process.env.REDIS_PORT ?? '6379'}`;
let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient?.isReady) return redisClient;
  try {
    const c = createClient({ url: REDIS_URL }) as RedisClientType;
    c.on('error', (err: Error) => {
      console.warn('[activity-log] Redis error:', err.message);
      redisClient = null;
    });
    await c.connect();
    redisClient = c;
    return c;
  } catch (err) {
    console.warn('[activity-log] Redis connect failed:', (err as Error).message);
    return null;
  }
}

async function publishActivityEvent(
  userId: string,
  eventType: string,
  detail: Record<string, unknown>,
  timestamp: string
): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  try {
    const channelId = `activity:${userId}`;
    const nodesKey = `websocket:channel:${channelId}:nodes`;
    const targetNodes = await redis.sMembers(nodesKey);

    if (targetNodes.length === 0) {
      console.log(`[activity-log] No subscribers for ${channelId}, skipping publish`);
      return;
    }

    const envelope = {
      type: 'channel_message',
      channel: channelId,
      message: {
        type: 'activity:event',
        channel: channelId,
        payload: { eventType, detail, timestamp },
        timestamp: new Date().toISOString(),
      },
      excludeClientId: null,
      fromNode: 'activity-log-lambda',
      seq: 0,
      timestamp: new Date().toISOString(),
      targetNodes,
    };

    await redis.publish(`websocket:route:${channelId}`, JSON.stringify(envelope));
    console.log(`[activity-log] Published activity:event to ${channelId} (${targetNodes.length} node(s))`);
  } catch (err) {
    console.warn(`[activity-log] Redis publish failed:`, (err as Error).message);
  }
}

interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: Record<string, unknown>;
  time?: string;
}

interface SQSRecord {
  messageId: string;
  body: string;
  receiptHandle: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, unknown>;
  md5OfBody: string;
  eventSource: string;
  eventSourceARN: string;
  awsRegion: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

function isSQSEvent(event: unknown): event is SQSEvent {
  return typeof event === 'object' && event !== null && 'Records' in event && Array.isArray((event as SQSEvent).Records);
}

async function processEventBridgeEvent(ebEvent: EventBridgeEvent): Promise<void> {
  const detailType = ebEvent['detail-type'];
  const detail = ebEvent.detail;
  const userId = (detail.userId ?? detail.followerId ?? detail.authorId ?? 'unknown') as string;
  const timestamp = ebEvent.time ?? new Date().toISOString();

  // Composite SK: timestamp#eventId ensures uniqueness when multiple events share the same timestamp
  const eventId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  const sk = `${timestamp}#${eventId}`;

  console.log(`[activity-log] Processing ${detailType} for user ${userId}`);

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: {
      userId,
      timestamp: sk,  // "2026-03-18T12:00:00.000Z#a1b2c3d4"
      eventType: detailType,
      detail: JSON.stringify(detail),
    },
  }));

  console.log(`[activity-log] Wrote activity record: userId=${userId}, timestamp=${sk}, type=${detailType}`);

  // Publish to Redis for real-time delivery to connected clients
  await publishActivityEvent(userId, detailType, detail as Record<string, unknown>, timestamp);
}

export async function handler(event: SQSEvent | EventBridgeEvent) {
  if (isSQSEvent(event)) {
    // SQS trigger: each record body is a JSON-encoded EventBridge event
    console.log(`[activity-log] Processing ${event.Records.length} SQS record(s)`);
    for (const record of event.Records) {
      try {
        const ebEvent: EventBridgeEvent = JSON.parse(record.body);
        await processEventBridgeEvent(ebEvent);
      } catch (err) {
        console.error(`[activity-log] Failed to process record ${record.messageId}: ${err}`);
        // Continue to next record — do NOT re-throw; one bad record must not fail the batch
      }
    }
  } else {
    // Direct invoke: raw EventBridge event
    await processEventBridgeEvent(event as EventBridgeEvent);
  }

  return { statusCode: 200, body: 'ok' };
}
