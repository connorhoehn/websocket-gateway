// frontend/src/components/pipelines/hooks/usePipelineSource.ts
//
// Activates the WebSocket pipeline source when VITE_PIPELINE_SOURCE=websocket.
// Default is the mock source (MockExecutor + EventStreamContext.dispatch).
//
// Mount this once near the top of the app tree (inside the shared
// EventStreamProvider) — NOT in PipelineEditorPage, because observability
// also relies on the same event stream. Today it mounts in AppLayout so the
// single provider instance that powers approvals, document triggers, and
// observability also receives WS-sourced events.

import { useEventStreamContext } from '../context/EventStreamContext';
import { useWebSocketPipelineEvents } from '../context/WebSocketEventAdapter';

/**
 * Module-level read of `VITE_PIPELINE_SOURCE`. Lives outside the hook so
 * non-component consumers (`useTriggerRun`) can branch on the same flag
 * without re-running React state.
 *
 * `'websocket'` enables the Phase 4 WS path. Anything else (or unset) keeps
 * the in-browser MockExecutor default.
 */
export function getPipelineSource(): 'mock' | 'websocket' {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_PIPELINE_SOURCE;
  return env === 'websocket' ? 'websocket' : 'mock';
}

export function usePipelineSource(): void {
  const { dispatchEnvelope, source } = useEventStreamContext();

  // Flip on either when the provider was constructed with source='websocket'
  // (Phase 4 production wiring) or when the dev env var is set (local
  // simulator testing against the current Phase 1 mock-provider tree).
  const envFlag = getPipelineSource() === 'websocket';

  useWebSocketPipelineEvents({
    channel: 'pipeline:all',
    // `dispatchEnvelope` is the envelope-aware entry point — forward the full
    // wire envelope so dedupe on (runId, stepId, seq) works as designed.
    onEvent: (env) => dispatchEnvelope(env),
    enabled: source === 'websocket' || envFlag,
  });
}
