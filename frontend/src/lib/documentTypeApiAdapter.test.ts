// Phase 51 Phase A.5 — sync-path tests for the localStorage→server adapter.
//
// Coverage:
//   - translateForApi maps wizard sectionTypes to the right backend
//     fieldType/widget tuples and falls back to text/text_field for unknown
//     renderer ids.
//   - syncDocumentTypeCreate fires the expected POST and returns ok=true
//     on a 201; ok=false on a non-2xx; ok=false on a network error.
//   - syncDocumentTypeUpdate fires PUT against the previously-stored
//     server typeId, falls back to POST when the server returns 404, and
//     creates fresh when no prior sync occurred.
//   - syncDocumentTypeDelete is a no-op when nothing was ever synced.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  translateForApi,
  syncDocumentTypeCreate,
  syncDocumentTypeUpdate,
  syncDocumentTypeDelete,
  _resetLocalToServerIdForTests,
} from './documentTypeApiAdapter';
import type { DocumentType } from '../types/documentType';

function makeLocalType(id = 'local-1'): DocumentType {
  return {
    id,
    name: 'Article',
    description: 'A long-form post',
    icon: '📄',
    fields: [
      { id: 'f-1', name: 'Title',  sectionType: 'text',      required: true,  defaultCollapsed: false, placeholder: 'short title', hiddenInModes: [], rendererOverrides: {} },
      { id: 'f-2', name: 'Body',   sectionType: 'rich-text', required: false, defaultCollapsed: false, placeholder: '',            hiddenInModes: [], rendererOverrides: {} },
      { id: 'f-3', name: 'Custom', sectionType: 'unknown-renderer-id', required: false, defaultCollapsed: false, placeholder: '',  hiddenInModes: [], rendererOverrides: {} },
    ],
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };
}

beforeEach(() => {
  _resetLocalToServerIdForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('translateForApi', () => {
  it('maps rich-text → long_text/textarea, text → text/text_field', () => {
    const out = translateForApi(makeLocalType());
    expect(out.name).toBe('Article');
    expect(out.fields).toHaveLength(3);
    expect(out.fields[0]).toMatchObject({
      name: 'Title', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true,
    });
    expect(out.fields[1]).toMatchObject({
      name: 'Body', fieldType: 'long_text', widget: 'textarea', cardinality: 1, required: false,
    });
  });

  it('falls back to text/text_field for unknown renderer ids', () => {
    const out = translateForApi(makeLocalType());
    expect(out.fields[2]).toMatchObject({
      name: 'Custom', fieldType: 'text', widget: 'text_field',
    });
  });

  it('forwards placeholder as helpText', () => {
    const out = translateForApi(makeLocalType());
    expect(out.fields[0].helpText).toBe('short title');
  });
});

describe('syncDocumentTypeCreate', () => {
  it('POSTs the translated payload and returns ok=true on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ typeId: 'server-id-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncDocumentTypeCreate(makeLocalType(), 'token-abc');

    expect(result.ok).toBe(true);
    expect(result.serverTypeId).toBe('server-id-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/document-types$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-abc');
    const body = JSON.parse(init.body as string) as { name: string; fields: { fieldType: string }[] };
    expect(body.name).toBe('Article');
    expect(body.fields).toHaveLength(3);
    expect(body.fields[1].fieldType).toBe('long_text');
  });

  it('returns ok=false when the server replies non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await syncDocumentTypeCreate(makeLocalType(), 'token');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/POST failed: 500/);
  });

  it('returns ok=false when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('NetworkError: offline')));
    const result = await syncDocumentTypeCreate(makeLocalType(), 'token');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/);
  });
});

describe('syncDocumentTypeUpdate', () => {
  it('PUTs against the cached serverTypeId after a prior create', async () => {
    // First, prime the local→server map via a successful create.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ typeId: 'srv-7' }),
    }));
    await syncDocumentTypeCreate(makeLocalType('local-7'), 'token');

    // Now an update should hit PUT /api/document-types/srv-7
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', putMock);
    const result = await syncDocumentTypeUpdate(makeLocalType('local-7'), 'token');
    expect(result.ok).toBe(true);
    const [url, init] = putMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/document-types\/srv-7$/);
    expect(init.method).toBe('PUT');
  });

  it('falls back to create when no prior sync exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ typeId: 'fresh-id' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncDocumentTypeUpdate(makeLocalType('never-synced'), 'token');
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST'); // create path
  });

  it('falls back to create when PUT returns 404 (server-side row vanished)', async () => {
    // Prime the map.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ typeId: 'will-be-gone' }),
    }));
    await syncDocumentTypeCreate(makeLocalType('local-9'), 'token');

    // Now PUT 404s; the adapter should re-POST.
    const sequence = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })  // PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ typeId: 're-created' }) }); // POST
    vi.stubGlobal('fetch', sequence);

    const result = await syncDocumentTypeUpdate(makeLocalType('local-9'), 'token');
    expect(result.ok).toBe(true);
    expect(result.serverTypeId).toBe('re-created');
    expect(sequence).toHaveBeenCalledTimes(2);
    expect((sequence.mock.calls[0][1] as RequestInit).method).toBe('PUT');
    expect((sequence.mock.calls[1][1] as RequestInit).method).toBe('POST');
  });
});

describe('syncDocumentTypeDelete', () => {
  it('is a no-op (ok=true, no fetch) when nothing was ever synced', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncDocumentTypeDelete('never-touched', 'token');
    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DELETEs against the cached serverTypeId after a prior create', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ typeId: 'srv-del' }),
    }));
    await syncDocumentTypeCreate(makeLocalType('local-del'), 'token');

    const delMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', delMock);
    const result = await syncDocumentTypeDelete('local-del', 'token');
    expect(result.ok).toBe(true);
    const [url, init] = delMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/document-types\/srv-del$/);
    expect(init.method).toBe('DELETE');
  });
});
