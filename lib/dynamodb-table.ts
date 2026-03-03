import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface DynamoDBTableResult {
  table: Table;
  tableName: string;
}

/**
 * Create DynamoDB table for CRDT snapshots with TTL and on-demand billing
 *
 * Table schema:
 * - Partition key: documentId (string) - unique document identifier
 * - Sort key: timestamp (number) - epoch milliseconds for versioning
 * - Attributes: snapshot (binary), ttl (number)
 * - TTL enabled on 'ttl' attribute for automatic snapshot expiration
 * - On-demand billing for cost optimization with unpredictable workload
 * - Point-in-time recovery for data safety
 * - AWS managed encryption at rest
 */
export function createCrdtSnapshotsTable(scope: Construct, vpc: Vpc): DynamoDBTableResult {
  const table = new Table(scope, 'CrdtSnapshotsTable', {
    tableName: 'crdt-snapshots',
    partitionKey: {
      name: 'documentId',
      type: AttributeType.STRING,
    },
    sortKey: {
      name: 'timestamp',
      type: AttributeType.NUMBER,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    encryption: TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: true,
    removalPolicy: RemovalPolicy.RETAIN,
    timeToLiveAttribute: 'ttl',
  });

  return {
    table,
    tableName: table.tableName,
  };
}
