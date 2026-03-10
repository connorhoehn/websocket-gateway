// frontend/src/components/DisconnectReconnect.tsx
//
// Developer control: drop and restore the WebSocket connection with a single
// click so the reconnection flow can be observed without touching the terminal.

import type { ConnectionState } from '../types/gateway';

interface Props {
  connectionState: ConnectionState;
  onDisconnect: () => void;
  onReconnect: () => void;
}

export function DisconnectReconnect({ connectionState, onDisconnect, onReconnect }: Props) {
  const isDisconnected = connectionState === 'disconnected';
  const isActiveOrConnecting =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'reconnecting';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <button
        onClick={onDisconnect}
        disabled={isDisconnected}
        style={{
          padding: '0.375rem 0.75rem',
          background: isDisconnected ? '#f3f4f6' : '#fee2e2',
          color: isDisconnected ? '#9ca3af' : '#dc2626',
          border: '1px solid',
          borderColor: isDisconnected ? '#d1d5db' : '#fca5a5',
          borderRadius: '4px',
          cursor: isDisconnected ? 'not-allowed' : 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
        }}
      >
        Disconnect
      </button>

      <button
        onClick={onReconnect}
        disabled={isActiveOrConnecting}
        style={{
          padding: '0.375rem 0.75rem',
          background: isActiveOrConnecting ? '#f3f4f6' : '#dcfce7',
          color: isActiveOrConnecting ? '#9ca3af' : '#15803d',
          border: '1px solid',
          borderColor: isActiveOrConnecting ? '#d1d5db' : '#86efac',
          borderRadius: '4px',
          cursor: isActiveOrConnecting ? 'not-allowed' : 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
        }}
      >
        Reconnect
      </button>

      <span style={{ color: '#6b7280', fontSize: '0.75rem', fontFamily: 'monospace' }}>
        state: <strong>{connectionState}</strong>
      </span>
    </div>
  );
}
