// Hub task #197 — persist pipeline run history to DynamoDB.
//
// Queryable index of pipeline run history. The Raft state machine + WAL remain
// the source of truth for replay; this repository backs the
// `/api/pipelines/:pipelineId/runs` operator-facing surface.

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';
import { tableName } from '../lib/ddb-table-name';

export interface PipelineRunItem {
  pipelineId: string;
  runId: string;
  status: string; // 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled'
  triggeredBy: string; // userId or 'system'
  triggerType: string; // 'manual' | 'schedule' | 'webhook' | 'document-event'
  startedAt: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  stepsSummary?: Record<string, unknown>; // opaque step state
  error?: string;
  /** Epoch seconds — set by application for auto-expiry of old runs. */
  ttl?: number;
}

export class PipelineRunRepository extends BaseRepository {
  constructor(docClient: DynamoDBDocumentClient) {
    super(tableName('pipeline-runs'), docClient);
  }

  /** Upsert a pipeline run. */
  async put(item: PipelineRunItem): Promise<void> {
    return this.putItem(item as unknown as Record<string, unknown>);
  }

  /** Fetch a single run by composite key. */
  async get(pipelineId: string, runId: string): Promise<PipelineRunItem | null> {
    return this.getItem<PipelineRunItem>({ pipelineId, runId });
  }

  /** List runs for a pipeline, most recent first by runId. */
  async listByPipeline(
    pipelineId: string,
    opts: { limit?: number } = {},
  ): Promise<PipelineRunItem[]> {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    return this.query<PipelineRunItem>({
      KeyConditionExpression: 'pipelineId = :pipelineId',
      ExpressionAttributeValues: { ':pipelineId': pipelineId },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  /** Query the status-startedAt GSI. Most recent first. */
  async listByStatus(
    status: string,
    opts: { limit?: number } = {},
  ): Promise<PipelineRunItem[]> {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    return this.query<PipelineRunItem>({
      IndexName: 'status-startedAt-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  /** Query the triggeredBy-startedAt GSI. Most recent first. */
  async listByTriggeredBy(
    triggeredBy: string,
    opts: { limit?: number } = {},
  ): Promise<PipelineRunItem[]> {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    return this.query<PipelineRunItem>({
      IndexName: 'triggeredBy-startedAt-index',
      KeyConditionExpression: 'triggeredBy = :triggeredBy',
      ExpressionAttributeValues: { ':triggeredBy': triggeredBy },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  /** Remove a run. */
  async delete(pipelineId: string, runId: string): Promise<void> {
    return this.deleteItem({ pipelineId, runId });
  }
}
