// frontend/src/hooks/__tests__/usePresence.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the usePresence hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConnectionState, GatewayMessage } from '../../types/gateway';

// ---------------------------------------------------------------------------
// Test helpers — simulate the sendMessage / onMessage contract from useWebSocket
// ---------------------------------------------------------------------------

type MessageHandler = (msg: GatewayMessage) => void;

function makePresenceOptions(overrides: {
  connectionState?: ConnectionState;
  currentChannel?: string;
  sendMessageMock?: ReturnType<typeof vi.fn>;
} = {}) {
  const sendMessage = overrides.sendMessageMock ?? vi.fn();
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
    currentChannel: overrides.currentChannel ?? 'general',
  };
}

// ---------------------------------------------------------------------------
// Import hook (will fail until implementation exists — RED phase)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let usePresence: any;
try {
  // Dynamic import won't work in vitest synchronously; we import at module level
  // but catch the failure gracefully.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ usePresence } = require('../usePresence'));
} catch {
  usePresence = null;
}

beforeEach(() => {
  vi.useFakeTimers();
  if (!usePresence) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ usePresence } = require('../usePresence'));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePresence', () => {
  describe('subscribe on mount', () => {
    it('sends subscribe message when connectionState is connected and channel is set', () => {
      const opts = makePresenceOptions();
      renderHook(() => usePresence(opts));

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'presence',
          action: 'subscribe',
          channel: 'general',
        })
      );
    });

    it('does NOT send subscribe when connectionState is not connected', () => {
      const opts = makePresenceOptions({ connectionState: 'connecting' });
      renderHook(() => usePresence(opts));

      expect(opts.sendMessage).not.toHaveBeenCalled();
    });

    it('does NOT send subscribe when currentChannel is empty', () => {
      const opts = makePresenceOptions({ currentChannel: '' });
      renderHook(() => usePresence(opts));

      expect(opts.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('sends heartbeat every 30 seconds while subscribed', () => {
      const opts = makePresenceOptions();
      renderHook(() => usePresence(opts));

      // Advance 30 seconds — one heartbeat
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'presence',
          action: 'heartbeat',
          channels: ['general'],
        })
      );
    });

    it('sends multiple heartbeats at 30s intervals', () => {
      const opts = makePresenceOptions();
      renderHook(() => usePresence(opts));

      // Advance 90 seconds — three heartbeats
      act(() => {
        vi.advanceTimersByTime(90_000);
      });

      const heartbeats = (opts.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>)?.action === 'heartbeat'
      );
      expect(heartbeats).toHaveLength(3);
    });
  });

  describe('presence:subscribed — initial user list', () => {
    it('initializes user list from subscribed message', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'subscribed',
          channel: 'general',
          users: [
            { clientId: 'client-1', status: 'online', metadata: {} },
            { clientId: 'client-2', status: 'online', metadata: {} },
          ],
        });
      });

      expect(result.current.users).toHaveLength(2);
      expect(result.current.users[0].clientId).toBe('client-1');
    });
  });

  describe('presence:update — upsert user', () => {
    it('adds new user on presence:update', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'update',
          clientId: 'client-new',
          presence: { status: 'online', metadata: {} },
        });
      });

      expect(result.current.users).toHaveLength(1);
      expect(result.current.users[0].clientId).toBe('client-new');
    });

    it('updates existing user on presence:update', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      // Initial user
      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'update',
          clientId: 'client-1',
          presence: { status: 'online', metadata: { isTyping: false } },
        });
      });

      // Update same user
      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'update',
          clientId: 'client-1',
          presence: { status: 'online', metadata: { isTyping: true } },
        });
      });

      expect(result.current.users).toHaveLength(1);
      expect(result.current.users[0].metadata.isTyping).toBe(true);
    });
  });

  describe('presence:offline — remove user', () => {
    it('removes user on presence:offline', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      // Add user first
      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'update',
          clientId: 'client-1',
          presence: { status: 'online', metadata: {} },
        });
      });

      expect(result.current.users).toHaveLength(1);

      // Remove user
      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'offline',
          clientId: 'client-1',
        });
      });

      expect(result.current.users).toHaveLength(0);
    });
  });

  describe('setTyping', () => {
    it('sends typing message when setTyping(true) called', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      // Clear the subscribe call
      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.setTyping(true);
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'presence',
          action: 'set',
          status: 'typing',
          metadata: { isTyping: true },
          channels: ['general'],
        })
      );
    });

    it('sends online message when setTyping(false) called', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.setTyping(false);
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'presence',
          action: 'set',
          status: 'online',
          metadata: { isTyping: false },
          channels: ['general'],
        })
      );
    });
  });

  describe('unsubscribe on unmount', () => {
    it('sends unsubscribe when hook unmounts', () => {
      const opts = makePresenceOptions();
      const { unmount } = renderHook(() => usePresence(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      unmount();

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'presence',
          action: 'unsubscribe',
          channel: 'general',
        })
      );
    });

    it('clears heartbeat interval on unmount', () => {
      const opts = makePresenceOptions();
      const { unmount } = renderHook(() => usePresence(opts));

      unmount();

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      // Advance timers — no heartbeat should fire after unmount
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      const heartbeats = (opts.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>)?.action === 'heartbeat'
      );
      expect(heartbeats).toHaveLength(0);
    });
  });

  describe('channel switch', () => {
    it('unsubscribes from old channel and subscribes to new when channel changes', () => {
      const opts = makePresenceOptions({ currentChannel: 'room-1' });
      const sendMessage = opts.sendMessage as ReturnType<typeof vi.fn>;

      // We need to re-render with a new channel prop to trigger the effect
      const { rerender } = renderHook(
        ({ channel }: { channel: string }) =>
          usePresence({ ...opts, currentChannel: channel }),
        { initialProps: { channel: 'room-1' } }
      );

      sendMessage.mockClear();

      // Switch channel
      rerender({ channel: 'room-2' });

      // Should unsubscribe from room-1 and subscribe to room-2
      const calls = sendMessage.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
      const unsubscribe = calls.find(
        (c) => c.action === 'unsubscribe' && c.channel === 'room-1'
      );
      const subscribe = calls.find(
        (c) => c.action === 'subscribe' && c.channel === 'room-2'
      );

      expect(unsubscribe).toBeDefined();
      expect(subscribe).toBeDefined();
    });

    it('clears user list when channel changes', () => {
      const opts = makePresenceOptions({ currentChannel: 'room-1' });

      const { result, rerender } = renderHook(
        ({ channel }: { channel: string }) =>
          usePresence({ ...opts, currentChannel: channel }),
        { initialProps: { channel: 'room-1' } }
      );

      // Add a user
      act(() => {
        opts.dispatch({
          type: 'presence',
          action: 'update',
          clientId: 'client-1',
          presence: { status: 'online', metadata: {} },
        });
      });

      expect(result.current.users).toHaveLength(1);

      // Switch channel
      rerender({ channel: 'room-2' });

      expect(result.current.users).toHaveLength(0);
    });
  });

  describe('return shape', () => {
    it('returns users array and setTyping function', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      expect(Array.isArray(result.current.users)).toBe(true);
      expect(typeof result.current.setTyping).toBe('function');
    });

    it('starts with empty users array', () => {
      const opts = makePresenceOptions();
      const { result } = renderHook(() => usePresence(opts));

      expect(result.current.users).toHaveLength(0);
    });
  });
});
