// frontend/src/hooks/useCursors.ts
//
// useCursors hook — freeform cursor mode.
// Subscribes to the gateway cursor service, broadcasts local mouse position,
// and maintains a live map of remote cursors from other connected clients.
//
// Plans 07-03 and 07-04 extend this hook by adding sendTableUpdate,
// sendTextUpdate, and sendCanvasUpdate — designed to be additive.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RemoteCursor {
  clientId: string;
  position: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface UseCursorsReturn {
  cursors: Map<string, RemoteCursor>;
  sendFreeformUpdate: (x: number, y: number) => void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseCursorsOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
  clientId: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCursors(options: UseCursorsOptions): UseCursorsReturn {
  const { sendMessage, onMessage, currentChannel, connectionState, clientId } =
    options;

  // cursorsRef is the authoritative store. We only call setCursors to
  // trigger a re-render — avoiding a full render on every byte update.
  const cursorsRef = useRef<Map<string, RemoteCursor>>(new Map());
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());

  // Throttle timer for 50ms mousemove rate-limiting.
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to the current channel so the message handler closure always
  // reads the freshest value without being torn down on every channel change.
  const channelRef = useRef<string>(currentChannel);
  useEffect(() => {
    channelRef.current = currentChannel;
  }, [currentChannel]);

  // Keep a ref to the current connection state for sendFreeformUpdate guard.
  const connectionStateRef = useRef<ConnectionState>(connectionState);
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  // Keep a ref to the local clientId so the message handler can filter
  // without being torn down every time clientId changes.
  const clientIdRef = useRef<string | null>(clientId);
  useEffect(() => {
    clientIdRef.current = clientId;
  }, [clientId]);

  // ---- Inbound message handler -------------------------------------------

  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type !== 'cursor') return;

      const action = msg.action as string | undefined;

      if (action === 'subscribed') {
        // Initialize cursors from the full list, filtering own clientId.
        const rawCursors = (msg.cursors as RemoteCursor[] | undefined) ?? [];
        const newMap = new Map<string, RemoteCursor>();
        for (const cursor of rawCursors) {
          if (cursor.clientId !== clientIdRef.current) {
            newMap.set(cursor.clientId, cursor);
          }
        }
        cursorsRef.current = newMap;
        setCursors(new Map(newMap));
        return;
      }

      if (action === 'update') {
        const cursor = msg.cursor as RemoteCursor | undefined;
        if (!cursor) return;
        if (cursor.clientId === clientIdRef.current) return; // Skip own cursor

        cursorsRef.current.set(cursor.clientId, cursor);
        setCursors(new Map(cursorsRef.current));
        return;
      }

      if (action === 'remove') {
        const removedId = msg.clientId as string | undefined;
        if (!removedId) return;
        cursorsRef.current.delete(removedId);
        setCursors(new Map(cursorsRef.current));
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Subscribe / Unsubscribe -------------------------------------------

  useEffect(() => {
    if (connectionState !== 'connected' || !currentChannel) return;

    sendMessage({
      service: 'cursor',
      action: 'subscribe',
      channel: currentChannel,
      mode: 'freeform',
    });

    return () => {
      // Unsubscribe and clear cursor state on channel change or unmount.
      sendMessage({
        service: 'cursor',
        action: 'unsubscribe',
        channel: currentChannel,
      });

      cursorsRef.current = new Map();
      setCursors(new Map());

      // Clear any pending throttle timer on cleanup.
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [currentChannel, connectionState, sendMessage]);

  // ---- sendFreeformUpdate ------------------------------------------------

  const sendFreeformUpdate = useCallback(
    (x: number, y: number) => {
      // Guard: only send when connected.
      if (connectionStateRef.current !== 'connected') return;

      // Throttle: drop calls within a 50ms window (leading-edge throttle).
      if (throttleTimerRef.current !== null) return;

      sendMessage({
        service: 'cursor',
        action: 'update',
        channel: channelRef.current,
        position: { x, y },
        metadata: { mode: 'freeform' },
      });

      // Set throttle timer — after 50ms, clear so the next call goes through.
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
      }, 50);
    },
    [sendMessage]
  );

  return { cursors, sendFreeformUpdate };
}
