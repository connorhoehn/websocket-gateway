// Tests for pipelineWebhooks router.
//
// Covers:
//   - 202 on valid path with expected response shape (accepted, webhookPath, at)
//   - 400 on invalid path (whitespace, slashes, too long, empty alts)
//   - Header pass-through forwards only `x-*` headers (uppercase + lowercase
//     X-Foo are both captured; Authorization / Cookie / Content-Type are not)
//   - Empty body is tolerated (defaults to {})

import express, { type NextFunction, type Request, type Response } from 'express';

import { pipelineWebhooksRouter, pickSafeHeaders } from '../pipelineWebhooks';
import {
  pipelineDefinitionsRouter,
  stubPipelineStore,
} from '../pipelineDefinitions';
import {
  computeSignature,
  generateWebhookSecret,
  SIGNATURE_HEADER,
} from '../../lib/webhookSignature';

// ---------------------------------------------------------------------------
// Test rig (mirrors pipelineTriggers.test.ts) — hand-rolled mock req/res so we
// don't depend on supertest, which isn't in the social-api dep tree.
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

async function run(
  app: express.Express,
  method: string,
  url: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<MockRes> {
  const res = mockRes();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }
  const [pathname] = url.split('?', 2);
  const req = {
    method: method.toUpperCase(),
    url,
    originalUrl: url,
    path: pathname,
    headers,
    query: {},
    body: opts.body,
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
    (app as unknown as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void)(req, res as unknown as Response, finalHandler);
    res.finished.then(() => resolve()).catch(reject);
  });
  return res;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/hooks/pipeline', pipelineWebhooksRouter);
  return app;
}

// Silence the structured `[pipeline-webhook] received` log line during tests.
let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// POST /hooks/pipeline/:path
// ---------------------------------------------------------------------------

describe('POST /hooks/pipeline/:path', () => {
  test('202 with shape { accepted, webhookPath, at } on valid path', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/weekly-digest', {
      body: { ping: 'pong' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.body as {
      accepted: boolean;
      webhookPath: string;
      at: string;
    };
    expect(body.accepted).toBe(true);
    expect(body.webhookPath).toBe('weekly-digest');
    expect(typeof body.at).toBe('string');
    // ISO 8601 date string (cheap shape check).
    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('accepts alphanumeric, underscore, hyphen', async () => {
    const app = buildApp();
    for (const path of ['abc', 'a_b', 'a-b', 'A1_b-2', 'x'.repeat(64)]) {
      const res = await run(app, 'POST', `/hooks/pipeline/${path}`, {
        body: {},
      });
      expect(res.statusCode).toBe(202);
    }
  });

  test('400 on invalid path: special chars, too long, empty', async () => {
    const app = buildApp();

    // 65 chars — past the cap.
    const tooLong = await run(
      app,
      'POST',
      `/hooks/pipeline/${'x'.repeat(65)}`,
      { body: {} },
    );
    expect(tooLong.statusCode).toBe(400);
    expect((tooLong.body as { error: string }).error).toMatch(/invalid path/);

    // dot is not allowed.
    const dot = await run(app, 'POST', '/hooks/pipeline/has.dot', { body: {} });
    expect(dot.statusCode).toBe(400);

    // slash inside a segment isn't routable as `:path` anyway, but a percent-
    // encoded one is and should be rejected.
    const pct = await run(app, 'POST', '/hooks/pipeline/has%2Fslash', {
      body: {},
    });
    expect(pct.statusCode).toBe(400);
  });

  test('forwards only x-* headers; strips Authorization / Cookie / Content-Type (helper)', () => {
    // Direct assertion against the pure helper — the route uses this function
    // verbatim, so the route's behavior is covered transitively.
    const safe = pickSafeHeaders({
      'X-Custom': 'yes',
      'x-other': 'also',
      'X-Forwarded-For': '10.0.0.1',
      Authorization: 'Bearer secret',
      Cookie: 'session=abc',
      'Content-Type': 'application/json',
      // Multi-value headers (express delivers as arrays) are dropped — we
      // only forward simple string values to keep the pipeline context flat.
      'x-multi': ['a', 'b'],
      // Undefined / null entries from upstream parsers are tolerated.
      'x-undef': undefined,
    });

    expect(safe).toEqual({
      'X-Custom': 'yes',
      'x-other': 'also',
      'X-Forwarded-For': '10.0.0.1',
    });
  });

  test('route handler runs the header filter without crashing on mixed inputs', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/h1', {
      body: { ok: true },
      headers: {
        'X-Custom': 'yes',
        'x-other': 'also',
        Authorization: 'Bearer secret',
        Cookie: 'session=abc',
        'Content-Type': 'application/json',
      },
    });
    expect(res.statusCode).toBe(202);
    expect((res.body as { webhookPath: string }).webhookPath).toBe('h1');
    expect(logSpy).toHaveBeenCalled();
  });

  test('tolerates an empty body and still returns 202', async () => {
    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/empty', {
      body: undefined,
    });
    expect(res.statusCode).toBe(202);
    expect((res.body as { accepted: boolean }).accepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification (X-Pipeline-Signature-256)
//
// We seed the stubPipelineStore with a webhook trigger binding that carries
// a `webhookSecret`. The route reads the secret out of the store and rejects
// any POST whose signature header doesn't match HMAC-SHA256(secret, body).
// Pipelines without a configured secret keep the Phase-1 unsigned-OK
// behavior so dev fixtures don't break.
//
// `req.body` is passed as a Buffer so the upstream `express.raw` middleware
// leaves it untouched (`typeis.hasBody(req)` is false without a
// content-length header → middleware skips → handler sees the Buffer).
// ---------------------------------------------------------------------------

/**
 * Drive a real PUT through `pipelineDefinitionsRouter` so the same upsert
 * code path the production app uses installs the binding (and persists the
 * provided secret). Keeps the test honest about how secrets actually get
 * into the store.
 */
async function seedViaPut(opts: {
  webhookPath: string;
  webhookSecret?: string;
}): Promise<{ secret: string }> {
  const app = express();
  app.use(express.json());
  // Inject a mock auth context — the upsert handler reads `req.user!.sub`.
  app.use((req, _res, next) => {
    (req as unknown as { user: { sub: string } }).user = { sub: 'test-user' };
    next();
  });
  app.use('/defs', pipelineDefinitionsRouter);

  const pipelineId = `pipe-${opts.webhookPath}`;
  const secret = opts.webhookSecret ?? generateWebhookSecret();
  const def = {
    id: pipelineId,
    name: 'sig test',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'test-user',
    triggerBinding: {
      event: 'webhook',
      webhookPath: opts.webhookPath,
      webhookSecret: secret,
    },
  };

  await run(app, 'PUT', `/defs/${pipelineId}`, { body: def });
  return { secret };
}

describe('POST /hooks/pipeline/:path — HMAC-SHA256 signature', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    stubPipelineStore.__resetForTests();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('valid signature → 202', async () => {
    const { secret } = await seedViaPut({ webhookPath: 'signed-ok' });
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    const sig = computeSignature(secret, rawBody);

    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/signed-ok', {
      body: rawBody,
      headers: { [SIGNATURE_HEADER]: sig },
    });

    expect(res.statusCode).toBe(202);
    expect((res.body as { accepted: boolean }).accepted).toBe(true);
  });

  test('invalid signature → 401 with problem-details body', async () => {
    await seedViaPut({
      webhookPath: 'signed-bad',
      webhookSecret: 'a'.repeat(64),
    });
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    // Compute signature with the WRONG secret.
    const wrongSig = computeSignature('b'.repeat(64), rawBody);

    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/signed-bad', {
      body: rawBody,
      headers: { [SIGNATURE_HEADER]: wrongSig },
    });

    expect(res.statusCode).toBe(401);
    const body = res.body as {
      type: string;
      title: string;
      status: number;
      detail: string;
    };
    expect(body.title).toBe('Invalid webhook signature');
    expect(body.status).toBe(401);
    expect(body.detail).toMatch(/did not match/i);
    // Structured error log so observability can alert on it.
    expect(errorSpy).toHaveBeenCalled();
  });

  test('missing signature header but secret configured → 401', async () => {
    await seedViaPut({ webhookPath: 'signed-missing' });
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/signed-missing', {
      body: rawBody,
      // no signature header
    });

    expect(res.statusCode).toBe(401);
    const body = res.body as { detail: string };
    expect(body.detail).toMatch(/required/i);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('no secret configured on def → 202 (legacy unsigned mode)', async () => {
    // Note: no seedViaPut call — store has no def for this path.
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

    const app = buildApp();
    const res = await run(app, 'POST', '/hooks/pipeline/unsigned-legacy', {
      body: rawBody,
      // No signature header — and that's fine because no secret is set.
    });

    expect(res.statusCode).toBe(202);
    expect((res.body as { accepted: boolean }).accepted).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('upsert mints a webhookSecret server-side when none is provided', async () => {
    // Drive a PUT with `triggerBinding.event: 'webhook'` but no secret —
    // the pipelineDefinitions handler should mint one before storing.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: { sub: string } }).user = { sub: 'test-user' };
      next();
    });
    app.use('/defs', pipelineDefinitionsRouter);

    const pipelineId = 'pipe-mint';
    const def = {
      id: pipelineId,
      name: 'mint test',
      version: 1,
      status: 'draft',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'test-user',
      triggerBinding: {
        event: 'webhook',
        webhookPath: 'mint-me',
        // webhookSecret intentionally omitted
      },
    };

    const res = await run(app, 'PUT', `/defs/${pipelineId}`, { body: def });
    expect(res.statusCode).toBe(200);
    const echoed = res.body as {
      triggerBinding: { webhookSecret?: string };
    };
    expect(typeof echoed.triggerBinding.webhookSecret).toBe('string');
    // 32 random bytes → 64 lowercase hex chars.
    expect(echoed.triggerBinding.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
  });
});
