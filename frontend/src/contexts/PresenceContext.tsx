// frontend/src/contexts/PresenceContext.tsx
//
// Provides presence user list and typing state to the tree.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { PresenceUser } from '../hooks/usePresence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceContextValue {
  presenceUsers: PresenceUser[];
  currentClientId: string | null;
  setTyping: (isTyping: boolean) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PresenceContext = createContext<PresenceContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PresenceProvider({
  value,
  children,
}: {
  value: PresenceContextValue;
  children: ReactNode;
}) {
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function usePresenceContext(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) {
    throw new Error('usePresenceContext must be used within a <PresenceProvider>');
  }
  return ctx;
}
