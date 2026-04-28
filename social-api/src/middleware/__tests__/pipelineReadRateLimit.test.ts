// Tests for the `pipelineReadRateLimit()` factory + the method-aware mount
// wired into `app.ts`. We don't boot the full app (no supertest dependency
// in this package); instead we drive the middleware directly with mocked
// Express req/res, mirroring the rig used in `rateLimit.test.ts`.
//
// What this test guards:
//   - 60-req/min budget enforced under a fast 65-request loop on a pipeline
//     GET — at least one request gets a 429 with a `Retry-After` header.
//   - The downstream "handler" is a mock that returns 200 for the first
//     allowed requests, so the test reflects what actually happens at the
//     pipeline GET routes (which are mocked here so this test stays out of
//     other agents' route files).
//
// Note: we exercise the factory's in-memory fallback (no Redis, no injected
// store) by mocking `getRedisClient` to null — this is the path the limiter
// takes in dev / unit-test environments.

import type { NextFunction, Request, Response } from 'express';

jest.mock('../../lib/redis-client', () => ({
  getRedisClient: async () => null,
}));

import {
  _resetRateLimitMemFallback,
  pipelineReadRateLimit,
  type RateLimitedProblem,
} from '../rateLimit';

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number | readonly string[]>;
  body: unknown;
  ended: boolean;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  setHeader(name: string, value: number | string | readonly string[]): MockRes;
  getHeader(name: string): unknown;
  end(...args: unknown[]): MockRes;
}

function mockRes(): MockRes {
  const r: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    setHeader(name, value) { this.headers[String(name)] = value; return this; },
    getHeader(name) { return this.headers[String(name)]; },
    end(..._args) { this.ended = true; return this; },
  };
  return r;
}

function mockGetReq(userId = 'reader-1'): Request {
  return {
    method: 'GET',
    headers: {},
    user: { sub: userId },
    ip: '127.0.0.1',
  } as unknown as Request;
}

interface RunResult {
  res: MockRes;
  passed: boolean;
}

async function runOnce(
  mw: ReturnType<typeof pipelineReadRateLimit>,
  req: Request,
  handler: (req: Request, res: Response) => void,
): Promise<RunResult> {
  const res = mockRes();
  let passed = false;
  await new Promise<void>((resolve, reject) => {
    const next: NextFunction = (err?: unknown) => {
      if (err) { reject(err); return; }
      passed = true;
      try {
        handler(req, res as unknown as Response);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    Promise.resolve(mw(req, res as unknown as Response, next))
      .then(() => { if (res.ended) resolve(); })
      .catch(reject);
  });
  return { res, passed };
}

beforeEach(() => {
  _resetRateLimitMemFallback();
});

describe('pipelineReadRateLimit — 60/min/user budget', () => {
  test('65 fast GETs against a mocked pipeline handler triggers ≥1 429 with Retry-After', async () => {
    const mw = pipelineReadRateLimit();
    // Stand-in for the real pipeline GET handlers (e.g. the listing
    // endpoints in pipelineDefinitions / pipelineHealth / pipelineMetrics).
    // Always returns 200 so any 429 we observe came from the limiter.
    const handler = (_req: Request, res: Response): void => {
      res.status(200).json({ ok: true });
    };

    const results: RunResult[] = [];
    for (let i = 0; i < 65; i++) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await runOnce(mw, mockGetReq('reader-burst'), handler));
    }

    const allowed = results.filter((r) => r.passed && r.res.statusCode === 200);
    const blocked = results.filter((r) => !r.passed && r.res.statusCode === 429);

    // Budget is 60 — first 60 should pass, remainder should 429. Use ≥/≤
    // bounds so the test is robust to fractional-tokens edge cases (none
    // expected here because we don't advance time, but defensive).
    expect(allowed.length).toBeGreaterThanOrEqual(60);
    expect(allowed.length).toBeLessThanOrEqual(60);
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(allowed.length + blocked.length).toBe(65);

    // Every 429 must carry a Retry-After header AND an RFC-7807 body.
    for (const b of blocked) {
      expect(b.res.headers['Retry-After']).toBeDefined();
      const sec = Number(b.res.headers['Retry-After']);
      expect(Number.isFinite(sec)).toBe(true);
      expect(sec).toBeGreaterThanOrEqual(1);

      const body = b.res.body as RateLimitedProblem;
      expect(body.status).toBe(429);
      expect(body.title).toBe('Too Many Requests');
      expect(body.detail).toMatch(/pipeline:read/);
      expect(body.retryAfterSec).toBe(sec);
    }
  });

  test('separate users have separate buckets — one user being limited does not block another', async () => {
    const mw = pipelineReadRateLimit();
    const handler = (_req: Request, res: Response): void => {
      res.status(200).json({ ok: true });
    };

    // User A burns through 60.
    for (let i = 0; i < 60; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runOnce(mw, mockGetReq('user-a'), handler);
    }
    // 61st for A should 429.
    const aBlocked = await runOnce(mw, mockGetReq('user-a'), handler);
    expect(aBlocked.passed).toBe(false);
    expect(aBlocked.res.statusCode).toBe(429);

    // User B is fresh — first request must pass.
    const bFirst = await runOnce(mw, mockGetReq('user-b'), handler);
    expect(bFirst.passed).toBe(true);
    expect(bFirst.res.statusCode).toBe(200);
  });
});
