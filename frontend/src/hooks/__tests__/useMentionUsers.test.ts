import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMentionUsers } from '../useMentionUsers';
import { DEV_USERS, DEV_GROUPS } from '../../data/userDirectory';
import type { Participant } from '../../types/document';

// Helper to build a minimal Participant.
function mkParticipant(overrides: Partial<Participant> & { clientId: string; displayName: string }): Participant {
  return {
    userId: overrides.userId ?? '',
    clientId: overrides.clientId,
    displayName: overrides.displayName,
    color: overrides.color ?? '#000000',
    mode: overrides.mode,
  } as Participant;
}

describe('useMentionUsers', () => {
  it('returns only directory users + groups when no one is online', () => {
    const { result } = renderHook(() => useMentionUsers([]));
    const users = result.current.filter(r => r.type === 'user');
    const groups = result.current.filter(r => r.type === 'group');
    expect(users).toHaveLength(DEV_USERS.length);
    expect(groups).toHaveLength(DEV_GROUPS.length);
    // All users should be offline in this state
    expect(users.every(u => u.online === false)).toBe(true);
  });

  it('orders results: online users → offline users → groups', () => {
    const participants: Participant[] = [
      mkParticipant({ clientId: 'c1', userId: 'alice', displayName: 'Alice Chen', color: '#3b82f6' }),
    ];
    const { result } = renderHook(() => useMentionUsers(participants));
    const types = result.current.map(r => ({ online: r.online, type: r.type }));
    // First entry: online user
    expect(types[0]).toEqual({ online: true, type: 'user' });
    // Group entries appear last
    expect(types[types.length - 1].type).toBe('group');
  });

  it('marks participants online and merges with directory data (color, displayName) when matched', () => {
    const participants: Participant[] = [
      mkParticipant({ clientId: 'c1', userId: 'alice', displayName: 'Alice Chen' }),
    ];
    const { result } = renderHook(() => useMentionUsers(participants));
    const alice = result.current.find(u => u.userId === 'alice');
    expect(alice).toBeDefined();
    expect(alice!.online).toBe(true);
    expect(alice!.type).toBe('user');
    // Color from directory is preferred over the participant's
    expect(alice!.color).toBe('#3b82f6');
  });

  it('matches participant to directory user by first-name fallback', () => {
    // Participant displayName is "Hank" (short form) but directory has "Hank Anderson"
    const participants: Participant[] = [
      mkParticipant({ clientId: 'c2', userId: 'hank-2yfy', displayName: 'Hank' }),
    ];
    const { result } = renderHook(() => useMentionUsers(participants));
    const hank = result.current.find(u => u.userId === 'hank-2yfy');
    expect(hank).toBeDefined();
    expect(hank!.online).toBe(true);
    // DisplayName should upgrade to the directory's full name
    expect(hank!.displayName).toBe('Hank Anderson');
  });

  it('does not duplicate a user when they appear both as a participant and in the directory', () => {
    const participants: Participant[] = [
      mkParticipant({ clientId: 'c1', userId: 'alice', displayName: 'Alice Chen' }),
    ];
    const { result } = renderHook(() => useMentionUsers(participants));
    const aliceEntries = result.current.filter(u => u.displayName === 'Alice Chen');
    expect(aliceEntries).toHaveLength(1);
    expect(aliceEntries[0].online).toBe(true);
  });

  it('groups carry their member count', () => {
    const { result } = renderHook(() => useMentionUsers([]));
    const groups = result.current.filter(r => r.type === 'group');
    for (const g of groups) {
      const directoryGroup = DEV_GROUPS.find(dg => dg.name === g.displayName);
      expect(g.memberCount).toBe(directoryGroup!.memberIds.length);
    }
  });

  it('handles a participant with no userId by falling back to clientId', () => {
    const participants: Participant[] = [
      mkParticipant({ clientId: 'anon-123', userId: '', displayName: 'Guest' }),
    ];
    const { result } = renderHook(() => useMentionUsers(participants));
    const guest = result.current.find(u => u.userId === 'anon-123');
    expect(guest).toBeDefined();
    expect(guest!.online).toBe(true);
  });
});
