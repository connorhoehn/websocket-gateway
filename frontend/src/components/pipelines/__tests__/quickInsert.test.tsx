// frontend/src/components/pipelines/__tests__/quickInsert.test.tsx
//
// Unit coverage for `QuickInsertPopover` — the double-click-on-canvas
// palette per PIPELINES_PLAN.md §18.4.3 / §18.11. We render it standalone
// (no React Flow host) so we can drive it entirely through keyboard /
// typed-text interactions and assert on the onInsert / onClose callbacks.
//
// Framework: Vitest + @testing-library/react.

import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QuickInsertPopover from '../canvas/QuickInsertPopover';

const ANCHOR = { x: 120, y: 200 };
const FLOW_POS = { x: 48, y: 96 };

function renderPopover(overrides: Partial<React.ComponentProps<typeof QuickInsertPopover>> = {}) {
  const onClose = vi.fn();
  const onInsert = vi.fn();
  const utils = render(
    <QuickInsertPopover
      anchor={ANCHOR}
      flowPosition={FLOW_POS}
      onClose={onClose}
      onInsert={onInsert}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onInsert };
}

describe('QuickInsertPopover', () => {
  test('renders at the given anchor and lists all node types', () => {
    renderPopover();
    const popover = screen.getByTestId('quick-insert-popover');
    expect(popover).toBeTruthy();
    // 8 node types from the plan's palette.
    expect(screen.getByTestId('quick-insert-row-trigger')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-llm')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-transform')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-condition')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-fork')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-join')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-action')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-approval')).toBeTruthy();
  });

  test('hides disabled types', () => {
    renderPopover({ disabledTypes: ['trigger'] });
    expect(screen.queryByTestId('quick-insert-row-trigger')).toBeNull();
    // Other rows still present.
    expect(screen.getByTestId('quick-insert-row-llm')).toBeTruthy();
  });

  test('typing in the search input filters the list', () => {
    renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'llm' } });
    // Only LLM row should remain.
    expect(screen.getByTestId('quick-insert-row-llm')).toBeTruthy();
    expect(screen.queryByTestId('quick-insert-row-trigger')).toBeNull();
    expect(screen.queryByTestId('quick-insert-row-transform')).toBeNull();
  });

  test('filter also matches description text', () => {
    renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    // "branch" appears in the Condition + Fork + Join descriptions.
    fireEvent.change(input, { target: { value: 'branch' } });
    expect(screen.getByTestId('quick-insert-row-condition')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-fork')).toBeTruthy();
    expect(screen.getByTestId('quick-insert-row-join')).toBeTruthy();
    // These have no "branch" in their copy.
    expect(screen.queryByTestId('quick-insert-row-trigger')).toBeNull();
    expect(screen.queryByTestId('quick-insert-row-llm')).toBeNull();
  });

  test('ArrowDown + Enter inserts the second item at flowPosition', () => {
    const { onInsert, onClose } = renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    // Top-of-list is 'trigger'; ArrowDown moves highlight to 'llm'.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('llm', FLOW_POS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Enter on first-render inserts the top match', () => {
    const { onInsert } = renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInsert).toHaveBeenCalledWith('trigger', FLOW_POS);
  });

  test('ArrowUp wraps around to the last item', () => {
    const { onInsert } = renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Last row in the catalog is 'approval'.
    expect(onInsert).toHaveBeenCalledWith('approval', FLOW_POS);
  });

  test('Escape closes without inserting', () => {
    const { onInsert, onClose } = renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
  });

  test('click outside closes the popover', () => {
    const { onClose } = renderPopover();
    // mousedown on window (outside the popover) should close.
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('clicking a row commits that row', () => {
    const { onInsert, onClose } = renderPopover();
    fireEvent.mouseDown(screen.getByTestId('quick-insert-row-action'));
    expect(onInsert).toHaveBeenCalledWith('action', FLOW_POS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders nothing when anchor is null', () => {
    const { container } = render(
      <QuickInsertPopover
        anchor={null}
        flowPosition={null}
        onClose={() => {}}
        onInsert={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="quick-insert-popover"]')).toBeNull();
  });

  test('empty state shows when filter matches nothing', () => {
    renderPopover();
    const input = screen.getByTestId('quick-insert-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzzzz' } });
    expect(screen.getByText(/No nodes match/)).toBeTruthy();
    // Enter in the empty state is a no-op.
  });
});
