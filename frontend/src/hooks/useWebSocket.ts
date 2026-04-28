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
 * Build the WebSocket URL.
 *
 * The JWT now travels via Sec-WebSocket-Protocol (see WS_AUTH_SUBPROTOCOL),
 * not the URL — the query string lands in server logs and proxy traces.
 * Only the (non-sensitive) sessionToken stays in the URL for reconnects.
 */
function buildUrl(config: GatewayConfig, sessionToken: string | null): string {
  const url = new URL(config.wsUrl);
  if (sessionToken) {
    url.searchParams.set('sessionToken', sessionToken);
  }
  return url.toString();
}

// Marker subprotocol the server echoes back. The JWT follows it as the
// second value in Sec-WebSocket-Protocol; the server reads it but does
// not echo it.
const WS_AUTH_SUBPROTOCOL = 'bearer-token-v1';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { config, onMessage } = options;

  // ---- State ---------------------------------------------------------------
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [lastError, setLastError] = useState<GatewayError | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => sessionStorage.getItem('ws_session_token'),
  );
  const [clientId, setClientId] = useState<string | null>(
    () => sessionStorage.getItem('ws_client_id'),
  );
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
  const sessionTokenRef = useRef<string | null>(
    sessionStorage.getItem('ws_session_token'),
  );
  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  // ---- connect -------------------------------------------------------------
  // Use a ref so the onclose handler can call connect() without violating
  // the "accessed before declaration" rule (connectRef is declared first).
  const connectRef = useRef<() => void>(() => {});

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
    const ws = new WebSocket(url, [WS_AUTH_SUBPROTOCOL, config.cognitoToken]);
    wsRef.current = ws;

    ws.onopen = () => {
      // Ignore events from stale sockets (React StrictMode double-mount)
      if (wsRef.current !== ws) return;
      retryCountRef.current = 0;
      setConnectionState('connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      // Ignore events from stale sockets
      if (wsRef.current !== ws) return;

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
        // Persist for page refresh recovery
        sessionStorage.setItem('ws_session_token', sessionMsg.sessionToken);
        sessionStorage.setItem('ws_client_id', sessionMsg.clientId);
      }

      if (msg.type === 'error' && msg.error) {
        setLastError(msg.error as GatewayError);
      }

      onMessageRef.current?.(msg);
    };

    ws.onclose = () => {
      // Ignore close events from stale sockets (React StrictMode double-mount).
      // Without this guard, ws1's late onclose clobbers ws2's 'connected' state.
      if (wsRef.current !== ws) return;

      if (retryCountRef.current < MAX_RETRIES) {
        setConnectionState('reconnecting');
        const delay = BASE_BACKOFF_MS * Math.pow(2, retryCountRef.current);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          connectRef.current();
        }, delay);
      } else {
        setConnectionState('disconnected');
      }
    };

    ws.onerror = (event: Event) => {
      // Ignore errors from stale sockets
      if (wsRef.current !== ws) return;

      const errEvent = event as ErrorEvent;
      if (errEvent.message) {
        setLastError({
          code: 'CONNECTION_ERROR',
          message: errEvent.message,
          timestamp: new Date().toISOString(),
        });
      }
    };
  }, [config]);

  // Keep connectRef in sync so the onclose retry always calls the latest connect.
  useEffect(() => { connectRef.current = connect; }, [connect]);  

  // ---- Lifecycle -----------------------------------------------------------

  useEffect(() => {
    connect(); // eslint-disable-line react-hooks/set-state-in-effect

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
    // Clear persisted session on intentional disconnect
    sessionStorage.removeItem('ws_session_token');
    sessionStorage.removeItem('ws_client_id');
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
