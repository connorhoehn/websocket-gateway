// Tests for pipelineMetrics + observability stub routers.
//
// We verify the stub generators produce the expected shape and that the
// routers wire them into HTTP handlers correctly. Both endpoints are
// stub-filled (no live cluster) so we don't need a bridge here.

import express, { type NextFunction, type Request, type Response } from 'express';
import {
  pipelineMetricsRouter,
  observabilityRouter,
  getPipelineMetricsStub,
  getObservabilityDashboardStub,
  getObservabilityMetricsStub,
} from '../pipelineMetrics';

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

async function run(app: express.Express, method: string, url: string): Promise<MockRes> {
  const res = mockRes();
  const req = {
    method: method.toUpperCase(),
    url,
    originalUrl: url,
    path: url.split('?')[0],
    headers: {},
    query: {},
    body: undefined,
  } as unknown as Request;
  await new Promise<void>((resolve, reject) => {
    const finalHandler = (err?: unknown): void => {
      if (err) {
        reject(err);
        return;
      }
      if (!res.ended) {
        res.status(404).json({ error: 'route not found' });
      }
      resolve();
    };
    (app as unknown as (req: Request, res: Response, next: NextFunction) => void)(
      req,
      res as unknown as Response,
      finalHandler,
    );
    res.finished.then(() => resolve()).catch(reject);
  });
  return res;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/pipelines/metrics', pipelineMetricsRouter);
  app.use('/observability', observabilityRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Stub generators (shape sanity checks).
// ---------------------------------------------------------------------------

describe('getPipelineMetricsStub', () => {
  test('returns expected shape with non-negative numbers', () => {
    const m = getPipelineMetricsStub();
    expect(typeof m.runsStarted).toBe('number');
    expect(m.runsStarted).toBeGreaterThanOrEqual(0);
    expect(m.runsCompleted).toBeGreaterThanOrEqual(0);
    expect(m.runsFailed).toBeGreaterThanOrEqual(0);
    expect(m.runsActive).toBeGreaterThanOrEqual(0);
    expect(m.runsAwaitingApproval).toBeGreaterThanOrEqual(0);
    expect(m.avgDurationMs).toBeGreaterThan(0);
    expect(typeof m.asOf).toBe('string');
    expect(new Date(m.asOf).toISOString()).toBe(m.asOf);
  });
});

describe('getObservabilityDashboardStub', () => {
  test('returns 3 healthy nodes and 0 alerts', () => {
    const d = getObservabilityDashboardStub();
    expect(d.cluster.healthy).toBe(3);
    expect(d.cluster.degraded).toBe(0);
    expect(d.cluster.down).toBe(0);
    expect(d.alerts).toEqual([]);
    expect(d.nodes).toHaveLength(3);
    expect(d.nodes.every((n) => n.status === 'healthy')).toBe(true);
    const leaders = d.nodes.filter((n) => n.role === 'leader');
    expect(leaders).toHaveLength(1);
    expect(d.cluster.leaderId).toBe(leaders[0].nodeId);
  });

  test('pipelines summary mirrors metrics stub', () => {
    const d = getObservabilityDashboardStub();
    expect(typeof d.pipelines.active).toBe('number');
    expect(typeof d.pipelines.awaitingApproval).toBe('number');
    expect(d.pipelines.active).toBeGreaterThanOrEqual(0);
  });
});

describe('getObservabilityMetricsStub', () => {
  test('p50 < p95 < p99', () => {
    const m = getObservabilityMetricsStub();
    expect(m.p50LatencyMs).toBeLessThan(m.p95LatencyMs);
    expect(m.p95LatencyMs).toBeLessThan(m.p99LatencyMs);
  });
  test('errorRatePct is bounded 0..100', () => {
    const m = getObservabilityMetricsStub();
    expect(m.errorRatePct).toBeGreaterThanOrEqual(0);
    expect(m.errorRatePct).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// HTTP wiring.
// ---------------------------------------------------------------------------

describe('GET /pipelines/metrics', () => {
  test('200 with metrics shape', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/metrics');
    expect(res.statusCode).toBe(200);
    const body = res.body as ReturnType<typeof getPipelineMetricsStub>;
    expect(body).toHaveProperty('runsStarted');
    expect(body).toHaveProperty('runsAwaitingApproval');
    expect(body).toHaveProperty('asOf');
  });
});

describe('GET /observability/dashboard', () => {
  test('200 with cluster + nodes + alerts', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/observability/dashboard');
    expect(res.statusCode).toBe(200);
    const body = res.body as ReturnType<typeof getObservabilityDashboardStub>;
    expect(body.cluster.healthy).toBe(3);
    expect(body.nodes).toHaveLength(3);
    expect(body.alerts).toEqual([]);
  });
});

describe('GET /observability/metrics', () => {
  test('200 with prometheus-ish summary', async () => {
    const app = buildApp();
    const res = await run(app, 'GET', '/observability/metrics');
    expect(res.statusCode).toBe(200);
    const body = res.body as ReturnType<typeof getObservabilityMetricsStub>;
    expect(body).toHaveProperty('runsPerMinute');
    expect(body).toHaveProperty('p50LatencyMs');
    expect(body).toHaveProperty('p95LatencyMs');
    expect(body).toHaveProperty('errorRatePct');
  });
});
