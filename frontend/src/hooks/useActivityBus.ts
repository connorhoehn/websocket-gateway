// frontend/src/hooks/useActivityBus.ts
//
// Unified activity bus hook -- subscribes to the gateway activity service,
// maintains a live event feed, and provides a publish helper for emitting
// new events. Replaces the duplicate useActivityFeed implementations that
// lived inline in ActivityPanel.tsx and BigBrotherPanel.tsx.
//
// WebSocket-only for now (no REST hydration).

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string;
  eventType: string;
  detail: Record<string, unknown>;
  timestamp: string;
  userId?: string;
  displayName?: string;
  color?: string;
  source: 'local' | 'remote';
}

export interface UseActivityBusOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: ConnectionState;
  userId: string;
  displayName: string;
  color?: string;
  maxItems?: number;
}

export interface UseActivityBusReturn {
  events: ActivityEvent[];
  publish: (eventType: string, detail: Record<string, unknown>) => void;
  isLive: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL_ID = 'activity:broadcast';
const DEFAULT_MAX_ITEMS = 100;

/** Window (ms) for deduping echoed events against optimistic local entries. */
const DEDUP_WINDOW_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextLocalId(): string {
  return `local-${Date.now()}-${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActivityBus(options: UseActivityBusOptions): UseActivityBusReturn {
  const {
    sendMessage,
    onMessage,
    connectionState,
    userId,
    displayName,
    color,
    maxItems = DEFAULT_MAX_ITEMS,
  } = options;

  // ---- State ---------------------------------------------------------------
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLive, setIsLive] = useState(false);

  // ---- Refs (stable references for effects / callbacks) --------------------
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const displayNameRef = useRef(displayName);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);

  const colorRef = useRef(color);
  useEffect(() => { colorRef.current = color; }, [color]);

  const maxItemsRef = useRef(maxItems);
  useEffect(() => { maxItemsRef.current = maxItems; }, [maxItems]);

  // ---- Message handler (listen for activity:event and activity history) -----
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      // Handle real-time activity events
      if (msg.type === 'activity:event') {
        const payload = msg.payload as {
          eventType: string;
          detail: Record<string, unknown>;
          timestamp: string;
          userId?: string;
          displayName?: string;
          color?: string;
          id?: string;
        } | undefined;
        if (!payload) return;

        setEvents((prev) => {
          // Dedup: if we already have a local (optimistic) entry with the same
          // eventType whose timestamp is within the dedup window, treat this
          // server message as the echo and skip it.
          const incomingTs = new Date(payload.timestamp).getTime();
          const isDuplicate = prev.some(
            (e) =>
              e.source === 'local' &&
              e.eventType === payload.eventType &&
              Math.abs(new Date(e.timestamp).getTime() - incomingTs) < DEDUP_WINDOW_MS,
          );
          if (isDuplicate) return prev;

          // Also dedup exact matches (same timestamp + eventType at head)
          if (
            prev.length > 0 &&
            prev[0].timestamp === payload.timestamp &&
            prev[0].eventType === payload.eventType
          ) {
            return prev;
          }

          const event: ActivityEvent = {
            id: payload.id ?? nextLocalId(),
            eventType: payload.eventType,
            detail: payload.detail,
            timestamp: payload.timestamp,
            userId: payload.userId,
            displayName: payload.displayName,
            color: payload.color,
            source: 'remote',
          };

          return [event, ...prev].slice(0, maxItemsRef.current);
        });
        return;
      }

      // Handle history response (hydration on connect)
      if (msg.type === 'activity' && msg.action === 'history') {
        const historyEvents = (msg as Record<string, unknown>).events as Array<{
          eventType: string;
          detail: Record<string, unknown>;
          timestamp: string;
          userId?: string;
          displayName?: string;
          color?: string;
        }> | undefined;
        if (!historyEvents || historyEvents.length === 0) return;

        setEvents((prev) => {
          // Only hydrate if we have no events yet (avoid duplicates on re-subscribe)
          if (prev.length > 0) return prev;

          const mapped: ActivityEvent[] = historyEvents.map((e) => ({
            id: nextLocalId(),
            eventType: e.eventType,
            detail: e.detail ?? {},
            timestamp: e.timestamp,
            userId: e.userId,
            displayName: e.displayName,
            source: 'remote' as const,
          }));

          return mapped.slice(0, maxItemsRef.current);
        });
      }
    });

    return unregister;
  }, [onMessage]);

  // ---- Subscribe / unsubscribe on connect ----------------------------------
  useEffect(() => {
    if (connectionState !== 'connected') {
      setIsLive(false);
      return;
    }

    sendMessageRef.current({
      service: 'activity',
      action: 'subscribe',
      channelId: CHANNEL_ID,
    });

    // Request history to hydrate the activity feed after page refresh
    sendMessageRef.current({
      service: 'activity',
      action: 'getHistory',
      channelId: CHANNEL_ID,
      limit: maxItemsRef.current,
    });

    setIsLive(true);

    return () => {
      sendMessageRef.current({
        service: 'activity',
        action: 'unsubscribe',
        channelId: CHANNEL_ID,
      });
      setIsLive(false);
    };
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — accessed via sendMessageRef.

  // ---- Publish --------------------------------------------------------------
  const publish = useCallback(
    (eventType: string, detail: Record<string, unknown>) => {
      const timestamp = new Date().toISOString();
      const id = nextLocalId();

      // Optimistically add to local events immediately
      const localEvent: ActivityEvent = {
        id,
        eventType,
        detail,
        timestamp,
        userId: userIdRef.current,
        displayName: displayNameRef.current,
        color: colorRef.current,
        source: 'local',
      };

      setEvents((prev) => [localEvent, ...prev].slice(0, maxItemsRef.current));

      // Send over the wire
      sendMessageRef.current({
        service: 'activity',
        action: 'publish',
        event: { eventType, detail },
      });
    },
    [], // All deps accessed via refs — stable callback
  );

  return { events, publish, isLive };
}
