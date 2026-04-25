// frontend/src/components/pipelines/persistence/runHistory.ts
//
// localStorage-backed persistence for terminal pipeline runs (Phase 1
// simplification — Phase 3+ replaces this with the distributed-core WAL, see
// PIPELINES_PLAN.md §13.4 / §14.4).
//
// Storage layout:
//   ws_pipeline_runs_v1:{pipelineId}  — PipelineRun[] sorted by startedAt desc,
//                                        capped at MAX_RUNS_PER_PIPELINE
//
// Writes are silent-failure (QuotaExceeded, JSON errors); reads return [] on
// any corruption so callers don't have to defend themselves.
//
// Only runs in a terminal state should be appended — active runs live in
// memory on `PipelineRunsContext`.

import type { PipelineRun } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'ws_pipeline_runs_v1:';
const MAX_RUNS_PER_PIPELINE = 50;

function keyFor(pipelineId: string): string {
  return `${KEY_PREFIX}${pipelineId}`;
}

// ---------------------------------------------------------------------------
// Silent-failure write helper
// ---------------------------------------------------------------------------

let quotaWarned = false;

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (!quotaWarned) {
      quotaWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[runHistory] localStorage write failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all persisted runs for a pipeline, newest first. Corrupt or missing
 * entries yield an empty array.
 */
export function listRuns(pipelineId: string): PipelineRun[] {
  try {
    const raw = localStorage.getItem(keyFor(pipelineId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PipelineRun[];
  } catch {
    return [];
  }
}

/**
 * Look up a specific run by id. Linear scan (capped at MAX_RUNS_PER_PIPELINE
 * so this is cheap).
 */
export function getRun(pipelineId: string, runId: string): PipelineRun | null {
  const runs = listRuns(pipelineId);
  return runs.find((r) => r.id === runId) ?? null;
}

/**
 * Insert/replace a run by id, then trim to the newest MAX_RUNS_PER_PIPELINE
 * entries. Safe to call repeatedly for the same runId — later writes win.
 */
export function appendRun(pipelineId: string, run: PipelineRun): void {
  const existing = listRuns(pipelineId).filter((r) => r.id !== run.id);
  const next = [run, ...existing]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RUNS_PER_PIPELINE);
  safeWrite(keyFor(pipelineId), JSON.stringify(next));
}

/**
 * Wipe every persisted run for a pipeline. Used by the editor's Delete
 * action and tests.
 */
export function clearRuns(pipelineId: string): void {
  try {
    localStorage.removeItem(keyFor(pipelineId));
  } catch {
    // ignore
  }
}
