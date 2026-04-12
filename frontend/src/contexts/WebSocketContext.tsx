// frontend/src/contexts/WebSocketContext.tsx
//
// Provides WebSocket connection state, messaging, and session info to the tree.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';
import type { UseWebSocketReturn } from '../hooks/useWebSocket';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

export interface WebSocketContextValue {
  connectionState: ConnectionState;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: OnMessageFn;
  ws: UseWebSocketReturn;
  clientId: string | null;
  sessionToken: string | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WebSocketProvider({
  value,
  children,
}: {
  value: WebSocketContextValue;
  children: ReactNode;
}) {
  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useWebSocketContext(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error('useWebSocketContext must be used within a <WebSocketProvider>');
  }
  return ctx;
}
