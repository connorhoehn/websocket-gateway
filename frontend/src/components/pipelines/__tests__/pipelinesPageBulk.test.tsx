// frontend/src/components/pipelines/__tests__/pipelinesPageBulk.test.tsx
//
// Multi-select + bulk actions on PipelinesPage:
//   - Entering selection mode reveals checkboxes on every card
//   - Selecting N cards shows the bulk action bar with "N selected"
//   - Delete → confirm modal → confirm removes N pipelines from storage
//   - Export all invokes URL.createObjectURL N times (built a blob per pipeline)
//   - Add tag writes the tag to every selected pipeline's def.tags
//   - Remove tag chip click drops the tag from every selected pipeline
//
// Framework: Vitest (jest-compatible API). See `frontend/vite.config.ts`.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context mocks — keep the test isolated from the real identity / websocket
// providers. Must run before the SUT import below.
// ---------------------------------------------------------------------------

vi.mock('../../../contexts/IdentityContext', () => ({
  useIdentityContext: () => ({
    userId: 'test-user',
    displayName: 'Test User',
    userEmail: 'test@example.com',
    idToken: 'test-token',
    onSignOut: () => {},
  }),
  IdentityProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../contexts/PresenceContext', () => ({
  usePresenceContext: () => ({
    presenceUsers: [],
    currentClientId: 'test-user',
    setTyping: () => {},
  }),
  PresenceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connectionState: 'connected',
    sendMessage: () => {},
    onMessage: () => () => {},
    ws: null,
    clientId: 'test-user',
    sessionToken: 'test-session',
  }),
  WebSocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import PipelinesPage from '../PipelinesPage';
import { ToastProvider } from '../../shared/ToastProvider';
import {
  createPipeline,
  listPipelines,
  loadPipeline,
} from '../persistence/pipelineStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PipelinesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function seedThreePipelines(): string[] {
  const a = createPipeline({ name: 'Alpha Pipeline', createdBy: 'test-user', icon: '🔀' });
  const b = createPipeline({ name: 'Beta Pipeline',  createdBy: 'test-user', icon: '🔀' });
  const c = createPipeline({ name: 'Gamma Pipeline', createdBy: 'test-user', icon: '🔀' });
  return [a.id, b.id, c.id];
}

function clearStorage() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
      localStorage.removeItem(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelinesPage — multi-select + bulk actions', () => {
  beforeEach(() => {
    clearStorage();
  });

  afterEach(() => {
    clearStorage();
    vi.restoreAllMocks();
  });

  test('clicking Select toggles selection mode and reveals checkboxes', () => {
    const [idA, idB, idC] = seedThreePipelines();
    renderPage();

    // All three cards rendered.
    expect(screen.getByTestId(`pipeline-card-${idA}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-card-${idB}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-card-${idC}`)).toBeInTheDocument();

    // Before entering selection mode there may be no checkboxes visible
    // (they only appear on hover / when selected). Verify at least one is
    // present after the toggle.
    fireEvent.click(screen.getByTestId('select-toggle-btn'));

    expect(screen.getByTestId(`pipeline-select-${idA}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-select-${idB}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-select-${idC}`)).toBeInTheDocument();
  });

  test('selecting two cards shows the bulk action bar with "2 selected"', () => {
    const [idA, idB] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));

    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');
  });

  test('bulk delete removes exactly the selected pipelines', () => {
    const [idA, idB, idC] = seedThreePipelines();
    renderPage();

    expect(listPipelines()).toHaveLength(3);

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));

    fireEvent.click(screen.getByTestId('bulk-delete'));
    // Modal opens with confirm button.
    fireEvent.click(screen.getByTestId('bulk-delete-confirm'));

    const remaining = listPipelines().map(e => e.id);
    expect(remaining).toHaveLength(1);
    expect(remaining).toContain(idC);
    expect(remaining).not.toContain(idA);
    expect(remaining).not.toContain(idB);

    // Selected cards are gone from the grid; the third remains.
    expect(screen.queryByTestId(`pipeline-card-${idA}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`pipeline-card-${idB}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-card-${idC}`)).toBeInTheDocument();
  });

  test('Clear button empties the selection without deleting', () => {
    const [idA, idB] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');

    fireEvent.click(screen.getByTestId('bulk-clear'));
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    expect(listPipelines()).toHaveLength(3);
  });

  test('Export all builds a blob per selected pipeline', () => {
    vi.useFakeTimers();
    const createSpy = vi.fn(() => 'blob:mock-url');
    const revokeSpy = vi.fn();
    // jsdom has no URL.createObjectURL — install mocks on the global URL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createSpy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeSpy;

    const [idA, idB] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));

    fireEvent.click(screen.getByTestId('bulk-export'));

    // Staggered 100ms apart: advance enough to fire both downloads.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test('Add tag writes the tag to every selected pipeline (dedupe)', () => {
    const [idA, idB, idC] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));

    fireEvent.click(screen.getByTestId('bulk-add-tag-btn'));
    const input = screen.getByTestId('bulk-add-tag-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'finance' } });
    fireEvent.click(screen.getByTestId('bulk-add-tag-submit'));

    expect(loadPipeline(idA)?.tags).toContain('finance');
    expect(loadPipeline(idB)?.tags).toContain('finance');
    // Unselected pipeline is untouched.
    expect(loadPipeline(idC)?.tags ?? []).not.toContain('finance');

    // Dedupe: repeating the same tag shouldn't duplicate it on any pipeline.
    fireEvent.click(screen.getByTestId('bulk-add-tag-btn'));
    const input2 = screen.getByTestId('bulk-add-tag-input') as HTMLInputElement;
    fireEvent.change(input2, { target: { value: 'finance' } });
    fireEvent.click(screen.getByTestId('bulk-add-tag-submit'));

    expect(loadPipeline(idA)?.tags?.filter(t => t === 'finance')).toHaveLength(1);
    expect(loadPipeline(idB)?.tags?.filter(t => t === 'finance')).toHaveLength(1);
  });

  test('Remove tag round-trip: chip click drops the tag from all selected', () => {
    const [idA, idB] = seedThreePipelines();
    renderPage();

    // Select + add the tag first (via the bulk path).
    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idB}`));

    fireEvent.click(screen.getByTestId('bulk-add-tag-btn'));
    const input = screen.getByTestId('bulk-add-tag-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.click(screen.getByTestId('bulk-add-tag-submit'));

    // Both have the tag.
    expect(loadPipeline(idA)?.tags).toContain('urgent');
    expect(loadPipeline(idB)?.tags).toContain('urgent');

    // Open the Remove tag popover and click the chip.
    fireEvent.click(screen.getByTestId('bulk-remove-tag-btn'));
    fireEvent.click(screen.getByTestId('bulk-remove-tag-chip-urgent'));

    expect(loadPipeline(idA)?.tags ?? []).not.toContain('urgent');
    expect(loadPipeline(idB)?.tags ?? []).not.toContain('urgent');
  });

  test('Escape clears selection and exits selection mode', () => {
    const [idA] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  test('Cmd+A selects all filtered cards when selection mode is on', () => {
    seedThreePipelines();
    renderPage();

    // Without selection mode Cmd+A should be a no-op.
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();

    // Turn on selection mode, then Cmd+A selects everything.
    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('3 selected');
  });

  test('Delete key opens the bulk delete modal when selected.size > 0', () => {
    const [idA] = seedThreePipelines();
    renderPage();

    fireEvent.click(screen.getByTestId('select-toggle-btn'));
    fireEvent.click(screen.getByTestId(`pipeline-select-${idA}`));

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.getByTestId('bulk-delete-confirm')).toBeInTheDocument();
  });
});
