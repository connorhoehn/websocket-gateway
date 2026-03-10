// frontend/src/hooks/__tests__/useCursors.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the useCursors hook (freeform mode).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConnectionState, GatewayMessage } from '../../types/gateway';
import { useCursors } from '../useCursors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCursorsOptions(overrides: Partial<Parameters<typeof useCursors>[0]> = {}) {
  const handlers: Array<(msg: GatewayMessage) => void> = [];

  const sendMessage = vi.fn();
  const onMessage = vi.fn((handler: (msg: GatewayMessage) => void) => {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  });

  const fireMessage = (msg: GatewayMessage) => {
    handlers.forEach((h) => h(msg));
  };

  return {
    options: {
      sendMessage,
      onMessage,
      currentChannel: 'general',
      connectionState: 'connected' as ConnectionState,
      clientId: 'local-client-id',
      ...overrides,
    },
    sendMessage,
    onMessage,
    fireMessage,
    handlers,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCursors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -------------------------------------------------------------------------

  describe('subscription', () => {
    it('sends cursor:subscribe when connectionState becomes connected', () => {
      const { options, sendMessage } = makeCursorsOptions();

      renderHook(() => useCursors(options));

      expect(sendMessage).toHaveBeenCalledWith({
        service: 'cursor',
        action: 'subscribe',
        channel: 'general',
        mode: 'freeform',
      });
    });

    it('does NOT send subscribe when connectionState is not connected', () => {
      const { options, sendMessage } = makeCursorsOptions({
        connectionState: 'connecting',
      });

      renderHook(() => useCursors(options));

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('sends cursor:unsubscribe on unmount', () => {
      const { options, sendMessage } = makeCursorsOptions();

      const { unmount } = renderHook(() => useCursors(options));

      // Clear subscribe calls
      sendMessage.mockClear();
      unmount();

      expect(sendMessage).toHaveBeenCalledWith({
        service: 'cursor',
        action: 'unsubscribe',
        channel: 'general',
      });
    });

    it('sends cursor:unsubscribe on channel switch and subscribes to new channel', () => {
      const { options, sendMessage } = makeCursorsOptions();
      let currentChannel = 'general';

      const { rerender } = renderHook(() =>
        useCursors({ ...options, currentChannel })
      );

      sendMessage.mockClear();
      currentChannel = 'sports';
      rerender();

      // Should unsubscribe from old channel
      expect(sendMessage).toHaveBeenCalledWith({
        service: 'cursor',
        action: 'unsubscribe',
        channel: 'general',
      });

      // Should subscribe to new channel
      expect(sendMessage).toHaveBeenCalledWith({
        service: 'cursor',
        action: 'subscribe',
        channel: 'sports',
        mode: 'freeform',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound messages
  // -------------------------------------------------------------------------

  describe('cursor:subscribed message', () => {
    it('initializes cursors map from message.cursors array', () => {
      const { options, fireMessage } = makeCursorsOptions();

      const { result } = renderHook(() => useCursors(options));

      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'subscribed',
          channel: 'general',
          cursors: [
            {
              clientId: 'remote-a',
              position: { x: 100, y: 200 },
              metadata: { mode: 'freeform', userInitials: 'RA' },
            },
            {
              clientId: 'remote-b',
              position: { x: 50, y: 75 },
              metadata: { mode: 'freeform' },
            },
          ],
        });
      });

      expect(result.current.cursors.size).toBe(2);
      expect(result.current.cursors.has('remote-a')).toBe(true);
      expect(result.current.cursors.has('remote-b')).toBe(true);
    });

    it('filters own clientId from initial cursors list', () => {
      const { options, fireMessage } = makeCursorsOptions({
        clientId: 'local-client-id',
      });

      const { result } = renderHook(() => useCursors(options));

      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'subscribed',
          channel: 'general',
          cursors: [
            {
              clientId: 'local-client-id',
              position: { x: 10, y: 20 },
              metadata: { mode: 'freeform' },
            },
            {
              clientId: 'remote-c',
              position: { x: 300, y: 400 },
              metadata: { mode: 'freeform' },
            },
          ],
        });
      });

      expect(result.current.cursors.size).toBe(1);
      expect(result.current.cursors.has('local-client-id')).toBe(false);
      expect(result.current.cursors.has('remote-c')).toBe(true);
    });
  });

  describe('cursor:update message', () => {
    it('upserts a remote cursor in the map', () => {
      const { options, fireMessage } = makeCursorsOptions();

      const { result } = renderHook(() => useCursors(options));

      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'update',
          cursor: {
            clientId: 'remote-d',
            position: { x: 150, y: 250 },
            metadata: { mode: 'freeform', userInitials: 'RD' },
          },
        });
      });

      expect(result.current.cursors.size).toBe(1);
      const cursor = result.current.cursors.get('remote-d');
      expect(cursor?.position).toEqual({ x: 150, y: 250 });
    });

    it('skips own clientId on cursor:update', () => {
      const { options, fireMessage } = makeCursorsOptions({
        clientId: 'local-client-id',
      });

      const { result } = renderHook(() => useCursors(options));

      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'update',
          cursor: {
            clientId: 'local-client-id',
            position: { x: 10, y: 20 },
            metadata: { mode: 'freeform' },
          },
        });
      });

      expect(result.current.cursors.size).toBe(0);
    });
  });

  describe('cursor:remove message', () => {
    it('deletes a remote cursor from the map on cursor:remove', () => {
      const { options, fireMessage } = makeCursorsOptions();

      const { result } = renderHook(() => useCursors(options));

      // Add a cursor first
      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'update',
          cursor: {
            clientId: 'remote-e',
            position: { x: 100, y: 100 },
            metadata: { mode: 'freeform' },
          },
        });
      });

      expect(result.current.cursors.size).toBe(1);

      // Now remove it
      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'remove',
          clientId: 'remote-e',
        });
      });

      expect(result.current.cursors.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // sendFreeformUpdate (throttle)
  // -------------------------------------------------------------------------

  describe('sendFreeformUpdate', () => {
    it('sends cursor:update with position and freeform metadata', () => {
      const { options, sendMessage } = makeCursorsOptions();

      const { result } = renderHook(() => useCursors(options));

      // Clear subscribe call
      sendMessage.mockClear();

      act(() => {
        result.current.sendFreeformUpdate(100, 200);
      });

      expect(sendMessage).toHaveBeenCalledWith({
        service: 'cursor',
        action: 'update',
        channel: 'general',
        position: { x: 100, y: 200 },
        metadata: { mode: 'freeform' },
      });
    });

    it('throttles rapid calls to 50ms', () => {
      const { options, sendMessage } = makeCursorsOptions();

      const { result } = renderHook(() => useCursors(options));
      sendMessage.mockClear();

      act(() => {
        result.current.sendFreeformUpdate(10, 20);
        result.current.sendFreeformUpdate(30, 40); // should be skipped
        result.current.sendFreeformUpdate(50, 60); // should be skipped
      });

      // Only the first call goes through immediately (throttle leading edge)
      expect(sendMessage).toHaveBeenCalledTimes(1);

      // After 50ms, another call should succeed
      act(() => {
        vi.advanceTimersByTime(51);
        result.current.sendFreeformUpdate(70, 80);
      });

      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('does NOT send when connectionState is not connected', () => {
      const { options, sendMessage } = makeCursorsOptions({
        connectionState: 'reconnecting',
      });

      const { result } = renderHook(() => useCursors(options));
      sendMessage.mockClear();

      act(() => {
        result.current.sendFreeformUpdate(100, 200);
      });

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cursor map clears on channel switch
  // -------------------------------------------------------------------------

  describe('channel switch', () => {
    it('clears the cursor map when the channel changes', () => {
      const { options, fireMessage } = makeCursorsOptions();
      let currentChannel = 'general';

      const { result, rerender } = renderHook(() =>
        useCursors({ ...options, currentChannel })
      );

      // Add a cursor
      act(() => {
        fireMessage({
          type: 'cursor',
          action: 'update',
          cursor: {
            clientId: 'remote-f',
            position: { x: 10, y: 10 },
            metadata: { mode: 'freeform' },
          },
        });
      });

      expect(result.current.cursors.size).toBe(1);

      // Switch channel
      act(() => {
        currentChannel = 'sports';
        rerender();
      });

      expect(result.current.cursors.size).toBe(0);
    });
  });
});
