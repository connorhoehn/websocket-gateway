// frontend/src/components/pipelines/__tests__/pipelineStorageRemote.test.ts
//
// Unit coverage for the Phase 4 remote persistence stub. Exercises every
// public function against a mocked `global.fetch` — no network, no timers.
//
// Framework: Vitest (jest-compatible API, jsdom env from vite.config.ts).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listPipelinesRemote,
  loadPipelineRemote,
  savePipelineRemote,
  deletePipelineRemote,
  publishPipelineRemote,
} from '../persistence/pipelineStorageRemote';
import type { PipelineDefinition } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeDef(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  return {
    id: 'pl-1',
    name: 'Remote Pipeline',
    status: 'draft',
    updatedAt: '2026-04-20T10:00:00.000Z',
    createdAt: '2026-04-20T09:00:00.000Z',
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  } as PipelineDefinition;
}

function mockFetchResponse(body: unknown, init: Partial<Response> = {}): Response {
  const status = (init.status as number | undefined) ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// Access the most recent call args for assertions.
function lastCallArgs(
  spy: ReturnType<typeof vi.spyOn>,
): [string, RequestInit | undefined] {
  const calls = (spy.mock.calls as unknown[][]);
  const last = calls[calls.length - 1] as [string, RequestInit | undefined];
  return last;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// listPipelinesRemote
// ---------------------------------------------------------------------------

describe('listPipelinesRemote', () => {
  test('fetches /api/pipelines/defs with Bearer auth and maps server shape', async () => {
    const serverBody = {
      pipelines: [
        makeDef({ id: 'a', name: 'A', icon: 'star', tags: ['x', 'y'] }),
        makeDef({ id: 'b', name: 'B', status: 'published' }),
      ],
    };
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(serverBody));

    const entries = await listPipelinesRemote('tok-123');

    const [url, init] = lastCallArgs(fetchSpy);
    expect(url).toContain('/api/pipelines/defs');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 'a',
      name: 'A',
      status: 'draft',
      updatedAt: '2026-04-20T10:00:00.000Z',
      icon: 'star',
      tags: ['x', 'y'],
    });
    // entry b has no icon/tags, so those keys must be absent (not undefined).
    expect(entries[1]).toEqual({
      id: 'b',
      name: 'B',
      status: 'published',
      updatedAt: '2026-04-20T10:00:00.000Z',
    });
    expect('icon' in entries[1]).toBe(false);
    expect('tags' in entries[1]).toBe(false);
  });

  test('tolerates missing `pipelines` key by returning an empty array', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}));
    const entries = await listPipelinesRemote('tok');
    expect(entries).toEqual([]);
  });

  test('throws on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ error: 'boom' }, { status: 500 }));
    await expect(listPipelinesRemote('tok')).rejects.toThrow(/listPipelinesRemote failed \(500\)/);
  });

  test('propagates network errors rather than crashing silently', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    await expect(listPipelinesRemote('tok')).rejects.toThrow('network down');
  });
});

// ---------------------------------------------------------------------------
// loadPipelineRemote
// ---------------------------------------------------------------------------

describe('loadPipelineRemote', () => {
  test('GETs /api/pipelines/defs/:id and returns the body', async () => {
    const def = makeDef({ id: 'p-77' });
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(def));

    const result = await loadPipelineRemote('tok', 'p-77');

    const [url, init] = lastCallArgs(fetchSpy);
    expect(url).toContain('/api/pipelines/defs/p-77');
    expect(init?.method).toBeUndefined(); // GET is default
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(result).toEqual(def);
  });

  test('URL-encodes the id', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(makeDef()));
    await loadPipelineRemote('tok', 'hello world/slash');
    const [url] = lastCallArgs(fetchSpy);
    expect(url).toContain('hello%20world%2Fslash');
  });

  test('returns null on 404', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 404 }));
    const result = await loadPipelineRemote('tok', 'missing');
    expect(result).toBeNull();
  });

  test('throws on other non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 500 }));
    await expect(loadPipelineRemote('tok', 'x')).rejects.toThrow(/loadPipelineRemote failed \(500\)/);
  });

  test('propagates network errors', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    await expect(loadPipelineRemote('tok', 'x')).rejects.toThrow('offline');
  });
});

// ---------------------------------------------------------------------------
// savePipelineRemote
// ---------------------------------------------------------------------------

describe('savePipelineRemote', () => {
  test('PUTs with JSON body and correct auth + content-type', async () => {
    const def = makeDef({ id: 'save-me' });
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}));

    await savePipelineRemote('tok-abc', def);

    const [url, init] = lastCallArgs(fetchSpy);
    expect(url).toContain('/api/pipelines/defs/save-me');
    expect(init?.method).toBe('PUT');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify(def));
  });

  test('throws on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 400 }));
    await expect(savePipelineRemote('tok', makeDef())).rejects.toThrow(/savePipelineRemote failed \(400\)/);
  });
});

// ---------------------------------------------------------------------------
// deletePipelineRemote
// ---------------------------------------------------------------------------

describe('deletePipelineRemote', () => {
  test('sends DELETE with bearer auth and resolves on 200', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 200 }));
    await expect(deletePipelineRemote('tok', 'id-1')).resolves.toBeUndefined();

    const [url, init] = lastCallArgs(fetchSpy);
    expect(url).toContain('/api/pipelines/defs/id-1');
    expect(init?.method).toBe('DELETE');
  });

  test('tolerates 204 No Content', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse('', { status: 204 }));
    await expect(deletePipelineRemote('tok', 'id-2')).resolves.toBeUndefined();
  });

  test('tolerates 404 (idempotent delete)', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 404 }));
    await expect(deletePipelineRemote('tok', 'gone')).resolves.toBeUndefined();
  });

  test('throws on 500', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 500 }));
    await expect(deletePipelineRemote('tok', 'bad')).rejects.toThrow(/deletePipelineRemote failed \(500\)/);
  });
});

// ---------------------------------------------------------------------------
// publishPipelineRemote
// ---------------------------------------------------------------------------

describe('publishPipelineRemote', () => {
  test('POSTs to /:id/publish and returns the updated def', async () => {
    const def = makeDef({ id: 'to-publish', status: 'published' });
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(def));

    const result = await publishPipelineRemote('tok', 'to-publish');

    const [url, init] = lastCallArgs(fetchSpy);
    expect(url).toContain('/api/pipelines/defs/to-publish/publish');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(result).toEqual(def);
  });

  test('returns null on 404', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 404 }));
    const result = await publishPipelineRemote('tok', 'nope');
    expect(result).toBeNull();
  });

  test('throws on other non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { status: 502 }));
    await expect(publishPipelineRemote('tok', 'x')).rejects.toThrow(/publishPipelineRemote failed \(502\)/);
  });
});
