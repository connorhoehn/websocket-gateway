// frontend/src/hooks/useChat.ts
//
// Chat hook — subscribes to the gateway chat service, loads the last 100
// history messages on join, sends messages to the current channel, and
// delivers real-time incoming messages to callers.
//
// Composes on top of useWebSocket: accepts sendMessage / onMessage from that
// hook and handles the chat protocol independently.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  clientId: string;
  content: string;
  timestamp: string;  // ISO string from server
}

export interface UseChatOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  send: (content: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions): UseChatReturn {
  const { sendMessage, onMessage, currentChannel, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);

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
      if (msg.type === 'chat:history') {
        // Only process history for the current channel
        if (msg.channel !== currentChannelRef.current) return;
        const incoming = (msg.messages as Array<{ clientId: string; content: string; timestamp: string }> | undefined) ?? [];
        setMessages(incoming.map((m) => ({
          clientId: m.clientId,
          content: m.content,
          timestamp: m.timestamp,
        })));
        return;
      }

      if (msg.type === 'chat:message') {
        // Only process messages for the current channel
        if (msg.channel !== currentChannelRef.current) return;
        const incoming: ChatMessage = {
          clientId: msg.clientId as string,
          content: msg.content as string,
          timestamp: msg.timestamp as string,
        };
        setMessages((prev) => [...prev, incoming]);
        return;
      }
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
    sendMessage({ service: 'chat', action: 'subscribe', channel: currentChannel });

    // Clear messages for the new channel (fresh state on channel join)
    setMessages([]);

    // Cleanup: unsubscribe when channel changes or unmounts
    return () => {
      sendMessageRef.current({
        service: 'chat',
        action: 'unsubscribe',
        channel: currentChannel,
      });
      // Clear messages on channel exit
      setMessages([]);
    };
  }, [currentChannel, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — we use sendMessageRef for stable access.

  // ---- send() ---------------------------------------------------------------
  // Stable callback — accesses current channel and sendMessage via refs
  const send = useCallback((content: string) => {
    sendMessageRef.current({
      service: 'chat',
      action: 'message',
      channel: currentChannelRef.current,
      content,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // All deps accessed via refs — stable callback that never causes re-renders

  return { messages, send };
}
