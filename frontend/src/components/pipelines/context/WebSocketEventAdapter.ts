// frontend/src/components/pipelines/context/WebSocketEventAdapter.ts
//
// Non-invasive WebSocket source adapter for the pipeline EventStreamContext.
//
// Phase 1 feeds EventStreamContext from the in-browser MockExecutor. Phase 4
// will feed it from the gateway, which bridges distributed-core's EventBus
// onto WebSocket frames. This adapter is the bridge on the client side: it
// subscribes to a gateway channel, decodes incoming `pipeline:event` frames
// into `PipelineWireEvent` envelopes, and hands them to a caller-supplied
// `onEvent` callback. The caller (see `usePipelineSource`) wires `onEvent`
// to `EventStreamContext.dispatchEnvelope`.
//
// Design notes:
//  - Does NOT modify EventStreamContext.tsx. Consumers opt in via a hook
//    that reads `dispatchEnvelope` and passes it through.
//  - Default `enabled = false` so the adapter is dormant on every page until
//    VITE_PIPELINE_SOURCE=websocket flips it on. Phase 1 behavior is
//    unchanged.
//  - Gaps in the Phase 1 local-emit wire format (missing seq / sourceNodeId
//    / emittedAt) are filled with sentinel defaults — dedupe in
//    dispatchEnvelope still works because each envelope gets a distinct
//    local-counter-style key from the caller if seq is 0 repeatedly; the
//    gateway bridge is expected to supply real monotonic seqs in Phase 4.
//  - Handles reconnects by re-subscribing whenever `connectionState`
//    transitions back to 'connected'.

import { useCallback, useEffect, useRef } from 'react';
import type {
  PipelineDefinition,
  PipelineEventMap,
  PipelineWireEvent,
} from '../../../types/pipeline';
import { useWebSocketContext } from '../../../contexts/WebSocketContext';
import type { GatewayMessage } from '../../../types/gateway';

export interface WebSocketEventAdapterOptions {
  /** Subscribe to this channel on mount. Default: 'pipeline:all' (observability). */
  channel?: string;
  /** Called with each decoded wire event. Wire this to EventStreamContext.dispatchEnvelope. */
  onEvent: (env: PipelineWireEvent<keyof PipelineEventMap>) => void;
  /** Opt-in: default `false` leaves the adapter dormant (still mock-driven). */
  enabled?: boolean;
}

/**
 * Subscribes to a pipeline event channel via the gateway WebSocket and invokes
 * `onEvent` with each received `pipeline:event` wire envelope. No-op when
 * `enabled === false`.
 *
 * Phase 4: feature-flag via `VITE_PIPELINE_SOURCE=websocket`.
 * Phase 5: may be replaced by an EventSource (SSE) adapter for observability-only clients.
 */
export function useWebSocketPipelineEvents({
  channel = 'pipeline:all',
  onEvent,
  enabled = false,
}: WebSocketEventAdapterOptions): void {
  const { connectionState, sendMessage, onMessage } = useWebSocketContext();

  // Keep the latest `onEvent` in a ref so the effect doesn't re-subscribe on
  // every render when the caller passes an inline closure.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    if (connectionState !== 'connected') return;

    // Subscribe to the channel. The gateway fans out `pipeline:event` frames
    // for any run/step the caller has permission to observe.
    sendMessage({ service: 'pipeline', action: 'subscribe', channel });

    // Register a filtering listener on the shared WS message bus.
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type !== 'pipeline:event') return;

      // Decode the wire envelope, tolerating gaps for the Phase 1 local-emit
      // source. The gateway bridge is expected to supply full envelopes in
      // Phase 4; until then, sentinel defaults keep the dispatch path safe.
      const eventType = msg.eventType as keyof PipelineEventMap | undefined;
      if (!eventType) return;

      const envelope: PipelineWireEvent<keyof PipelineEventMap> = {
        eventType,
        payload: msg.payload as PipelineEventMap[keyof PipelineEventMap],
        seq: typeof msg.seq === 'number' ? msg.seq : 0,
        sourceNodeId:
          typeof msg.sourceNodeId === 'string' ? msg.sourceNodeId : 'unknown',
        emittedAt:
          typeof msg.emittedAt === 'number' ? msg.emittedAt : Date.now(),
      };

      try {
        onEventRef.current(envelope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[WebSocketEventAdapter] onEvent threw', err);
      }
    });

    return () => {
      unregister();
      // Best-effort unsubscribe. If the socket is already dropping we just
      // rely on the gateway's session cleanup; this send is a no-op in that
      // case.
      sendMessage({ service: 'pipeline', action: 'unsubscribe', channel });
    };
  }, [enabled, connectionState, channel, sendMessage, onMessage]);
}

// ---------------------------------------------------------------------------
// Command helpers — outbound WS frames per PIPELINES_PLAN.md §14.2
// ---------------------------------------------------------------------------

/**
 * Returns memoized helpers that fan WS frames for the pipeline service.
 * Channel subscriptions are fire-and-forget — the gateway echoes a
 * `pipeline` ack frame when subscribed; the dispatch path (above) is what
 * actually surfaces events. Execution-control helpers return correlation ids
 * that callers can match against `pipeline:ack` / `pipeline:error` frames.
 */
export interface PipelineWsCommands {
  subscribeToRun: (runId: string) => void;
  unsubscribeFromRun: (runId: string) => void;
  subscribeToAll: () => void;
  unsubscribeFromAll: () => void;
  subscribeToApprovals: () => void;
  unsubscribeFromApprovals: () => void;
  triggerRun: (
    pipelineId: string,
    options?: { definition?: PipelineDefinition; triggerPayload?: Record<string, unknown>; triggeredBy?: { userId: string; triggerType: string }; correlationId?: string },
  ) => string;
  cancelRun: (runId: string, correlationId?: string) => string;
  resolveApproval: (
    runId: string,
    stepId: string,
    decision: 'approve' | 'reject',
    options?: { comment?: string; decidedBy?: string; correlationId?: string },
  ) => string;
  requestResumeFromStep: (runId: string, fromNodeId: string, correlationId?: string) => string;
}

function makeCorrelationId(): string {
  // crypto.randomUUID is available in modern browsers + jsdom 22+; fall back
  // for older runtimes used by tests.
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function usePipelineWsCommands(): PipelineWsCommands {
  const { sendMessage } = useWebSocketContext();

  const subscribeToRun = useCallback(
    (runId: string) =>
      sendMessage({ service: 'pipeline', action: 'subscribe', channel: `pipeline:run:${runId}` }),
    [sendMessage],
  );
  const unsubscribeFromRun = useCallback(
    (runId: string) =>
      sendMessage({ service: 'pipeline', action: 'unsubscribe', channel: `pipeline:run:${runId}` }),
    [sendMessage],
  );
  const subscribeToAll = useCallback(
    () => sendMessage({ service: 'pipeline', action: 'subscribe', channel: 'pipeline:all' }),
    [sendMessage],
  );
  const unsubscribeFromAll = useCallback(
    () => sendMessage({ service: 'pipeline', action: 'unsubscribe', channel: 'pipeline:all' }),
    [sendMessage],
  );
  const subscribeToApprovals = useCallback(
    () => sendMessage({ service: 'pipeline', action: 'subscribe', channel: 'pipeline:approvals' }),
    [sendMessage],
  );
  const unsubscribeFromApprovals = useCallback(
    () => sendMessage({ service: 'pipeline', action: 'unsubscribe', channel: 'pipeline:approvals' }),
    [sendMessage],
  );

  const triggerRun = useCallback<PipelineWsCommands['triggerRun']>(
    (pipelineId, options = {}) => {
      const correlationId = options.correlationId ?? makeCorrelationId();
      sendMessage({
        service: 'pipeline',
        action: 'trigger',
        pipelineId,
        ...(options.definition ? { definition: options.definition } : {}),
        ...(options.triggerPayload ? { triggerPayload: options.triggerPayload } : {}),
        ...(options.triggeredBy ? { triggeredBy: options.triggeredBy } : {}),
        correlationId,
      });
      return correlationId;
    },
    [sendMessage],
  );

  const cancelRun = useCallback<PipelineWsCommands['cancelRun']>(
    (runId, correlationId) => {
      const cid = correlationId ?? makeCorrelationId();
      sendMessage({ service: 'pipeline', action: 'cancel', runId, correlationId: cid });
      return cid;
    },
    [sendMessage],
  );

  const resolveApproval = useCallback<PipelineWsCommands['resolveApproval']>(
    (runId, stepId, decision, options = {}) => {
      const cid = options.correlationId ?? makeCorrelationId();
      sendMessage({
        service: 'pipeline',
        action: 'resolveApproval',
        runId,
        stepId,
        decision,
        ...(options.comment ? { comment: options.comment } : {}),
        ...(options.decidedBy ? { decidedBy: options.decidedBy } : {}),
        correlationId: cid,
      });
      return cid;
    },
    [sendMessage],
  );

  const requestResumeFromStep = useCallback<PipelineWsCommands['requestResumeFromStep']>(
    (runId, fromNodeId, correlationId) => {
      const cid = correlationId ?? makeCorrelationId();
      sendMessage({
        service: 'pipeline',
        action: 'resumeFromStep',
        runId,
        fromNodeId,
        correlationId: cid,
      });
      return cid;
    },
    [sendMessage],
  );

  return {
    subscribeToRun,
    unsubscribeFromRun,
    subscribeToAll,
    unsubscribeFromAll,
    subscribeToApprovals,
    unsubscribeFromApprovals,
    triggerRun,
    cancelRun,
    resolveApproval,
    requestResumeFromStep,
  };
}
