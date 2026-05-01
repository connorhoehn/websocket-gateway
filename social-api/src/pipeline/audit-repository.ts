// social-api/src/pipeline/audit-repository.ts
//
// Wave 1 of the pipeline-audit-log persistence migration.
// Provides an append-only audit trail for pipeline operations (trigger,
// approve, reject, cancel, webhook). Wave 2 will wire route handlers in
// routes/pipelineDefinitions.ts and routes/pipelineRuns.ts to call
// `record(...)` on every state-changing operation.
//
// Storage shape (table `pipeline-audit`):
//   PK: auditId (S) — caller-generated ULID, lexicographically time-sortable
//   GSI `actor-time-index`:
//     PK: actorUserId (S)
//     SK: timestamp (S, ISO 8601)
//     Projection: ALL
//   GSI `pipeline-time-index`:
//     PK: pipelineId (S)
//     SK: timestamp (S, ISO 8601)
//     Projection: ALL
//
// `record` is intentionally fire-and-forget at the persistence layer (no
// transactional guarantees) — pipeline state changes happen in their own
// repositories and we do NOT want a DynamoDB hiccup on the audit table to
// fail the user's request. Callers that need atomic "state + audit" writes
// should switch to `outbox-publisher.ts` style transactions later.
//
// NOTE: this file is intentionally NOT wired up yet — Wave 2 will add the
// `auditRepo.record(...)` calls inside the route handlers.

import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { BaseRepository } from '../repositories/BaseRepository';
import { docClient } from '../lib/aws-clients';
import { tableName } from '../lib/ddb-table-name';

const PIPELINE_AUDIT_TABLE = tableName('pipeline-audit');
const ACTOR_TIME_INDEX = 'actor-time-index';
const PIPELINE_TIME_INDEX = 'pipeline-time-index';

/** Logical action types recorded in the audit log. */
export type AuditAction =
  | 'pipeline.trigger'
  | 'pipeline.approve'
  | 'pipeline.reject'
  | 'pipeline.cancel'
  | 'pipeline.webhook';

/** Optional decision tag attached to the event. */
export type AuditDecision =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'completed';

/** Caller-supplied input to `record`. The repository fills in id + timestamp. */
export type AuditEvent = {
  action: AuditAction;
  actorUserId: string;
  pipelineId: string;
  runId?: string;
  decision?: AuditDecision;
  details?: Record<string, unknown>;
};

/** Fully-persisted shape (what queries return). */
export interface StoredAuditEvent extends AuditEvent {
  auditId: string;
  timestamp: string;
}

export class AuditRepository {
  private store: BaseRepository;

  constructor(private docClient: DynamoDBDocumentClient) {
    this.store = new BaseRepository(PIPELINE_AUDIT_TABLE, docClient);
  }

  /**
   * Append an event to the audit log. Generates a fresh ULID `auditId` and
   * an ISO 8601 `timestamp`. Returns void — callers that need the id should
   * generate it themselves and use a different API.
   */
  async record(event: AuditEvent): Promise<void> {
    const auditId = ulid();
    const timestamp = new Date().toISOString();

    const item: StoredAuditEvent = {
      auditId,
      timestamp,
      action: event.action,
      actorUserId: event.actorUserId,
      pipelineId: event.pipelineId,
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.decision ? { decision: event.decision } : {}),
      ...(event.details ? { details: event.details } : {}),
    };

    return this.store.putItem(item as unknown as Record<string, unknown>);
  }

  /**
   * List audit events authored by `userId`, newest first. `limit` caps the
   * page size (default 100). Pagination tokens are not exposed yet — Wave 2
   * route handlers will add them when the UI needs them.
   */
  async listByActor(
    userId: string,
    limit = 100,
  ): Promise<StoredAuditEvent[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: PIPELINE_AUDIT_TABLE,
        IndexName: ACTOR_TIME_INDEX,
        KeyConditionExpression: 'actorUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false, // newest first
        Limit: limit,
      }),
    );
    return (result.Items ?? []) as StoredAuditEvent[];
  }

  /**
   * List audit events for a given pipeline, newest first. Used to render
   * the per-pipeline activity timeline in the UI.
   */
  async listByPipeline(
    pipelineId: string,
    limit = 100,
  ): Promise<StoredAuditEvent[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: PIPELINE_AUDIT_TABLE,
        IndexName: PIPELINE_TIME_INDEX,
        KeyConditionExpression: 'pipelineId = :pid',
        ExpressionAttributeValues: { ':pid': pipelineId },
        ScanIndexForward: false, // newest first
        Limit: limit,
      }),
    );
    return (result.Items ?? []) as StoredAuditEvent[];
  }
}

/** Singleton instance — shares the same docClient as the other repositories. */
export const auditRepo = new AuditRepository(docClient);
