import { ITable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface DynamoDBTableResult {
  table: ITable;
  tableName: string;
}

const TABLE_NAME = 'crdt-snapshots';

/**
 * Reference the existing DynamoDB table for CRDT snapshots.
 * The table was created outside this stack and is retained independently.
 * Use `cdk import` to bring it under full CDK management if needed.
 */
export function createCrdtSnapshotsTable(scope: Construct, vpc: Vpc): DynamoDBTableResult {
  const table = Table.fromTableName(scope, 'CrdtSnapshotsTable', TABLE_NAME);

  return {
    table,
    tableName: TABLE_NAME,
  };
}
