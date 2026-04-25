// frontend/src/components/pipelines/context/EventStreamContext.tsx
//
// Single dispatcher for pipeline events. The editor canvas, observability
// dashboard, and approvals panel all subscribe here. The Phase 1 source is
// the in-browser MockExecutor, which calls `dispatch(type, payload)` from
// its `onEvent` callback; Phase 4+ swaps the source to a WebSocket frame
// handler without touching any subscriber. See PIPELINES_PLAN.md §13.2.
//
// The provider owns a mutable `listeners` ref so subscribe/dispatch don't
// trigger re-renders. `'*'` subscribers see every event tagged with its
// `eventType` for debug / observability use.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type {
  PipelineEventMap,
  PipelineWireEvent,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WildcardEvent = {
  eventType: string;
  payload: unknown;
};

export type PipelineEventHandler<K extends keyof PipelineEventMap> = (
  payload: PipelineEventMap[K] | WildcardEvent,
) => void;

export interface EventStreamValue {
  subscribe<K extends keyof PipelineEventMap>(
    type: K | '*',
    handler: (payload: PipelineEventMap[K] | WildcardEvent) => void,
  ): () => void;
  /**
   * Convenience shim used by the in-browser MockExecutor path. Synthesizes a
   * `PipelineWireEvent` (auto-incrementing local `seq`, `sourceNodeId =
   * 'local-mock'`, `emittedAt = Date.now()`) and forwards to
   * `dispatchEnvelope` so the mock and the future WS adapter share the exact
   * same dedupe + fan-out pipeline.
   */
  dispatch<K extends keyof PipelineEventMap>(
    type: K,
    payload: PipelineEventMap[K],
  ): void;
  /**
   * Primary entry point for any envelope-aware producer. Used by the Phase 4+
   * WebSocket adapter to forward server-supplied envelopes verbatim. Dedupes
   * on `(runId, stepId, seq)` so replays after a ResourceRouter-orphaned run
   * is resumed on a new owner don't double-count. Timestamps are re-stamped
   * on replay — never use them for dedupe.
   */
  dispatchEnvelope<K extends keyof PipelineEventMap>(
    envelope: PipelineWireEvent<K>,
  ): void;
  subscribeToRun(runId: string): () => void;
  subscribeToAll(): () => void;
  subscribeToApprovals(): () => void;
  source: 'mock' | 'websocket';
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EventStreamContext = createContext<EventStreamValue | null>(null);

// Internal untyped handler bucket — keeps the listener map a single Set
// per channel without juggling 30+ typed sets.
type AnyHandler = (payload: unknown) => void;

// Upper bound on the dedupe memory — enough to cover the replay window of a
// crash/failover on a mid-sized run without unbounded growth. Oldest entries
// are evicted on insert (insertion-order LRU via Set iteration order).
const DEDUPE_CAPACITY = 2048;

/**
 * Build the dedupe key for a wire event.
 *  - `runId` is extracted from the payload (all lifecycle events carry one;
 *    unknown payload shapes fall back to `'<no-run>'`).
 *  - `stepId` is extracted when present (step / llm / approval / join events)
 *    and falls back to `'<run>'` for run-scoped events so `(run, seq)` on
 *    retries stays unique.
 *  - `seq` is the server-supplied monotonic per-run counter; it's the same
 *    across replays, which is what makes dedupe work.
 */
function buildDedupeKey(env: PipelineWireEvent): string {
  const payload = env.payload as
    | (Record<string, unknown> & { runId?: unknown; stepId?: unknown })
    | undefined;
  const runId =
    payload && typeof payload.runId === 'string' ? payload.runId : '<no-run>';
  const stepId =
    payload && typeof payload.stepId === 'string' ? payload.stepId : '<run>';
  return `${runId}:${stepId}:${env.seq}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface EventStreamProviderProps {
  children: React.ReactNode;
  /** Optional — defaults to 'mock' for Phase 1. */
  source?: 'mock' | 'websocket';
}

export function EventStreamProvider({
  children,
  source = 'mock',
}: EventStreamProviderProps) {
  const listeners = useRef<Map<string, Set<AnyHandler>>>(new Map());
  // Insertion-order LRU of seen `(runId, stepId, seq)` triples. We use a plain
  // Set; on overflow, we evict the oldest entry (the first value produced by
  // Set's iterator). Capped at DEDUPE_CAPACITY to bound memory.
  const seenKeys = useRef<Set<string>>(new Set());
  // Local monotonic counter used by the `dispatch(type, payload)` shim so the
  // mock source produces distinct-seq envelopes without the caller threading a
  // counter. Not used for replay semantics — the WS adapter supplies server
  // seqs via `dispatchEnvelope`.
  const localSeqCounter = useRef<number>(0);

  const subscribe = useCallback(
    <K extends keyof PipelineEventMap>(
      type: K | '*',
      handler: (payload: PipelineEventMap[K] | WildcardEvent) => void,
    ): (() => void) => {
      const key = type as string;
      let bucket = listeners.current.get(key);
      if (!bucket) {
        bucket = new Set();
        listeners.current.set(key, bucket);
      }
      const wrapped = handler as AnyHandler;
      bucket.add(wrapped);
      return () => {
        const current = listeners.current.get(key);
        if (!current) return;
        current.delete(wrapped);
        if (current.size === 0) listeners.current.delete(key);
      };
    },
    [],
  );

  // Internal fan-out — does not dedupe. Called by `dispatchEnvelope` once the
  // event has been accepted; callers outside the module should never reach
  // this path directly.
  const fanOut = useCallback(
    <K extends keyof PipelineEventMap>(
      type: K,
      payload: PipelineEventMap[K],
    ): void => {
      const typed = listeners.current.get(type as string);
      if (typed) {
        // Clone to tolerate handlers unsubscribing during iteration.
        for (const h of Array.from(typed)) {
          try {
            h(payload);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[EventStream] handler threw', type, err);
          }
        }
      }
      const wildcard = listeners.current.get('*');
      if (wildcard) {
        const envelope: WildcardEvent = { eventType: type as string, payload };
        for (const h of Array.from(wildcard)) {
          try {
            h(envelope);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[EventStream] wildcard handler threw', type, err);
          }
        }
      }
    },
    [],
  );

  const dispatchEnvelope = useCallback(
    <K extends keyof PipelineEventMap>(env: PipelineWireEvent<K>): void => {
      const key = buildDedupeKey(env);
      const seen = seenKeys.current;
      if (seen.has(key)) return;
      seen.add(key);
      // Bound memory — evict the oldest entry (insertion-order) when over cap.
      if (seen.size > DEDUPE_CAPACITY) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      fanOut(env.eventType, env.payload);
    },
    [fanOut],
  );

  const dispatch = useCallback(
    <K extends keyof PipelineEventMap>(
      type: K,
      payload: PipelineEventMap[K],
    ): void => {
      // Synthesize a local envelope so the mock path and the future WS path
      // both funnel through `dispatchEnvelope`. Dedupe is a pass-through for
      // the mock source (seqs are unique by construction).
      const envelope: PipelineWireEvent<K> = {
        eventType: type,
        payload,
        seq: localSeqCounter.current++,
        sourceNodeId: 'local-mock',
        emittedAt: Date.now(),
      };
      dispatchEnvelope(envelope);
    },
    [dispatchEnvelope],
  );

  const subscribeToRun = useCallback((runId: string): (() => void) => {
    // Phase 1 no-op — Phase 4 sends { service:'pipeline', action:'subscribe',
    // channel:`pipeline:run:${runId}` } over WS. See §14.2.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.debug('[EventStream] subscribeToRun (mock no-op)', runId);
    }
    return () => {
      // eslint-disable-next-line no-console
      console.debug('[EventStream] unsubscribeFromRun (mock no-op)', runId);
    };
  }, []);

  const subscribeToAll = useCallback((): (() => void) => {
    // eslint-disable-next-line no-console
    console.debug('[EventStream] subscribeToAll (mock no-op)');
    return () => {
      // eslint-disable-next-line no-console
      console.debug('[EventStream] unsubscribeFromAll (mock no-op)');
    };
  }, []);

  const subscribeToApprovals = useCallback((): (() => void) => {
    // eslint-disable-next-line no-console
    console.debug('[EventStream] subscribeToApprovals (mock no-op)');
    return () => {
      // eslint-disable-next-line no-console
      console.debug('[EventStream] unsubscribeFromApprovals (mock no-op)');
    };
  }, []);

  const value = useMemo<EventStreamValue>(
    () => ({
      subscribe,
      dispatch,
      dispatchEnvelope,
      subscribeToRun,
      subscribeToAll,
      subscribeToApprovals,
      source,
    }),
    [
      subscribe,
      dispatch,
      dispatchEnvelope,
      subscribeToRun,
      subscribeToAll,
      subscribeToApprovals,
      source,
    ],
  );

  return (
    <EventStreamContext.Provider value={value}>
      {children}
    </EventStreamContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the raw EventStream context. Throws if used outside a provider.
 * Prefer `useEventStream(type, handler)` for subscription use cases.
 */
export function useEventStreamContext(): EventStreamValue {
  const ctx = useContext(EventStreamContext);
  if (!ctx) {
    throw new Error(
      'useEventStreamContext must be used within an EventStreamProvider',
    );
  }
  return ctx;
}

/**
 * Lifecycle-safe subscription. The `handler` ref is kept latest so callers
 * can use inline closures without re-subscribing on every render. Cleanup
 * removes the listener when the component unmounts or `type` changes.
 */
export function useEventStream<K extends keyof PipelineEventMap>(
  type: K | '*',
  handler: (payload: PipelineEventMap[K] | WildcardEvent) => void,
): void {
  const { subscribe } = useEventStreamContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const cleanup = subscribe<K>(type, (payload) => handlerRef.current(payload));
    return cleanup;
  }, [subscribe, type]);
}
