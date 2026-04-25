// frontend/src/hooks/__tests__/useReactions.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the useReactions hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConnectionState, GatewayMessage } from '../../types/gateway';

// ---------------------------------------------------------------------------
// Test helpers — simulate the sendMessage / onMessage contract from useWebSocket
// ---------------------------------------------------------------------------

type MessageHandler = (msg: GatewayMessage) => void;

function makeReactionsOptions(overrides: {
  connectionState?: ConnectionState;
  currentChannel?: string;
  sendMessageMock?: ReturnType<typeof vi.fn>;
} = {}) {
  const sendMessage = (overrides.sendMessageMock ?? vi.fn()) as unknown as ((msg: Record<string, unknown>) => void) & ReturnType<typeof vi.fn>;
  const handlers: MessageHandler[] = [];

  const onMessage = (handler: MessageHandler) => {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  };

  const dispatch = (msg: GatewayMessage) => handlers.forEach((h) => h(msg));

  return {
    sendMessage,
    onMessage,
    dispatch,
    connectionState: overrides.connectionState ?? 'connected' as ConnectionState,
    currentChannel: overrides.currentChannel ?? 'ch-1',
  };
}

// ---------------------------------------------------------------------------
// Import hook
// ---------------------------------------------------------------------------

import { useReactions } from '../useReactions';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReactions', () => {
  describe('1. subscribes when connected', () => {
    it('sends subscribe message when connectionState is connected and channel is set', () => {
      const opts = makeReactionsOptions();
      renderHook(() => useReactions(opts));

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'reaction',
          action: 'subscribe',
          channel: 'ch-1',
        })
      );
    });
  });

  describe('2. does not subscribe when disconnected', () => {
    it('does NOT send subscribe when connectionState is disconnected', () => {
      const opts = makeReactionsOptions({ connectionState: 'disconnected' });
      renderHook(() => useReactions(opts));

      const calls = (opts.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as Record<string, unknown>
      );
      const subscribeCall = calls.find((c) => c.action === 'subscribe');
      expect(subscribeCall).toBeUndefined();
    });
  });

  describe('3. unsubscribes on channel change', () => {
    it('unsubscribes from old channel and subscribes to new channel when channel changes', () => {
      const opts = makeReactionsOptions({ currentChannel: 'ch-1' });
      const sendMessage = opts.sendMessage as ReturnType<typeof vi.fn>;

      const { rerender } = renderHook(
        ({ channel }: { channel: string }) =>
          useReactions({ ...opts, currentChannel: channel }),
        { initialProps: { channel: 'ch-1' } }
      );

      sendMessage.mockClear();

      rerender({ channel: 'ch-2' });

      const calls = sendMessage.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
      const unsubscribe = calls.find(
        (c) => c.action === 'unsubscribe' && c.channel === 'ch-1'
      );
      const subscribe = calls.find(
        (c) => c.action === 'subscribe' && c.channel === 'ch-2'
      );

      expect(unsubscribe).toBeDefined();
      expect(subscribe).toBeDefined();
    });
  });

  describe('4. unsubscribes on unmount', () => {
    it('sends unsubscribe when hook unmounts', () => {
      const opts = makeReactionsOptions();
      const { unmount } = renderHook(() => useReactions(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      unmount();

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'reaction',
          action: 'unsubscribe',
          channel: 'ch-1',
        })
      );
    });
  });

  describe('5. react() sends gateway message', () => {
    it('sends react message with emoji when react() is called', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.react('👍');
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'reaction',
          action: 'send',
          channel: 'ch-1',
          emoji: '👍',
        })
      );
    });
  });

  describe('6. incoming reactions:reaction adds to activeReactions', () => {
    it('adds an EphemeralReaction to activeReactions on reactions:reaction message', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      act(() => {
        opts.dispatch({
          type: 'reaction',
          action: 'reaction_received',
          data: {
            channel: 'ch-1',
            clientId: 'c1',
            emoji: '🎉',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        });
      });

      expect(result.current.activeReactions).toHaveLength(1);
      const reaction = result.current.activeReactions[0];
      expect(reaction.emoji).toBe('🎉');
      expect(reaction.x).toBeGreaterThanOrEqual(10);
      expect(reaction.x).toBeLessThanOrEqual(90);
      expect(reaction.y).toBeGreaterThanOrEqual(10);
      expect(reaction.y).toBeLessThanOrEqual(90);
      expect(typeof reaction.id).toBe('string');
      expect(reaction.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('7. reactions:reaction for different channel is ignored', () => {
    it('ignores reactions from a different channel', () => {
      const opts = makeReactionsOptions({ currentChannel: 'ch-1' });
      const { result } = renderHook(() => useReactions(opts));

      act(() => {
        opts.dispatch({
          type: 'reaction',
          action: 'reaction_received',
          data: {
            channel: 'other',
            clientId: 'c2',
            emoji: '😂',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        });
      });

      expect(result.current.activeReactions).toHaveLength(0);
    });
  });

  describe('8. reactions auto-remove after 2500ms', () => {
    it('removes a reaction from activeReactions after 2500ms', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      act(() => {
        opts.dispatch({
          type: 'reaction',
          action: 'reaction_received',
          data: {
            channel: 'ch-1',
            clientId: 'c1',
            emoji: '🔥',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        });
      });

      expect(result.current.activeReactions).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      expect(result.current.activeReactions).toHaveLength(0);
    });
  });

  describe('9. multiple reactions accumulate then each removes independently', () => {
    it('handles multiple reactions with independent timers', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      // Reaction A at t=0
      act(() => {
        opts.dispatch({
          type: 'reaction',
          action: 'reaction_received',
          data: {
            channel: 'ch-1',
            clientId: 'c1',
            emoji: '👍',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        });
      });

      expect(result.current.activeReactions).toHaveLength(1);

      // Reaction B at t=1000
      act(() => {
        vi.advanceTimersByTime(1000);
        opts.dispatch({
          type: 'reaction',
          action: 'reaction_received',
          data: {
            channel: 'ch-1',
            clientId: 'c2',
            emoji: '❤️',
            timestamp: '2026-01-01T00:00:01.000Z',
          },
        });
      });

      expect(result.current.activeReactions).toHaveLength(2);

      // At t=2500 reaction A's timer fires (1500ms after B was dispatched)
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.activeReactions).toHaveLength(1);
      expect(result.current.activeReactions[0].emoji).toBe('❤️');

      // At t=3500 reaction B's timer fires
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.activeReactions).toHaveLength(0);
    });
  });

  describe('10. return shape', () => {
    it('returns activeReactions array and react function', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      expect(Array.isArray(result.current.activeReactions)).toBe(true);
      expect(typeof result.current.react).toBe('function');
    });

    it('starts with empty activeReactions array', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      expect(result.current.activeReactions).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('does not crash when reactions:subscribed is received', () => {
      const opts = makeReactionsOptions();
      const { result } = renderHook(() => useReactions(opts));

      expect(() => {
        act(() => {
          opts.dispatch({
            type: 'reaction',
            action: 'reaction_subscribed',
            data: { channel: 'ch-1' },
          });
        });
      }).not.toThrow();

      expect(result.current.activeReactions).toHaveLength(0);
    });

    it('react() when disconnected still calls sendMessage (no-op handled by useWebSocket)', () => {
      const opts = makeReactionsOptions({ connectionState: 'disconnected' });
      const { result } = renderHook(() => useReactions(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.react('👏');
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'reaction',
          action: 'send',
          emoji: '👏',
        })
      );
    });
  });
});
