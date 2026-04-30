// frontend/src/hooks/useApiHealth.test.ts
//
// Hub task #4: cover the polling hook for the three response shapes that
// drive the degraded-API banner — 200/ok, 503/degraded, and a network
// failure mapped to "degraded" so the banner still surfaces the outage.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

vi.stubEnv('VITE_SOCIAL_API_URL', 'http://api.test');

import { useApiHealth } from './useApiHealth';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('useApiHealth', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts unknown, then resolves to ok after the first sample lands', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'ok', service: 'social-api', checks: { dynamodb: { status: 'ok' } } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(60_000));
    expect(result.current.status).toBe('unknown');

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.failing).toEqual([]);
  });

  it('flags failing dependencies when /health returns 503/degraded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 'degraded',
          service: 'social-api',
          checks: {
            dynamodb: { status: 'error', latencyMs: 2, error: '' },
            redis: { status: 'error', latencyMs: 53, error: 'Redis client unavailable' },
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(60_000));

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.failing).toEqual(expect.arrayContaining(['dynamodb', 'redis']));
  });

  it('treats a network failure as degraded so the banner still shows', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(60_000));

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.failing).toEqual(['network']);
  });
});
