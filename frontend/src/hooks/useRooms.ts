// frontend/src/hooks/useRooms.ts
//
// Rooms hook — list/create/join/leave rooms plus real-time member tracking.
// Handles social:member_joined and social:member_left WebSocket events (RTIM-04).
// All requests use Authorization: Bearer idToken against VITE_SOCIAL_API_URL.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomItem {
  roomId: string;
  channelId: string;
  name: string;
  type: 'standalone' | 'group' | 'dm';
  ownerId: string;
  groupId?: string;
  dmPeerUserId?: string;
  createdAt: string;
}

export interface RoomMemberItem {
  roomId: string;
  userId: string;
  displayName?: string;
  joinedAt: string;
}

export type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

export interface UseRoomsOptions {
  idToken: string | null;
  onMessage: OnMessageFn;
}

export interface UseRoomsReturn {
  rooms: RoomItem[];
  activeRoom: RoomItem | null;
  setActiveRoom: (room: RoomItem | null) => void;
  createRoom: (name: string) => Promise<void>;
  createDM: (peerId: string) => Promise<void>;
  createGroupRoom: (groupId: string, name: string) => Promise<void>;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: (roomId: string) => Promise<void>;
  loadMembers: (roomId: string) => Promise<void>;
  members: RoomMemberItem[];
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRooms({ idToken, onMessage }: UseRoomsOptions): UseRoomsReturn {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [activeRoom, setActiveRoomState] = useState<RoomItem | null>(null);
  const [members, setMembers] = useState<RoomMemberItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  // ---- Stable refs for WS handler -----------------------------------------

  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const activeRoomRef = useRef<string | null>(null);

  // ---- On mount: fetch my rooms --------------------------------------------

  useEffect(() => {
    if (!idToken) return;

    setLoading(true);
    setError(null);

    fetch(`${baseUrl}/api/rooms`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load rooms (${res.status})`);
        return res.json() as Promise<{ rooms: RoomItem[] }>;
      })
      .then((data) => {
        setRooms(data.rooms ?? []);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- WS handler: member joined / member left (RTIM-04) ------------------

  useEffect(() => {
    const unregister = onMessageRef.current((msg) => {
      if (msg.type === 'social:member_joined' && msg.roomId === activeRoomRef.current) {
        setMembers((prev) => [
          ...prev,
          {
            roomId: msg.roomId as string,
            userId: msg.userId as string,
            displayName: msg.displayName as string | undefined,
            joinedAt: new Date().toISOString(),
          },
        ]);
      } else if (msg.type === 'social:member_left' && msg.roomId === activeRoomRef.current) {
        setMembers((prev) => prev.filter((m) => m.userId !== (msg.userId as string)));
      }
    });

    return unregister;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- loadMembers (ROOM-06) -----------------------------------------------

  const loadMembers = useCallback(async (roomId: string): Promise<void> => {
    if (!idToken) return;
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to load members (${res.status})`);
      const data = await res.json() as { members: RoomMemberItem[] };
      setMembers(data.members ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- setActiveRoom -------------------------------------------------------

  const setActiveRoom = useCallback((room: RoomItem | null): void => {
    activeRoomRef.current = room?.roomId ?? null;
    setActiveRoomState(room);
    if (room) {
      void loadMembers(room.roomId);
    }
  }, [loadMembers]);

  // ---- createRoom ----------------------------------------------------------

  const createRoom = useCallback(async (name: string): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Failed to create room (${res.status})`);
      const room = await res.json() as RoomItem;
      setRooms((prev) => [room, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- createDM ------------------------------------------------------------

  const createDM = useCallback(async (peerId: string): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/dm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ peerId }),
      });
      if (!res.ok) throw new Error(`Failed to create DM (${res.status})`);
      const room = await res.json() as RoomItem;
      setRooms((prev) => [room, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- joinRoom ------------------------------------------------------------

  const joinRoom = useCallback(async (roomId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to join room (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- leaveRoom -----------------------------------------------------------

  const leaveRoom = useCallback(async (roomId: string): Promise<void> => {
    if (!idToken) return;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/leave`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to leave room (${res.status})`);
      setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- createGroupRoom (ROOM-02) -------------------------------------------

  const createGroupRoom = useCallback(async (groupId: string, name: string): Promise<void> => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/groups/${groupId}/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Failed to create group room (${res.status})`);
      const room = await res.json() as RoomItem;
      setRooms((prev) => [room, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [idToken, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rooms,
    activeRoom,
    setActiveRoom,
    createRoom,
    createDM,
    createGroupRoom,
    joinRoom,
    leaveRoom,
    loadMembers,
    members,
    loading,
    error,
  };
}
