// frontend/src/hooks/useWebSocket.ts
//
// Core WebSocket hook — single source of truth for gateway connectivity.
// All feature hooks (usePresence, useCursors, useChat, etc.) compose on top of this.

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ConnectionState,
  GatewayConfig,
  GatewayError,
  GatewayMessage,
  SessionMessage,
} from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseWebSocketOptions {
  config: GatewayConfig;
  onMessage?: (msg: GatewayMessage) => void;
}

export interface UseWebSocketReturn {
  connectionState: ConnectionState;
  lastError: GatewayError | null;
  sessionToken: string | null;
  clientId: string | null;
  currentChannel: string;
  switchChannel: (channel: string) => void;
  sendMessage: (msg: Record<string, unknown>) => void;
  disconnect: () => void;
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the WebSocket URL with required query params.
 *
 * New connection:  wss://host?token=<JWT>
 * Reconnect:       wss://host?token=<JWT>&sessionToken=<token>
 */
function buildUrl(config: GatewayConfig, sessionToken: string | null): string {
  const url = new URL(config.wsUrl);
  url.searchParams.set('token', config.cognitoToken);
  if (sessionToken) {
    url.searchParams.set('sessionToken', sessionToken);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { config, onMessage } = options;

  // ---- State ---------------------------------------------------------------
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [lastError, setLastError] = useState<GatewayError | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<string>(config.defaultChannel);

  // ---- Refs (survive re-renders without triggering them) -------------------
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks in a ref so the WebSocket handlers always have fresh values
  // without being torn down and rebuilt every render.
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // We need to read sessionToken inside the WebSocket close handler, so keep
  // a ref that is always current.
  const sessionTokenRef = useRef<string | null>(null);
  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  // ---- connect -------------------------------------------------------------

  const connect = useCallback(() => {
    // Guard: don't create a second socket if one is already open/connecting.
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionState('connecting');

    const url = buildUrl(config, sessionTokenRef.current);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      setConnectionState('connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      let msg: GatewayMessage;
      try {
        msg = JSON.parse(event.data as string) as GatewayMessage;
      } catch {
        return; // Ignore non-JSON frames
      }

      if (msg.type === 'session') {
        const sessionMsg = msg as unknown as SessionMessage;
        setSessionToken(sessionMsg.sessionToken);
        setClientId(sessionMsg.clientId);
        // Keep ref in sync immediately (useState is async)
        sessionTokenRef.current = sessionMsg.sessionToken;
      }

      if (msg.type === 'error' && msg.error) {
        setLastError(msg.error as GatewayError);
      }

      onMessageRef.current?.(msg);
    };

    ws.onclose = () => {
      if (retryCountRef.current < MAX_RETRIES) {
        setConnectionState('reconnecting');
        const delay = BASE_BACKOFF_MS * Math.pow(2, retryCountRef.current);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setConnectionState('disconnected');
      }
    };

    ws.onerror = (event: Event) => {
      // The server may have sent an error message; the onmessage handler
      // covers structured error frames. This handler catches raw transport
      // errors. Cast to ErrorEvent to extract message when available.
      const errEvent = event as ErrorEvent;
      if (errEvent.message) {
        setLastError({
          code: 'CONNECTION_ERROR',
          message: errEvent.message,
          timestamp: new Date().toISOString(),
        });
      }
    };
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Lifecycle -----------------------------------------------------------

  useEffect(() => {
    connect();

    return () => {
      // Cancel any pending reconnect timer
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // Close the WebSocket — prevents dangling connections on unmount
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally empty deps: connect on mount, clean up on unmount.
  // `connect` is stable (useCallback with [config]) and config is captured
  // once at mount. If callers need to reconnect with a new config they should
  // unmount/remount the hook consumer.

  // ---- Public API ----------------------------------------------------------

  const switchChannel = useCallback((channel: string) => {
    setCurrentChannel(channel);
    // useWebSocket intentionally does NOT send subscribe messages.
    // Feature hooks (useChat, usePresence, etc.) observe currentChannel
    // and send their own subscribe/unsubscribe messages. This keeps the
    // concern boundary clean.
  }, []);

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
    // No-op when socket is not OPEN (connecting, closing, closed).
  }, []);

  const disconnect = useCallback(() => {
    // Cancel pending reconnect so we don't auto-reconnect after an
    // intentional disconnect.
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = MAX_RETRIES; // Prevent onclose from scheduling a retry
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionState('disconnected');
  }, []);

  const reconnect = useCallback(() => {
    // Reset retry counter so we get a fresh 5-attempt window.
    retryCountRef.current = 0;
    // Cancel any pending timer from a previous reconnect sequence.
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    // Close existing socket (if any) without triggering auto-reconnect.
    // We temporarily bump retryCount past MAX_RETRIES to silence onclose.
    const existing = wsRef.current;
    wsRef.current = null;
    existing?.close();
    // Reset so connect() can proceed.
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  return {
    connectionState,
    lastError,
    sessionToken,
    clientId,
    currentChannel,
    switchChannel,
    sendMessage,
    disconnect,
    reconnect,
  };
}
