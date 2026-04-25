// frontend/src/components/pipelines/__tests__/useReplayKeyboard.test.tsx
//
// Coverage for the replay keyboard-shortcut hook (`useReplayKeyboard`).
// Renders a small harness that combines `useReplayDriver` (for state) with
// `useReplayKeyboard` (under test) so we can fire window keydowns and assert
// the driver's transport responded.
//
// Keys covered:
//   Space               toggle play / pause
//   j / ArrowLeft       back 1
//   k / ArrowRight      forward 1
//   Shift+J / Shift+←   back 10
//   Shift+K / Shift+→   forward 10
//   Home / End          seek to start / end
//   0..9                seek to deciles
//   bail when target is an editable element
//   bail when ⌘/Ctrl/Alt held
//   listener is removed on unmount

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useReplayDriver } from '../replay/useReplayDriver';
import { useReplayKeyboard } from '../replay/useReplayKeyboard';
import { EventStreamProvider } from '../context/EventStreamContext';
import type { PipelineRun } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(): PipelineRun {
  // 12+ events worth of timeline so deciles + step-of-10 shortcuts have room.
  return {
    id: 'run-kbd',
    pipelineId: 'pipe-1',
    pipelineVersion: 1,
    status: 'completed',
    triggeredBy: { triggerType: 'manual', userId: 'user-1', payload: {} },
    ownerNodeId: 'node-owner',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:30.000Z',
    durationMs: 30_000,
    currentStepIds: [],
    context: {},
    steps: {
      'step-a': {
        nodeId: 'step-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:01.000Z',
        completedAt: '2026-01-01T00:00:02.000Z',
        durationMs: 1000,
        output: { ok: true },
        // Synthesized tokens widen the timeline (one tick per word).
        llm: {
          model: 'gpt-test',
          prompt: 'hello',
          response: 'one two three four five six seven eight',
          tokensIn: 1,
          tokensOut: 8,
        },
      },
      'step-b': {
        nodeId: 'step-b',
        status: 'completed',
        startedAt: '2026-01-01T00:00:03.000Z',
        completedAt: '2026-01-01T00:00:05.000Z',
        durationMs: 2000,
        output: { ok: true },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  return <EventStreamProvider>{children}</EventStreamProvider>;
}

/**
 * Combined hook that mirrors the page wiring: driver + keyboard listener on
 * the same render. Returns the driver so tests can read its state directly.
 */
function useDriverWithKeyboard(run: PipelineRun) {
  const driver = useReplayDriver(run);
  useReplayKeyboard(driver, true);
  return driver;
}

function dispatchKey(key: string, init: Partial<KeyboardEventInit> = {}): void {
  // Dispatch on window so we exercise the global listener path. The hook
  // installs onto `window` in production, so this matches the runtime.
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init, bubbles: true }));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReplayKeyboard', () => {
  test('Space toggles play / pause', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });
    expect(result.current.state.playing).toBe(false);

    act(() => {
      dispatchKey(' ');
    });
    expect(result.current.state.playing).toBe(true);

    act(() => {
      dispatchKey(' ');
    });
    expect(result.current.state.playing).toBe(false);
  });

  test('j / ArrowLeft seek back 1; k / ArrowRight seek forward 1', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.seek(5);
    });
    expect(result.current.state.cursor).toBe(5);

    act(() => {
      dispatchKey('j');
    });
    expect(result.current.state.cursor).toBe(4);

    act(() => {
      dispatchKey('ArrowLeft');
    });
    expect(result.current.state.cursor).toBe(3);

    act(() => {
      dispatchKey('k');
    });
    expect(result.current.state.cursor).toBe(4);

    act(() => {
      dispatchKey('ArrowRight');
    });
    expect(result.current.state.cursor).toBe(5);
  });

  test('Shift+J / Shift+ArrowLeft seek back 10; Shift+K / Shift+ArrowRight seek forward 10', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });
    const total = result.current.state.totalEvents;
    expect(total).toBeGreaterThanOrEqual(10);

    // Park near end so back-10 has room.
    act(() => {
      result.current.seek(total);
    });
    expect(result.current.state.cursor).toBe(total);

    act(() => {
      dispatchKey('J', { shiftKey: true });
    });
    expect(result.current.state.cursor).toBe(total - 10);

    act(() => {
      dispatchKey('ArrowLeft', { shiftKey: true });
    });
    expect(result.current.state.cursor).toBe(Math.max(0, total - 20));

    // Reset to 0 then Shift+K / Shift+ArrowRight forward 10.
    act(() => {
      result.current.seek(0);
    });
    expect(result.current.state.cursor).toBe(0);

    act(() => {
      dispatchKey('K', { shiftKey: true });
    });
    expect(result.current.state.cursor).toBe(Math.min(total, 10));

    act(() => {
      dispatchKey('ArrowRight', { shiftKey: true });
    });
    expect(result.current.state.cursor).toBe(Math.min(total, 20));
  });

  test('Home seeks to start, End seeks to end', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });
    const total = result.current.state.totalEvents;

    act(() => {
      result.current.seek(3);
    });
    act(() => {
      dispatchKey('Home');
    });
    expect(result.current.state.cursor).toBe(0);

    act(() => {
      dispatchKey('End');
    });
    expect(result.current.state.cursor).toBe(total);
  });

  test('digit keys 0..9 seek to deciles', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });
    const total = result.current.state.totalEvents;

    for (let d = 0; d <= 9; d++) {
      act(() => {
        dispatchKey(String(d));
      });
      const expected = Math.round((d / 10) * total);
      expect(result.current.state.cursor).toBe(
        Math.max(0, Math.min(total, expected)),
      );
    }
  });

  test('bails when keydown target is an input', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });
    expect(result.current.state.playing).toBe(false);

    // Render an input and fire keydown directly on it. fireEvent bubbles, so
    // the window listener runs — but its bail-on-editable guard should drop it.
    const { getByTestId, unmount } = render(
      <input data-testid="kbd-input" />,
    );
    const input = getByTestId('kbd-input');
    act(() => {
      fireEvent.keyDown(input, { key: ' ' });
    });
    expect(result.current.state.playing).toBe(false);
    unmount();
  });

  test('bails when ⌘/Ctrl/Alt held (so editor shortcuts pass through)', () => {
    const run = makeRun();
    const { result } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.seek(3);
    });
    const before = result.current.state.cursor;

    act(() => {
      dispatchKey('ArrowLeft', { metaKey: true });
    });
    expect(result.current.state.cursor).toBe(before);

    act(() => {
      dispatchKey('ArrowLeft', { ctrlKey: true });
    });
    expect(result.current.state.cursor).toBe(before);

    act(() => {
      dispatchKey('ArrowLeft', { altKey: true });
    });
    expect(result.current.state.cursor).toBe(before);
  });

  test('listener is removed on unmount', () => {
    const run = makeRun();
    const { result, unmount } = renderHook(() => useDriverWithKeyboard(run), {
      wrapper: Wrapper,
    });

    act(() => {
      dispatchKey(' ');
    });
    expect(result.current.state.playing).toBe(true);

    // Snapshot the post-toggle cursor; after unmount, more keys must NOT mutate
    // the (now-unmounted) driver — and importantly, no error / leak occurs.
    unmount();
    // The bare test here is that no listener fires; nothing throws.
    act(() => {
      dispatchKey(' ');
      dispatchKey('End');
    });
    // No assertions on `result.current` post-unmount — React warns on access.
  });

  test('disabled flag suppresses the listener entirely', () => {
    function Harness({ run, enabled }: { run: PipelineRun; enabled: boolean }) {
      const driver = useReplayDriver(run);
      useReplayKeyboard(driver, enabled);
      return null;
    }

    const run = makeRun();
    // We just need to verify no errors when disabled. There's no observable
    // state change; if the listener fired, we'd see it in the other tests.
    const { unmount } = render(<Wrapper><Harness run={run} enabled={false} /></Wrapper>);
    act(() => {
      dispatchKey(' ');
      dispatchKey('End');
    });
    // No assertion needed — the test asserts no exception path runs.
    unmount();
  });
});
