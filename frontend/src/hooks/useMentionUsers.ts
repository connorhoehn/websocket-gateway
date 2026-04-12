import { useMemo } from 'react';
import type { Participant } from '../types/document';
import { DEV_USERS, DEV_GROUPS } from '../data/userDirectory';
import type { UserGroup } from '../data/userDirectory';

export interface MentionUser {
  userId: string;
  displayName: string;
  color: string;
  online: boolean;
  mode?: string;
  type: 'user' | 'group';
  memberCount?: number;
}

/**
 * Aggregate mention-able users from awareness (online) + user directory (offline) + groups.
 * Online users appear first, then offline users, then groups.
 */
export function useMentionUsers(participants: Participant[]): MentionUser[] {
  return useMemo(() => {
    const seen = new Set<string>();
    const results: MentionUser[] = [];

    // 1. Online users from awareness (top priority)
    for (const p of participants) {
      const key = p.userId || p.clientId;
      if (seen.has(key)) continue;
      seen.add(key);
      // Also match by first name to connect awareness to directory
      const dirMatch = DEV_USERS.find(u =>
        u.displayName.toLowerCase() === p.displayName.toLowerCase() ||
        u.displayName.split(' ')[0].toLowerCase() === p.displayName.split(' ')[0].toLowerCase()
      );
      results.push({
        userId: p.userId || p.clientId,
        displayName: dirMatch?.displayName || p.displayName,
        color: dirMatch?.color || p.color,
        online: true,
        mode: p.mode,
        type: 'user',
      });
    }

    // 2. Offline users from directory
    for (const u of DEV_USERS) {
      if (seen.has(u.userId)) continue;
      // Check if already added by display name match
      if (results.some(r => r.displayName === u.displayName)) continue;
      results.push({
        userId: u.userId,
        displayName: u.displayName,
        color: u.color,
        online: false,
        type: 'user',
      });
    }

    // 3. Groups
    for (const g of DEV_GROUPS) {
      results.push({
        userId: g.id,
        displayName: g.name,
        color: g.color,
        online: false,
        type: 'group',
        memberCount: g.memberIds.length,
      });
    }

    return results;
  }, [participants]);
}

export type { UserGroup };
