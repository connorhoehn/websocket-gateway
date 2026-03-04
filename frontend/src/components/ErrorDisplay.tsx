// frontend/src/components/ErrorDisplay.tsx
import type { GatewayError } from '../types/gateway';

export const ERROR_CODE_DESCRIPTIONS: Record<string, string> = {
  AUTH_TOKEN_MISSING:           'No authentication token provided.',
  AUTH_TOKEN_EXPIRED:           'Your session token has expired. Please refresh your credentials.',
  AUTH_TOKEN_INVALID:           'The provided token is invalid or malformed.',
  AUTH_FAILED:                  'Authentication failed.',
  AUTHZ_FORBIDDEN:              'You do not have permission to perform this action.',
  AUTHZ_CHANNEL_DENIED:         'Access to this channel is not permitted for your account.',
  AUTHZ_ADMIN_REQUIRED:         'This channel requires admin privileges.',
  RATE_LIMIT_EXCEEDED:          'Too many requests. Please slow down.',
  RATE_LIMIT_MESSAGE_QUOTA:     'Message rate limit exceeded (100 messages/sec).',
  RATE_LIMIT_CURSOR_QUOTA:      'Cursor update rate limit exceeded (40 updates/sec).',
  INVALID_MESSAGE:              'Message format is invalid.',
  INVALID_MESSAGE_STRUCTURE:    'Message is missing required fields.',
  INVALID_MESSAGE_SERVICE:      'Unknown service specified.',
  INVALID_CHANNEL_NAME:         'Channel name must be 1–50 characters.',
  PAYLOAD_TOO_LARGE:            'Message payload exceeds the size limit.',
  SERVICE_UNAVAILABLE:          'The requested service is not available.',
  SERVICE_REDIS_ERROR:          'A distributed state error occurred (Redis).',
  SERVICE_INTERNAL_ERROR:       'An internal server error occurred.',
  CONNECTION_LIMIT_EXCEEDED:    'The server has reached its connection limit.',
  CONNECTION_IP_LIMIT_EXCEEDED: 'Too many connections from your IP address.',
};

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
