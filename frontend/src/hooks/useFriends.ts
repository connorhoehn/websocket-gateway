// frontend/src/hooks/useFriends.ts
//
// Social graph hook — followers, following, friends lists with follow/unfollow.
// All requests use Authorization: Bearer idToken against VITE_SOCIAL_API_URL.

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicProfile {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  visibility: 'public' | 'private';
}

export interface UseFriendsOptions {
  idToken: string | null;
}

export interface UseFriendsReturn {
  followers: PublicProfile[];
  following: PublicProfile[];
  friends: PublicProfile[];
  follow: (userId: string) => Promise<void>;
  unfollow: (userId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFriends({ idToken }: UseFriendsOptions): UseFriendsReturn {
  const [followers, setFollowers] = useState<PublicProfile[]>([]);
  const [following, setFollowing] = useState<PublicProfile[]>([]);
  const [friends, setFriends] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  // ---- On mount: fetch all three lists in parallel -------------------------

  useEffect(() => {
    if (!idToken || !baseUrl) return;

    setLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${idToken}` };

    Promise.all([
      fetch(`${baseUrl}/api/social/followers`, { headers }).then((r) => r.json()),
      fetch(`${baseUrl}/api/social/following`, { headers }).then((r) => r.json()),
      fetch(`${baseUrl}/api/social/friends`, { headers }).then((r) => r.json()),
    ])
      .then(([followersRes, followingRes, friendsRes]) => {
        setFollowers((followersRes as { followers: PublicProfile[] }).followers ?? []);
        setFollowing((followingRes as { following: PublicProfile[] }).following ?? []);
        setFriends((friendsRes as { friends: PublicProfile[] }).friends ?? []);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, baseUrl]);  

  // ---- Refresh following list helper ---------------------------------------

  const refreshFollowing = useCallback(async (): Promise<void> => {
    if (!idToken) return;
    const res = await fetch(`${baseUrl}/api/social/following`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.ok) {
      const data = await res.json() as { following: PublicProfile[] };
      setFollowing(data.following ?? []);
    }
  }, [idToken, baseUrl]);  

  // ---- follow --------------------------------------------------------------

  const follow = useCallback(async (userId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/social/follow/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to follow (${res.status})`);
      await refreshFollowing();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, [idToken, baseUrl, refreshFollowing]);  

  // ---- unfollow ------------------------------------------------------------

  const unfollow = useCallback(async (userId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/social/follow/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to unfollow (${res.status})`);
      await refreshFollowing();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, [idToken, baseUrl, refreshFollowing]);  

  return { followers, following, friends, follow, unfollow, loading, error };
}
