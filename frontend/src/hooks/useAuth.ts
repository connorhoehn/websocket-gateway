// frontend/src/hooks/useAuth.ts
//
// Cognito USER_PASSWORD_AUTH hook.
// Manages the full auth lifecycle: session restore, sign-in, sign-up, sign-out.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
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
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    idToken: null,
    email: null,
    error: null,
  });

  // Create a stable userPool instance for the lifetime of this hook instance
  const userPool = useMemo(
    () =>
      new CognitoUserPool({
        UserPoolId: (import.meta.env as Record<string, string>).VITE_COGNITO_USER_POOL_ID ?? '',
        ClientId: (import.meta.env as Record<string, string>).VITE_COGNITO_CLIENT_ID ?? '',
      }),
    []
  );

  // ── SESSION RESTORE (on mount) ──────────────────────────────────────────

  useEffect(() => {
    const storedUser = userPool.getCurrentUser();

    if (!storedUser) {
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
      }
    });
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
          newPasswordRequired: (_userAttrs: Record<string, unknown>) => {
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
    [userPool]
  );

  // ── SIGN UP ────────────────────────────────────────────────────────────

  const signUp = useCallback(
    (email: string, password: string): Promise<void> => {
      return new Promise((resolve) => {
        const attributes = [new CognitoUserAttribute({ Name: 'email', Value: email })];

        userPool.signUp(email, password, attributes, [], (err, _result) => {
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

  // ── SIGN OUT ───────────────────────────────────────────────────────────

  const signOut = useCallback(() => {
    userPool.getCurrentUser()?.signOut();
    localStorage.removeItem(STORAGE_ID_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_EMAIL);
    setState({
      status: 'unauthenticated',
      idToken: null,
      email: null,
      error: null,
    });
  }, [userPool]);

  // ── RETURN ─────────────────────────────────────────────────────────────

  return {
    ...state,
    signIn,
    signUp,
    signOut,
  };
}
