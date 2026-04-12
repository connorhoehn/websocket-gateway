// frontend/src/contexts/IdentityContext.tsx
//
// Provides authenticated user identity info to the tree.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentityContextValue {
  userId: string;
  displayName: string;
  userEmail: string | null;
  idToken: string | null;
  onSignOut: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const IdentityContext = createContext<IdentityContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function IdentityProvider({
  value,
  children,
}: {
  value: IdentityContextValue;
  children: ReactNode;
}) {
  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useIdentityContext(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) {
    throw new Error('useIdentityContext must be used within an <IdentityProvider>');
  }
  return ctx;
}
