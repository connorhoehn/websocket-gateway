// social-api/src/routes/pipelineTriggers.ts
//
// Per-pipeline run trigger + run-snapshot + history endpoints, plus an
// `approvalsRouter` for POST /api/pipelines/:runId/approvals.
//
// Endpoints:
//   POST   /api/pipelines/:pipelineId/runs                  → trigger a run
//   GET    /api/pipelines/:pipelineId/runs/:runId           → run snapshot
//   GET    /api/pipelines/:pipelineId/runs/:runId/history?fromVersion=0
//                                                           → BusEvent[] (or [])
//   POST   /api/pipelines/:runId/approvals                  → resolve approval
//
// Phase notes:
//   - All endpoints honor the `Idempotency-Key` request header via
//     `middleware/idempotency.idempotency`. Cache TTL 24h, Redis-backed.
//   - When the gateway PipelineModule bridge isn't wired (Phase 1/Phase 4
//     handoff), POST /runs synthesizes a runId and returns 202 Accepted with
//     a TODO log line. Reads (GET run / history) return 404 / [] respectively.
//   - The bridge contract (matched by Agent 1's PipelineService) is:
//       getRun(runId)
//       getHistory(runId, fromVersion)
//       resolveApproval(runId, stepId, userId, decision, comment?)
//       listActiveRuns()
//       getMetrics().runsAwaitingApproval
//     The bridge is provided via `setPipelineBridge()` (called from
//     server bootstrap once distributed-core is mounted). Until then, the
//     unbridged stub branches below run and the frontend exercises the
//     in-process MockExecutor.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/error-handler';
import { idempotency } from '../middleware/idempotency';

// ---------------------------------------------------------------------------
// Bridge contract (matches `~/Sandbox/distributed-core` PipelineModule shape).
// ---------------------------------------------------------------------------

export interface PipelineRunSnapshot {
  runId: string;
  pipelineId?: string;
  status?: string;
  [k: string]: unknown;
}

export interface BusEvent {
  type: string;
  payload?: unknown;
  version?: number;
  at?: string;
  [k: string]: unknown;
}

export interface PipelineBridge {
  /** Trigger a new run; returns the freshly-minted runId. */
  trigger?(args: {
    pipelineId: string;
    definition?: unknown;
    triggerPayload?: unknown;
    triggeredBy: { userId: string };
  }): Promise<{ runId: string }>;
  getRun(runId: string): Promise<PipelineRunSnapshot | null> | PipelineRunSnapshot | null;
  /**
   * Returns BusEvent[] for replay. Per the handoff contract: returns [] (NO
   * throw) when the underlying bus has no walFilePath configured.
   */
  getHistory(runId: string, fromVersion: number): Promise<BusEvent[]> | BusEvent[];
  resolveApproval(
    runId: string,
    stepId: string,
    userId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<void> | void;
}

let bridge: PipelineBridge | null = null;

/**
 * Wire a live PipelineModule bridge. Called once from server bootstrap when
 * distributed-core is mounted. Until set, the stub paths below take over.
 */
export function setPipelineBridge(b: PipelineBridge | null): void {
  bridge = b;
}

/** Test/inspection helper. */
export function getPipelineBridge(): PipelineBridge | null {
  return bridge;
}

// ---------------------------------------------------------------------------
// Request/response shapes.
// ---------------------------------------------------------------------------

export interface InlinePipelineDefinition {
  id: string;
  [key: string]: unknown;
}

export interface TriggerRunRequest {
  triggerPayload?: Record<string, unknown>;
  /**
   * Inline pipeline definition. Optional in Phase 1; required in Phase 4
   * (the distributed-core `createResource` call needs it inline so the
   * worker side doesn't have to read-after-write against pipeline storage).
   */
  definition?: InlinePipelineDefinition;
}

export interface TriggerRunResponse {
  runId: string;
  pipelineId: string;
  triggeredBy: { userId: string; triggerType: string };
  at: string;
}

export interface ResolveApprovalRequest {
  stepId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}

// ---------------------------------------------------------------------------
// Triggers + run snapshot + history.
// `mergeParams` exposes :pipelineId from the parent mount.
// ---------------------------------------------------------------------------

export const pipelineTriggersRouter = Router({ mergeParams: true });

// POST /
pipelineTriggersRouter.post(
  '/',
  idempotency({ scope: 'pipeline-trigger' }),
  asyncHandler<{ pipelineId: string }, TriggerRunResponse, TriggerRunRequest>(async (req, res) => {
    const { pipelineId } = req.params;
    const userId = req.user!.sub;
    const body = (req.body ?? {}) as TriggerRunRequest;

    if (body.definition && body.definition.id !== pipelineId) {
      throw new ValidationError(
        `definition.id (${body.definition.id}) does not match :pipelineId (${pipelineId})`,
      );
    }

    let runId: string;
    if (bridge?.trigger) {
      const out = await bridge.trigger({
        pipelineId,
        definition: body.definition,
        triggerPayload: body.triggerPayload,
        triggeredBy: { userId },
      });
      runId = out.runId;
    } else {
      runId = randomUUID();
      // eslint-disable-next-line no-console
      console.log(
        `[pipelineTriggers] TODO: PipelineModule bridge not wired; synthesized runId=${runId} for pipelineId=${pipelineId}`,
      );
    }

    const response: TriggerRunResponse = {
      runId,
      pipelineId,
      triggeredBy: { userId, triggerType: 'manual' },
      at: new Date().toISOString(),
    };

    res.status(202).json(response);
  }),
);

// GET /:runId — run snapshot
pipelineTriggersRouter.get(
  '/:runId',
  asyncHandler<{ pipelineId: string; runId: string }>(async (req, res) => {
    const { runId } = req.params;
    if (!bridge) {
      throw new NotFoundError('run not found');
    }
    const snap = await Promise.resolve(bridge.getRun(runId));
    if (!snap) {
      throw new NotFoundError('run not found');
    }
    res.json(snap);
  }),
);

// GET /:runId/history?fromVersion=0
pipelineTriggersRouter.get(
  '/:runId/history',
  asyncHandler<{ pipelineId: string; runId: string }, unknown, unknown, { fromVersion?: string }>(
    async (req, res) => {
      const { runId } = req.params;
      const rawFromVersion = req.query.fromVersion;
      const fromVersion = rawFromVersion ? parseInt(String(rawFromVersion), 10) : 0;
      if (!Number.isFinite(fromVersion) || fromVersion < 0) {
        throw new ValidationError('fromVersion must be a non-negative integer');
      }
      if (!bridge) {
        // Per handoff contract: [] when bus has no walFilePath configured.
        res.json([]);
        return;
      }
      const events = await Promise.resolve(bridge.getHistory(runId, fromVersion));
      res.json(events ?? []);
    },
  ),
);

// ---------------------------------------------------------------------------
// Approvals — POST /api/pipelines/:runId/approvals
// Mounted separately from the runs router so the path matches the spec.
// ---------------------------------------------------------------------------

export const pipelineApprovalsRouter = Router({ mergeParams: true });

pipelineApprovalsRouter.post(
  '/',
  idempotency({ scope: 'pipeline-approval' }),
  asyncHandler<{ runId: string }, unknown, ResolveApprovalRequest>(async (req, res) => {
    const { runId } = req.params;
    const userId = req.user!.sub;
    const body = (req.body ?? {}) as ResolveApprovalRequest;

    if (!body.stepId || typeof body.stepId !== 'string') {
      throw new ValidationError('stepId is required');
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      throw new ValidationError("decision must be 'approve' or 'reject'");
    }
    if (body.comment !== undefined && typeof body.comment !== 'string') {
      throw new ValidationError('comment must be a string when present');
    }

    if (!bridge) {
      // eslint-disable-next-line no-console
      console.log(
        `[pipelineApprovals] TODO: bridge not wired; accepted approval runId=${runId} stepId=${body.stepId} decision=${body.decision} userId=${userId}`,
      );
      res.status(204).end();
      return;
    }

    await Promise.resolve(
      bridge.resolveApproval(runId, body.stepId, userId, body.decision, body.comment),
    );
    res.status(204).end();
  }),
);
