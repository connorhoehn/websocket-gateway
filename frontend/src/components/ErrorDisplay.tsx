// frontend/src/components/ErrorDisplay.tsx
import type { GatewayError } from '../types/gateway';
import { ERROR_CODE_DESCRIPTIONS } from './errorCodes';

interface Props {
  error: GatewayError | null;
}

export function ErrorDisplay({ error }: Props) {
  if (!error) return null;
  const description = ERROR_CODE_DESCRIPTIONS[error.code] ?? error.message;
  return (
    <div style={{
      background: '#fef2f2',
      border: '1px solid #fca5a5',
      borderRadius: '4px',
      padding: '0.75rem 1rem',
      fontFamily: 'monospace',
      marginTop: '0.5rem',
    }}>
      <strong style={{ color: '#dc2626' }}>[{error.code}]</strong>{' '}
      <span style={{ color: '#374151' }}>{description}</span>
      <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.25rem' }}>
        {new Date(error.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
