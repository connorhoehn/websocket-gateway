// frontend/src/components/pipelines/chaos/chaosState.ts
//
// Global chaos injection knobs for Phase 1 MockExecutor runs. The observability
// ChaosPanel writes to this module; MockExecutor reads from it on every sleep
// and failure-roll. A lightweight pub/sub lets UI chips render the current
// state reactively.
//
// Not a React context on purpose — it's consumed from non-React code
// (MockExecutor) so a plain module-scope singleton is the simplest path. Pair
// with `useSyncExternalStore` or a `subscribeChaosState + useState` pattern on
// the React side.

export interface ChaosState {
  /** Additional milliseconds added to every sleep in the executor. */
  injectedLatencyMs: number;
  /** Extra failure probability stacked on top of the base per-node rate (0..1). */
  injectedFailureRate: number;
  /** When true, the executor polls rather than advancing. */
  paused: boolean;
}

const INITIAL_STATE: ChaosState = {
  injectedLatencyMs: 0,
  injectedFailureRate: 0,
  paused: false,
};

let state: ChaosState = { ...INITIAL_STATE };
const listeners = new Set<(s: ChaosState) => void>();

export function getChaosState(): ChaosState {
  return state;
}

export function setChaosState(patch: Partial<ChaosState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    try {
      l(state);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chaosState] listener threw', err);
    }
  });
}

export function resetChaosState(): void {
  setChaosState(INITIAL_STATE);
}

export function subscribeChaosState(
  listener: (s: ChaosState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
