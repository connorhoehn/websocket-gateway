import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleDetector } from '../useIdleDetector';

describe('useIdleDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in the active state (not idle)', () => {
    const { result } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));
    expect(result.current.isIdle).toBe(false);
  });

  it('becomes idle after the configured timeout elapses with no activity', () => {
    const { result } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));
    expect(result.current.isIdle).toBe(false);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(result.current.isIdle).toBe(true);
  });

  it('returns to active on user activity after going idle', () => {
    const { result } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.isIdle).toBe(true);

    act(() => { window.dispatchEvent(new Event('mousemove')); });
    expect(result.current.isIdle).toBe(false);
  });

  it('resets the idle timer on any of the watched events', () => {
    const { result } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));

    // 500 ms before idle → activity resets the clock
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { window.dispatchEvent(new Event('keydown')); });

    // Another 700 ms passes — without the reset, this would have tripped idle;
    // with the reset, we're only 700 ms into a fresh 1000 ms window.
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.isIdle).toBe(false);

    // 400 ms more (total 1100 ms since keydown) → now idle.
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.isIdle).toBe(true);
  });

  it('debounces high-frequency events (mousemove spam) to a single reset', () => {
    const { result } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));

    // Fire 10 mousemove events within the debounce window (500 ms).
    // Only the first should reset the timer; the rest are swallowed.
    for (let i = 0; i < 10; i++) {
      act(() => { window.dispatchEvent(new Event('mousemove')); });
      act(() => { vi.advanceTimersByTime(20); });
    }

    // 800 ms after the first event → still active (timer was reset once).
    expect(result.current.isIdle).toBe(false);

    // Advance past the idle threshold.
    act(() => { vi.advanceTimersByTime(900); });
    expect(result.current.isIdle).toBe(true);
  });

  it('defaults timeoutMs to 2 minutes when no option is passed', () => {
    const { result } = renderHook(() => useIdleDetector());

    // At 119 seconds we're still active
    act(() => { vi.advanceTimersByTime(119_000); });
    expect(result.current.isIdle).toBe(false);

    // Cross 120s → idle
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.isIdle).toBe(true);
  });

  it('cleans up event listeners and timers on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdleDetector({ timeoutMs: 1000 }));

    unmount();

    // 5 events were attached; each gets detached on unmount.
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    for (const event of events) {
      expect(removeSpy).toHaveBeenCalledWith(event, expect.any(Function));
    }
    removeSpy.mockRestore();
  });
});
