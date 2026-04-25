// frontend/src/components/pipelines/hooks/useDocumentTriggers.ts
//
// Phase 4-ready document-trigger wiring (PIPELINES_PLAN.md §5.1).
//
// Subscribes to the activity bus and, for every document activity event that
// maps to a pipeline TriggerType, scans localStorage for published pipelines
// whose triggerBinding matches and invokes `usePipelineRuns().triggerRun()`
// on each match.
//
// Phase 1 uses the MockExecutor fed by the shared EventStreamProvider; the
// same wiring will forward runs to the gateway in Phase 4 without changing
// this hook.
//
// Mount at the top of the app — see AppLayout.tsx — so triggers fire from
// anywhere a `doc.*` activity event is published.

import { useEffect, useRef } from 'react';
import { usePipelineRuns } from '../context/PipelineRunsContext';
import { listPipelines, loadPipeline } from '../persistence/pipelineStorage';
import type { ActivityEvent } from '../../../hooks/useActivityBus';
import type { TriggerType } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Activity-event → TriggerType mapping
// ---------------------------------------------------------------------------
//
//   doc.finalize           → document.finalize
//   doc.comment            → document.comment
//   doc.add_item           → document.submit (section:item creation)
//
// Other `doc.*` events (unlock, mention, resolve_thread, review_*) do not
// correspond to a pipeline trigger type and are ignored.

const ACTIVITY_TO_TRIGGER: Record<string, TriggerType> = {
  'doc.finalize': 'document.finalize',
  'doc.comment': 'document.comment',
  'doc.add_item': 'document.submit',
};

// Dedupe window (ms) per pipelineId to avoid double-fires when the same
// logical activity produces closely-timed events.
const DEDUP_WINDOW_MS = 500;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to activity-bus events and fires pipeline runs whose
 * triggerBinding matches. Mount once near the top of the tree (AppLayout).
 *
 * Expects an activity-event accessor. We accept events as a prop-style
 * argument to keep the hook pure and testable; callers wire it up from the
 * same `useActivityBus().events` array they already maintain.
 */
export function useDocumentTriggers(events: ActivityEvent[]): void {
  const { triggerRun } = usePipelineRuns();

  // Track the highest event index we've already processed — activity events
  // are prepended, so new events appear at the head.
  const lastSeenIdRef = useRef<string | null>(null);

  // On first run (when we have history events but no `lastSeen`), mark the
  // head as seen without firing. Hydrated history events should not retro-
  // actively trigger pipelines.
  const initializedRef = useRef(false);

  // Per-pipeline last-fire timestamp for the 500ms dedupe window.
  const lastFireRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (events.length === 0) return;

    // First render with a non-empty events array — do not fire for any
    // pre-existing events; just remember the head so we fire only for
    // truly new activity.
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSeenIdRef.current = events[0].id;
      return;
    }

    // Walk from newest → oldest, stopping at the first event we've already
    // processed. Collect new events in reverse order so we fire them
    // chronologically.
    const fresh: ActivityEvent[] = [];
    for (const evt of events) {
      if (lastSeenIdRef.current === evt.id) break;
      fresh.push(evt);
    }
    if (fresh.length === 0) return;

    // Remember the newest event id for the next render.
    lastSeenIdRef.current = events[0].id;

    // Fire in chronological order.
    fresh.reverse();

    // Snapshot published pipelines once per batch — this is a cheap
    // localStorage read but still worth caching across the loop.
    const indexEntries = listPipelines();
    const publishedDefs = indexEntries
      .filter((e) => e.status === 'published')
      .map((e) => loadPipeline(e.id))
      .filter((d): d is NonNullable<typeof d> => d !== null);

    for (const evt of fresh) {
      const triggerEvent = ACTIVITY_TO_TRIGGER[evt.eventType];
      if (!triggerEvent) continue;

      const detail = evt.detail ?? {};
      const documentId = typeof detail.documentId === 'string' ? detail.documentId : undefined;
      const documentTypeId =
        typeof detail.documentTypeId === 'string' ? detail.documentTypeId : undefined;

      for (const def of publishedDefs) {
        const binding = def.triggerBinding;
        if (!binding) continue;
        if (binding.event !== triggerEvent) continue;

        // If the binding narrows by documentTypeId, enforce it.
        if (binding.documentTypeId && binding.documentTypeId !== documentTypeId) {
          continue;
        }

        // Dedupe: skip if this pipeline fired within the last 500ms.
        const now = Date.now();
        const lastFire = lastFireRef.current.get(def.id) ?? 0;
        if (now - lastFire < DEDUP_WINDOW_MS) continue;
        lastFireRef.current.set(def.id, now);

        const payload: Record<string, unknown> = {
          event: triggerEvent,
          documentId,
          documentTypeId,
          userId: evt.userId,
        };

        void triggerRun(def.id, payload).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[useDocumentTriggers] triggerRun failed', def.id, err);
        });
      }
    }
  }, [events, triggerRun]);
}
