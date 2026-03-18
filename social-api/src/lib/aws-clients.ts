import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';

const endpoint = process.env.LOCALSTACK_ENDPOINT;
const localstackConfig = endpoint
  ? {
      endpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';

export const ddbClient = new DynamoDBClient({ region, ...localstackConfig });
export const docClient = DynamoDBDocumentClient.from(ddbClient);
export const eventBridgeClient = new EventBridgeClient({ region, ...localstackConfig });
export const sqsClient = new SQSClient({ region, ...localstackConfig });

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'social-events';

/**
 * Publish a social event to EventBridge. Log-and-continue on failure —
 * event publish errors must NOT break the HTTP response.
 */
export async function publishSocialEvent(
  detailType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'social-api',
            DetailType: detailType,
            Detail: JSON.stringify({ ...detail, timestamp: new Date().toISOString() }),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }),
    );
  } catch (err) {
    console.error(`[event-publish] Failed to publish ${detailType}:`, err);
  }
}
