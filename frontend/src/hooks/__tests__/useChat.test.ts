// frontend/src/hooks/__tests__/useChat.test.ts
//
// Tests for useChat — aligned with the current chat protocol as implemented
// by `useChat.ts` and `src/services/chat-service.js`.
//
// Protocol summary:
//   Outgoing (client -> gateway):
//     Join:    { service: 'chat', action: 'join',  channel }
//     Leave:   { service: 'chat', action: 'leave', channel }
//     Send:    { service: 'chat', action: 'send',  channel, message, metadata: { displayName } }
//
//   Incoming (gateway -> client):
//     History: { type: 'chat', action: 'history', channel,
//                messages: [{ clientId, message, timestamp, metadata? }, ...] }
//     Message: { type: 'chat', action: 'message', channel,
//                message: { id?, clientId, message, timestamp, channel, metadata? } }
//
// The hook internally translates wire field `message` -> ChatMessage.content.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConnectionState, GatewayMessage } from '../../types/gateway';

// ---------------------------------------------------------------------------
// Test helpers — simulate the sendMessage / onMessage contract from useWebSocket
// ---------------------------------------------------------------------------

type MessageHandler = (msg: GatewayMessage) => void;

function makeChatOptions(overrides: {
  connectionState?: ConnectionState;
  currentChannel?: string;
  displayName?: string;
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
    currentChannel: overrides.currentChannel ?? 'general',
    displayName: overrides.displayName ?? 'tester',
  };
}

// ---------------------------------------------------------------------------
// Import hook
// ---------------------------------------------------------------------------

import { useChat } from '../useChat';

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

describe('useChat', () => {
  describe('subscribe on connect', () => {
    it('sends join message when connectionState is connected and channel is set', () => {
      const opts = makeChatOptions();
      renderHook(() => useChat(opts));

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'chat',
          action: 'join',
          channel: 'general',
        })
      );
    });

    it('does NOT send join when connectionState is disconnected', () => {
      const opts = makeChatOptions({ connectionState: 'disconnected' });
      renderHook(() => useChat(opts));

      expect(opts.sendMessage).not.toHaveBeenCalled();
    });

    it('does NOT send join when connectionState is connecting', () => {
      const opts = makeChatOptions({ connectionState: 'connecting' });
      renderHook(() => useChat(opts));

      expect(opts.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('chat history — initial message load', () => {
    it('populates messages array from chat history event (chronological order)', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'history',
          channel: 'general',
          messages: [
            { clientId: 'a', message: 'hi', timestamp: 'T1' },
            { clientId: 'b', message: 'hello', timestamp: 'T2' },
          ],
        });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].clientId).toBe('a');
      expect(result.current.messages[0].content).toBe('hi');
      expect(result.current.messages[0].timestamp).toBe('T1');
      expect(result.current.messages[1].content).toBe('hello');
    });

    it('sets messages to [] when chat history has empty messages array', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'history',
          channel: 'general',
          messages: [],
        });
      });

      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe('chat message — real-time receive', () => {
    it('appends a new message to the messages array', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      // Load history first
      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'history',
          channel: 'general',
          messages: [{ clientId: 'a', message: 'hi', timestamp: 'T1' }],
        });
      });

      // Receive a real-time message — server wraps payload in `message`
      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'message',
          channel: 'general',
          message: {
            clientId: 'b',
            message: 'hey',
            timestamp: 'T2',
            channel: 'general',
          },
        });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].content).toBe('hey');
      expect(result.current.messages[1].clientId).toBe('b');
    });

    it('ignores chat message for a different channel', () => {
      const opts = makeChatOptions({ currentChannel: 'general' });
      const { result } = renderHook(() => useChat(opts));

      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'message',
          channel: 'other-channel',
          message: {
            clientId: 'x',
            message: 'wrong channel',
            timestamp: 'T1',
            channel: 'other-channel',
          },
        });
      });

      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe('send()', () => {
    it('emits a chat send protocol message with correct fields', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      // Clear the join call
      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.send('hello');
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'chat',
          action: 'send',
          channel: 'general',
          message: 'hello',
        })
      );
    });

    it('emits even with empty string content (caller responsibility to validate)', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.send('');
      });

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'chat',
          action: 'send',
          message: '',
        })
      );
    });
  });

  describe('channel change', () => {
    it('leaves old channel and joins new channel when channel changes', () => {
      const opts = makeChatOptions({ currentChannel: 'general' });
      const sendMessage = opts.sendMessage as ReturnType<typeof vi.fn>;

      const { rerender } = renderHook(
        ({ channel }: { channel: string }) =>
          useChat({ ...opts, currentChannel: channel }),
        { initialProps: { channel: 'general' } }
      );

      sendMessage.mockClear();

      // Switch channel
      rerender({ channel: 'dev' });

      const calls = sendMessage.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
      const leave = calls.find(
        (c) => c.action === 'leave' && c.channel === 'general'
      );
      const join = calls.find(
        (c) => c.action === 'join' && c.channel === 'dev'
      );

      expect(leave).toBeDefined();
      expect(join).toBeDefined();
    });

    it('clears messages array when channel changes', () => {
      const opts = makeChatOptions({ currentChannel: 'general' });

      const { result, rerender } = renderHook(
        ({ channel }: { channel: string }) =>
          useChat({ ...opts, currentChannel: channel }),
        { initialProps: { channel: 'general' } }
      );

      // Load history on general
      act(() => {
        opts.dispatch({
          type: 'chat',
          action: 'history',
          channel: 'general',
          messages: [{ clientId: 'a', message: 'hi', timestamp: 'T1' }],
        });
      });

      expect(result.current.messages).toHaveLength(1);

      // Switch to dev channel
      rerender({ channel: 'dev' });

      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe('leave on unmount', () => {
    it('sends leave when hook unmounts', () => {
      const opts = makeChatOptions();
      const { unmount } = renderHook(() => useChat(opts));

      (opts.sendMessage as ReturnType<typeof vi.fn>).mockClear();

      unmount();

      expect(opts.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'chat',
          action: 'leave',
          channel: 'general',
        })
      );
    });
  });

  describe('return shape', () => {
    it('returns messages array and send function', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      expect(Array.isArray(result.current.messages)).toBe(true);
      expect(typeof result.current.send).toBe('function');
    });

    it('starts with empty messages array', () => {
      const opts = makeChatOptions();
      const { result } = renderHook(() => useChat(opts));

      expect(result.current.messages).toHaveLength(0);
    });
  });
});
