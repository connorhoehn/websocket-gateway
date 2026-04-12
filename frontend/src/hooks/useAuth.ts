// frontend/src/hooks/useAuth.ts
//
// Cognito USER_PASSWORD_AUTH hook.
// Manages the full auth lifecycle: session restore, sign-in, sign-up, sign-out.
// Phase 13-01: adds proactive token refresh and multi-tab session sync.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoRefreshToken,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const STORAGE_ID_TOKEN = 'auth_id_token';
const STORAGE_REFRESH_TOKEN = 'auth_refresh_token';
const STORAGE_EMAIL = 'auth_email';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface AuthState {
  status: 'loading' | 'unauthenticated' | 'authenticated';
  idToken: string | null;   // Cognito ID token — pass this to useWebSocket as JWT
  email: string | null;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type AuthBroadcastEvent =
  | { type: 'TOKEN_REFRESHED'; idToken: string }
  | { type: 'SIGNED_OUT' };

// ---------------------------------------------------------------------------
// Helper: schedule a silent token refresh 2 minutes before expiry
// ---------------------------------------------------------------------------

function scheduleTokenRefresh(
  idToken: string,
  onRefresh: () => void
): ReturnType<typeof setTimeout> | null {
  try {
    const payload = JSON.parse(
      atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    const expiresInMs = payload.exp * 1000 - Date.now();
    const refreshInMs = expiresInMs - 2 * 60 * 1000; // 2 min early
    if (refreshInMs <= 0) {
      onRefresh();
      return null;
    }
    return setTimeout(onRefresh, refreshInMs);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

// Each browser tab gets a unique dev identity (persisted in sessionStorage).
const DEV_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'];
function getDevIdentity(): { token: string; email: string } {
  const KEY = 'dev_identity';
  const stored = sessionStorage.getItem(KEY);
  if (stored) return JSON.parse(stored);

  const idx = Math.floor(Math.random() * DEV_NAMES.length);
  const name = DEV_NAMES[idx];
  const suffix = Math.random().toString(36).slice(2, 6);
  const userId = `dev-${name.toLowerCase()}-${suffix}`;
  const email = `${name.toLowerCase()}@local.dev`;
  const payload = btoa(JSON.stringify({
    sub: userId,
    email,
    given_name: name,
    exp: 9999999999,
  })).replace(/=/g, '');
  const token = `eyJhbGciOiJub25lIn0.${payload}.dev`;
  const identity = { token, email };
  sessionStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}

const DEV_IDENTITY = DEV_BYPASS ? getDevIdentity() : null;

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    status: DEV_BYPASS ? 'authenticated' : 'loading',
    idToken: DEV_BYPASS ? DEV_IDENTITY!.token : null,
    email: DEV_BYPASS ? DEV_IDENTITY!.email : null,
    error: null,
  });

  // Create a stable userPool instance for the lifetime of this hook instance
  const userPool = useMemo(
    () => {
      if (DEV_BYPASS) return null as unknown as InstanceType<typeof CognitoUserPool>;
      return new CognitoUserPool({
        UserPoolId: (import.meta.env as Record<string, string>).VITE_COGNITO_USER_POOL_ID ?? '',
        ClientId: (import.meta.env as Record<string, string>).VITE_COGNITO_CLIENT_ID ?? '',
      });
    },
    []
  );

  // Refs for timer and BroadcastChannel
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  // ── SIGN OUT ───────────────────────────────────────────────────────────
  // Defined early so it can be referenced by doRefresh

  const signOut = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    userPool?.getCurrentUser()?.signOut();
    localStorage.removeItem(STORAGE_ID_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_EMAIL);
    broadcastChannel.current?.postMessage({ type: 'SIGNED_OUT' });
    setState({
      status: 'unauthenticated',
      idToken: null,
      email: null,
      error: null,
    });
  }, [userPool]);

  // ── TOKEN REFRESH ──────────────────────────────────────────────────────
  // Use a ref so the callback can reference itself (scheduleTokenRefresh
  // passes doRefresh as a callback) without violating the "accessed before
  // declaration" rule.
  const doRefreshRef = useRef<() => void>(() => {});

  const doRefresh = useCallback(() => {
    const storedToken = localStorage.getItem(STORAGE_REFRESH_TOKEN);
    if (!storedToken) {
      signOut();
      setState((prev) => ({
        ...prev,
        status: 'unauthenticated',
        error: 'Your session has expired. Please sign in again.',
      }));
      return;
    }

    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      signOut();
      setState((prev) => ({
        ...prev,
        status: 'unauthenticated',
        error: 'Your session has expired. Please sign in again.',
      }));
      return;
    }

    const refreshToken = new CognitoRefreshToken({ RefreshToken: storedToken });
    cognitoUser.refreshSession(refreshToken, (err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        signOut();
        setState((prev) => ({
          ...prev,
          status: 'unauthenticated',
          error: 'Your session has expired. Please sign in again.',
        }));
        return;
      }
      const newIdToken = session.getIdToken().getJwtToken();
      const newRefreshToken = session.getRefreshToken().getToken();
      localStorage.setItem(STORAGE_ID_TOKEN, newIdToken);
      localStorage.setItem(STORAGE_REFRESH_TOKEN, newRefreshToken);
      setState((prev) => ({ ...prev, idToken: newIdToken }));
      broadcastChannel.current?.postMessage({ type: 'TOKEN_REFRESHED', idToken: newIdToken });
      // Re-schedule next refresh
      timerRef.current = scheduleTokenRefresh(newIdToken, () => doRefreshRef.current());
    });
  }, [userPool, signOut]);

  // Keep doRefreshRef in sync so scheduled callbacks call the latest version.
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);

  // ── BROADCAST CHANNEL ─────────────────────────────────────────────────

  useEffect(() => {
    const channel = new BroadcastChannel('auth');
    broadcastChannel.current = channel;

    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as AuthBroadcastEvent;
      if (msg.type === 'TOKEN_REFRESHED') {
        localStorage.setItem(STORAGE_ID_TOKEN, msg.idToken);
        setState((prev) => ({ ...prev, idToken: msg.idToken }));
      } else if (msg.type === 'SIGNED_OUT') {
        localStorage.removeItem(STORAGE_ID_TOKEN);
        localStorage.removeItem(STORAGE_REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_EMAIL);
        setState({ status: 'unauthenticated', idToken: null, email: null, error: null });
      }
    };

    return () => {
      channel.close();
      broadcastChannel.current = null;
    };
  }, []);

  // ── SESSION RESTORE (on mount) ──────────────────────────────────────────

  useEffect(() => {
    if (DEV_BYPASS) return; // Skip session restore in dev bypass mode

    const storedUser = userPool.getCurrentUser();

    if (!storedUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session restore must set initial auth state synchronously
      setState({
        status: 'unauthenticated',
        idToken: null,
        email: null,
        error: null,
      });
      return;
    }

    storedUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        setState({
          status: 'unauthenticated',
          idToken: null,
          email: null,
          error: null,
        });
      } else {
        const idToken = session.getIdToken().getJwtToken();
        const email = storedUser.getUsername();
        setState({
          status: 'authenticated',
          idToken,
          email,
          error: null,
        });
        // Schedule proactive refresh
        timerRef.current = scheduleTokenRefresh(idToken, doRefresh);
      }
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SIGN IN ────────────────────────────────────────────────────────────

  const signIn = useCallback(
    (email: string, password: string): Promise<void> => {
      return new Promise((resolve) => {
        const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });

        cognitoUser.authenticateUser(authDetails, {
          onSuccess: (session: CognitoUserSession) => {
            const idToken = session.getIdToken().getJwtToken();
            const refreshToken = session.getRefreshToken().getToken();
            localStorage.setItem(STORAGE_ID_TOKEN, idToken);
            localStorage.setItem(STORAGE_REFRESH_TOKEN, refreshToken);
            localStorage.setItem(STORAGE_EMAIL, email);
            setState({
              status: 'authenticated',
              idToken,
              email,
              error: null,
            });
            // Schedule proactive refresh
            timerRef.current = scheduleTokenRefresh(idToken, doRefresh);
            resolve();
          },
          onFailure: (err: Error) => {
            setState((prev) => ({
              ...prev,
              status: 'unauthenticated',
              idToken: null,
              error: err.message,
            }));
            resolve();
          },
          newPasswordRequired: () => {
            setState((prev) => ({
              ...prev,
              status: 'unauthenticated',
              idToken: null,
              error: 'Password change required — contact admin',
            }));
            resolve();
          },
        });
      });
    },
    [userPool, doRefresh]
  );

  // ── SIGN UP ────────────────────────────────────────────────────────────

  const signUp = useCallback(
    (email: string, password: string): Promise<void> => {
      return new Promise((resolve) => {
        const attributes = [new CognitoUserAttribute({ Name: 'email', Value: email })];

        userPool.signUp(email, password, attributes, [], (err) => {
          if (err) {
            setState((prev) => ({
              ...prev,
              status: 'unauthenticated',
              error: err.message,
            }));
            resolve();
            return;
          }
          // Auto-sign-in after successful signup
          signIn(email, password).then(resolve);
        });
      });
    },
    [userPool, signIn]
  );

  // ── RETURN ─────────────────────────────────────────────────────────────

  return {
    ...state,
    signIn,
    signUp,
    signOut,
  };
}
