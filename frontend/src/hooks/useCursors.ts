// frontend/src/hooks/useCursors.ts
//
// useCursors hook — multi-mode cursor (freeform, table, text, canvas).
// Subscribes to the gateway cursor service, broadcasts local cursor position
// and metadata, and maintains a live map of remote cursors from other clients.
//
// Plans 07-02, 07-03, 07-04 extended this hook additively with each mode.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CursorMode = 'freeform' | 'table' | 'text' | 'canvas';
export type CanvasTool = 'brush' | 'pen' | 'eraser' | 'select';

export interface RemoteCursor {
  clientId: string;
  position: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface TextSelectionData {
  start: number;
  end: number;
  text: string;
}

export interface UseCursorsReturn {
  cursors: Map<string, RemoteCursor>;
  activeMode: CursorMode;
  sendFreeformUpdate: (x: number, y: number) => void;
  sendTableUpdate: (row: number, col: number) => void;
  sendTextUpdate: (position: number, selectionData: TextSelectionData | null, hasSelection: boolean) => void;
  sendCanvasUpdate: (x: number, y: number, tool: CanvasTool, color: string, size: number) => void;
  switchMode: (mode: CursorMode) => void;
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
  displayName: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCursors(options: UseCursorsOptions): UseCursorsReturn {
  const { sendMessage, onMessage, currentChannel, connectionState, clientId, displayName } =
    options;

  // cursorsRef is the authoritative store. We only call setCursors to
  // trigger a re-render — avoiding a full render on every byte update.
  const cursorsRef = useRef<Map<string, RemoteCursor>>(new Map());
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());

  // Active cursor mode — controls which subscription mode is used.
  const [activeMode, setActiveMode] = useState<CursorMode>('freeform');
  const activeModeRef = useRef<CursorMode>('freeform');

  // Throttle timer for 50ms mousemove rate-limiting (freeform).
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to the current channel so the message handler closure always
  // reads the freshest value without being torn down on every channel change.
  const channelRef = useRef<string>(currentChannel);
  useEffect(() => {
    channelRef.current = currentChannel;
  }, [currentChannel]);

  // Keep a ref to the current connection state for send guards.
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

  // Keep a ref to displayName so send callbacks always read the freshest value.
  const displayNameRef = useRef<string>(displayName);
  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

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
  // Re-runs when channel, connectionState, or activeMode changes.

  useEffect(() => {
    if (connectionState !== 'connected' || !currentChannel) return;

    sendMessage({
      service: 'cursor',
      action: 'subscribe',
      channel: currentChannel,
      mode: activeMode,
    });

    return () => {
      // Unsubscribe and clear cursor state on channel/mode change or unmount.
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
  }, [currentChannel, connectionState, activeMode, sendMessage]);

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
        metadata: { mode: 'freeform', displayName: displayNameRef.current },
      });

      // Set throttle timer — after 50ms, clear so the next call goes through.
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
      }, 50);
    },
    [sendMessage]
  );

  // ---- sendTableUpdate ---------------------------------------------------

  const sendTableUpdate = useCallback(
    (row: number, col: number) => {
      if (connectionStateRef.current !== 'connected') return;

      sendMessage({
        service: 'cursor',
        action: 'update',
        channel: channelRef.current,
        position: { row, col },
        metadata: { mode: 'table', displayName: displayNameRef.current },
      });
    },
    [sendMessage]
  );

  // ---- sendTextUpdate ----------------------------------------------------

  const sendTextUpdate = useCallback(
    (
      position: number,
      selectionData: TextSelectionData | null,
      hasSelection: boolean
    ) => {
      if (connectionStateRef.current !== 'connected') return;

      sendMessage({
        service: 'cursor',
        action: 'update',
        channel: channelRef.current,
        position: { position },
        metadata: { mode: 'text', selection: selectionData, hasSelection, displayName: displayNameRef.current },
      });
    },
    [sendMessage]
  );

  // ---- sendCanvasUpdate --------------------------------------------------
  // No internal throttle — CanvasCursorBoard applies its own 50ms RAF-based
  // throttle before calling this, keeping component and hook concerns separate.

  const sendCanvasUpdate = useCallback(
    (
      x: number,
      y: number,
      tool: CanvasTool,
      color: string,
      size: number
    ) => {
      if (connectionStateRef.current !== 'connected' || !channelRef.current) return;

      sendMessage({
        service: 'cursor',
        action: 'update',
        channel: channelRef.current,
        position: { x, y },
        metadata: { mode: 'canvas', tool, color, size, displayName: displayNameRef.current },
      });
    },
    [sendMessage]
  );

  // ---- switchMode --------------------------------------------------------
  // Unsubscribes from the current channel, clears cursor state, sets the new
  // mode, then resubscribes. The subscribe useEffect will fire when activeMode
  // changes and send the updated subscription automatically.

  const switchMode = useCallback(
    (newMode: CursorMode) => {
      if (connectionStateRef.current !== 'connected' || !channelRef.current) return;

      // Unsubscribe from current channel (clears server-side subscription).
      sendMessage({
        service: 'cursor',
        action: 'unsubscribe',
        channel: channelRef.current,
      });

      // Clear remote cursors immediately for instant UI feedback.
      cursorsRef.current = new Map();
      setCursors(new Map());

      // Update active mode — the subscribe useEffect will resubscribe.
      activeModeRef.current = newMode;
      setActiveMode(newMode);
    },
    [sendMessage]
  );

  return {
    cursors,
    activeMode,
    sendFreeformUpdate,
    sendTableUpdate,
    sendTextUpdate,
    sendCanvasUpdate,
    switchMode,
  };
}
