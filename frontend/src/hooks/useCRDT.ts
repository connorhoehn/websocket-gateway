// frontend/src/hooks/useCRDT.ts
//
// CRDT hook — subscribes to the gateway CRDT service, applies incoming Y.js
// binary updates to a shared Y.Doc, broadcasts local edits encoded as base64
// Y.js updates, and restores document state from a DynamoDB snapshot when
// (re)connecting.
//
// Composes on top of useWebSocket: accepts sendMessage / onMessage from that
// hook and handles the CRDT protocol independently.

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { encodeStateAsUpdate, applyUpdate } from 'yjs';
import type { ConnectionState, GatewayMessage } from '../types/gateway';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseCRDTOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
}

export interface UseCRDTReturn {
  content: string;                        // Current Y.Text content as plain string (reactive)
  applyLocalEdit: (newText: string) => void;  // Called by editor on user input
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCRDT(options: UseCRDTOptions): UseCRDTReturn {
  const { sendMessage, onMessage, currentChannel, connectionState } = options;

  // ---- State ---------------------------------------------------------------
  const [content, setContent] = useState<string>('');

  // ---- Y.Doc refs ----------------------------------------------------------
  // Y.Doc lives in a ref — stable across renders, one doc per hook instance.
  const ydoc = useRef<Y.Doc>(new Y.Doc());
  const ytext = useRef<Y.Text>(ydoc.current.getText('content'));

  // ---- Stable refs for closures --------------------------------------------
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const currentChannelRef = useRef(currentChannel);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  // ---- onMessage handler ---------------------------------------------------
  // Separate effect from subscribe so the handler survives channel changes
  // without being torn down. Channel filtering uses currentChannelRef so
  // closures always read the freshest channel.
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type === 'crdt:snapshot') {
        // Only process snapshots for the current channel
        if (msg.channel !== currentChannelRef.current) return;

        const snapshotB64 = msg.snapshot as string | undefined;
        if (!snapshotB64) return;

        try {
          const bytes = Buffer.from(snapshotB64, 'base64');
          applyUpdate(ydoc.current, bytes);
          setContent(ytext.current.toString());
        } catch {
          // Malformed snapshot — leave doc empty
        }
        return;
      }

      if (msg.type === 'crdt:update') {
        // Only process updates for the current channel
        if (msg.channel !== currentChannelRef.current) return;

        const updateB64 = msg.update as string | undefined;
        if (!updateB64) return;

        try {
          const bytes = Buffer.from(updateB64, 'base64');
          applyUpdate(ydoc.current, bytes);
          setContent(ytext.current.toString());
        } catch {
          // Malformed update — ignore
        }
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

    // Reset Y.Doc on each new subscription so stale state from the previous
    // channel or session is cleared. Register a fresh observer on the new doc.
    ydoc.current.destroy();
    ydoc.current = new Y.Doc();
    ytext.current = ydoc.current.getText('content');
    ytext.current.observe(() => setContent(ytext.current.toString()));
    setContent('');

    // Subscribe to the channel
    sendMessage({ service: 'crdt', action: 'subscribe', channel: currentChannel });

    // Cleanup: unsubscribe when channel changes or unmounts
    return () => {
      sendMessageRef.current({
        service: 'crdt',
        action: 'unsubscribe',
        channel: currentChannel,
      });
      setContent('');
    };
  }, [currentChannel, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps
  // sendMessage intentionally excluded — we use sendMessageRef for stable access.

  // ---- applyLocalEdit() ---------------------------------------------------
  // Stable callback — accesses current channel and sendMessage via refs.
  // Performs a Y.js transact (delete + insert) to replace full content,
  // then encodes the full doc state as a base64 update for the gateway.
  const applyLocalEdit = useCallback((newText: string) => {
    ydoc.current.transact(() => {
      ytext.current.delete(0, ytext.current.length);
      ytext.current.insert(0, newText);
    });
    const update = encodeStateAsUpdate(ydoc.current);
    const b64 = Buffer.from(update).toString('base64');
    sendMessageRef.current({
      service: 'crdt',
      action: 'update',
      channel: currentChannelRef.current,
      update: b64,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // All deps accessed via refs — stable callback that never causes re-renders

  return { content, applyLocalEdit };
}
