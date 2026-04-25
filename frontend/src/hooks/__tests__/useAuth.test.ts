// frontend/src/hooks/__tests__/useAuth.test.ts
//
// TDD RED phase: Tests written before implementation.
// These tests define the expected behaviour of the useAuth hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Stub env BEFORE importing useAuth so DEV_BYPASS evaluates to false.
// (`.env` sets VITE_DEV_BYPASS_AUTH=true for local dev; the Cognito code path
// is what these tests exercise, so we force it off here.)
// vi.hoisted ensures this runs before the hoisted `import` of useAuth below.
// ---------------------------------------------------------------------------

vi.hoisted(() => {
  vi.stubEnv('VITE_DEV_BYPASS_AUTH', 'false');
});

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
  refreshSession: vi.fn(),
};

const mockUserPool = {
  getCurrentUser: vi.fn(),
  signUp: vi.fn(),
};

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn(function () { return mockUserPool; }),
  CognitoUser: vi.fn(function () { return mockCognitoUser; }),
  AuthenticationDetails: vi.fn(function () { return {}; }),
  CognitoUserAttribute: vi.fn(function () { return {}; }),
  CognitoRefreshToken: vi.fn(function () { return {}; }),
}));

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

const mockBroadcastChannel = {
  postMessage: vi.fn(),
  close: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
};

// ---------------------------------------------------------------------------
// Import hook — after vi.mock declarations
// ---------------------------------------------------------------------------

import { useAuth } from '../useAuth';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  // Reset BroadcastChannel mock
  mockBroadcastChannel.postMessage.mockReset();
  mockBroadcastChannel.close.mockReset();
  mockBroadcastChannel.onmessage = null;
  global.BroadcastChannel = vi.fn(function () { return mockBroadcastChannel; }) as unknown as typeof BroadcastChannel;

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
  vi.useRealTimers();
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

  // -------------------------------------------------------------------------
  // Token refresh and multi-tab sync tests (Phase 13-01)
  // -------------------------------------------------------------------------

  describe('token refresh', () => {
    /**
     * Helper: build a valid-looking JWT with a specific exp claim.
     * The actual signature is not verified in these tests.
     */
    function makeJwt(exp: number): string {
      const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ sub: 'user-id', exp }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      return `${header}.${payload}.fake-signature`;
    }

    it('schedules a token refresh timer when authenticated on mount', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 3600;
      const idToken = makeJwt(exp);

      mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(idToken) });
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      renderHook(() => useAuth());

      await act(async () => {});

      const expectedDelay = (3600 - 120) * 1000;
      const calls = setTimeoutSpy.mock.calls;
      const refreshCall = calls.find(
        ([, delay]) => typeof delay === 'number' && Math.abs(delay - expectedDelay) < 5000
      );
      expect(refreshCall).toBeDefined();
    });

    it('on refresh success, updates idToken state and broadcasts TOKEN_REFRESHED', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 3600;
      const idToken = makeJwt(exp);
      const newIdToken = makeJwt(nowSec + 7200);

      mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(idToken) });
      mockSession.getRefreshToken.mockReturnValue({ getToken: vi.fn().mockReturnValue('stored-refresh') });
      localStorage.setItem('auth_refresh_token', 'stored-refresh');

      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );

      const newSession = {
        getIdToken: vi.fn().mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(newIdToken) }),
        getRefreshToken: vi.fn().mockReturnValue({ getToken: vi.fn().mockReturnValue('new-refresh') }),
      };

      mockCognitoUser.refreshSession.mockImplementation(
        (_token: unknown, cb: (err: null, session: typeof newSession) => void) => {
          cb(null, newSession);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('authenticated');

      // Advance timer to trigger refresh
      await act(async () => {
        vi.runAllTimers();
      });

      expect(result.current.idToken).toBe(newIdToken);
      expect(mockBroadcastChannel.postMessage).toHaveBeenCalledWith({
        type: 'TOKEN_REFRESHED',
        idToken: newIdToken,
      });
    });

    it('on refresh failure, signs out and sets session-expired error', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 3600;
      const idToken = makeJwt(exp);

      mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(idToken) });
      localStorage.setItem('auth_refresh_token', 'stored-refresh');

      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );

      mockCognitoUser.refreshSession.mockImplementation(
        (_token: unknown, cb: (err: Error, session: null) => void) => {
          cb(new Error('Token expired'), null);
        }
      );

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('authenticated');

      await act(async () => {
        vi.runAllTimers();
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.error).toBe('Your session has expired. Please sign in again.');
    });

    it('clears refresh timer on signOut', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 3600;
      const idToken = makeJwt(exp);

      mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(idToken) });
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      act(() => {
        result.current.signOut();
      });

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('clears refresh timer on unmount', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 3600;
      const idToken = makeJwt(exp);

      mockSession.getIdToken.mockReturnValue({ getJwtToken: vi.fn().mockReturnValue(idToken) });
      mockUserPool.getCurrentUser.mockReturnValue(mockCognitoUser);
      mockCognitoUser.getSession.mockImplementation(
        (cb: (err: null, session: typeof mockSession) => void) => {
          cb(null, mockSession);
        }
      );

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { unmount } = renderHook(() => useAuth());

      await act(async () => {});

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('does not schedule refresh when session restore finds no stored user', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      renderHook(() => useAuth());

      await act(async () => {});

      // setTimeout should NOT be called for refresh scheduling
      const expectedDelay = (3600 - 120) * 1000;
      const refreshCall = setTimeoutSpy.mock.calls.find(
        ([, delay]) => typeof delay === 'number' && delay > 60000
      );
      expect(refreshCall).toBeUndefined();
      void expectedDelay; // suppress lint warning
    });
  });

  describe('multi-tab sync via BroadcastChannel', () => {
    it('TOKEN_REFRESHED broadcast from another tab updates idToken without re-authenticating', async () => {
      mockUserPool.getCurrentUser.mockReturnValue(null);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      expect(result.current.status).toBe('unauthenticated');

      await act(async () => {
        mockBroadcastChannel.onmessage?.({
          data: { type: 'TOKEN_REFRESHED', idToken: 'cross-tab-token' },
        } as MessageEvent);
      });

      expect(result.current.idToken).toBe('cross-tab-token');
    });

    it('SIGNED_OUT broadcast from another tab transitions to unauthenticated and clears localStorage', async () => {
      localStorage.setItem('auth_id_token', 'some-token');
      localStorage.setItem('auth_refresh_token', 'some-refresh');
      localStorage.setItem('auth_email', 'user@example.com');

      mockUserPool.getCurrentUser.mockReturnValue(null);

      const { result } = renderHook(() => useAuth());

      await act(async () => {});

      await act(async () => {
        mockBroadcastChannel.onmessage?.({
          data: { type: 'SIGNED_OUT' },
        } as MessageEvent);
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(localStorage.getItem('auth_id_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
      expect(localStorage.getItem('auth_email')).toBeNull();
    });
  });
});
