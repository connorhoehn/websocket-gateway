// frontend/src/components/shared/__tests__/Modal.focusTrap.test.tsx
//
// Coverage for the accessibility focus-trap added to the shared <Modal />:
//   - On open, focus moves to the first focusable element inside the modal.
//   - `[data-autofocus]` overrides that default and wins.
//   - Tab from the last focusable cycles back to the first.
//   - Shift+Tab from the first focusable jumps to the last.
//   - Escape closes the modal (existing behavior — guard against regression).
//   - On close, focus is restored to the previously-focused element.
//
// We intentionally exercise the keyboard via `fireEvent.keyDown(window, …)`
// because Modal listens on the window — `userEvent` would route the event
// through the React synthetic system but the Tab handler runs at the global
// `keydown` layer.

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';

import Modal from '../Modal';

function Harness({
  initialOpen = true,
  onClose,
  withAutofocus = false,
}: {
  initialOpen?: boolean;
  onClose?: () => void;
  withAutofocus?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button
        type="button"
        data-testid="external-trigger"
        onClick={() => setOpen(true)}
      >
        Open modal
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Test modal"
      >
        <button type="button" data-testid="first-btn">
          First
        </button>
        <button
          type="button"
          data-testid="middle-btn"
          {...(withAutofocus ? { 'data-autofocus': true } : {})}
        >
          Middle
        </button>
        <button type="button" data-testid="last-btn">
          Last
        </button>
      </Modal>
    </>
  );
}

describe('Modal focus trap', () => {
  test('focuses the first focusable element on open', () => {
    render(<Harness />);
    // Wait for the open effect to commit the focus move.
    expect(screen.getByTestId('first-btn')).toHaveFocus();
  });

  test('honours [data-autofocus] when present', () => {
    render(<Harness withAutofocus />);
    expect(screen.getByTestId('middle-btn')).toHaveFocus();
  });

  test('Tab from the last focusable cycles back to the first', () => {
    render(<Harness />);
    const last = screen.getByTestId('last-btn');
    act(() => {
      last.focus();
    });
    expect(last).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByTestId('first-btn')).toHaveFocus();
  });

  test('Shift+Tab from the first focusable jumps to the last', () => {
    render(<Harness />);
    const first = screen.getByTestId('first-btn');
    act(() => {
      first.focus();
    });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('last-btn')).toHaveFocus();
  });

  test('Escape closes the modal', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('restores focus to the element that was focused before the modal opened', () => {
    // Render the harness with the modal closed first so we can move focus to
    // the external trigger, then open the modal, then close it and assert that
    // focus returns to the trigger.
    const { rerender } = render(<Harness initialOpen={false} />);
    const trigger = screen.getByTestId('external-trigger');
    act(() => {
      trigger.focus();
    });
    expect(trigger).toHaveFocus();

    // Open the modal — focus should move inside the modal.
    fireEvent.click(trigger);
    expect(screen.getByTestId('first-btn')).toHaveFocus();

    // Close the modal via Escape — focus should return to the trigger.
    fireEvent.keyDown(window, { key: 'Escape' });
    // Force a re-render flush; jsdom commits the cleanup in the same tick.
    rerender(<Harness initialOpen={false} />);
    expect(trigger).toHaveFocus();
  });

  test('Tab traps inside the modal even when focus drifts outside the card', () => {
    // Edge case: if focus somehow ends up outside the modal card (e.g. on
    // another element), the next Tab pulls it back to the first focusable.
    render(<Harness />);
    const external = screen.getByTestId('external-trigger');
    act(() => {
      external.focus();
    });
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByTestId('first-btn')).toHaveFocus();
  });
});
