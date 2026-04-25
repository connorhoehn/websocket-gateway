// frontend/src/components/pipelines/replay/useReplayDriver.ts
//
// Drives the Phase-1 replay scrubber on `PipelineRunReplayPage`. Walks the
// derived event array from `deriveEventsFromRun` and fires each envelope into
// `EventStreamContext.dispatchEnvelope` at a configurable speed.
//
// Session scoping: every time the user plays, seeks backward, or restarts we
// mint a fresh `runId` on the envelopes we dispatch. That sidesteps the
// dedupe set in EventStreamContext (which keys on `(runId, stepId, seq)`) so
// earlier replay passes don't shadow later ones. The canvas subscribers that
// care about `runId` (activity relay, observability filters) just see a new
// ephemeral run each pass — they never pollute each other and the original
// persisted run stays untouched in localStorage.
//
// This is a placeholder until the Phase-5 WAL replay ships — at that point
// the dispatcher will consume server-supplied envelopes directly and this
// hook will flip to a thin controller over that stream.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  PipelineEventMap,
  PipelineRun,
  PipelineWireEvent,
} from '../../../types/pipeline';
import { useEventStreamContext } from '../context/EventStreamContext';
import { deriveEventsFromRun } from './deriveEvents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lower bound on inter-event wait — keeps the browser responsive at 4×. */
const MIN_DELAY_MS = 10;
/** Upper bound on inter-event wait — caps dead air between lazy-paced steps. */
const MAX_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplaySpeed = 0.5 | 1 | 2 | 4 | 'instant';

export interface ReplayState {
  playing: boolean;
  speedMultiplier: ReplaySpeed;
  /** Index of the next event to dispatch (0-based, events[cursor] is pending). */
  cursor: number;
  totalEvents: number;
}

export interface ReplayDriver {
  state: ReplayState;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (cursor: number) => void;
  setSpeed: (m: ReplaySpeed) => void;
  /** Materialized events so the scrubber can render ticks. */
  events: PipelineWireEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mintReplayRunId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `replay-${rand}`;
}

/**
 * Clone an event and rewrite its `runId` so replay passes don't collide in
 * the dispatcher's dedupe set. The envelope is otherwise preserved verbatim
 * so subscribers see the same event shape as the live-run code path.
 */
function rebindRunId<K extends keyof PipelineEventMap>(
  env: PipelineWireEvent<K>,
  runId: string,
): PipelineWireEvent<K> {
  const payload = env.payload as PipelineEventMap[K] & { runId?: string };
  return {
    ...env,
    payload: { ...payload, runId } as PipelineEventMap[K],
  };
}

/**
 * Inter-event wait, clamped to [MIN_DELAY_MS, MAX_DELAY_MS] and scaled by the
 * replay speed multiplier. Returns `0` for `'instant'` so the caller can skip
 * the timer entirely.
 */
function computeDelayMs(
  current: PipelineWireEvent,
  next: PipelineWireEvent,
  speed: ReplaySpeed,
): number {
  if (speed === 'instant') return 0;
  const raw = next.emittedAt - current.emittedAt;
  if (raw <= 0) return MIN_DELAY_MS;
  const scaled = raw / speed;
  if (scaled < MIN_DELAY_MS) return MIN_DELAY_MS;
  if (scaled > MAX_DELAY_MS) return MAX_DELAY_MS;
  return scaled;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Controls a scrubber-driven replay of a persisted pipeline run. Returns
 * transport controls (play/pause/stop/seek/setSpeed) and the live state
 * (playing, cursor, speed). Safe to call with `null` while the run is
 * loading — the hook returns a no-op driver in that case.
 */
export function useReplayDriver(run: PipelineRun | null): ReplayDriver {
  const { dispatchEnvelope } = useEventStreamContext();

  // Derive the event array once per run — pure function, cheap when `run` is
  // stable (PipelineRunsContext keeps the reference identity across renders).
  const events = useMemo<PipelineWireEvent[]>(
    () => (run ? deriveEventsFromRun(run) : []),
    [run],
  );

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);
  const [cursor, setCursor] = useState(0);

  // Mutable refs so the timer tick can read the latest values without re-
  // creating the scheduler when callers change speed mid-playback.
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const cursorRef = useRef(cursor);
  const eventsRef = useRef(events);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RunId for the current replay "pass" — refreshed on every play-from-start,
  // seek-backward, or stop so dispatcher dedupe doesn't swallow re-emits.
  const sessionRunIdRef = useRef<string>(mintReplayRunId());

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    eventsRef.current = events;
    // New run → reset cursor and session id so we don't fire stale envelopes.
    setCursor(0);
    setPlaying(false);
    sessionRunIdRef.current = mintReplayRunId();
  }, [events]);

  // Cleanup any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  /** Dispatch a single event via the event stream, rebound to this session. */
  const emit = useCallback(
    (idx: number) => {
      const env = eventsRef.current[idx];
      if (!env) return;
      dispatchEnvelope(rebindRunId(env, sessionRunIdRef.current));
    },
    [dispatchEnvelope],
  );

  /**
   * Recursive scheduler — runs one event, then sleeps the appropriate gap
   * before the next. Guards on playingRef so pause/stop interrupts cleanly
   * without tearing down the tick loop's setup.
   */
  const scheduleNext = useCallback(() => {
    if (!playingRef.current) return;
    const all = eventsRef.current;
    const idx = cursorRef.current;
    if (idx >= all.length) {
      setPlaying(false);
      return;
    }

    emit(idx);
    const nextIdx = idx + 1;
    cursorRef.current = nextIdx;
    setCursor(nextIdx);

    // Instant mode — flush all remaining events in this tick.
    if (speedRef.current === 'instant') {
      while (
        playingRef.current &&
        cursorRef.current < eventsRef.current.length
      ) {
        emit(cursorRef.current);
        cursorRef.current += 1;
      }
      setCursor(cursorRef.current);
      setPlaying(false);
      return;
    }

    if (nextIdx >= all.length) {
      setPlaying(false);
      return;
    }
    const delay = computeDelayMs(all[idx], all[nextIdx], speedRef.current);
    timerRef.current = setTimeout(scheduleNext, delay);
  }, [emit]);

  // ── Public controls ──────────────────────────────────────────────────

  const play = useCallback(() => {
    if (eventsRef.current.length === 0) return;
    if (playingRef.current) return;
    // If the playhead is past the end, rewind to start before playing.
    if (cursorRef.current >= eventsRef.current.length) {
      sessionRunIdRef.current = mintReplayRunId();
      cursorRef.current = 0;
      setCursor(0);
    }
    playingRef.current = true;
    setPlaying(true);
    scheduleNext();
  }, [scheduleNext]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Fresh session so the next play re-emits from 0 without dedupe shadowing.
    sessionRunIdRef.current = mintReplayRunId();
    cursorRef.current = 0;
    setCursor(0);
  }, []);

  const seek = useCallback(
    (target: number) => {
      const all = eventsRef.current;
      const clamped = Math.max(0, Math.min(all.length, target));
      const current = cursorRef.current;

      // Cancel any running timer — the new position supersedes it.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const wasPlaying = playingRef.current;
      playingRef.current = false;
      setPlaying(false);

      if (clamped > current) {
        // Forward seek — fast-forward by flushing the pending envelopes now.
        for (let i = current; i < clamped; i++) emit(i);
      } else if (clamped < current) {
        // Backward seek — mint a new session so the dispatcher dedupe lets us
        // replay the earlier envelopes without swallowing them.
        sessionRunIdRef.current = mintReplayRunId();
        for (let i = 0; i < clamped; i++) emit(i);
      }

      cursorRef.current = clamped;
      setCursor(clamped);

      if (wasPlaying && clamped < all.length) {
        playingRef.current = true;
        setPlaying(true);
        scheduleNext();
      }
    },
    [emit, scheduleNext],
  );

  const setSpeed = useCallback((m: ReplaySpeed) => {
    speedRef.current = m;
    setSpeedState(m);
  }, []);

  const state = useMemo<ReplayState>(
    () => ({
      playing,
      speedMultiplier: speed,
      cursor,
      totalEvents: events.length,
    }),
    [playing, speed, cursor, events.length],
  );

  return { state, play, pause, stop, seek, setSpeed, events };
}
