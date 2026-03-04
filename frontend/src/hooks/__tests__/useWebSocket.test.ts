// frontend/src/hooks/__tests__/useWebSocket.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the useWebSocket hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { GatewayConfig } from '../../types/gateway';
import { useWebSocket } from '../useWebSocket';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((evt: Event) => void) | null = null;
  onmessage: ((evt: MessageEvent) => void) | null = null;
  onclose: ((evt: CloseEvent) => void) | null = null;
  onerror: ((evt: Event) => void) | null = null;

  static instances: MockWebSocket[] = [];
  static sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receiveMessage(data: unknown): void {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    this.onmessage?.(event);
  }

  triggerClose(code = 1006): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent('close', { code, wasClean: false });
    this.onclose?.(event);
  }

  send(data: string): void {
    MockWebSocket.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  static reset(): void {
    MockWebSocket.instances = [];
    MockWebSocket.sentMessages = [];
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const makeConfig = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  wsUrl: 'wss://test.example.com',
  cognitoToken: 'test-jwt-token',
  defaultChannel: 'general',
  ...overrides,
});

beforeEach(() => {
  MockWebSocket.reset();
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWebSocket', () => {
  describe('initial connection', () => {
    it('starts in idle state before connecting', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      // Before WebSocket opens, state should be connecting or idle
      // (idle is set before useEffect fires, connecting is set when ws is created)
      expect(['idle', 'connecting']).toContain(result.current.connectionState);
    });

    it('transitions to connecting when WebSocket is created', () => {
      renderHook(() => useWebSocket({ config: makeConfig() }));
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('builds the URL with ?token= query param from cognitoToken', () => {
      renderHook(() => useWebSocket({ config: makeConfig() }));
      const ws = MockWebSocket.instances[0];
      expect(ws.url).toContain('?token=test-jwt-token');
    });

    it('transitions to connected when WebSocket opens', async () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
      });
      expect(result.current.connectionState).toBe('connected');
    });

    it('joins the defaultChannel from config', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig({ defaultChannel: 'lobby' }) })
      );
      expect(result.current.currentChannel).toBe('lobby');
    });
  });

  describe('session message handling', () => {
    it('stores sessionToken from session message', async () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].receiveMessage({
          type: 'session',
          clientId: 'client-abc',
          sessionToken: 'session-xyz',
          restored: false,
        });
      });
      expect(result.current.sessionToken).toBe('session-xyz');
      expect(result.current.clientId).toBe('client-abc');
    });

    it('calls onMessage callback for all received messages', () => {
      const onMessage = vi.fn();
      renderHook(() =>
        useWebSocket({ config: makeConfig(), onMessage })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].receiveMessage({ type: 'session', clientId: 'c1', sessionToken: 'tok', restored: false });
        MockWebSocket.instances[0].receiveMessage({ type: 'chat', action: 'message' });
      });
      expect(onMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('reconnection with session token', () => {
    it('includes sessionToken in reconnect URL when available', async () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );

      // Connect and get session token
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].receiveMessage({
          type: 'session',
          clientId: 'c1',
          sessionToken: 'session-tok-1',
          restored: false,
        });
      });

      // Trigger disconnect to force reconnect
      act(() => {
        MockWebSocket.instances[0].triggerClose();
      });

      // Advance timers to trigger first reconnect (1000ms)
      act(() => {
        vi.advanceTimersByTime(1100);
      });

      expect(result.current.connectionState).toBe('reconnecting');
      // A new WebSocket should have been created with the session token
      const secondWs = MockWebSocket.instances[1];
      expect(secondWs).toBeDefined();
      expect(secondWs.url).toContain('sessionToken=session-tok-1');
    });
  });

  describe('exponential backoff', () => {
    it('transitions to reconnecting on close', async () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].triggerClose();
      });
      expect(result.current.connectionState).toBe('reconnecting');
    });

    it('transitions to disconnected after 5 retries', async () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );

      // Initial connection opens then closes
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].triggerClose();
      });

      // Simulate 5 reconnect attempts each failing immediately
      for (let i = 1; i <= 5; i++) {
        const delay = 1000 * Math.pow(2, i - 1);
        act(() => {
          vi.advanceTimersByTime(delay + 50);
        });
        // Each new WebSocket closes immediately
        if (MockWebSocket.instances[i]) {
          act(() => {
            MockWebSocket.instances[i].triggerClose();
          });
        }
      }

      expect(result.current.connectionState).toBe('disconnected');
    });
  });

  describe('error handling', () => {
    it('sets lastError from error messages', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].receiveMessage({
          type: 'error',
          error: {
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Your token has expired',
            timestamp: '2026-03-04T00:00:00Z',
          },
        });
      });
      expect(result.current.lastError).toEqual({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Your token has expired',
        timestamp: '2026-03-04T00:00:00Z',
      });
    });

    it('initialises lastError as null', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      expect(result.current.lastError).toBeNull();
    });
  });

  describe('switchChannel', () => {
    it('updates currentChannel without closing the WebSocket', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        result.current.switchChannel('room-2');
      });
      expect(result.current.currentChannel).toBe('room-2');
      // WebSocket should still be open
      expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.OPEN);
      // Only one WS instance created
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe('sendMessage', () => {
    it('sends JSON-stringified message when WebSocket is OPEN', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        result.current.sendMessage({ service: 'chat', action: 'join', channel: 'general' });
      });
      expect(MockWebSocket.sentMessages).toHaveLength(1);
      expect(JSON.parse(MockWebSocket.sentMessages[0])).toEqual({
        service: 'chat',
        action: 'join',
        channel: 'general',
      });
    });

    it('no-ops when WebSocket is not OPEN', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      // Don't call .open(), so readyState is still CONNECTING
      act(() => {
        result.current.sendMessage({ service: 'chat', action: 'join', channel: 'general' });
      });
      expect(MockWebSocket.sentMessages).toHaveLength(0);
    });
  });

  describe('disconnect', () => {
    it('closes the WebSocket and sets state to disconnected', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        result.current.disconnect();
      });
      expect(result.current.connectionState).toBe('disconnected');
    });
  });

  describe('reconnect', () => {
    it('creates a new WebSocket connection', () => {
      const { result } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      act(() => {
        MockWebSocket.instances[0].open();
        result.current.disconnect();
      });
      act(() => {
        result.current.reconnect();
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });

  describe('cleanup', () => {
    it('closes WebSocket on unmount', () => {
      const { unmount } = renderHook(() =>
        useWebSocket({ config: makeConfig() })
      );
      const ws = MockWebSocket.instances[0];
      act(() => {
        ws.open();
      });
      unmount();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });
});
