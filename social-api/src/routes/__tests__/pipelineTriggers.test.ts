// Tests for pipelineTriggers + pipelineApprovals routes.
//
// Covers:
//   - POST  /  → 202 with synthesized runId when no bridge wired
//   - POST  /  → forwards to bridge.trigger when wired
//   - POST  /  → 400 when definition.id mismatches :pipelineId
//   - GET   /  → list past runs (paginated) from in-memory stub or bridge
//   - GET   /:runId → 404 when no bridge / unknown runId; 200 with snapshot otherwise
//   - GET   /:runId/history → [] when no bridge; pass-through otherwise
//   - GET   /:runId/history?fromVersion=-1 → 400
//   - GET   /pipelines/runs/active → list active runs (stub or bridge)
//   - POST  /pipelines/:runId/cancel → 200 / 404 / 400 paths
//   - POST  /api/pipelines/:runId/approvals → 204 (stub) and via bridge
//   - approvals route validates body shape (stepId, decision)

import express, { type NextFunction, type Request, type Response } from 'express';

// Stub redis-client so the idempotency middleware doesn't try to dial Redis
// in unit tests (saves ~30ms/test and keeps stderr clean).
jest.mock('../../lib/redis-client', () => ({
  getRedisClient: async () => null,
}));

import { errorHandler } from '../../middleware/error-handler';
import {
  pipelineTriggersRouter,
  pipelineApprovalsRouter,
  pipelineActiveRunsRouter,
  pipelineCancelRouter,
  setPipelineBridge,
  stubRunStore,
  type PipelineBridge,
} from '../pipelineTriggers';

// ---------------------------------------------------------------------------
// Test rig — build a tiny Express app, invoke handlers via the router stack
// directly. We don't use supertest (not in the social-api dep tree); instead,
// we call into the router with mock req/res that capture status/body/headers.
// ---------------------------------------------------------------------------

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number | readonly string[]>;
  body: unknown;
  ended: boolean;
  finished: Promise<void>;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  setHeader(name: string, value: number | string | readonly string[]): MockRes;
  getHeader(name: string): unknown;
  end(...args: unknown[]): MockRes;
}

function mockRes(): MockRes {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => {
    resolveFinished = r;
  });
  const r: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    finished,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      resolveFinished();
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name)] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[String(name)];
    },
    end(..._args) {
      this.ended = true;
      resolveFinished();
      return this;
    },
  };
  return r;
}

/**
 * Drive a request through an Express app, returning the captured response.
 * Bypasses sockets entirely; we hand-roll the req/res pair.
 */
async function run(
  app: express.Express,
  method: string,
  url: string,
  opts: { body?: unknown; headers?: Record<string, string>; userId?: string } = {},
): Promise<MockRes> {
  const res = mockRes();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }
  // Parse out path/query manually to avoid pulling in URL helpers.
  const [pathname, qs] = url.split('?', 2);
  const query: Record<string, string> = {};
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, v] = part.split('=', 2);
      if (k) query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }
  const req = {
    method: method.toUpperCase(),
    url,
    originalUrl: url,
    path: pathname,
    headers,
    query,
    body: opts.body,
    user: { sub: opts.userId ?? 'user-1' },
  } as unknown as Request;

  await new Promise<void>((resolve, reject) => {
    const finalHandler = (err?: unknown): void => {
      if (err) {
        reject(err);
        return;
      }
      // 404 fallback if the router didn't match anything.
      if (!res.ended) {
        res.status(404).json({ error: 'route not found' });
      }
      resolve();
    };
    // Drive the app's handler stack.
    (app as unknown as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void)(req, res as unknown as Response, finalHandler);
    // Resolve once res is finished.
    res.finished.then(() => resolve()).catch(reject);
  });
  return res;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Simulate auth middleware.
  app.use((req, _res, next) => {
    if (!(req as Request & { user?: unknown }).user) {
      (req as Request & { user?: { sub: string } }).user = { sub: 'user-1' };
    }
    next();
  });
  // Active-runs router must be mounted BEFORE the :pipelineId one, mirroring
  // routes/index.ts (Express resolves mounts in registration order).
  app.use('/pipelines/runs/active', pipelineActiveRunsRouter);
  app.use('/pipelines/:pipelineId/runs', pipelineTriggersRouter);
  app.use('/pipelines/:runId/cancel', pipelineCancelRouter);
  app.use('/pipelines/:runId/approvals', pipelineApprovalsRouter);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  setPipelineBridge(null);
  stubRunStore.__resetForTests();
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/:pipelineId/runs
// ---------------------------------------------------------------------------

describe('POST /pipelines/:pipelineId/runs (trigger)', () => {
  test('synthesizes runId + returns 202 when no bridge wired', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      const res = await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
      expect(res.statusCode).toBe(202);
      const body = res.body as {
        runId: string;
        pipelineId: string;
        triggeredBy: { userId: string; triggerType: string };
        at: string;
      };
      expect(body.pipelineId).toBe('p1');
      expect(body.triggeredBy).toEqual({ userId: 'user-1', triggerType: 'manual' });
      expect(typeof body.runId).toBe('string');
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
      // TODO log line proves the stub branch ran.
      expect(logSpy).toHaveBeenCalled();
      const text = logSpy.mock.calls.flat().map(String).join(' ');
      expect(text).toMatch(/bridge not wired/);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('forwards to bridge.trigger when wired', async () => {
    const trigger = jest.fn(async () => ({ runId: 'bridge-run-1' }));
    const bridge: PipelineBridge = {
      trigger,
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
    };
    setPipelineBridge(bridge);

    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/p1/runs', {
      body: { triggerPayload: { foo: 'bar' } },
    });
    expect(res.statusCode).toBe(202);
    expect((res.body as { runId: string }).runId).toBe('bridge-run-1');
    expect(trigger).toHaveBeenCalledWith({
      pipelineId: 'p1',
      definition: undefined,
      triggerPayload: { foo: 'bar' },
      triggeredBy: { userId: 'user-1' },
    });
  });

  test('rejects 400 when definition.id does not match :pipelineId', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/p1/runs', {
      body: { definition: { id: 'p2' } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/does not match/);
  });

  test('Idempotency-Key replay returns same runId without re-invoking bridge', async () => {
    const trigger = jest.fn(async () => ({ runId: 'idem-run-1' }));
    setPipelineBridge({
      trigger,
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
    });

    const app = buildApp();
    const headers = { 'Idempotency-Key': 'idem-1' };
    const r1 = await run(app, 'POST', '/pipelines/p1/runs', { body: { x: 1 }, headers });
    expect(r1.statusCode).toBe(202);
    expect((r1.body as { runId: string }).runId).toBe('idem-run-1');
    // Allow fire-and-forget persist.
    await new Promise((r) => setImmediate(r));

    const r2 = await run(app, 'POST', '/pipelines/p1/runs', { body: { x: 1 }, headers });
    expect(r2.statusCode).toBe(202);
    expect((r2.body as { runId: string }).runId).toBe('idem-run-1');
    expect(r2.headers['X-Idempotent-Replay']).toBe('true');
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:pipelineId/runs/:runId
// ---------------------------------------------------------------------------

describe('GET /pipelines/:pipelineId/runs/:runId (snapshot)', () => {
  test('404 when no bridge wired', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1');
    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toBe('run not found');
  });

  test('404 when bridge.getRun returns null', async () => {
    setPipelineBridge({
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/missing');
    expect(res.statusCode).toBe(404);
  });

  test('200 with snapshot when bridge returns one', async () => {
    setPipelineBridge({
      getRun: async (runId) => ({ runId, status: 'running', steps: [] }),
      getHistory: async () => [],
      resolveApproval: async () => {},
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ runId: 'r1', status: 'running' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:pipelineId/runs/:runId/history
// ---------------------------------------------------------------------------

describe('GET /pipelines/:pipelineId/runs/:runId/history (replay)', () => {
  test('returns [] when no bridge wired (per WAL-disabled handoff contract)', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1/history');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns [] when bridge.getHistory returns []', async () => {
    setPipelineBridge({
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1/history?fromVersion=5');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('passes fromVersion to bridge and returns events', async () => {
    const getHistory = jest.fn(async () => [{ type: 'pipeline.step.started', version: 7 }]);
    setPipelineBridge({
      getRun: async () => null,
      getHistory,
      resolveApproval: async () => {},
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1/history?fromVersion=5');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ type: 'pipeline.step.started', version: 7 }]);
    expect(getHistory).toHaveBeenCalledWith('r1', 5);
  });

  test('400 on negative fromVersion', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs/r1/history?fromVersion=-1');
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/:runId/approvals
// ---------------------------------------------------------------------------

describe('POST /pipelines/:runId/approvals (resolveApproval)', () => {
  test('204 stub when no bridge wired', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      const res = await run(app, 'POST', '/pipelines/run-1/approvals', {
        body: { stepId: 'approval-1', decision: 'approve', comment: 'lgtm' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBeUndefined();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test('forwards to bridge.resolveApproval when wired', async () => {
    const resolveApproval = jest.fn(async () => {});
    setPipelineBridge({
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval,
    });
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/run-1/approvals', {
      body: { stepId: 'approval-1', decision: 'reject', comment: 'no' },
      userId: 'alice',
    });
    expect(res.statusCode).toBe(204);
    expect(resolveApproval).toHaveBeenCalledWith('run-1', 'approval-1', 'alice', 'reject', 'no');
  });

  test('400 when stepId missing', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/run-1/approvals', {
      body: { decision: 'approve' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when decision is not approve/reject', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/run-1/approvals', {
      body: { stepId: 's1', decision: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:pipelineId/runs (history listing)
// ---------------------------------------------------------------------------

describe('GET /pipelines/:pipelineId/runs (history)', () => {
  test('returns runs from the in-memory stub store, newest first', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      // Trigger 3 runs through the stub branch — they all land in stubRunStore.
      for (let i = 0; i < 3; i++) {
        const r = await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
        expect(r.statusCode).toBe(202);
      }
      const res = await run(app, 'GET', '/pipelines/p1/runs');
      expect(res.statusCode).toBe(200);
      const body = res.body as { runs: Array<{ pipelineId: string; status: string }> };
      expect(body.runs).toHaveLength(3);
      expect(body.runs[0]!.pipelineId).toBe('p1');
      expect(body.runs[0]!.status).toBe('pending');
    } finally {
      logSpy.mockRestore();
    }
  });

  test('paginates via limit + cursor', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      for (let i = 0; i < 5; i++) {
        await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
        // Tiny delay so triggeredAt timestamps differ.
        await new Promise((r) => setTimeout(r, 2));
      }
      const r1 = await run(app, 'GET', '/pipelines/p1/runs?limit=2');
      const b1 = r1.body as { runs: Array<{ runId: string }>; nextCursor?: string };
      expect(b1.runs).toHaveLength(2);
      expect(b1.nextCursor).toBeDefined();

      const r2 = await run(
        app,
        'GET',
        `/pipelines/p1/runs?limit=2&cursor=${encodeURIComponent(b1.nextCursor!)}`,
      );
      const b2 = r2.body as { runs: Array<{ runId: string }>; nextCursor?: string };
      expect(b2.runs).toHaveLength(2);
      // No overlap between pages.
      expect(b2.runs.map((r) => r.runId)).not.toEqual(
        expect.arrayContaining(b1.runs.map((r) => r.runId)),
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  test('400 when limit is out of range', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs?limit=0');
    expect(res.statusCode).toBe(400);
  });

  test('forwards to bridge.listRuns when wired', async () => {
    const listRuns = jest.fn(async () => ({
      runs: [{ runId: 'br-1', status: 'running' }],
      nextCursor: undefined,
    }));
    setPipelineBridge({
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
      listRuns,
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/p1/runs?limit=5');
    expect(res.statusCode).toBe(200);
    expect(listRuns).toHaveBeenCalledWith('p1', { limit: 5, cursor: undefined });
    expect(res.body).toMatchObject({ runs: [{ runId: 'br-1' }] });
  });

  test("filters by user — user-2 doesn't see user-1's runs", async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      // Trigger as user-1 (default).
      await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
      // List as user-2 — must be empty.
      const res = await run(app, 'GET', '/pipelines/p1/runs', { userId: 'user-2' });
      expect(res.statusCode).toBe(200);
      expect((res.body as { runs: unknown[] }).runs).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/runs/active
// ---------------------------------------------------------------------------

describe('GET /pipelines/runs/active', () => {
  test('lists pending/running runs from the stub store', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
      await run(app, 'POST', '/pipelines/p2/runs', { body: {} });

      const res = await run(app, 'GET', '/pipelines/runs/active');
      expect(res.statusCode).toBe(200);
      const body = res.body as { runs: Array<{ pipelineId: string; status: string }> };
      expect(body.runs).toHaveLength(2);
      expect(body.runs.every((r) => r.status === 'pending')).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("returns [] when caller has no active runs", async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/runs/active');
    expect(res.statusCode).toBe(200);
    expect((res.body as { runs: unknown[] }).runs).toEqual([]);
  });

  test('forwards to bridge.listActiveRuns when wired', async () => {
    const listActiveRuns = jest.fn(async () => [
      { runId: 'br-active-1', status: 'running' },
    ]);
    setPipelineBridge({
      getRun: async () => null,
      getHistory: async () => [],
      resolveApproval: async () => {},
      listActiveRuns,
    });
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/runs/active');
    expect(res.statusCode).toBe(200);
    expect(listActiveRuns).toHaveBeenCalled();
    expect((res.body as { runs: Array<{ runId: string }> }).runs[0]!.runId).toBe('br-active-1');
  });
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/:runId/cancel
// ---------------------------------------------------------------------------

describe('POST /pipelines/:runId/cancel', () => {
  test('cancels an active stub run and returns the updated record', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      const trig = await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
      const runId = (trig.body as { runId: string }).runId;

      const res = await run(app, 'POST', `/pipelines/${runId}/cancel`, {
        body: { reason: 'no longer needed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        runId,
        status: 'canceled',
        reason: 'no longer needed',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test('404 when runId is unknown', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/missing-run/cancel', { body: {} });
    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/run not found/);
  });

  test('400 when run is already in terminal state', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      const trig = await run(app, 'POST', '/pipelines/p1/runs', { body: {} });
      const runId = (trig.body as { runId: string }).runId;
      // First cancel succeeds.
      await run(app, 'POST', `/pipelines/${runId}/cancel`, { body: {} });
      // Second cancel hits the terminal-state branch.
      const res = await run(app, 'POST', `/pipelines/${runId}/cancel`, { body: {} });
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toMatch(/terminal state/);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('forwards to bridge.cancelRun when wired', async () => {
    const cancelRun = jest.fn(async () => {});
    const getRun = jest.fn(async (runId: string) => ({ runId, status: 'canceled' }));
    setPipelineBridge({
      getRun,
      getHistory: async () => [],
      resolveApproval: async () => {},
      cancelRun,
    });
    const app = buildApp();
    const res = await run(app, 'POST', '/pipelines/run-xyz/cancel', { body: {} });
    expect(res.statusCode).toBe(200);
    expect(cancelRun).toHaveBeenCalledWith('run-xyz', 'user-1');
    expect(res.body).toMatchObject({ runId: 'run-xyz', status: 'canceled' });
  });
});
