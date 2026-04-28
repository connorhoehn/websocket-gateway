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
//
// Observability (Wave 2):
//   - Every bridge invocation is wrapped in a try/catch with:
//       * a manual OTel span (`pipeline.<op>`),
//       * pino structured log lines (route='pipelineTriggers'),
//       * a Prometheus counter on success (trigger/approval/cancel) and on
//         error (recordPipelineError).
//   - On bridge error we now return a 5xx with a structured body
//     `{ error, action }` instead of the generic errorHandler 500. This is
//     a behaviour change vs. the silent rethrow from earlier waves.
//   - Audit writes (`auditRepo.record`) are FIRE-AND-FORGET: the response
//     does not block on a DynamoDB round-trip and an audit failure never
//     fails the user's request. Audit-write rejections are logged at warn.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/error-handler';
import { idempotency } from '../middleware/idempotency';
import { createRateLimiter } from '../middleware/rateLimit';
import { withContext } from '../lib/logger';
import {
  recordPipelineApproval,
  recordPipelineCancel,
  recordPipelineError,
  recordPipelineTrigger,
} from '../observability/metrics';
import { auditRepo, type AuditAction, type AuditDecision } from '../pipeline/audit-repository';

// ---------------------------------------------------------------------------
// Logger + tracer for this route module.
// ---------------------------------------------------------------------------

const log = withContext({ route: 'pipelineTriggers' });
const tracer = trace.getTracer('social-api');

/**
 * Fire-and-forget audit write. We deliberately do NOT await this in the hot
 * path — pipeline state changes happen elsewhere and a DynamoDB hiccup must
 * not turn into a 5xx for the client. Rejections are logged at `warn` so
 * they're still visible in observability without breaking the request.
 *
 * If a future caller needs strong "state + audit" durability, switch to the
 * outbox-publisher pattern instead of awaiting this directly.
 */
function fireAndForgetAudit(
  event: Parameters<typeof auditRepo.record>[0],
): void {
  auditRepo.record(event).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { action: event.action, pipelineId: event.pipelineId, runId: event.runId, err: message },
      'audit write failed',
    );
  });
}

/**
 * Convenience: run an async fn inside an OTel span, marking SpanStatusCode
 * appropriately and rethrowing so callers can decide on the HTTP shape.
 */
async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

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
   * (Phase 4) Runtime metrics for the pipeline subsystem. Maps to
   * `PipelineModule.getMetrics()`. Every numeric field is optional — the
   * bridge forwards whatever the underlying module exposes today and the
   * route renders missing fields as `null` rather than fabricating values.
   *
   * Fields exposed by distributed-core ≥ v0.3.7:
   *   - runsStarted / runsCompleted / runsFailed / runsActive / runsAwaitingApproval
   *   - avgDurationMs
   *   - llmTokensIn / llmTokensOut
   *   - avgFirstTokenLatencyMs (v0.3.7+)
   *   - asOf (ISO timestamp the module stamped the snapshot)
   *
   * `estimatedCostUsd` is NOT tracked by distributed-core yet — it is always
   * absent here and surfaces as `null` to clients.
   */
  getMetrics?(): Promise<PipelineBridgeMetrics> | PipelineBridgeMetrics;
}

/**
 * Loose mirror of `PipelineModule.getMetrics()`'s return shape. Every field is
 * optional so older module versions (which only emit `runsAwaitingApproval`)
 * still type-check; the route normalizes missing fields to `null`.
 */
export interface PipelineBridgeMetrics {
  runsStarted?: number;
  runsCompleted?: number;
  runsFailed?: number;
  runsActive?: number;
  runsAwaitingApproval?: number;
  avgDurationMs?: number;
  llmTokensIn?: number;
  llmTokensOut?: number;
  /** First-token latency averaged across LLM steps (distributed-core ≥ v0.3.7). */
  avgFirstTokenLatencyMs?: number;
  /** ISO timestamp the underlying module stamped the snapshot. */
  asOf?: string;
  // Permit forward-compat fields from distributed-core without TS churn here.
  [k: string]: unknown;
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
// Independent of the pipelineDefinitions store. Keyed by runId for
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

/** Structured 5xx response body when a bridge call throws. */
interface BridgeErrorBody {
  error: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the correlation id (if any) off the request headers. */
function correlationIdOf(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers['x-correlation-id'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

/**
 * Standard error-tail for a failed bridge call: emit a Prometheus error
 * counter, write an audit row (fire-and-forget), log structured, and return
 * a 5xx with `{ error, action }`. Bridge-unavailable (null) → 503; everything
 * else → 500.
 */
function respondBridgeError(params: {
  res: { status(code: number): { json(body: BridgeErrorBody): unknown } };
  reqLog: ReturnType<typeof withContext>;
  err: unknown;
  action: string; // bridge method name (used in response body)
  auditAction: AuditAction;
  actorUserId: string;
  pipelineId: string;
  runId?: string;
  bridgeMissing?: boolean;
  details?: Record<string, unknown>;
}): void {
  const message = params.err instanceof Error ? params.err.message : String(params.err);
  const status = params.bridgeMissing ? 503 : 500;

  recordPipelineError();

  fireAndForgetAudit({
    action: params.auditAction,
    actorUserId: params.actorUserId,
    pipelineId: params.pipelineId,
    runId: params.runId,
    decision: 'failed',
    details: { error: message, ...(params.details ?? {}) },
  });

  params.reqLog.error(
    {
      action: params.action,
      auditAction: params.auditAction,
      pipelineId: params.pipelineId,
      runId: params.runId,
      status,
      err: message,
    },
    'pipeline bridge call failed',
  );

  params.res.status(status).json({ error: message, action: params.action });
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
  asyncHandler<{ pipelineId: string }, TriggerRunResponse | BridgeErrorBody, TriggerRunRequest>(
    async (req, res) => {
      const { pipelineId } = req.params;
      const userId = req.user!.sub;
      const body = (req.body ?? {}) as TriggerRunRequest;
      const reqLog = log.child({
        correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
        userId,
        pipelineId,
      });

      if (body.definition && body.definition.id !== pipelineId) {
        throw new ValidationError(
          `definition.id (${body.definition.id}) does not match :pipelineId (${pipelineId})`,
        );
      }

      let runId: string;
      if (bridge?.trigger) {
        try {
          const out = await withSpan(
            'pipeline.trigger',
            { 'pipeline.id': pipelineId, 'pipeline.user_id': userId },
            async () =>
              Promise.resolve(
                bridge!.trigger!({
                  pipelineId,
                  definition: body.definition,
                  triggerPayload: body.triggerPayload,
                  triggeredBy: { userId },
                }),
              ),
          );
          runId = out.runId;
        } catch (err) {
          respondBridgeError({
            res,
            reqLog,
            err,
            action: 'trigger',
            auditAction: 'pipeline.trigger',
            actorUserId: userId,
            pipelineId,
          });
          return;
        }
      } else {
        runId = randomUUID();
        reqLog.info(
          { runId, action: 'trigger.stub' },
          'pipeline bridge not wired; synthesized runId',
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

      // Success-path observability.
      recordPipelineTrigger();
      fireAndForgetAudit({
        action: 'pipeline.trigger',
        actorUserId: userId,
        pipelineId,
        runId,
      });
      reqLog.info({ runId, action: 'trigger.create' }, 'pipeline triggered');

      const response: TriggerRunResponse = {
        runId,
        pipelineId,
        triggeredBy: { userId, triggerType: 'manual' },
        at,
      };

      res.status(202).json(response);
    },
  ),
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
    const reqLog = log.child({
      correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
      userId,
      pipelineId,
    });

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
      try {
        const out = await withSpan(
          'pipeline.listRuns',
          { 'pipeline.id': pipelineId, 'pipeline.limit': limit },
          async () => Promise.resolve(bridge!.listRuns!(pipelineId, { limit, cursor })),
        );
        res.json(out);
        return;
      } catch (err) {
        respondBridgeError({
          res: res as unknown as {
            status(code: number): { json(body: BridgeErrorBody): unknown };
          },
          reqLog,
          err,
          action: 'listRuns',
          auditAction: 'pipeline.trigger',
          actorUserId: userId,
          pipelineId,
        });
        return;
      }
    }
    const out = stubRunStore.listForPipeline(pipelineId, userId, { limit, cursor });
    res.json(out);
  }),
);

// GET /:runId — run snapshot
pipelineTriggersRouter.get(
  '/:runId',
  asyncHandler<{ pipelineId: string; runId: string }>(async (req, res) => {
    const { runId, pipelineId } = req.params;
    const userId = req.user!.sub;
    const reqLog = log.child({
      correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
      userId,
      pipelineId,
      runId,
    });

    if (!bridge) {
      throw new NotFoundError('run not found');
    }

    let snap;
    try {
      snap = await withSpan(
        'pipeline.getRun',
        { 'pipeline.id': pipelineId, 'pipeline.run_id': runId },
        async () => Promise.resolve(bridge!.getRun(runId)),
      );
    } catch (err) {
      respondBridgeError({
        res: res as unknown as {
          status(code: number): { json(body: BridgeErrorBody): unknown };
        },
        reqLog,
        err,
        action: 'getRun',
        auditAction: 'pipeline.trigger',
        actorUserId: userId,
        pipelineId,
        runId,
      });
      return;
    }

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
      const { runId, pipelineId } = req.params;
      const userId = req.user!.sub;
      const reqLog = log.child({
        correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
        userId,
        pipelineId,
        runId,
      });

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

      try {
        const events = await withSpan(
          'pipeline.getHistory',
          { 'pipeline.id': pipelineId, 'pipeline.run_id': runId, 'pipeline.from_version': fromVersion },
          async () => Promise.resolve(bridge!.getHistory(runId, fromVersion)),
        );
        res.json(events ?? []);
      } catch (err) {
        respondBridgeError({
          res: res as unknown as {
            status(code: number): { json(body: BridgeErrorBody): unknown };
          },
          reqLog,
          err,
          action: 'getHistory',
          auditAction: 'pipeline.trigger',
          actorUserId: userId,
          pipelineId,
          runId,
        });
      }
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
    const reqLog = log.child({
      correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
      userId,
    });

    if (bridge?.listActiveRuns) {
      try {
        const runs = await withSpan(
          'pipeline.listActiveRuns',
          { 'pipeline.user_id': userId },
          async () => Promise.resolve(bridge!.listActiveRuns!()),
        );
        res.json({ runs });
        return;
      } catch (err) {
        respondBridgeError({
          res: res as unknown as {
            status(code: number): { json(body: BridgeErrorBody): unknown };
          },
          reqLog,
          err,
          action: 'listActiveRuns',
          // No specific pipelineId on this endpoint; use a sentinel so the
          // audit row is still queryable by actor.
          auditAction: 'pipeline.trigger',
          actorUserId: userId,
          pipelineId: '*',
        });
        return;
      }
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
    const reqLog = log.child({
      correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
      userId,
      runId,
    });

    if (body.reason !== undefined && typeof body.reason !== 'string') {
      throw new ValidationError('reason must be a string when present');
    }

    if (bridge?.cancelRun) {
      // Best-effort pipelineId derivation for audit/metrics: if the bridge
      // can hand us the snapshot we read it AFTER the cancel so we know
      // which pipeline this belonged to. Falls back to '*' on failure.
      let pipelineIdForAudit = '*';

      try {
        await withSpan(
          'pipeline.cancelRun',
          { 'pipeline.run_id': runId, 'pipeline.user_id': userId },
          async () => Promise.resolve(bridge!.cancelRun!(runId, userId)),
        );
      } catch (err) {
        respondBridgeError({
          res: res as unknown as {
            status(code: number): { json(body: BridgeErrorBody): unknown };
          },
          reqLog,
          err,
          action: 'cancelRun',
          auditAction: 'pipeline.cancel',
          actorUserId: userId,
          pipelineId: pipelineIdForAudit,
          runId,
          details: { reason: body.reason },
        });
        return;
      }

      // Bridge owns the truth in Phase 4; we surface the same shape as the
      // stub branch by reading back via getRun. The PipelineBridge interface
      // declares `getRun` non-optional, but partial test bridges (and older
      // phase-1 bridges) may omit it — defensively pull it via dynamic
      // accessor so we behave the same as before.
      const getRunFn = bridge.getRun?.bind(bridge);
      if (getRunFn) {
        let snap;
        try {
          snap = await withSpan(
            'pipeline.getRun',
            { 'pipeline.run_id': runId },
            async () => Promise.resolve(getRunFn(runId)),
          );
        } catch (err) {
          respondBridgeError({
            res: res as unknown as {
              status(code: number): { json(body: BridgeErrorBody): unknown };
            },
            reqLog,
            err,
            action: 'getRun',
            auditAction: 'pipeline.cancel',
            actorUserId: userId,
            pipelineId: pipelineIdForAudit,
            runId,
          });
          return;
        }

        if (!snap) {
          throw new NotFoundError('run not found');
        }
        if (typeof snap.pipelineId === 'string') pipelineIdForAudit = snap.pipelineId;

        recordPipelineCancel();
        fireAndForgetAudit({
          action: 'pipeline.cancel',
          actorUserId: userId,
          pipelineId: pipelineIdForAudit,
          runId,
          decision: 'cancelled',
          details: body.reason ? { reason: body.reason } : undefined,
        });
        reqLog.info({ runId, pipelineId: pipelineIdForAudit, action: 'cancel' }, 'pipeline cancelled');

        res.json(snap);
        return;
      }

      // Bridge doesn't expose getRun; we still emit metrics + audit on the
      // fact that cancelRun returned successfully.
      recordPipelineCancel();
      fireAndForgetAudit({
        action: 'pipeline.cancel',
        actorUserId: userId,
        pipelineId: pipelineIdForAudit,
        runId,
        decision: 'cancelled',
        details: body.reason ? { reason: body.reason } : undefined,
      });
      reqLog.info({ runId, action: 'cancel' }, 'pipeline cancelled');

      res.json({ runId, status: 'canceled' });
      return;
    }

    // Stub branch — no bridge wired.
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

    recordPipelineCancel();
    fireAndForgetAudit({
      action: 'pipeline.cancel',
      actorUserId: userId,
      pipelineId: updated.pipelineId,
      runId,
      decision: 'cancelled',
      details: body.reason ? { reason: body.reason } : undefined,
    });
    reqLog.info(
      { runId, pipelineId: updated.pipelineId, action: 'cancel.stub' },
      'pipeline cancelled (stub)',
    );

    res.json(updated);
  }),
);

// ---------------------------------------------------------------------------
// Pending approvals queue — GET /api/pipelines/approvals
//
// Surfaces `bridge.getPendingApprovals()` to the frontend so the approvals
// inbox can render across all runs without per-run polling. Mounted at the
// static `/pipelines/approvals` path (NOT under `:pipelineId` and NOT under
// `:runId/approvals`) — see routes/index.ts ordering note.
//
// Behaviour:
//   - Bridge wired + getPendingApprovals defined → forward.
//   - Bridge null OR getPendingApprovals undefined → return { approvals: [] }
//     with HTTP 200 (an empty queue is a valid answer in stub mode; we
//     deliberately do NOT 503 since the frontend treats this as data, not
//     a health probe).
//   - Optional `?userId=` query param: when present, filter to rows where
//     the requesting user appears in `approvers`. Default is no filter —
//     the frontend can do its own visual filtering across teammates.
// ---------------------------------------------------------------------------

export const pipelinePendingApprovalsRouter = Router();

pipelinePendingApprovalsRouter.get(
  '/',
  asyncHandler<unknown, { approvals: PendingApprovalRow[] } | BridgeErrorBody, unknown, { userId?: string }>(
    async (req, res) => {
      const userId = req.user?.sub ?? 'anon';
      const reqLog = log.child({
        correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
        userId,
      });

      if (!bridge || !bridge.getPendingApprovals) {
        res.json({ approvals: [] });
        return;
      }

      let rows: PendingApprovalRow[];
      try {
        rows = await withSpan(
          'pipeline.getPendingApprovals',
          { 'pipeline.user_id': userId },
          async () => Promise.resolve(bridge!.getPendingApprovals!()),
        );
      } catch (err) {
        respondBridgeError({
          res: res as unknown as {
            status(code: number): { json(body: BridgeErrorBody): unknown };
          },
          reqLog,
          err,
          action: 'getPendingApprovals',
          auditAction: 'pipeline.approve',
          actorUserId: userId,
          pipelineId: '*',
        });
        return;
      }

      const filterUserId = req.query.userId ? String(req.query.userId) : undefined;
      const approvals = filterUserId
        ? rows.filter((row) => row.approvers.some((a) => a.userId === filterUserId))
        : rows;
      res.json({ approvals });
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
    const reqLog = log.child({
      correlationId: correlationIdOf(req as unknown as { headers: Record<string, unknown> }),
      userId,
      runId,
    });

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
      reqLog.info(
        {
          runId,
          stepId: body.stepId,
          decision: body.decision,
          action: 'approval.stub',
        },
        'pipeline bridge not wired; accepted approval (stub)',
      );
      res.status(204).end();
      return;
    }

    // Best-effort pipelineId derivation for audit. We try `getRun` BEFORE
    // resolveApproval so even a failed resolution audit row carries the
    // pipelineId. Snapshot fetch failures are non-fatal — fall back to '*'.
    let pipelineIdForAudit = '*';
    if (bridge.getRun) {
      try {
        const snap = await Promise.resolve(bridge.getRun(runId));
        if (snap && typeof snap.pipelineId === 'string') {
          pipelineIdForAudit = snap.pipelineId;
        }
      } catch (err) {
        reqLog.warn(
          { runId, err: err instanceof Error ? err.message : String(err) },
          'getRun for approval audit-context lookup failed; continuing',
        );
      }
    }

    try {
      await withSpan(
        'pipeline.resolveApproval',
        {
          'pipeline.run_id': runId,
          'pipeline.step_id': body.stepId,
          'pipeline.decision': body.decision,
        },
        async () =>
          Promise.resolve(
            bridge!.resolveApproval(runId, body.stepId, userId, body.decision, body.comment),
          ),
      );
    } catch (err) {
      respondBridgeError({
        res: res as unknown as {
          status(code: number): { json(body: BridgeErrorBody): unknown };
        },
        reqLog,
        err,
        action: 'resolveApproval',
        auditAction: body.decision === 'approve' ? 'pipeline.approve' : 'pipeline.reject',
        actorUserId: userId,
        pipelineId: pipelineIdForAudit,
        runId,
        details: { stepId: body.stepId, decision: body.decision },
      });
      return;
    }

    // Success-path observability.
    recordPipelineApproval();
    const auditAction: AuditAction =
      body.decision === 'approve' ? 'pipeline.approve' : 'pipeline.reject';
    const auditDecision: AuditDecision =
      body.decision === 'approve' ? 'approved' : 'rejected';
    fireAndForgetAudit({
      action: auditAction,
      actorUserId: userId,
      pipelineId: pipelineIdForAudit,
      runId,
      decision: auditDecision,
      details: body.comment ? { stepId: body.stepId, comment: body.comment } : { stepId: body.stepId },
    });
    reqLog.info(
      {
        runId,
        stepId: body.stepId,
        decision: body.decision,
        pipelineId: pipelineIdForAudit,
        action: 'approval.resolve',
      },
      'pipeline approval resolved',
    );

    res.status(204).end();
  }),
);
