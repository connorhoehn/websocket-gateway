// social-api/src/routes/pipelineTriggers.ts
//
// Per-pipeline run trigger + run-snapshot + history endpoints, plus an
// `approvalsRouter` for POST /api/pipelines/:runId/approvals.
//
// Endpoints:
//   POST   /api/pipelines/:pipelineId/runs                  → trigger a run
//   GET    /api/pipelines/:pipelineId/runs                  → list past runs
//                                                             (paginated, in-memory)
//   GET    /api/pipelines/:pipelineId/runs/:runId           → run snapshot
//   GET    /api/pipelines/:pipelineId/runs/:runId/history?fromVersion=0
//                                                           → BusEvent[] (or [])
//   POST   /api/pipelines/:runId/cancel                     → cancel an active run
//   POST   /api/pipelines/:runId/approvals                  → resolve approval
//   GET    /api/pipelines/runs/active                       → list active runs
//
// Phase notes:
//   - All endpoints honor the `Idempotency-Key` request header via
//     `middleware/idempotency.idempotency`. Cache TTL 24h, Redis-backed.
//   - When the gateway PipelineModule bridge isn't wired (Phase 1/Phase 4
//     handoff), POST /runs synthesizes a runId, records it in `stubRunStore`
//     (in-memory, per-user) and returns 202 Accepted. The list / active /
//     cancel endpoints read/write that same in-memory store so the MCP
//     tools and the frontend dashboard have something real to talk to.
//     Phase 4 swaps the stubRunStore reads for the bridge methods.
//   - The bridge contract (matched by Agent 1's PipelineService) is:
//       getRun(runId)
//       getHistory(runId, fromVersion)
//       resolveApproval(runId, stepId, userId, decision, comment?)
//       listRuns(pipelineId, opts) ........ NEW (Phase 4)
//       listActiveRuns() ................. NEW (Phase 4)
//       cancelRun(runId, userId) ......... NEW (Phase 4)
//       getMetrics().runsAwaitingApproval
//     The bridge is provided via `setPipelineBridge()` (called from
//     server bootstrap once distributed-core is mounted). Until then, the
//     unbridged stub branches below run and the frontend exercises the
//     in-process MockExecutor.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/error-handler';
import { idempotency } from '../middleware/idempotency';
import { createRateLimiter } from '../middleware/rateLimit';

// ---------------------------------------------------------------------------
// Per-user rate limit for POST /:pipelineId/runs.
//
// Defaults: 60 tokens capacity, 60 tokens / 60s refill (= 1 run/sec sustained
// with a 60-burst). Operators can tune via env without redeploying:
//
//   PIPELINE_RATELIMIT_CAPACITY        — burst size (tokens)
//   PIPELINE_RATELIMIT_REFILL_PER_MIN  — sustained tokens per 60s
//
// Mounted AFTER auth (so `req.user.sub` is populated) but BEFORE idempotency
// (so a 429 doesn't burn a fresh Idempotency-Key — the client can retry the
// same key once a token frees up). Rate-limit scope is per-userId; unauth'd
// flows fall back to req.ip.
// ---------------------------------------------------------------------------

const PIPELINE_RATELIMIT_CAPACITY = (() => {
  const raw = process.env.PIPELINE_RATELIMIT_CAPACITY;
  if (!raw) return 60;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

const PIPELINE_RATELIMIT_REFILL_PER_MIN = (() => {
  const raw = process.env.PIPELINE_RATELIMIT_REFILL_PER_MIN;
  if (!raw) return 60;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

const triggerRateLimiter = createRateLimiter({
  scope: 'pipeline-trigger',
  capacity: PIPELINE_RATELIMIT_CAPACITY,
  refillRate: PIPELINE_RATELIMIT_REFILL_PER_MIN,
  refillIntervalMs: 60_000,
  // Prefer the authed userId; fall back to ip for any pre-auth path that
  // might land here (defensive — `requireAuth` is global today).
  key: (req) => req.user?.sub ?? req.ip ?? 'anon',
});

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
  /**
   * (Phase 4) List past runs for a pipeline. Optional — when absent, the
   * route falls back to the in-memory stubRunStore so MCP / UI still work.
   */
  listRuns?(
    pipelineId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<{ runs: PipelineRunSnapshot[]; nextCursor?: string }>
    | { runs: PipelineRunSnapshot[]; nextCursor?: string };
  /**
   * (Phase 4) List runs whose status is pending / running / awaiting-approval.
   * Optional — falls back to filtering the in-memory store when absent.
   */
  listActiveRuns?(): Promise<PipelineRunSnapshot[]> | PipelineRunSnapshot[];
  /**
   * (Phase 4) Cancel an active run. Optional — the stub branch flips the
   * in-memory store entry's status to 'canceled'.
   */
  cancelRun?(runId: string, userId: string): Promise<void> | void;
  /**
   * (Phase 4) Pending-approval queue across all in-flight runs on this node.
   * Maps to `PipelineModule.getPendingApprovals()`. Optional — the stub
   * approvals route returns an empty array when the bridge isn't wired.
   */
  getPendingApprovals?(): Promise<PendingApprovalRow[]> | PendingApprovalRow[];
  /**
   * (Phase 4) `runsAwaitingApproval` count for the sub-nav badge. Maps to
   * `PipelineModule.getMetrics().runsAwaitingApproval`. Optional.
   */
  getMetrics?(): Promise<{ runsAwaitingApproval: number }> | { runsAwaitingApproval: number };
}

/**
 * Mirror of distributed-core's `PendingApprovalRow`. Kept here as a local
 * shape so social-api consumers don't need to import `distributed-core` until
 * the live bridge is wired. Must stay in sync — see PIPELINES_PLAN.md §11.5.
 */
export interface PendingApprovalRow {
  runId: string;
  stepId: string;
  pipelineId: string;
  approvers: Array<{ userId: string; teamId?: string; role?: string }>;
  message?: string;
  /** ISO 8601. */
  requestedAt: string;
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
// In-memory run store (Phase 1 stub).
//
// Mirrors `stubPipelineStore` from pipelineDefinitions.ts. Keyed by runId for
// O(1) cancel lookups; we also index by pipelineId for the history endpoint.
// Per-user — the runs list is filtered against `req.user.sub` on read so two
// users in the same process don't see each other's stubs.
//
// Phase 4 swap-out: replace these reads with `bridge.listRuns()` /
// `bridge.listActiveRuns()` / `bridge.cancelRun()` calls. The route shapes
// are deliberately compatible with what those bridge methods return.
// ---------------------------------------------------------------------------

export type StubRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting-approval'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface StubRunRecord {
  runId: string;
  pipelineId: string;
  userId: string;
  status: StubRunStatus;
  triggeredAt: string; // ISO
  updatedAt: string; // ISO
  triggerPayload?: unknown;
  /** Optional reason for status transitions (e.g. cancel reason). */
  reason?: string;
}

const runRecords = new Map<string, StubRunRecord>(); // runId -> record

const ACTIVE_STATUSES: ReadonlySet<StubRunStatus> = new Set([
  'pending',
  'running',
  'awaiting-approval',
]);

export const stubRunStore = {
  /** Insert (used by the trigger route's stub branch). */
  put(record: StubRunRecord): void {
    runRecords.set(record.runId, record);
  },
  get(runId: string): StubRunRecord | undefined {
    return runRecords.get(runId);
  },
  /** List runs for a pipeline (newest first), filtered to `userId`. */
  listForPipeline(
    pipelineId: string,
    userId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): { runs: StubRunRecord[]; nextCursor?: string } {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const all = Array.from(runRecords.values())
      .filter((r) => r.pipelineId === pipelineId && r.userId === userId)
      .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1));
    let startIdx = 0;
    if (opts.cursor) {
      const idx = all.findIndex((r) => r.runId === opts.cursor);
      startIdx = idx >= 0 ? idx + 1 : 0;
    }
    const page = all.slice(startIdx, startIdx + limit);
    const nextCursor =
      startIdx + limit < all.length ? page[page.length - 1]?.runId : undefined;
    return { runs: page, nextCursor };
  },
  /** All active runs for `userId`. */
  listActive(userId: string): StubRunRecord[] {
    return Array.from(runRecords.values())
      .filter((r) => r.userId === userId && ACTIVE_STATUSES.has(r.status))
      .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1));
  },
  /**
   * Mark a run as canceled. Returns the updated record, or null when the run
   * isn't owned by `userId` (or doesn't exist), or when it's already in a
   * terminal state.
   */
  cancel(runId: string, userId: string, reason?: string): StubRunRecord | null {
    const r = runRecords.get(runId);
    if (!r || r.userId !== userId) return null;
    if (!ACTIVE_STATUSES.has(r.status)) return null;
    r.status = 'canceled';
    r.updatedAt = new Date().toISOString();
    if (reason) r.reason = reason;
    return r;
  },
  /** Test helper — wipe everything between cases. */
  __resetForTests(): void {
    runRecords.clear();
  },
};

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
  // Rate-limit BEFORE idempotency: a 429 must not consume an Idempotency-Key
  // entry, otherwise the client's retry would replay an empty cached response.
  triggerRateLimiter,
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

    const at = new Date().toISOString();

    // Record into the in-memory stub store so the list/active/cancel routes
    // (and their MCP tools) have something real to read. Phase 4 swaps the
    // reads to the bridge; the writes here become a no-op once bridge.trigger
    // is wired (the bridge owns its own state).
    if (!bridge?.trigger) {
      stubRunStore.put({
        runId,
        pipelineId,
        userId,
        status: 'pending',
        triggeredAt: at,
        updatedAt: at,
        triggerPayload: body.triggerPayload,
      });
    }

    const response: TriggerRunResponse = {
      runId,
      pipelineId,
      triggeredBy: { userId, triggerType: 'manual' },
      at,
    };

    res.status(202).json(response);
  }),
);

// GET / — list past runs for a pipeline (paginated).
//
// Query: ?limit=NN&cursor=<runId>   (limit clamped to 1..100, default 20)
//
// When the bridge exposes `listRuns()` we forward to it; otherwise we read
// from the in-memory stubRunStore (filtered to the calling user).
pipelineTriggersRouter.get(
  '/',
  asyncHandler<
    { pipelineId: string },
    unknown,
    unknown,
    { limit?: string; cursor?: string }
  >(async (req, res) => {
    const { pipelineId } = req.params;
    const userId = req.user!.sub;

    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const n = parseInt(String(rawLimit), 10);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        throw new ValidationError('limit must be an integer between 1 and 100');
      }
      limit = n;
    }
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

    if (bridge?.listRuns) {
      const out = await Promise.resolve(bridge.listRuns(pipelineId, { limit, cursor }));
      res.json(out);
      return;
    }
    const out = stubRunStore.listForPipeline(pipelineId, userId, { limit, cursor });
    res.json(out);
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
// Active runs — GET /api/pipelines/runs/active
// Mounted separately from the runs router (no :pipelineId in the path).
// ---------------------------------------------------------------------------

export const pipelineActiveRunsRouter = Router();

pipelineActiveRunsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    if (bridge?.listActiveRuns) {
      const runs = await Promise.resolve(bridge.listActiveRuns());
      res.json({ runs });
      return;
    }
    const runs = stubRunStore.listActive(userId);
    res.json({ runs });
  }),
);

// ---------------------------------------------------------------------------
// Cancel — POST /api/pipelines/:runId/cancel
// Returns 200 with the updated record on success, 404 when the run doesn't
// exist (or isn't owned by the caller), 409 when the run is already in a
// terminal state.
// ---------------------------------------------------------------------------

export const pipelineCancelRouter = Router({ mergeParams: true });

interface CancelRunRequest {
  reason?: string;
}

pipelineCancelRouter.post(
  '/',
  idempotency({ scope: 'pipeline-cancel' }),
  asyncHandler<{ runId: string }, unknown, CancelRunRequest>(async (req, res) => {
    const { runId } = req.params;
    const userId = req.user!.sub;
    const body = (req.body ?? {}) as CancelRunRequest;
    if (body.reason !== undefined && typeof body.reason !== 'string') {
      throw new ValidationError('reason must be a string when present');
    }

    if (bridge?.cancelRun) {
      await Promise.resolve(bridge.cancelRun(runId, userId));
      // Bridge owns the truth in Phase 4; we surface the same shape as the
      // stub branch by reading back via getRun if available.
      if (bridge.getRun) {
        const snap = await Promise.resolve(bridge.getRun(runId));
        if (!snap) {
          throw new NotFoundError('run not found');
        }
        res.json(snap);
        return;
      }
      res.json({ runId, status: 'canceled' });
      return;
    }

    const updated = stubRunStore.cancel(runId, userId, body.reason);
    if (!updated) {
      // Distinguish missing-vs-terminal so the MCP layer can surface a
      // useful error. We probe the store again to figure out which case.
      const existing = stubRunStore.get(runId);
      if (!existing || existing.userId !== userId) {
        throw new NotFoundError('run not found');
      }
      throw new ValidationError(
        `run ${runId} is in terminal state '${existing.status}' and cannot be canceled`,
      );
    }
    res.json(updated);
  }),
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
