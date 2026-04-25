// frontend/src/components/observability/__tests__/ActiveRunsTable.test.tsx
//
// Coverage for the dashboard's active-runs drill-down behavior:
//   • mouse click → invokes onRowClick with the row
//   • Enter key  → same
//   • Space key  → same
//   • cancel button click does NOT bubble to onRowClick
//   • aria-label is present on each clickable row

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ActiveRunsTable, {
  type ActiveRunRow,
} from '../components/ActiveRunsTable';

const sampleRun: ActiveRunRow = {
  pipelineId: 'pipe-1',
  pipelineName: 'Nightly ETL',
  runId: 'run-abc-123',
  currentStep: 'transform',
  ownerNode: 'node-2',
  elapsed: '00:42',
  status: 'running',
};

describe('ActiveRunsTable drill-down', () => {
  test('clicking a row invokes onRowClick with the run', () => {
    const onRowClick = vi.fn();
    render(<ActiveRunsTable runs={[sampleRun]} onRowClick={onRowClick} />);

    const row = screen.getByTestId('active-run-row');
    fireEvent.click(row);

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(sampleRun);
  });

  test('pressing Enter on a focused row invokes onRowClick', () => {
    const onRowClick = vi.fn();
    render(<ActiveRunsTable runs={[sampleRun]} onRowClick={onRowClick} />);

    const row = screen.getByTestId('active-run-row');
    fireEvent.keyDown(row, { key: 'Enter' });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(sampleRun);
  });

  test('pressing Space on a focused row invokes onRowClick', () => {
    const onRowClick = vi.fn();
    render(<ActiveRunsTable runs={[sampleRun]} onRowClick={onRowClick} />);

    const row = screen.getByTestId('active-run-row');
    fireEvent.keyDown(row, { key: ' ' });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(sampleRun);
  });

  test('clicking the cancel button does NOT trigger row navigation', () => {
    const onRowClick = vi.fn();
    const onCancelRun = vi.fn();
    render(
      <ActiveRunsTable
        runs={[sampleRun]}
        onRowClick={onRowClick}
        onCancelRun={onCancelRun}
      />,
    );

    const row = screen.getByTestId('active-run-row');
    const cancelBtn = within(row).getByTestId('active-run-cancel');
    fireEvent.click(cancelBtn);

    expect(onCancelRun).toHaveBeenCalledTimes(1);
    expect(onCancelRun).toHaveBeenCalledWith(sampleRun);
    // Critical: stopPropagation prevents the row click handler from firing.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test('row exposes a descriptive aria-label and is keyboard-focusable', () => {
    const onRowClick = vi.fn();
    render(<ActiveRunsTable runs={[sampleRun]} onRowClick={onRowClick} />);

    const row = screen.getByTestId('active-run-row');
    expect(row).toHaveAttribute(
      'aria-label',
      'Open run run-abc-123 of pipeline Nightly ETL',
    );
    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
  });
});
