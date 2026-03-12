// frontend/src/components/LoginForm.tsx
import { useState } from 'react';

export interface LoginFormProps {
  status: 'loading' | 'unauthenticated' | 'authenticated';
  error: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSwitchToSignup: () => void;
}

export function LoginForm({ status, error, onSignIn, onSwitchToSignup }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isLoading = status === 'loading';

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSignIn(email, password);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Brand header */}
      <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <div style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.025em',
        }}>
          WebSocket Gateway
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '2rem',
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
      }}>
        <h2 style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 600,
          marginTop: 0,
          marginBottom: '1.5rem',
        }}>Sign In</h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email address"
            disabled={isLoading}
            style={inputStyle}
          />

          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isLoading}
            style={inputStyle}
          />

          {error !== null && (
            <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            style={{
              background: '#2563eb',
              color: '#ffffff',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              width: '100%',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '0.875rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onSwitchToSignup}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '0.875rem',
            }}
          >
            Don't have an account?
          </button>
        </div>
      </div>
    </div>
  );
}
