// frontend/src/components/pipelines/__tests__/executionLogPolish.test.tsx
//
// Coverage for the §18.4.6 ExecutionLog polish features added on top of the
// base bottom strip:
//   - `⛶` button toggles a portal-rendered fullscreen overlay (testid
//     `exec-log-fullscreen`).
//   - Close button + Escape both exit fullscreen.
//   - `filterByNodeId` prop limits visible rows to events where
//     `payload.stepId === id` or `payload.nodeId === id`.
//   - The filter chip × button calls `onClearFilter`.

import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  EventStreamProvider,
  useEventStreamContext,
  type EventStreamValue,
} from '../context/EventStreamContext';
import ExecutionLog from '../canvas/ExecutionLog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Captures the EventStream value into a ref so tests can `dispatch` directly
 * from outside the provider tree without needing `renderHook`.
 */
function StreamCapture({
  onReady,
}: {
  onReady: (value: EventStreamValue) => void;
}) {
  const value = useEventStreamContext();
  React.useEffect(() => {
    onReady(value);
  }, [value, onReady]);
  return null;
}

interface HarnessProps {
  filterByNodeId?: string | null;
  filterNodeLabel?: string | null;
  onClearFilter?: () => void;
  onStream: (value: EventStreamValue) => void;
}

function Harness({
  filterByNodeId = null,
  filterNodeLabel = null,
  onClearFilter,
  onStream,
}: HarnessProps) {
  return (
    <EventStreamProvider source="mock">
      <StreamCapture onReady={onStream} />
      <ExecutionLog
        filterByNodeId={filterByNodeId}
        filterNodeLabel={filterNodeLabel}
        onClearFilter={onClearFilter}
      />
    </EventStreamProvider>
  );
}

function dispatchSampleEvents(stream: EventStreamValue) {
  act(() => {
    stream.dispatch('pipeline.run.started', {
      runId: 'run-1',
      pipelineId: 'pipe-1',
      triggeredBy: { triggerType: 'manual', payload: {} },
      at: '2026-04-23T00:00:00.000Z',
    });
    stream.dispatch('pipeline.step.started', {
      runId: 'run-1',
      stepId: 'step-A',
      nodeType: 'transform',
      at: '2026-04-23T00:00:00.100Z',
    });
    stream.dispatch('pipeline.step.started', {
      runId: 'run-1',
      stepId: 'step-B',
      nodeType: 'llm',
      at: '2026-04-23T00:00:00.200Z',
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionLog polish (§18.4.6)', () => {
  test('⛶ button toggles a portal-rendered fullscreen overlay', () => {
    let stream: EventStreamValue | null = null;
    render(<Harness onStream={(v) => (stream = v)} />);
    expect(stream).toBeTruthy();

    // Initially no fullscreen overlay.
    expect(screen.queryByTestId('exec-log-fullscreen')).toBeNull();

    // Click the fullscreen toggle.
    const btn = screen.getByTestId('execution-log-fullscreen-btn');
    fireEvent.click(btn);

    // Overlay rendered via portal — query the document body.
    const overlay = screen.getByTestId('exec-log-fullscreen');
    expect(overlay).toBeTruthy();
    // The portal mounts on document.body, not inside the harness root.
    expect(overlay.parentElement).toBe(document.body);
  });

  test('close button in fullscreen exits fullscreen', () => {
    render(<Harness onStream={() => {}} />);

    fireEvent.click(screen.getByTestId('execution-log-fullscreen-btn'));
    expect(screen.getByTestId('exec-log-fullscreen')).toBeTruthy();

    fireEvent.click(screen.getByTestId('execution-log-fullscreen-close'));
    expect(screen.queryByTestId('exec-log-fullscreen')).toBeNull();
  });

  test('Escape key in fullscreen exits fullscreen', () => {
    render(<Harness onStream={() => {}} />);

    fireEvent.click(screen.getByTestId('execution-log-fullscreen-btn'));
    expect(screen.getByTestId('exec-log-fullscreen')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('exec-log-fullscreen')).toBeNull();
  });

  test('filterByNodeId limits visible events to matching rows', () => {
    let stream: EventStreamValue | null = null;
    const { rerender } = render(
      <Harness onStream={(v) => (stream = v)} />,
    );
    expect(stream).toBeTruthy();
    dispatchSampleEvents(stream as unknown as EventStreamValue);

    // Open the log so rows are rendered, then filter to step-A.
    fireEvent.click(screen.getByLabelText('Expand log'));
    rerender(
      <Harness
        filterByNodeId="step-A"
        filterNodeLabel="Transform"
        onStream={(v) => (stream = v)}
      />,
    );
    // Re-open after rerender (state preserved by React, but to be safe).
    const expandBtn = screen.queryByLabelText('Expand log');
    if (expandBtn) fireEvent.click(expandBtn);

    // Filter chip is visible with the resolved label.
    const chip = screen.getByTestId('execution-log-filter-chip');
    expect(chip.textContent).toContain('Transform');

    // Step-B's row should be filtered out, step-A's should remain.
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('pipeline.step.started');
    // Confirm step-B is not in any visible row text. The summary includes
    // the stepId (`step-B`), so its absence proves the filter is active.
    const visibleRows = document.querySelectorAll(
      '[data-testid^="execution-log-row-"]',
    );
    const visibleText = Array.from(visibleRows)
      .map((el) => el.textContent ?? '')
      .join('\n');
    expect(visibleText).toContain('step-A');
    expect(visibleText).not.toContain('step-B');
  });

  test('filter chip × calls onClearFilter', () => {
    const onClearFilter = vi.fn();
    render(
      <Harness
        filterByNodeId="step-A"
        filterNodeLabel="Transform"
        onClearFilter={onClearFilter}
        onStream={() => {}}
      />,
    );
    // Expand so the chip row is visible.
    fireEvent.click(screen.getByLabelText('Expand log'));
    const close = screen.getByTestId('execution-log-filter-chip-clear');
    fireEvent.click(close);
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });
});
