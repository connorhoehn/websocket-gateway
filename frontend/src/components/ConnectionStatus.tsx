// frontend/src/components/ConnectionStatus.tsx
import type { ConnectionState } from '../types/gateway';

interface Props {
  state: ConnectionState;
}

const STATE_CONFIG: Record<ConnectionState, { label: string; color: string; dot: string }> = {
  idle:          { label: 'Idle',          color: '#6b7280', dot: '⬤' },
  connecting:    { label: 'Connecting…',   color: '#f59e0b', dot: '⬤' },
  connected:     { label: 'Connected',     color: '#10b981', dot: '⬤' },
  reconnecting:  { label: 'Reconnecting…', color: '#f59e0b', dot: '⬤' },
  disconnected:  { label: 'Disconnected',  color: '#ef4444', dot: '⬤' },
};

export function ConnectionStatus({ state }: Props) {
  const cfg = STATE_CONFIG[state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'monospace' }}>
      <span style={{ color: cfg.color }}>{cfg.dot}</span>
      <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
    </span>
  );
}
