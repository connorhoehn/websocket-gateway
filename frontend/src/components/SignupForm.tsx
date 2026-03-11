// frontend/src/components/SignupForm.tsx
import { useState } from 'react';

export interface SignupFormProps {
  status: 'loading' | 'unauthenticated' | 'authenticated';
  error: string | null;
  onSignUp: (email: string, password: string) => Promise<void>;
  onSwitchToLogin: () => void;
}

export function SignupForm({ status, error, onSignUp, onSwitchToLogin }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isLoading = status === 'loading';

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    onSignUp(email, password);
  }

  const displayedError = localError ?? error;

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
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#f9fafb',
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '2rem',
        maxWidth: '400px',
        width: '100%',
      }}>
        <h2 style={{ fontFamily: 'monospace', marginTop: 0, marginBottom: '1.5rem' }}>Create Account</h2>

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

          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            disabled={isLoading}
            style={inputStyle}
          />

          {displayedError !== null && (
            <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{displayedError}</p>
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
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onSwitchToLogin}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
            }}
          >
            Already have an account?
          </button>
        </div>
      </div>
    </div>
  );
}
