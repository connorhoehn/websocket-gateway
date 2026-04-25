// frontend/src/components/pipelines/__tests__/useTriggerRun.test.tsx
//
// Unit coverage for the Phase 4 `useTriggerRun` hook. Tests the public
// contract: 202 returns runId, non-2xx sets lastError, auth header is
// present, optional triggerPayload is forwarded in the body.
//
// Framework: Vitest + @testing-library/react.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  IdentityProvider,
  type IdentityContextValue,
} from '../../../contexts/IdentityContext';
import { useTriggerRun } from '../hooks/useTriggerRun';
import { savePipeline } from '../persistence/pipelineStorage';
import type { PipelineDefinition } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(id: string): PipelineDefinition {
  // Minimal valid-ish shape; the hook treats the definition as opaque.
  return {
    id,
    name: `pipe-${id}`,
    version: 0,
    status: 'draft',
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
  } as PipelineDefinition;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdentity(
  overrides: Partial<IdentityContextValue> = {},
): IdentityContextValue {
  return {
    userId: 'user-1',
    displayName: 'Test User',
    userEmail: 'test@example.com',
    idToken: 'jwt-test-token',
    onSignOut: () => {},
    ...overrides,
  };
}

function wrapperWith(identity: IdentityContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <IdentityProvider value={identity}>{children}</IdentityProvider>;
  };
}

function mockResponse(
  body: unknown,
  init: Partial<Response> & { responseHeaders?: Record<string, string> } = {},
): Response {
  const status = (init.status as number | undefined) ?? 200;
  const responseHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.responseHeaders ?? {})) {
    responseHeaders[k.toLowerCase()] = v;
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    // The hook reads `X-Idempotent-Replay` via Headers.get(); supplying a
    // minimal Headers-shaped object avoids a TypeError on success paths.
    headers: {
      get: (name: string) => responseHeaders[name.toLowerCase()] ?? null,
    } as unknown as Headers,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch');
  // Isolate localStorage between tests so pipeline definitions from one test
  // don't leak into the next (the hook loads the definition via
  // `loadPipeline`, which reads from localStorage).
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom-less environment — ignore */
  }
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTriggerRun', () => {
  test('returns runId on 202 success and toggles isTriggering around the request', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        {
          runId: 'run-abc-123',
          pipelineId: 'pl-1',
          triggeredBy: { userId: 'user-1', triggerType: 'manual' },
          at: '2026-04-23T00:00:00.000Z',
        },
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    expect(result.current.isTriggering).toBe(false);
    expect(result.current.lastError).toBeNull();

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.triggerRun('pl-1');
    });

    expect(returned).toBe('run-abc-123');
    expect(result.current.isTriggering).toBe(false);
    expect(result.current.lastError).toBeNull();
  });

  test('sends Bearer auth header and default empty body when no payload given', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ runId: 'r1', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' }, { status: 202 }),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity({ idToken: 'bearer-42' })),
    });

    await act(async () => {
      await result.current.triggerRun('pipe-xyz');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/pipelines/pipe-xyz/runs');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer bearer-42');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{}');
  });

  test('passes triggerPayload through in the request body', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ runId: 'r', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' }, { status: 202 }),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    await act(async () => {
      await result.current.triggerRun('p-1', { foo: 'bar', n: 7 });
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ triggerPayload: { foo: 'bar', n: 7 } }));
  });

  test('URL-encodes the pipelineId', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ runId: 'r', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' }, { status: 202 }),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    await act(async () => {
      await result.current.triggerRun('weird id/slash');
    });

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('weird%20id%2Fslash');
  });

  test('sets lastError and returns null on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('Forbidden', { status: 403 }),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    let returned: string | null = 'unset';
    await act(async () => {
      returned = await result.current.triggerRun('p');
    });

    expect(returned).toBeNull();
    expect(result.current.lastError).toMatch(/Trigger failed \(403\)/);
  });

  test('surfaces network errors via lastError', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    let returned: string | null = 'unset';
    await act(async () => {
      returned = await result.current.triggerRun('p');
    });

    expect(returned).toBeNull();
    expect(result.current.lastError).toBe('network down');
  });

  test('short-circuits with "Not authenticated" when idToken is missing', async () => {
    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity({ idToken: null })),
    });

    let returned: string | null = 'unset';
    await act(async () => {
      returned = await result.current.triggerRun('p');
    });

    expect(returned).toBeNull();
    expect(result.current.lastError).toBe('Not authenticated');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('ships the saved pipeline definition inline in the request body', async () => {
    // savePipeline() persists into localStorage; the hook calls loadPipeline()
    // and embeds the result under `definition` so the gateway can forward to
    // PipelineModule.createResource() without a read-after-write.
    const def = makeDefinition('pl-with-def');
    savePipeline(def);

    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        { runId: 'r', pipelineId: 'pl-with-def', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' },
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    await act(async () => {
      await result.current.triggerRun('pl-with-def', { kick: true });
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as {
      definition?: { id: string };
      triggerPayload?: Record<string, unknown>;
    };
    expect(parsed.definition).toBeTruthy();
    expect(parsed.definition?.id).toBe('pl-with-def');
    expect(parsed.triggerPayload).toEqual({ kick: true });
  });

  test('forwards Idempotency-Key header when options.idempotencyKey is supplied', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        { runId: 'r', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' },
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    await act(async () => {
      await result.current.triggerRun('p', undefined, { idempotencyKey: 'idem-xyz' });
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-xyz');
  });

  test('omits Idempotency-Key header when no key is supplied', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        { runId: 'r', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' },
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    await act(async () => {
      await result.current.triggerRun('p');
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  test('isReplay reflects X-Idempotent-Replay response header', async () => {
    // First call: server says it was a replay → isReplay flips to true.
    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        { runId: 'r-cached', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' },
        { status: 202, responseHeaders: { 'X-Idempotent-Replay': 'true' } },
      ),
    );

    const { result } = renderHook(() => useTriggerRun(), {
      wrapper: wrapperWith(makeIdentity()),
    });

    expect(result.current.isReplay).toBe(false);

    await act(async () => {
      await result.current.triggerRun('p', undefined, { idempotencyKey: 'k' });
    });

    await waitFor(() => expect(result.current.isReplay).toBe(true));

    // Second call: header absent → isReplay resets to false.
    fetchSpy.mockResolvedValueOnce(
      mockResponse(
        { runId: 'r-fresh', pipelineId: 'p', triggeredBy: { userId: 'u', triggerType: 'manual' }, at: 'now' },
        { status: 202 },
      ),
    );

    await act(async () => {
      await result.current.triggerRun('p');
    });

    await waitFor(() => expect(result.current.isReplay).toBe(false));
  });
});
