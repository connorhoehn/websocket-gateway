import { useMemo } from 'react';
import type { Participant } from '../types/document';

export interface MentionUser {
  userId: string;
  displayName: string;
  color: string;
  online: boolean;
  mode?: string;
}

/** Aggregate mention-able users from awareness participants. */
export function useMentionUsers(participants: Participant[]): MentionUser[] {
  return useMemo(() => {
    const seen = new Set<string>();
    return participants
      .filter(p => {
        const key = p.userId || p.clientId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(p => ({
        userId: p.userId || p.clientId,
        displayName: p.displayName,
        color: p.color,
        online: true, // All awareness participants are online
        mode: p.mode,
      }));
  }, [participants]);
}
