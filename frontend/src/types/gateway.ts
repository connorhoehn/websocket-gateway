// frontend/src/types/gateway.ts

/** Connection lifecycle states */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

/** Error received from the gateway (matches server error-codes.js format) */
export interface GatewayError {
  /** Standardized error code (e.g. AUTH_TOKEN_EXPIRED, AUTHZ_CHANNEL_DENIED) */
  code: string;
  /** Human-readable description for display */
  message: string;
  timestamp: string;
}

/** A raw message received over the WebSocket */
export interface GatewayMessage {
  type: string;       // e.g. 'session', 'chat', 'presence', 'cursor', 'reaction', 'error'
  action?: string;    // e.g. 'joined', 'sent', 'message'
  channel?: string;
  error?: GatewayError;
  [key: string]: unknown;
}

/** Server welcome message (type === 'session') */
export interface SessionMessage extends GatewayMessage {
  type: 'session';
  clientId: string;
  sessionToken: string;
  restored: boolean;
}

/** Runtime configuration read from env vars */
export interface GatewayConfig {
  wsUrl: string;
  cognitoToken: string;
  defaultChannel: string;
}
