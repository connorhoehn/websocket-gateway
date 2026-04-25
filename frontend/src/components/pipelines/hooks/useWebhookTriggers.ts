// frontend/src/components/pipelines/hooks/useWebhookTriggers.ts
//
// Webhook-trigger relay (PIPELINES_PLAN.md §5.1, webhook variant).
//
// Subscribes to `pipeline.webhook.triggered` events on the EventStream,
// matches each event's `webhookPath` against published pipelines whose
// triggerBinding is { event: 'webhook', webhookPath: '<same>' }, and fires a
// run via `usePipelineRuns().triggerRun()` for every match.
//
// Phase 1: the EventStream source is the in-browser MockExecutor. The
// social-api `/hooks/pipeline/:path` route currently logs + 202s; the gateway
// bridge that would forward incoming webhooks onto the pipeline event source
// isn't wired yet. As a result, this hook is a dormant subscriber today.
// TODO Phase 4: wire bridge to forward webhook events.
//
// Mount once near the top of the tree (AppLayoutInner) so webhook triggers
// fire from anywhere in the app.

import { useRef } from 'react';
import { usePipelineRuns } from '../context/PipelineRunsContext';
import { useEventStream } from '../context/EventStreamContext';
import { listPipelines, loadPipeline } from '../persistence/pipelineStorage';
import type { PipelineEventMap } from '../../../types/pipeline';

// Dedupe window (ms) per webhook path to prevent double-fires when a flaky
// webhook source retries the same delivery within the window. Matches the
// 500ms window used by useDocumentTriggers for symmetry.
const DEDUP_WINDOW_MS = 500;

type WebhookPayload = PipelineEventMap['pipeline.webhook.triggered'];

/**
 * Subscribes to webhook events on the pipeline EventStream and fires runs
 * whose triggerBinding matches `(event: 'webhook', webhookPath)`.
 *
 * The hook re-reads the pipeline index per event (cheap localStorage scan)
 * so newly-published pipelines start receiving webhooks without a remount.
 */
export function useWebhookTriggers(): void {
  const { triggerRun } = usePipelineRuns();

  // Per-path last-fire timestamp for the dedupe window. Keyed by webhookPath
  // because two pipelines bound to the same path are pathological — we treat
  // them as one trigger surface and dedupe at that level.
  const lastFireByPathRef = useRef<Map<string, number>>(new Map());

  useEventStream('pipeline.webhook.triggered', (raw) => {
    // Wildcard subscribers receive `{ eventType, payload }`; typed
    // subscribers receive the payload directly. Narrow defensively so the
    // hook works either way.
    const payload =
      raw && typeof raw === 'object' && 'webhookPath' in raw
        ? (raw as WebhookPayload)
        : (raw as { payload?: WebhookPayload }).payload;
    if (!payload || typeof payload.webhookPath !== 'string') return;

    const webhookPath = payload.webhookPath;

    // Dedupe within the window.
    const now = Date.now();
    const lastFire = lastFireByPathRef.current.get(webhookPath) ?? 0;
    if (now - lastFire < DEDUP_WINDOW_MS) return;
    lastFireByPathRef.current.set(webhookPath, now);

    // Snapshot published pipelines and match.
    const indexEntries = listPipelines();
    for (const entry of indexEntries) {
      if (entry.status !== 'published') continue;
      const def = loadPipeline(entry.id);
      if (!def) continue;
      const binding = def.triggerBinding;
      if (!binding) continue;
      if (binding.event !== 'webhook') continue;
      if (binding.webhookPath !== webhookPath) continue;

      void triggerRun(def.id, {
        event: 'webhook',
        webhookPath,
        body: payload.body,
        headers: payload.headers,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[useWebhookTriggers] triggerRun failed', def.id, err);
      });
    }
  });
}
