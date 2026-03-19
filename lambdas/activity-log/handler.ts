import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const localstackConfig = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ddb = new DynamoDBClient({ region, ...localstackConfig });
const docClient = DynamoDBDocumentClient.from(ddb);

const TABLE = 'user-activity';

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
