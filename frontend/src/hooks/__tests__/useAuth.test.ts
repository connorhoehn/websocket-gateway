// frontend/src/hooks/__tests__/useAuth.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the useAuth hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — amazon-cognito-identity-js
// ---------------------------------------------------------------------------

// Shared mock state — mutated per test
const mockSession = {
  isValid: vi.fn().mockReturnValue(true),
  getIdToken: vi.fn().mockReturnValue({ getJwtToken: vi.fn().mockReturnValue('mock-id-token') }),
  getRefreshToken: vi.fn().mockReturnValue({ getToken: vi.fn().mockReturnValue('mock-refresh') }),
};

const mockCognitoUser = {
  authenticateUser: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  getUsername: vi.fn().mockReturnValue('user@example.com'),
};

const mockUserPool = {
  getCurrentUser: vi.fn(),
  signUp: vi.fn(),
};

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn().mockImplementation(() => mockUserPool),
  CognitoUser: vi.fn().mockImplementation(() => mockCognitoUser),
  AuthenticationDetails: vi.fn(),
  CognitoUserAttribute: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import hook — after vi.mock declarations
// ---------------------------------------------------------------------------

import { useAuth } from '../useAuth';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: reset mocks to sensible base state
  mockSession.isValid.mockReturnValue(true);
  mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue('mock-id-token') });
  mockSession.getRefreshToken.mockReturnValue({ getToken: vi.fn().mockReturnValue('mock-refresh') });
  mockCognitoUser.getUsername.mockReturnValue('user@example.com');

  // Default: no stored user (unauthenticated)
  mockUserPool.getCurrentUser.mockReturnValue(null);

  // Clear localStorage between tests
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuth', () => {
  describe('session restore on mount', () => {
    it('resolves to unauthenticated when no stored user exists', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        // Allow useEffect to run
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.idToken).toBeNull();
      expect(result.current.email).toBeNull();
    });

    it('resolves to authenticated when stored session is valid', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );
      mockSession.isValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('authenticated');
      expect(result.current.idToken).toBe('mock-id-token');
      expect(result.current.email).toBe('user@example.com');
    });

    it('resolves to unauthenticated when stored session is invalid', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );
      mockSession.isValid.mockReturnValue(false);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.idToken).toBeNull();
    });

    it('resolves to unauthenticated when getSession returns an error', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: Error, session: null) => void) => {
          cb(new Error('Session error'), null);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('unauthenticated');
    });
  });

  describe('signIn', () => {
    it("signIn sets status='authenticated' and idToken on success", async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);
      mockCognitoUser.authenticateUser.mockImplementation(
        (_details: unknown, callbacks: { onSuccess: (session: typeof mockSession) => void }) => {
          callbacks.onSuccess(mockSession);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        result.current.signIn('user@example.com', 'Password1!');
      });

      expect(result.current.status).toBe('authenticated');
      expect(result.current.idToken).toBe('mock-id-token');
      expect(result.current.email).toBe('user@example.com');
      expect(result.current.error).toBeNull();
    });

    it("signIn sets error on failure (wrong password)", async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);
      mockCognitoUser.authenticateUser.mockImplementation(
        (_details: unknown, callbacks: { onFailure: (err: Error) => void }) => {
          callbacks.onFailure(new Error('Incorrect username or password'));
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        result.current.signIn('user@example.com', 'wrong');
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.error).toBe('Incorrect username or password');
      expect(result.current.idToken).toBeNull();
    });

    it("signIn with newPasswordRequired sets error message", async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);
      mockCognitoUser.authenticateUser.mockImplementation(
        (
          _details: unknown,
          callbacks: { newPasswordRequired: (userAttrs: Record<string, unknown>) => void }
        ) => {
          callbacks.newPasswordRequired({});
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        result.current.signIn('user@example.com', 'Password1!');
      });

      expect(result.current.error).toContain('Password change required');
      expect(result.current.status).toBe('unauthenticated');
    });
  });

  describe('signOut', () => {
    it("signOut sets status='unauthenticated' and clears idToken and email", async () => {
      // Start authenticated via mock getSession
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );
      mockSession.isValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      // Confirm authenticated
      expect(result.current.status).toBe('authenticated');

      // Now sign out — getCurrentUser returns the same user for signOut call
      act(() => {
        result.current.signOut();
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.idToken).toBeNull();
      expect(result.current.email).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('signOut clears localStorage keys', async () => {
      // Seed localStorage
      localStorage.setItem('auth_id_token', 'old-token');
      localStorage.setItem('auth_refresh_token', 'old-refresh');
      localStorage.setItem('auth_email', 'user@example.com');

      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );
      mockSession.isValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      act(() => {
        result.current.signOut();
      });

      expect(localStorage.getItem('auth_id_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
      expect(localStorage.getItem('auth_email')).toBeNull();
    });
  });

  describe('signUp', () => {
    it("signUp calls userPool.signUp and auto-signs in on success", async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);
      // signUp succeeds
      mockUserPool.signUp.mockImplementation(
        (
          _email: string,
          _password: string,
          _attrs: unknown[],
          _validationData: unknown[],
          cb: (err: null, result: Record<string, unknown>) => void
        ) => {
          cb(null, {});
        }
      );
      // auto-signIn via authenticateUser
      mockCognitoUser.authenticateUser.mockImplementation(
        (_details: unknown, callbacks: { onSuccess: (session: typeof mockSession) => void }) => {
          callbacks.onSuccess(mockSession);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        result.current.signUp('new@example.com', 'Password1!');
      });

      expect(result.current.status).toBe('authenticated');
    });

    it("signUp sets error when userPool.signUp fails", async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);
      mockUserPool.signUp.mockImplementation(
        (
          _email: string,
          _password: string,
          _attrs: unknown[],
          _validationData: unknown[],
          cb: (err: Error, result: null) => void
        ) => {
          cb(new Error('User already exists'), null);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        result.current.signUp('existing@example.com', 'Password1!');
      });

      expect(result.current.error).toBe('User already exists');
      expect(result.current.status).toBe('unauthenticated');
    });
  });

  describe('interface contract', () => {
    it('exposes the correct shape from useAuth()', async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(typeof result.current.signIn).toBe('function');
      expect(typeof result.current.signUp).toBe('function');
      expect(typeof result.current.signOut).toBe('function');
      expect(['loading', 'unauthenticated', 'authenticated']).toContain(result.current.status);
    });
  });
});
