// Phase 51 / hub#80 — sync layer tests for the decisions renderer's
// best-effort POST to /api/approvals.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mapStatusToDecision,
  readDocumentIdFromUrl,
  postApproval,
} from '../approvalSync';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapStatusToDecision', () => {
  it('maps acked + done to approved', () => {
    expect(mapStatusToDecision('acked')).toBe('approved');
    expect(mapStatusToDecision('done')).toBe('approved');
  });

  it('maps rejected to rejected', () => {
    expect(mapStatusToDecision('rejected')).toBe('rejected');
  });

  it('returns null for non-terminal statuses', () => {
    expect(mapStatusToDecision('pending')).toBeNull();
    expect(mapStatusToDecision('in-progress')).toBeNull();
    expect(mapStatusToDecision('')).toBeNull();
  });
});

describe('readDocumentIdFromUrl', () => {
  it('extracts the id from /documents/<id>', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/documents/abc-123' },
      writable: true,
    });
    expect(readDocumentIdFromUrl()).toBe('abc-123');
  });

  it('returns null when not on a doc URL', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/document-types' },
      writable: true,
    });
    expect(readDocumentIdFromUrl()).toBeNull();
  });

  it('handles trailing path segments + query strings', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/documents/xyz?mode=reader' },
      writable: true,
    });
    expect(readDocumentIdFromUrl()).toBe('xyz');
  });
});

describe('postApproval', () => {
  it('fires POST /api/approvals with the expected body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postApproval({
      sectionId: 'sec-1',
      decision: 'approved',
      reviewerName: 'Alice',
      documentId: 'doc-9', // override; bypass URL parsing
      idToken: 'tok-abc',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/approvals$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-abc');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body).toEqual({
      documentId: 'doc-9',
      sectionId: 'sec-1',
      decision: 'approved',
      reviewerName: 'Alice',
    });
  });

  it('does NOT fire when no documentId can be resolved', async () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/document-types' },
      writable: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await postApproval({ sectionId: 's', decision: 'approved' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no documentId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok=false when the server responds non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await postApproval({ sectionId: 's', decision: 'approved', documentId: 'd' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/POST failed: 500/);
  });

  it('returns ok=false when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await postApproval({ sectionId: 's', decision: 'approved', documentId: 'd' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/);
  });
});
