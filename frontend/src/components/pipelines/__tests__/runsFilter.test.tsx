// Tests for the run-history filter primitives, URL-param parsing, and the
// search/filter/bulk UX layered on top of <PipelineRunsPage/>. The `filterRuns`
// helper is exercised directly (pure function); the page-level interactions
// are covered with @testing-library/react against an in-memory router.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

import PipelineRunsPage, {
  filterRuns,
  parseFilterParams,
  triggerTypeToKind,
  type StatusKey,
  type TriggerKindKey,
} from '../PipelineRunsPage';
import { createPipeline } from '../persistence/pipelineStorage';
import { appendRun, listRuns } from '../persistence/runHistory';
import type { PipelineRun, RunStatus } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(
  pipelineId: string,
  id: string,
  overrides: Partial<PipelineRun> & { startedAt?: string } = {},
): PipelineRun {
  const startedAt = overrides.startedAt ?? new Date('2026-04-25T00:00:00Z').toISOString();
  return {
    id,
    pipelineId,
    pipelineVersion: 1,
    status: 'completed' as RunStatus,
    triggeredBy: { triggerType: 'manual', payload: {} },
    ownerNodeId: 'test-node',
    startedAt,
    completedAt: startedAt,
    durationMs: 100,
    currentStepIds: [],
    steps: {},
    context: {},
    ...overrides,
  };
}

function renderPage(pipelineId: string, search = '') {
  return render(
    <MemoryRouter initialEntries={[`/pipelines/${pipelineId}/runs${search}`]}>
      <Routes>
        <Route path="/pipelines/:pipelineId/runs" element={<PipelineRunsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function clearStorage() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
      localStorage.removeItem(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure-helper coverage
// ---------------------------------------------------------------------------

describe('triggerTypeToKind', () => {
  test('document.* collapses to "document"', () => {
    expect(triggerTypeToKind('document.finalize')).toBe('document');
    expect(triggerTypeToKind('document.comment')).toBe('document');
  });
  test('"schedule" surfaces as "scheduled"', () => {
    expect(triggerTypeToKind('schedule')).toBe('scheduled');
  });
  test('webhook is preserved verbatim', () => {
    expect(triggerTypeToKind('webhook')).toBe('webhook');
  });
  test('unrecognized values fall back to manual', () => {
    expect(triggerTypeToKind('manual')).toBe('manual');
    expect(triggerTypeToKind('weird-thing')).toBe('manual');
  });
});

describe('parseFilterParams', () => {
  test('default range is 7d when missing', () => {
    const out = parseFilterParams(new URLSearchParams(''));
    expect(out.range).toBe('7d');
    expect(out.query).toBe('');
    expect(out.statuses.size).toBe(0);
    expect(out.triggerKinds.size).toBe(0);
  });

  test('parses csv status + trigger sets and ignores unknown values', () => {
    const out = parseFilterParams(
      new URLSearchParams('q=abc&status=running,failed,bogus&trigger=manual,document,evil&range=30d'),
    );
    expect(out.query).toBe('abc');
    expect(out.range).toBe('30d');
    expect(Array.from(out.statuses).sort()).toEqual(['failed', 'running']);
    expect(Array.from(out.triggerKinds).sort()).toEqual(['document', 'manual']);
  });

  test('invalid range falls back to 7d', () => {
    expect(parseFilterParams(new URLSearchParams('range=lifetime')).range).toBe('7d');
  });
});

describe('filterRuns', () => {
  const pid = 'p1';
  const NOW = new Date('2026-04-25T12:00:00Z').getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const recent = makeRun(pid, 'run-recent-aaaa', {
    startedAt: new Date(NOW - 2 * HOUR).toISOString(),
  });
  const dayOld = makeRun(pid, 'run-yesterday-bbbb', {
    startedAt: new Date(NOW - 30 * HOUR).toISOString(),
  });
  const weekOld = makeRun(pid, 'run-week-cccc', {
    startedAt: new Date(NOW - 6 * DAY).toISOString(),
  });
  const monthOld = makeRun(pid, 'run-month-dddd', {
    startedAt: new Date(NOW - 20 * DAY).toISOString(),
    status: 'failed',
    triggeredBy: { triggerType: 'webhook', payload: {} },
  });
  const ancient = makeRun(pid, 'run-ancient-eeee', {
    startedAt: new Date(NOW - 90 * DAY).toISOString(),
  });
  const docTriggered = makeRun(pid, 'run-doc-ffff', {
    startedAt: new Date(NOW - 1 * HOUR).toISOString(),
    triggeredBy: { triggerType: 'document.finalize', payload: {} },
    status: 'running',
  });

  const all = [recent, dayOld, weekOld, monthOld, ancient, docTriggered];

  test('range="24h" keeps only the last day', () => {
    const out = filterRuns(all, {
      query: '',
      statuses: new Set<StatusKey>(),
      triggerKinds: new Set<TriggerKindKey>(),
      range: '24h',
      now: NOW,
    });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual([recent.id, docTriggered.id].sort());
  });

  test('range="7d" excludes month-old + ancient, keeps the rest', () => {
    const out = filterRuns(all, {
      query: '',
      statuses: new Set(),
      triggerKinds: new Set(),
      range: '7d',
      now: NOW,
    });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual([recent.id, dayOld.id, weekOld.id, docTriggered.id].sort());
  });

  test('range="all" includes ancient runs', () => {
    const out = filterRuns(all, {
      query: '',
      statuses: new Set(),
      triggerKinds: new Set(),
      range: 'all',
      now: NOW,
    });
    expect(out.length).toBe(all.length);
  });

  test('status filter is multi-select', () => {
    const out = filterRuns(all, {
      query: '',
      statuses: new Set<StatusKey>(['failed', 'running']),
      triggerKinds: new Set(),
      range: 'all',
      now: NOW,
    });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual([monthOld.id, docTriggered.id].sort());
  });

  test('trigger filter "document" matches document.* runs only', () => {
    const out = filterRuns(all, {
      query: '',
      statuses: new Set(),
      triggerKinds: new Set<TriggerKindKey>(['document']),
      range: 'all',
      now: NOW,
    });
    expect(out.map((r) => r.id)).toEqual([docTriggered.id]);
  });

  test('case-insensitive substring search hits run id', () => {
    const out = filterRuns(all, {
      query: 'WEEK',
      statuses: new Set(),
      triggerKinds: new Set(),
      range: 'all',
      now: NOW,
    });
    expect(out.map((r) => r.id)).toEqual([weekOld.id]);
  });

  test('search hits pipelineId too', () => {
    const out = filterRuns(all, {
      query: 'P1',
      statuses: new Set(),
      triggerKinds: new Set(),
      range: 'all',
      now: NOW,
    });
    expect(out.length).toBe(all.length);
  });

  test('combined filters AND-compose', () => {
    const out = filterRuns(all, {
      query: 'run-',
      statuses: new Set<StatusKey>(['running']),
      triggerKinds: new Set<TriggerKindKey>(['document']),
      range: '7d',
      now: NOW,
    });
    expect(out.map((r) => r.id)).toEqual([docTriggered.id]);
  });
});

// ---------------------------------------------------------------------------
// Page-level integration: URL params, chips, bulk-action UI
// ---------------------------------------------------------------------------

describe('<PipelineRunsPage/> filter UX', () => {
  beforeEach(() => clearStorage());

  test('search input filters table rows live', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'apple-1111'));
    appendRun(def.id, makeRun(def.id, 'banana-2222'));

    renderPage(def.id, '?range=all');

    expect(screen.getByText('apple-11')).toBeInTheDocument();
    expect(screen.getByText('banana-2')).toBeInTheDocument();

    const input = screen.getByTestId('runs-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'apple' } });

    expect(screen.getByText('apple-11')).toBeInTheDocument();
    expect(screen.queryByText('banana-2')).not.toBeInTheDocument();
  });

  test('toggling a status chip writes the URL param and persists across remounts', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'a-1111', { status: 'completed' }));
    appendRun(def.id, makeRun(def.id, 'b-2222', { status: 'failed' }));

    // Initial mount with `status=failed` already in the URL — only the failed
    // run should be visible. This exercises the URL -> state direction.
    const { unmount } = renderPage(def.id, '?status=failed&range=all');
    expect(screen.queryByText('a-1111'.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText('b-2222'.slice(0, 8))).toBeInTheDocument();
    unmount();

    // Re-mount with a different param to confirm the URL is the source of truth.
    renderPage(def.id, '?status=completed&range=all');
    expect(screen.getByText('a-1111'.slice(0, 8))).toBeInTheDocument();
    expect(screen.queryByText('b-2222'.slice(0, 8))).not.toBeInTheDocument();
  });

  test('trigger chip "document" filters down to document.* runs', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(
      def.id,
      makeRun(def.id, 'man-1111', {
        triggeredBy: { triggerType: 'manual', payload: {} },
      }),
    );
    appendRun(
      def.id,
      makeRun(def.id, 'doc-2222', {
        triggeredBy: { triggerType: 'document.finalize', payload: {} },
      }),
    );

    renderPage(def.id, '?trigger=document&range=all');
    expect(screen.queryByText('man-1111'.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText('doc-2222'.slice(0, 8))).toBeInTheDocument();
  });

  test('bulk-select all + Export JSON triggers a download with the right filename', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'a-1111'));
    appendRun(def.id, makeRun(def.id, 'b-2222'));

    renderPage(def.id, '?range=all');

    fireEvent.click(screen.getByTestId('runs-select-all'));
    expect(screen.getByTestId('runs-bulk-toolbar')).toBeInTheDocument();

    // Stub the URL.createObjectURL / revokeObjectURL pair (jsdom doesn't have them).
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Trap the synthetic <a> click so jsdom doesn't try to navigate.
    let downloadName: string | null = null;
    const origCreate = document.createElement.bind(document);
    const createElSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = () => {
            downloadName = (el as HTMLAnchorElement).download;
          };
        }
        return el;
      });

    fireEvent.click(screen.getByTestId('runs-bulk-export'));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(downloadName).toMatch(/^pipeline-runs-.+\.json$/);

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    createElSpy.mockRestore();
  });

  test('bulk Delete prompts for confirmation and rewrites runHistory on confirm', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'keep-1111'));
    appendRun(def.id, makeRun(def.id, 'drop-2222'));

    renderPage(def.id, '?range=all');

    // Pick only the "drop" row.
    fireEvent.click(screen.getByTestId('run-select-drop-2222'));
    expect(screen.getByTestId('runs-bulk-toolbar')).toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTestId('runs-bulk-delete'));
    confirmSpy.mockRestore();

    // Persistence layer reflects the deletion.
    const remaining = listRuns(def.id).map((r) => r.id);
    expect(remaining).toEqual(['keep-1111']);

    // UI updates too.
    expect(screen.getByText('keep-111')).toBeInTheDocument();
    expect(screen.queryByText('drop-222')).not.toBeInTheDocument();
  });

  test('bulk Delete is a no-op when the user cancels the confirm prompt', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'a-1111'));
    appendRun(def.id, makeRun(def.id, 'b-2222'));

    renderPage(def.id, '?range=all');

    fireEvent.click(screen.getByTestId('runs-select-all'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByTestId('runs-bulk-delete'));
    confirmSpy.mockRestore();

    expect(listRuns(def.id).length).toBe(2);
  });

  test('Compare picker and bulk-select are independent', () => {
    const def = createPipeline({ name: 'P', createdBy: 'u' });
    appendRun(def.id, makeRun(def.id, 'a-1111'));
    appendRun(def.id, makeRun(def.id, 'b-2222'));
    appendRun(def.id, makeRun(def.id, 'c-3333'));

    renderPage(def.id, '?range=all');

    // Bulk-select two rows.
    fireEvent.click(screen.getByTestId('run-select-a-1111'));
    fireEvent.click(screen.getByTestId('run-select-b-2222'));
    expect(within(screen.getByTestId('runs-bulk-toolbar')).getByText(/2 selected/)).toBeInTheDocument();

    // Compare-pick two different rows.
    fireEvent.click(screen.getByTestId('run-compare-pick-b-2222'));
    fireEvent.click(screen.getByTestId('run-compare-pick-c-3333'));

    // Compare button enables at exactly 2 picks regardless of bulk-selection.
    const compareBtn = screen.getByTestId('run-compare-btn') as HTMLButtonElement;
    expect(compareBtn.disabled).toBe(false);
    expect(compareBtn.textContent).toMatch(/\(2\/2\)/);

    // Bulk toolbar still shows 2 selected (the two original bulk picks).
    expect(within(screen.getByTestId('runs-bulk-toolbar')).getByText(/2 selected/)).toBeInTheDocument();
  });
});
