// Pipeline run persistence — durable queryable index of run history.
//
// The Raft state machine + WAL remain the source of truth for replay; this
// repository provides the queryable index for `/api/pipelines/:pipelineId/runs`
// and other operator-facing surfaces.

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';
import { tableName } from '../lib/ddb-table-name';

export type PipelineRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting-approval'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface PipelineRunItem {
  pipelineId: string;
  runId: string;
  userId: string;
  status: PipelineRunStatus;
  triggeredAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  triggerPayload?: unknown;
  triggeredBy?: { userId: string; triggerType: string };
  reason?: string;
  /** Epoch seconds — set for auto-expiry of old runs after 90 days. */
  ttl?: number;
}

export class PipelineRunRepository extends BaseRepository {
  constructor(docClient: DynamoDBDocumentClient) {
    super(tableName('pipeline-runs'), docClient);
  }

  async create(item: PipelineRunItem): Promise<void> {
    return this.putItem(item as unknown as Record<string, unknown>);
  }

  async get(pipelineId: string, runId: string): Promise<PipelineRunItem | null> {
    return this.getItem<PipelineRunItem>({ pipelineId, runId });
  }

  /** Update run status + metadata. */
  async updateStatus(
    pipelineId: string,
    runId: string,
    patch: Partial<Pick<PipelineRunItem, 'status' | 'startedAt' | 'completedAt' | 'reason'>>,
  ): Promise<void> {
    const expressions: string[] = ['updatedAt = :updatedAt'];
    const exprValues: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

    if (patch.status !== undefined) {
      expressions.push('#status = :status');
      exprValues[':status'] = patch.status;
    }
    if (patch.startedAt !== undefined) {
      expressions.push('startedAt = :startedAt');
      exprValues[':startedAt'] = patch.startedAt;
    }
    if (patch.completedAt !== undefined) {
      expressions.push('completedAt = :completedAt');
      exprValues[':completedAt'] = patch.completedAt;
    }
    if (patch.reason !== undefined) {
      expressions.push('reason = :reason');
      exprValues[':reason'] = patch.reason;
    }

    await this.updateItem({
      Key: { pipelineId, runId },
      UpdateExpression: 'SET ' + expressions.join(', '),
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: exprValues,
    });
  }

  /** List runs for a pipeline (newest first), optionally filtered by userId. */
  async listForPipeline(
    pipelineId: string,
    opts: { limit?: number; userId?: string; exclusiveStartKey?: Record<string, unknown> } = {},
  ): Promise<{ runs: PipelineRunItem[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const result = await this.queryWithPagination<PipelineRunItem>({
      KeyConditionExpression: 'pipelineId = :pipelineId',
      ExpressionAttributeValues: { ':pipelineId': pipelineId },
      ScanIndexForward: false, // newest first
      Limit: limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    });

    // Filter by userId in-memory if specified (DDB doesn't have a userId GSI yet).
    const filtered = opts.userId
      ? result.items.filter((r) => r.userId === opts.userId)
      : result.items;

    return { runs: filtered, lastEvaluatedKey: result.lastEvaluatedKey };
  }

  /** List active runs (pending, running, awaiting-approval) for a userId. */
  async listActiveForUser(
    userId: string,
    opts: { limit?: number } = {},
  ): Promise<PipelineRunItem[]> {
    // Phase 1 implementation: Scan with filter. Production deployment should
    // add a GSI on userId-status once this query pattern is load-tested.
    const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
    const activeStatuses: PipelineRunStatus[] = ['pending', 'running', 'awaiting-approval'];

    // For now, fall back to query on status GSI if available, otherwise Scan.
    // The schema includes status-startedAt-index; use it.
    const allActive: PipelineRunItem[] = [];
    for (const status of activeStatuses) {
      const result = await this.query<PipelineRunItem>({
        IndexName: 'status-startedAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        ScanIndexForward: false,
        Limit: limit,
      });
      allActive.push(...result.filter((r) => r.userId === userId));
    }

    return allActive
      .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1))
      .slice(0, limit);
  }
}
