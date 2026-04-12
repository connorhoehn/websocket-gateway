// frontend/src/hooks/usePresence.ts
//
// Presence hook — subscribes to the gateway presence service, maintains a
// live user list for the current channel, and provides a setTyping helper.
//
// Composes on top of useWebSocket: accepts sendMessage / onMessage from that
// hook and handles the presence protocol independently.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PresenceUser {
  clientId: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface UsePresenceReturn {
  users: PresenceUser[];
  setTyping: (isTyping: boolean) => void;
}

export interface UsePresenceOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
  displayName: string;
}

// Heartbeat interval in milliseconds
const HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePresence(options: UsePresenceOptions): UsePresenceReturn {
  const { sendMessage, onMessage, currentChannel, connectionState, displayName } = options;

  // ---- State ---------------------------------------------------------------
  const [users, setUsers] = useState<Map<string, PresenceUser>>(new Map());

  // ---- Refs ----------------------------------------------------------------
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep stable references for use inside effects without stale closures
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const currentChannelRef = useRef(currentChannel);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const displayNameRef = useRef(displayName);
  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  // ---- Message handler -----------------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type !== 'presence') return;

      if (msg.action === 'subscribed') {
        // Server sends { presence: [...] } with the current channel users
        const incoming = (msg.presence as PresenceUser[] | undefined)
          ?? (msg.users as PresenceUser[] | undefined)
          ?? [];
        const map = new Map<string, PresenceUser>();
        for (const user of incoming) {
          map.set(user.clientId, user);
        }
        setUsers(map);
        return;
      }

      if (msg.action === 'update') {
        // Server sends { presence: { clientId, status, metadata, ... } }
        const presence = msg.presence as { clientId: string; status: string; metadata: Record<string, unknown> } | undefined;
        const clientId = presence?.clientId ?? (msg.clientId as string);
        if (!clientId) return;
        const status = presence?.status ?? 'online';
        const metadata = presence?.metadata ?? {};
        setUsers((prev) => {
          const next = new Map(prev);
          next.set(clientId, { clientId, status, metadata });
          return next;
        });
        return;
      }

      if (msg.action === 'offline') {
        const clientId = msg.clientId as string;
        setUsers((prev) => {
          const next = new Map(prev);
          next.delete(clientId);
          return next;
        });
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Subscribe / heartbeat on connect / channel change ------------------
  useEffect(() => {
    // Guard: only subscribe when connected and channel is set
    if (connectionState !== 'connected' || !currentChannel) {
      return;
    }

    // Subscribe to the channel
    sendMessage({ service: 'presence', action: 'subscribe', channel: currentChannel });

    // Announce ourselves as online in this channel
    sendMessage({
      service: 'presence',
      action: 'set',
      status: 'online',
      metadata: { displayName: displayNameRef.current },
      channels: [currentChannel],
    });

    // Start heartbeat interval
    heartbeatRef.current = setInterval(() => {
      sendMessageRef.current({
        service: 'presence',
        action: 'heartbeat',
        metadata: { displayName: displayNameRef.current, isTyping: false },
        channels: [currentChannelRef.current],
      });
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup: unsubscribe and clear interval when channel changes or unmounts
    return () => {
      if (heartbeatRef.current !== null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      // Only unsubscribe if we were actually connected when this effect ran
      sendMessageRef.current({
        service: 'presence',
        action: 'unsubscribe',
        channel: currentChannel,
      });
      // Clear user list on channel exit
      setUsers(new Map());
    };
  }, [currentChannel, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — we use sendMessageRef for stable access.

  // ---- setTyping -----------------------------------------------------------
  const setTyping = useCallback(
    (isTyping: boolean) => {
      sendMessageRef.current({
        service: 'presence',
        action: 'set',
        status: isTyping ? 'typing' : 'online',
        metadata: { displayName: displayNameRef.current, isTyping },
        channels: [currentChannelRef.current],
      });

      if (isTyping) {
        // Auto-clear: reset the timer so repeated calls extend the window
        if (typingTimerRef.current !== null) {
          clearTimeout(typingTimerRef.current);
        }
        typingTimerRef.current = setTimeout(() => {
          sendMessageRef.current({
            service: 'presence',
            action: 'set',
            status: 'online',
            metadata: { displayName: displayNameRef.current, isTyping: false },
            channels: [currentChannelRef.current],
          });
          typingTimerRef.current = null;
        }, 2_000);
      } else {
        // Explicit stop: cancel any pending auto-clear
        if (typingTimerRef.current !== null) {
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = null;
        }
      }
    },
    []  
    // All deps are accessed via refs — stable callback that never causes re-renders
  );

  // ---- Derive array from map for consumers ---------------------------------
  const usersArray = Array.from(users.values());

  return { users: usersArray, setTyping };
}
