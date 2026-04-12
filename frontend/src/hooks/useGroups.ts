// frontend/src/hooks/useGroups.ts
//
// Groups hook — create/delete/join/leave groups and manage members.
// All requests use Authorization: Bearer idToken against VITE_SOCIAL_API_URL.

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupItem {
  groupId: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  ownerId: string;
  createdAt: string;
}

export interface MemberItem {
  groupId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  displayName?: string;
  status?: string;
}

export interface UseGroupsOptions {
  idToken: string | null;
}

export interface UseGroupsReturn {
  groups: GroupItem[];
  createGroup: (name: string, description?: string, visibility?: 'public' | 'private') => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  joinGroup: (groupId: string) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;
  inviteUser: (groupId: string, userId: string) => Promise<void>;
  acceptInvite: (groupId: string, accept: boolean) => Promise<void>;
  loadMembers: (groupId: string) => Promise<void>;
  members: MemberItem[];
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGroups({ idToken }: UseGroupsOptions): UseGroupsReturn {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  }), [idToken]);

  // ---- createGroup ---------------------------------------------------------

  const createGroup = useCallback(async (
    name: string,
    description?: string,
    visibility?: 'public' | 'private',
  ): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, description, visibility }),
      });
      if (!res.ok) throw new Error(`Failed to create group (${res.status})`);
      const group = await res.json() as GroupItem;
      setGroups((prev) => [group, ...prev]);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl, authHeaders]);  

  // ---- deleteGroup (GRUP-02) -----------------------------------------------

  const deleteGroup = useCallback(async (groupId: string): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to delete group (${res.status})`);
      setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl]);  

  // ---- joinGroup -----------------------------------------------------------

  const joinGroup = useCallback(async (groupId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to join group (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl]);  

  // ---- leaveGroup ----------------------------------------------------------

  const leaveGroup = useCallback(async (groupId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/leave`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to leave group (${res.status})`);
      setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl]);  

  // ---- inviteUser ----------------------------------------------------------

  const inviteUser = useCallback(async (groupId: string, userId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`Failed to invite user (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl, authHeaders]);  

  // ---- acceptInvite --------------------------------------------------------

  const acceptInvite = useCallback(async (groupId: string, accept: boolean): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/accept`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) throw new Error(`Failed to respond to invite (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl, authHeaders]);  

  // ---- loadMembers ---------------------------------------------------------

  const loadMembers = useCallback(async (groupId: string): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to load members (${res.status})`);
      const data = await res.json() as { members: MemberItem[] };
      setMembers(data.members ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl]);  

  return {
    groups,
    createGroup,
    deleteGroup,
    joinGroup,
    leaveGroup,
    inviteUser,
    acceptInvite,
    loadMembers,
    members,
    loading,
    error,
  };
}
