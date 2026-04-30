// Phase 51 Phase A — DDB-backed persistence for DocumentType schemas.
//
// Schema definitions for the document-types feature live in the
// `document-types` table (PK: typeId). The shape mirrors the frontend
// `DocumentType` TS interface so the API consumer can deserialize without
// translation.

import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';

export type DocumentTypeFieldKind =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'boolean';

export type DocumentTypeFieldWidget =
  | 'text_field'
  | 'textarea'
  | 'number_input'
  | 'date_picker'
  | 'checkbox';

export type DocumentTypeFieldCardinality = 1 | 'unlimited';

export interface DocumentTypeFieldItem {
  fieldId: string;
  name: string;
  fieldType: DocumentTypeFieldKind;
  widget: DocumentTypeFieldWidget;
  cardinality: DocumentTypeFieldCardinality;
  required: boolean;
  helpText: string;
}

export interface DocumentTypeItem {
  typeId: string;
  name: string;
  description: string;
  icon: string;
  fields: DocumentTypeFieldItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class DocumentTypeRepository extends BaseRepository {
  constructor(docClient: DynamoDBDocumentClient) {
    super('document-types', docClient);
  }

  async create(item: DocumentTypeItem): Promise<void> {
    return this.putItem(item as unknown as Record<string, unknown>);
  }

  async get(typeId: string): Promise<DocumentTypeItem | null> {
    return this.getItem<DocumentTypeItem>({ typeId });
  }

  async delete(typeId: string): Promise<void> {
    return this.deleteItem({ typeId });
  }

  // Phase A — full-table Scan, capped. Acceptable for the demo cardinality
  // (hand-crafted document types, not user-generated content). A GSI keyed
  // on `createdBy` would be the right move once tenancy lands.
  async list(limit = 50): Promise<DocumentTypeItem[]> {
    const result = await this.docClient.send(
      new ScanCommand({ TableName: this.tableName, Limit: Math.min(limit, 200) }),
    );
    return (result.Items ?? []) as DocumentTypeItem[];
  }

  async update(
    typeId: string,
    patch: Partial<Pick<DocumentTypeItem, 'name' | 'description' | 'icon' | 'fields'>>,
  ): Promise<DocumentTypeItem> {
    const expressions: string[] = [];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {};

    if (patch.name !== undefined) {
      expressions.push('#name = :name');
      exprNames['#name'] = 'name';
      exprValues[':name'] = patch.name;
    }
    if (patch.description !== undefined) {
      expressions.push('description = :description');
      exprValues[':description'] = patch.description;
    }
    if (patch.icon !== undefined) {
      expressions.push('icon = :icon');
      exprValues[':icon'] = patch.icon;
    }
    if (patch.fields !== undefined) {
      expressions.push('#fields = :fields');
      exprNames['#fields'] = 'fields';
      exprValues[':fields'] = patch.fields;
    }
    expressions.push('updatedAt = :updatedAt');
    exprValues[':updatedAt'] = new Date().toISOString();

    const result = await this.updateItem({
      Key: { typeId },
      UpdateExpression: 'SET ' + expressions.join(', '),
      ...(Object.keys(exprNames).length ? { ExpressionAttributeNames: exprNames } : {}),
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    });

    return result as unknown as DocumentTypeItem;
  }
}
