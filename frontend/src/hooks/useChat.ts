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
  id?: string;        // server-assigned message ID for deduplication
  clientId: string;
  content: string;
  timestamp: string;  // ISO string from server
  displayName?: string;
}

export interface UseChatOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
  displayName: string;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  send: (content: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions): UseChatReturn {
  const { sendMessage, onMessage, currentChannel, connectionState, displayName } = options;

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

  const displayNameRef = useRef(displayName);
  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  // ---- Message handler -----------------------------------------------------
  // Separate effect from subscribe so the handler survives channel changes
  // without being torn down. Channel filtering is done inside the handler
  // using currentChannelRef so closures always see the latest channel.
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type === 'chat' && msg.action === 'history') {
        // Only process history for the current channel
        if (msg.channel !== currentChannelRef.current) return;
        const incoming = (msg.messages as Array<{ clientId: string; message: string; timestamp: string; metadata?: { displayName?: string } }> | undefined) ?? [];
        setMessages(incoming.map((m) => ({
          clientId: m.clientId,
          content: m.message,
          timestamp: m.timestamp,
          displayName: m.metadata?.displayName,
        })));
        return;
      }

      if (msg.type === 'chat' && msg.action === 'message') {
        // Only process messages for the current channel
        if (msg.channel !== currentChannelRef.current) return;
        const messageData = msg.message as { id?: string; clientId: string; message: string; timestamp: string; channel: string; metadata?: { displayName?: string } } | undefined;
        if (!messageData) return;
        const incoming: ChatMessage = {
          id: messageData.id,
          clientId: messageData.clientId,
          content: messageData.message,
          timestamp: messageData.timestamp,
          displayName: messageData.metadata?.displayName,
        };
        setMessages((prev) => {
          // Deduplicate by server message ID
          if (incoming.id && prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
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

    // Join the channel
    sendMessage({ service: 'chat', action: 'join', channel: currentChannel });

    // Note: messages are cleared in the cleanup function of the previous
    // effect iteration, so no need to clear here.

    // Cleanup: leave channel when channel changes or unmounts
    return () => {
      sendMessageRef.current({
        service: 'chat',
        action: 'leave',
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
      action: 'send',
      channel: currentChannelRef.current,
      message: content,
      metadata: { displayName: displayNameRef.current },
    });
  }, []);  
  // All deps accessed via refs — stable callback that never causes re-renders

  return { messages, send };
}
