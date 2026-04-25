// Tests for the four MCP tools wired in this PR:
//   pipeline_history          → GET  /pipelines/:pipelineId/runs
//   pipeline_active_runs      → GET  /pipelines/runs/active
//   pipeline_cancel_run       → POST /pipelines/:runId/cancel
//   pipeline_resolve_approval → POST /pipelines/:runId/approvals
//
// The handler is a thin REST translation layer — we mock global.fetch and
// assert the URL/method/body the handler emits, plus how it surfaces errors.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PipelineToolHandler } = require('../pipeline-tool-handler');

interface MockResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

interface FetchCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined;
}

const calls: FetchCall[] = [];
let nextResponses: MockResponse[] = [];

function mockFetch(_input: string | URL | Request, init?: RequestInit): Promise<MockResponse> {
  calls.push({ url: String(_input), init: init as FetchCall['init'] });
  const r = nextResponses.shift();
  if (!r) {
    return Promise.reject(new Error(`No mock response queued for ${String(_input)}`));
  }
  return Promise.resolve(r);
}

function jsonResp(status: number, body: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mocked',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  calls.length = 0;
  nextResponses = [];
  // Override global fetch — tests are CommonJS so we assign through globalThis.
  (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

describe('PipelineToolHandler.history (pipeline_history)', () => {
  test('happy path: forwards limit + cursor and returns body verbatim', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(
      jsonResp(200, {
        runs: [{ runId: 'r1', status: 'pending' }],
        nextCursor: 'r1',
      }),
    );
    const out = await handler.handleToolCall(
      'pipeline_history',
      { pipelineId: 'p1', limit: 5, cursor: 'prev' },
      'tok',
    );
    expect(out).toEqual({
      runs: [{ runId: 'r1', status: 'pending' }],
      nextCursor: 'r1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api/api/pipelines/p1/runs?limit=5&cursor=prev');
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  test('default invocation omits the query string', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(200, { runs: [], nextCursor: undefined }));
    await handler.handleToolCall('pipeline_history', { pipelineId: 'p1' }, 'tok');
    expect(calls[0]!.url).toBe('http://api/api/pipelines/p1/runs');
  });

  test('error: invalid_args when pipelineId missing', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall('pipeline_history', {}, 'tok'),
    ).rejects.toMatchObject({
      code: 'invalid_args',
      message: expect.stringMatching(/pipelineId is required/),
    });
    expect(calls).toHaveLength(0);
  });

  test('error: invalid_args when limit out of range', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall('pipeline_history', { pipelineId: 'p1', limit: 0 }, 'tok'),
    ).rejects.toMatchObject({ code: 'invalid_args' });
  });

  test('error: surfaces upstream 404 with code=not_found', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(404, { error: 'pipeline not found' }));
    await expect(
      handler.handleToolCall('pipeline_history', { pipelineId: 'missing' }, 'tok'),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  test('back-compat alias: pipeline_list_runs routes to history', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(200, { runs: [], nextCursor: undefined }));
    await handler.handleToolCall('pipeline_list_runs', { pipelineId: 'p1' }, 'tok');
    expect(calls[0]!.url).toBe('http://api/api/pipelines/p1/runs');
  });
});

describe('PipelineToolHandler.activeRuns (pipeline_active_runs)', () => {
  test('happy path: GET /pipelines/runs/active', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(
      jsonResp(200, { runs: [{ runId: 'a1', status: 'running' }] }),
    );
    const out = await handler.handleToolCall('pipeline_active_runs', {}, 'tok');
    expect(out).toEqual({ runs: [{ runId: 'a1', status: 'running' }] });
    expect(calls[0]!.url).toBe('http://api/api/pipelines/runs/active');
  });

  test('error: surfaces 401 with code=unauthorized', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(401, { error: 'no token' }));
    await expect(
      handler.handleToolCall('pipeline_active_runs', {}, undefined),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });
});

describe('PipelineToolHandler.cancelRun (pipeline_cancel_run)', () => {
  test('happy path: POST /pipelines/:runId/cancel with reason', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(200, { runId: 'r1', status: 'canceled' }));
    const out = await handler.handleToolCall(
      'pipeline_cancel_run',
      { runId: 'r1', reason: 'manual abort' },
      'tok',
    );
    expect(out).toEqual({ runId: 'r1', status: 'canceled' });
    expect(calls[0]!.url).toBe('http://api/api/pipelines/r1/cancel');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({ reason: 'manual abort' });
  });

  test('error: invalid_args when runId missing', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall('pipeline_cancel_run', {}, 'tok'),
    ).rejects.toMatchObject({
      code: 'invalid_args',
      message: expect.stringMatching(/runId is required/),
    });
    expect(calls).toHaveLength(0);
  });

  test('error: surfaces 404 when run is unknown', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(404, { error: 'run not found' }));
    await expect(
      handler.handleToolCall('pipeline_cancel_run', { runId: 'missing' }, 'tok'),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  test('error: invalid_args when reason is not a string', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall(
        'pipeline_cancel_run',
        { runId: 'r1', reason: 42 },
        'tok',
      ),
    ).rejects.toMatchObject({ code: 'invalid_args' });
  });
});

describe('PipelineToolHandler.resolveApproval (pipeline_resolve_approval)', () => {
  test('happy path: POST /pipelines/:runId/approvals with stepId/decision/comment', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push({ ok: true, status: 204, text: async () => '' });
    const out = await handler.handleToolCall(
      'pipeline_resolve_approval',
      {
        runId: 'r1',
        stepId: 'step-approve',
        decision: 'approve',
        comment: 'lgtm',
      },
      'tok',
    );
    // 204 → handler returns { ok: true }
    expect(out).toEqual({ ok: true });
    expect(calls[0]!.url).toBe('http://api/api/pipelines/r1/approvals');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({
      stepId: 'step-approve',
      decision: 'approve',
      comment: 'lgtm',
    });
  });

  test('omits comment when not provided', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push({ ok: true, status: 204, text: async () => '' });
    await handler.handleToolCall(
      'pipeline_resolve_approval',
      { runId: 'r1', stepId: 's1', decision: 'reject' },
      'tok',
    );
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({
      stepId: 's1',
      decision: 'reject',
    });
  });

  test("error: invalid_args when decision is not 'approve'/'reject'", async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall(
        'pipeline_resolve_approval',
        { runId: 'r1', stepId: 's1', decision: 'maybe' },
        'tok',
      ),
    ).rejects.toMatchObject({
      code: 'invalid_args',
      message: expect.stringMatching(/decision must be/),
    });
    expect(calls).toHaveLength(0);
  });

  test('error: invalid_args when runId / stepId missing', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    await expect(
      handler.handleToolCall(
        'pipeline_resolve_approval',
        { stepId: 's1', decision: 'approve' },
        'tok',
      ),
    ).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(
      handler.handleToolCall(
        'pipeline_resolve_approval',
        { runId: 'r1', decision: 'approve' },
        'tok',
      ),
    ).rejects.toMatchObject({ code: 'invalid_args' });
  });

  test('error: surfaces upstream 400 (e.g. server-side body validation)', async () => {
    const handler = new PipelineToolHandler('http://api/api');
    nextResponses.push(jsonResp(400, { error: 'stepId is required' }));
    await expect(
      handler.handleToolCall(
        'pipeline_resolve_approval',
        { runId: 'r1', stepId: 's1', decision: 'approve' },
        'tok',
      ),
    ).rejects.toMatchObject({ code: 'invalid_args', status: 400 });
  });
});
