#!/usr/bin/env node
//
// Phase 51 / hub#53 — create the DDB tables social-api expects, against a
// local DynamoDB at $LOCALSTACK_ENDPOINT (default http://localhost:8000).
// Idempotent: skips tables that already exist.

import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:8000';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

// Minimum table set to keep /health green and the UI populated. Each entry
// matches what social-api expects in its repositories/routes.
const TABLES = [
  // /health canary + profile lookups
  {
    TableName: 'social-profiles',
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Rooms / channels
  {
    TableName: 'social-rooms',
    KeySchema: [{ AttributeName: 'roomId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'roomId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Room membership — has GSI userId-roomId-index used by getRoomsByUser
  {
    TableName: 'social-room-members',
    KeySchema: [
      { AttributeName: 'roomId', KeyType: 'HASH' },
      { AttributeName: 'userId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'roomId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-roomId-index',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'roomId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Follower/followee — used by visibility gating
  {
    TableName: 'social-relationships',
    KeySchema: [
      { AttributeName: 'followerId', KeyType: 'HASH' },
      { AttributeName: 'followeeId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'followerId', AttributeType: 'S' },
      { AttributeName: 'followeeId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Outbox — used by the room create + outbox publisher
  {
    TableName: 'social-outbox',
    KeySchema: [{ AttributeName: 'outboxId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'outboxId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Activity log — pk userId, sk timestamp#eventId
  {
    TableName: 'user-activity',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Phase 51 Phase A — document type schemas
  {
    TableName: 'document-types',
    KeySchema: [{ AttributeName: 'typeId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'typeId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  // Phase 51 Phase A — typed document instances
  {
    TableName: 'typed-documents',
    KeySchema: [{ AttributeName: 'documentId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'documentId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

async function main() {
  const existing = await client.send(new ListTablesCommand({}));
  const have = new Set((existing.TableNames ?? []));
  console.log(`[bootstrap] existing tables: ${[...have].join(', ') || '(none)'}`);

  for (const def of TABLES) {
    if (have.has(def.TableName)) {
      console.log(`[bootstrap] skip ${def.TableName} (exists)`);
      continue;
    }
    console.log(`[bootstrap] create ${def.TableName}`);
    await client.send(new CreateTableCommand(def));
  }
  console.log('[bootstrap] done');
}

main().catch((err) => {
  console.error('[bootstrap] failed:', err);
  process.exit(1);
});
