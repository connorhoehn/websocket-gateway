// Phase 51 Phase A — DDB-backed persistence for TypedDocument instances.
//
// Each instance conforms to a DocumentType schema; the route layer enforces
// shape (required fields present, cardinality matches).

import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';
import { tableName } from '../lib/ddb-table-name';

// Value shapes Phase B understands. Stored verbatim in DDB; the route
// layer enforces (fieldType, cardinality) → value-shape correspondence
// before persisting.
export type TypedDocumentValue =
  | string
  | string[]
  | number
  | number[]
  | boolean;

export interface TypedDocumentItem {
  documentId: string;
  typeId: string;
  values: Record<string, TypedDocumentValue>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class TypedDocumentRepository extends BaseRepository {
  constructor(docClient: DynamoDBDocumentClient) {
    super(tableName('typed-documents'), docClient);
  }

  async create(item: TypedDocumentItem): Promise<void> {
    return this.putItem(item as unknown as Record<string, unknown>);
  }

  async get(documentId: string): Promise<TypedDocumentItem | null> {
    return this.getItem<TypedDocumentItem>({ documentId });
  }

  // Phase A — Scan + filter on typeId. Flagged in the planning doc: a GSI on
  // typeId is the right shape but adding it requires IaC — operator work.
  // Acceptable while document instance counts stay demo-scale.
  async listByType(typeId: string, limit = 50): Promise<TypedDocumentItem[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'typeId = :typeId',
        ExpressionAttributeValues: { ':typeId': typeId },
        Limit: Math.min(limit, 200),
      }),
    );
    return (result.Items ?? []) as TypedDocumentItem[];
  }
}
