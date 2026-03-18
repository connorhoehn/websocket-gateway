import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
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
