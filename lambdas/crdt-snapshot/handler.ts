import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const localstackConfig = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ddb = new DynamoDBClient({ region, ...localstackConfig });
const docClient = DynamoDBDocumentClient.from(ddb);

const TABLE = process.env.DYNAMODB_CRDT_TABLE || 'crdt-snapshots';

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
  const detail = ebEvent.detail;
  const channelId = detail.channelId as string;
  const snapshotData = detail.snapshotData as string;
  const timestamp = (detail.timestamp as string) ?? new Date().toISOString();

  // Convert snapshotData from base64 to Buffer (already gzip-compressed from gateway)
  const snapshotBuffer = Buffer.from(snapshotData, 'base64');

  // Calculate TTL: 7 days from now
  const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: {
      documentId: channelId,
      timestamp: String(Date.now()),
      snapshot: snapshotBuffer,
      ttl: String(ttl),
    },
  }));

  console.log(`[crdt-snapshot] Wrote snapshot for channel ${channelId}`);
}

export async function handler(event: SQSEvent | EventBridgeEvent) {
  if (isSQSEvent(event)) {
    // SQS trigger: each record body is a JSON-encoded EventBridge event
    console.log(`[crdt-snapshot] Processing ${event.Records.length} SQS record(s)`);
    for (const record of event.Records) {
      try {
        const ebEvent: EventBridgeEvent = JSON.parse(record.body);
        await processEventBridgeEvent(ebEvent);
      } catch (err) {
        console.error(`[crdt-snapshot] Failed to process record ${record.messageId}: ${err}`);
        // Continue to next record — do NOT re-throw; one bad record must not fail the batch
      }
    }
  } else {
    // Direct invoke: raw EventBridge event
    await processEventBridgeEvent(event as EventBridgeEvent);
  }

  return { statusCode: 200, body: 'ok' };
}
