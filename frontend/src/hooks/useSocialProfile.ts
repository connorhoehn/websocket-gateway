// frontend/src/hooks/useSocialProfile.ts
//
// Social profile hook — fetches and updates the authenticated user's own
// profile, and provides viewProfile() for inspecting other users.
// All requests go to VITE_SOCIAL_API_URL with Authorization: Bearer idToken.

import { useState, useEffect, useCallback } from 'react';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileItem {
  userId: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}

export interface UseSocialProfileOptions {
  idToken: string | null;
}

export interface UseSocialProfileReturn {
  profile: ProfileItem | null;
  loading: boolean;
  error: string | null;
  updateProfile: (updates: Partial<ProfileItem>) => Promise<void>;
  viewProfile: (userId: string) => Promise<ProfileItem | null>;
}

// Satisfy the onMessage type used across social hooks (not used in this hook,
// but exported for re-use by sibling hooks).
export type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSocialProfile({ idToken }: UseSocialProfileOptions): UseSocialProfileReturn {
  const [profile, setProfile] = useState<ProfileItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  // ---- Helpers --------------------------------------------------------------

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  }), [idToken]);

  // ---- On mount: fetch own profile -----------------------------------------

  useEffect(() => {
    if (!idToken) return;

    let sub: string;
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1]));
      sub = payload.sub as string;
    } catch {
      setError('Invalid token');
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`${baseUrl}/api/profiles/${sub}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
        return res.json() as Promise<ProfileItem>;
      })
      .then((data) => {
        setProfile(data);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- updateProfile -------------------------------------------------------

  const updateProfile = useCallback(async (updates: Partial<ProfileItem>): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/profiles`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`Failed to update profile (${res.status})`);
      const updated = await res.json() as ProfileItem;
      setProfile(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl, authHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- viewProfile ---------------------------------------------------------

  const viewProfile = useCallback(async (userId: string): Promise<ProfileItem | null> => {
    if (!idToken) return null;
    try {
      const res = await fetch(`${baseUrl}/api/profiles/${userId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to view profile (${res.status})`);
      return await res.json() as ProfileItem;
    } catch {
      return null;
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return { profile, loading, error, updateProfile, viewProfile };
}
