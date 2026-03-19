import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const localstackConfig = endpoint
  ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ddb = new DynamoDBClient({ region, ...localstackConfig });
const docClient = DynamoDBDocumentClient.from(ddb);
const sqsClient = new SQSClient({ region, ...localstackConfig });

const OUTBOX_TABLE = 'social-outbox';

const QUEUE_URLS: Record<string, string> = {
  'social-follows':   process.env.SQS_FOLLOWS_URL   ?? '',
  'social-rooms':     process.env.SQS_ROOMS_URL     ?? '',
  'social-posts':     process.env.SQS_POSTS_URL     ?? '',
  'social-reactions': process.env.SQS_REACTIONS_URL ?? '',
};

export async function handler(_event: unknown) {
  const result = await docClient.send(new QueryCommand({
    TableName: OUTBOX_TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':u': 'UNPROCESSED' },
    Limit: 100,
  }));

  let relayed = 0;
  for (const item of result.Items ?? []) {
    const outboxId = item['outboxId'] as string;
    const eventType = item['eventType'] as string;
    const queueName = item['queueName'] as string;
    const payload = item['payload'] as string;
    const createdAt = item['createdAt'] as string;
    const queueUrl = QUEUE_URLS[queueName];

    if (!queueUrl) {
      console.error(`[outbox-relay] No URL for queue=${queueName} outboxId=${outboxId}`);
      continue;
    }

    try {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          source: 'social-api',
          'detail-type': eventType,
          detail: JSON.parse(payload),
          time: createdAt,
        }),
      }));

      await docClient.send(new UpdateCommand({
        TableName: OUTBOX_TABLE,
        Key: { outboxId },
        UpdateExpression: 'SET #s = :p, processedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':p': 'PROCESSED',
          ':now': new Date().toISOString(),
        },
      }));

      relayed++;
      console.log(`[outbox-relay] OK: ${eventType} -> ${queueName} (${outboxId})`);
    } catch (err) {
      console.error(`[outbox-relay] FAIL: ${outboxId}:`, err);
      // Record stays UNPROCESSED — retried next invocation
    }
  }

  console.log(`[outbox-relay] Relayed ${relayed}/${result.Items?.length ?? 0} records`);
  return { statusCode: 200, relayed };
}
