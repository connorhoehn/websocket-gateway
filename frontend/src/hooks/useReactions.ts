// frontend/src/hooks/useReactions.ts
//
// Reactions hook — subscribes to the gateway reactions service, sends
// ephemeral emoji reactions to the current channel, and receives incoming
// reactions from all channel members. Reactions are displayed as animated
// overlays that auto-disappear after 2.5 seconds.
//
// Composes on top of useWebSocket: accepts sendMessage / onMessage from that
// hook and handles the reactions protocol independently.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EphemeralReaction {
  id: string;          // unique identifier for removal
  emoji: string;
  x: number;           // percentage 10-90
  y: number;           // percentage 10-90
  timestamp: string;   // ISO string from server
}

export interface UseReactionsOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
}

export interface UseReactionsReturn {
  activeReactions: EphemeralReaction[];
  react: (emoji: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReactions(options: UseReactionsOptions): UseReactionsReturn {
  const { sendMessage, onMessage, currentChannel, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [activeReactions, setActiveReactions] = useState<EphemeralReaction[]>([]);

  // ---- Refs ----------------------------------------------------------------
  // Keep stable references for use inside effects without stale closures
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const currentChannelRef = useRef(currentChannel);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  // ---- Message handler -----------------------------------------------------
  // Separate effect from subscribe so the handler survives channel changes
  // without being torn down. Channel filtering is done inside the handler
  // using currentChannelRef so closures always see the latest channel.
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type === 'reactions:reaction') {
        // Only process reactions for the current channel
        if (msg.channel !== currentChannelRef.current) return;

        const reaction: EphemeralReaction = {
          id: `${Date.now()}-${Math.random()}`,
          emoji: msg.emoji as string,
          x: Math.floor(Math.random() * 81) + 10,  // 10-90
          y: Math.floor(Math.random() * 81) + 10,  // 10-90
          timestamp: msg.timestamp as string,
        };

        setActiveReactions((prev) => [...prev, reaction]);

        // Auto-remove after 2.5 seconds using the unique id
        setTimeout(() => {
          setActiveReactions((prev) => prev.filter((r) => r.id !== reaction.id));
        }, 2500);
      }
      // reactions:subscribed is silently ignored — no state change needed
    });

    return unregister;
  }, [onMessage]);

  // ---- Subscribe / unsubscribe on connect / channel change -----------------
  useEffect(() => {
    // Guard: only subscribe when connected and channel is set
    if (connectionState !== 'connected' || !currentChannel) {
      return;
    }

    // Subscribe to the channel
    sendMessage({ service: 'reaction', action: 'subscribe', channel: currentChannel });

    // Note: reactions are cleared in the cleanup function of the previous
    // effect iteration, so no need to clear here.

    // Cleanup: unsubscribe when channel changes or unmounts
    return () => {
      sendMessageRef.current({
        service: 'reaction',
        action: 'unsubscribe',
        channel: currentChannel,
      });
      // Clear reactions on channel exit
      setActiveReactions([]);
    };
  }, [currentChannel, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — we use sendMessageRef for stable access.

  // ---- react() ---------------------------------------------------------------
  // Stable callback — accesses current channel and sendMessage via refs
  const react = useCallback((emoji: string) => {
    sendMessageRef.current({
      service: 'reaction',
      action: 'react',
      channel: currentChannelRef.current,
      emoji,
    });
  }, []);  
  // All deps accessed via refs — stable callback that never causes re-renders

  return { activeReactions, react };
}
