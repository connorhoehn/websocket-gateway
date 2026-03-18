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

export async function handler(event: EventBridgeEvent) {
  const detailType = event['detail-type'];
  const detail = event.detail;
  const userId = (detail.userId ?? detail.followerId ?? detail.authorId ?? 'unknown') as string;
  const timestamp = event.time ?? new Date().toISOString();

  console.log(`Processing ${detailType} for user ${userId}`);

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: {
      userId,
      timestamp,
      eventType: detailType,
      detail: JSON.stringify(detail),
    },
  }));

  console.log(`Wrote activity record: userId=${userId}, timestamp=${timestamp}, type=${detailType}`);
  return { statusCode: 200, body: 'ok' };
}
