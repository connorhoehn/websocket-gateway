// frontend/src/hooks/useAwareness.ts
//
// Observes a GatewayProvider's awareness instance and exposes:
//  - `participants`: deduplicated list of remote clients (excluding self)
//  - `awareness`: the typed AwarenessUpdaters (merged writer, single source
//    of truth for all local awareness writes)
//
// This hook composes the existing `useAwarenessState` internally so that
// writers remain centralised — independent consumers setting partial
// `user` state can't clobber each other's fields.

import { useState, useEffect } from 'react';
import type { GatewayProvider } from '../providers/GatewayProvider';
import { useAwarenessState } from './useAwarenessState';
import type { AwarenessUpdaters } from './useAwarenessState';
import type { Participant, ViewMode } from '../types/document';

export interface UseAwarenessOptions {
  userId: string;
  displayName: string;
  color: string;
  mode: ViewMode;
}

export interface UseAwarenessReturn {
  awareness: AwarenessUpdaters;
  participants: Participant[];
}

export function useAwareness(
  provider: GatewayProvider | null,
  opts: UseAwarenessOptions,
): UseAwarenessReturn {
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Central writer for local awareness state.
  const awareness = useAwarenessState(provider, {
    userId: opts.userId,
    displayName: opts.displayName,
    color: opts.color,
    mode: opts.mode,
    currentSectionId: null,
  });

  // Observe remote awareness → participants list.
  useEffect(() => {
    if (!provider) {
      setParticipants([]);
      return;
    }

    let prevKey = '';
    const handler = () => {
      const states = provider.awareness.getStates();
      const parts: Participant[] = [];
      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === provider.awareness.clientID) return;
        const user = state.user as Record<string, unknown> | undefined;
        if (!user) return;
        parts.push({
          clientId: String(clientId),
          userId: (user.userId as string) ?? '',
          displayName: (user.displayName as string) ?? 'Anonymous',
          color: (user.color as string) ?? '#3b82f6',
          mode:
            user.mode === 'ack'
              ? 'reviewer'
              : user.mode === 'reader'
                ? 'reader'
                : 'editor',
          currentSectionId: (user.currentSectionId as string | null) ?? null,
          lastSeen: (user.lastSeen as number) ?? Date.now(),
          idle: (user.idle as boolean) ?? false,
        });
      });

      // Dedup by userId|displayName|clientId — keep most recent per user.
      const seen = new Map<string, Participant>();
      for (const p of parts) {
        const key = p.userId || p.displayName || p.clientId;
        const existing = seen.get(key);
        if (!existing || (p.lastSeen ?? 0) > (existing.lastSeen ?? 0)) {
          seen.set(key, p);
        }
      }

      const next = Array.from(seen.values());
      const nextKey = next
        .map(
          (p) => `${p.clientId}:${p.currentSectionId}:${p.mode}:${p.idle}`,
        )
        .join('|');
      if (nextKey === prevKey) return;
      prevKey = nextKey;
      queueMicrotask(() => setParticipants(next));
    };

    provider.awareness.on('change', handler);
    // Initial read
    handler();

    return () => {
      provider.awareness.off('change', handler);
    };
  }, [provider]);

  return { awareness, participants };
}
