// frontend/src/components/ErrorPanel.tsx
//
// ErrorPanel — always-visible dev tool component that accumulates and displays
// all gateway errors since page load. Newest errors appear first.
//
// Imports ERROR_CODE_DESCRIPTIONS from shared errorCodes module.

import { ERROR_CODE_DESCRIPTIONS } from './errorCodes';
import type { GatewayError } from '../types/gateway';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  errors: GatewayError[];   // all errors since page load, newest first
}

export function ErrorPanel({ errors }: Props) {
  return (
    <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
        Errors{' '}
        <span
          style={{
            color: errors.length > 0 ? '#dc2626' : '#9ca3af',
            fontWeight: 'normal',
          }}
        >
          ({errors.length})
        </span>
      </h3>

      {errors.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No errors.</p>
      ) : (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {errors.map((error, index) => (
            <div
              key={`${error.timestamp}-${error.code}-${index}`}
              style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                padding: '0.5rem 0.75rem',
                marginBottom: '0.25rem',
                fontFamily: 'monospace',
              }}
            >
              <strong style={{ color: '#dc2626' }}>[{error.code}]</strong>{' '}
              <span style={{ color: '#374151' }}>
                {ERROR_CODE_DESCRIPTIONS[error.code] ?? error.message}
              </span>
              <div style={{ color: '#9ca3af', fontSize: '0.7rem' }}>
                {new Date(error.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
