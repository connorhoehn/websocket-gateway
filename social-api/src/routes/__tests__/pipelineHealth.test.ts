// Tests for the /api/pipelines/health stub router.
//
// We verify:
//   1. Endpoint shape — every documented field is present with the right type.
//   2. `llmClientConfigured` is sensitive to env-var changes:
//        - default provider (anthropic) requires ANTHROPIC_API_KEY
//        - PIPELINE_LLM_PROVIDER=bedrock relies on AWS_REGION (default chain)
//        - unknown provider returns false
//   3. Phase 1 status is `unwired` even when the LLM is configured (cluster
//      and pipelineModule are still stubbed false).

import express, { type NextFunction, type Request, type Response } from 'express';
import {
  pipelineHealthRouter,
  hasLLMConfig,
  getPipelineHealthStub,
  type PipelineHealth,
} from '../pipelineHealth';

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
  app.use('/pipelines/health', pipelineHealthRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Env helpers — restore env around each test so order doesn't matter.
// ---------------------------------------------------------------------------

const ORIG_ENV = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  PIPELINE_LLM_PROVIDER: process.env.PIPELINE_LLM_PROVIDER,
  AWS_REGION: process.env.AWS_REGION,
};

afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
});

// ---------------------------------------------------------------------------
// hasLLMConfig — env-var sensitivity
// ---------------------------------------------------------------------------

describe('hasLLMConfig', () => {
  test('returns true with anthropic provider + ANTHROPIC_API_KEY', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(hasLLMConfig()).toBe(true);
  });

  test('returns false with anthropic provider when ANTHROPIC_API_KEY is missing', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasLLMConfig()).toBe(false);
  });

  test('defaults to anthropic when PIPELINE_LLM_PROVIDER is unset', () => {
    delete process.env.PIPELINE_LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(hasLLMConfig()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasLLMConfig()).toBe(false);
  });

  test('returns true for bedrock (AWS default chain is acceptable)', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'bedrock';
    process.env.AWS_REGION = 'us-east-1';
    expect(hasLLMConfig()).toBe(true);
  });

  test('returns false for unknown provider', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'mystery-llm';
    expect(hasLLMConfig()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stub generator shape
// ---------------------------------------------------------------------------

describe('getPipelineHealthStub', () => {
  test('returns the documented PipelineHealth shape', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    const h = getPipelineHealthStub();
    expect(h.status).toBe('unwired');
    expect(h.embeddedClusterReady).toBe(false);
    expect(h.llmClientConfigured).toBe(false);
    expect(h.pipelineModuleConnected).toBe(false);
    expect(h.lastEventAt).toBeNull();
    expect(h.tokenRate).toBeNull();
    expect(typeof h.asOf).toBe('string');
    expect(new Date(h.asOf).toISOString()).toBe(h.asOf);
  });

  test('llmClientConfigured reflects env at call time', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-present';
    expect(getPipelineHealthStub().llmClientConfigured).toBe(true);

    delete process.env.ANTHROPIC_API_KEY;
    expect(getPipelineHealthStub().llmClientConfigured).toBe(false);
  });

  test('Phase 1 status is `unwired` even when the LLM is configured', () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-present';
    const h = getPipelineHealthStub();
    expect(h.status).toBe('unwired');
    expect(h.llmClientConfigured).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------

describe('GET /pipelines/health', () => {
  test('200 with PipelineHealth shape', async () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/health');
    expect(res.statusCode).toBe(200);
    const body = res.body as PipelineHealth;
    expect(body.status).toBe('unwired');
    expect(body.embeddedClusterReady).toBe(false);
    expect(body.llmClientConfigured).toBe(true);
    expect(body.pipelineModuleConnected).toBe(false);
    expect(body.lastEventAt).toBeNull();
    expect(body.tokenRate).toBeNull();
    expect(typeof body.asOf).toBe('string');
  });

  test('llmClientConfigured=false propagates over the wire when key is missing', async () => {
    process.env.PIPELINE_LLM_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildApp();
    const res = await run(app, 'GET', '/pipelines/health');
    expect(res.statusCode).toBe(200);
    const body = res.body as PipelineHealth;
    expect(body.llmClientConfigured).toBe(false);
  });
});
