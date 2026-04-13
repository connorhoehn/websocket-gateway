// frontend/src/providers/GatewayProvider.ts
//
// Custom Y.js provider that bridges the existing WebSocket gateway with Y.js.
// Sends Y.js document updates and awareness state through the gateway's
// message-based protocol instead of a raw binary WebSocket.

import { Observable } from 'lib0/observable';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { toBase64, fromBase64 } from 'lib0/buffer';

export type SendMessage = (msg: Record<string, unknown>) => void;

export class GatewayProvider extends Observable<string> {
  readonly doc: Y.Doc;
  readonly channel: string;
  readonly awareness: Awareness;

  private readonly _sendMessage: SendMessage;
  private _synced = false;
  private _awarenessTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: Y.Doc, channel: string, sendMessage: SendMessage) {
    super();

    this.doc = doc;
    this.channel = channel;
    this._sendMessage = sendMessage;
    this.awareness = new Awareness(doc);

    // Listen for local document updates and forward deltas to the gateway.
    // Use `origin === this` guard to avoid echoing back remote updates.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const b64 = toBase64(update);
      this._sendMessage({
        service: 'crdt',
        action: 'update',
        channel: this.channel,
        update: b64,
      });
    });

    // Forward local awareness changes to the gateway (debounced to avoid flooding).
    this.awareness.on('update', ({ added, updated, removed }: {
      added: number[];
      updated: number[];
      removed: number[];
    }, origin: unknown) => {
      // Skip updates applied from remote (applyAwarenessUpdate uses `this` as origin)
      if (origin === this) return;
      const changedClients = added.concat(updated, removed);
      // Only send if local client changed (not remote echoes)
      if (!changedClients.includes(this.awareness.clientID)) return;

      if (this._awarenessTimer) clearTimeout(this._awarenessTimer);
      this._awarenessTimer = setTimeout(() => {
        const encoded = encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
        const b64 = toBase64(encoded);
        this._sendMessage({
          service: 'crdt',
          action: 'awareness',
          channel: this.channel,
          update: b64,
        });
      }, 50); // 50ms debounce — max 20 awareness updates/second
    });
  }

  /** Whether we have received at least one snapshot from the server. */
  get synced(): boolean {
    return this._synced;
  }

  /**
   * Apply a remote Y.js document update received from the gateway.
   * Uses `this` as origin so the update handler above skips re-sending it.
   */
  applyRemoteUpdate(b64: string): void {
    const bytes = fromBase64(b64);
    Y.applyUpdate(this.doc, bytes, this);
  }

  /**
   * Apply the initial document snapshot from the server.
   * Functionally identical to applyRemoteUpdate but marks the provider as synced.
   */
  applySnapshot(b64: string): void {
    const bytes = fromBase64(b64);
    Y.applyUpdate(this.doc, bytes, this);
    this._synced = true;
    this.emit('synced', [true]);
  }

  /**
   * Apply a remote awareness update received from the gateway.
   */
  applyAwarenessUpdate(b64: string): void {
    const bytes = fromBase64(b64);
    applyAwarenessUpdate(this.awareness, bytes, this);
  }

  override destroy(): void {
    this.doc.off('update', () => {});
    this.awareness.destroy();
    super.destroy();
  }
}
