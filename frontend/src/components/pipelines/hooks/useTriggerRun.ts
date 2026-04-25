// frontend/src/components/pipelines/hooks/useTriggerRun.ts
//
// Backend-sourced trigger path. POSTs `/api/pipelines/:pipelineId/runs` with
// the PipelineDefinition inline so the gateway forwards via PipelineBridge to
// the (currently mocked) PipelineModule without a read-after-write against
// pipeline storage.
//
// Source-mode auto-detection: this hook is the WebSocket-source path. The
// in-browser MockExecutor path lives on `PipelineRunsContext.triggerRun` —
// when `getPipelineSource()` returns `'mock'`, callers inside the pipelines
// tree should prefer that. This hook still works in either mode (the gateway
// has its own in-memory mock module under `pipeline-service.js`), so call
// sites that don't have a `PipelineRunsProvider` can use it unconditionally.
//
// On success returns the created `runId`; on failure returns `null` with the
// reason on `lastError`. The optional `Idempotency-Key` header is forwarded
// when supplied; replays surface via `isReplay`.

import { useCallback, useState } from 'react';
import { useIdentityContext } from '../../../contexts/IdentityContext';
import { loadPipeline } from '../persistence/pipelineStorage';
import { getPipelineSource } from './usePipelineSource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerRunResponse {
  runId: string;
  pipelineId: string;
  triggeredBy: { userId: string; triggerType: string };
  at: string;
}

export interface TriggerRunOptions {
  /**
   * When provided, sent as the `Idempotency-Key` request header. The server
   * dedupes replays of the same key within a short window and returns the
   * original response (with `X-Idempotent-Replay: true`). Callers typically
   * pass `crypto.randomUUID()` once per logical trigger and reuse it across
   * retries.
   */
  idempotencyKey?: string;
}

export interface UseTriggerRunReturn {
  triggerRun: (
    pipelineId: string,
    payload?: Record<string, unknown>,
    options?: TriggerRunOptions,
  ) => Promise<string | null>;
  isTriggering: boolean;
  lastError: string | null;
  /**
   * True iff the most recent successful `triggerRun` call was served from the
   * server's idempotency cache (i.e. the `X-Idempotent-Replay` header was
   * set). Resets to `false` on each new trigger attempt.
   */
  isReplay: boolean;
  /** Active source mode read at call time. */
  source: 'mock' | 'websocket';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTriggerRun(): UseTriggerRunReturn {
  const { idToken } = useIdentityContext();
  const [isTriggering, setIsTriggering] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isReplay, setIsReplay] = useState(false);

  const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

  const triggerRun = useCallback(
    async (
      pipelineId: string,
      payload?: Record<string, unknown>,
      options?: TriggerRunOptions,
    ): Promise<string | null> => {
      if (!idToken) {
        setLastError('Not authenticated');
        return null;
      }
      setIsTriggering(true);
      setLastError(null);
      setIsReplay(false);
      try {
        // Load the definition from local pipeline storage and ship it inline.
        // Missing-definition is non-fatal in Phase 1: the server accepts a
        // bare trigger. In Phase 4 the server will require `definition`.
        const definition = loadPipeline(pipelineId);

        const bodyPayload: Record<string, unknown> = {};
        if (payload) bodyPayload.triggerPayload = payload;
        if (definition) bodyPayload.definition = definition;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        };
        if (options?.idempotencyKey) {
          headers['Idempotency-Key'] = options.idempotencyKey;
        }

        const res = await fetch(
          `${baseUrl}/api/pipelines/${encodeURIComponent(pipelineId)}/runs`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyPayload),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          setLastError(
            `Trigger failed (${res.status})${text ? `: ${text}` : ''}`,
          );
          return null;
        }
        // Header matching is case-insensitive via the Headers API; fall back
        // to a plain-object lookup if the runtime hands us a bag of strings.
        // Note: the backend middleware uses `X-Idempotent-Replay` (RFC draft
        // wording). Keep both casings on the fallback path defensively.
        const replayHeader =
          typeof (res.headers as Headers)?.get === 'function'
            ? (res.headers as Headers).get('X-Idempotent-Replay')
            : ((res.headers as unknown as Record<string, string>)['x-idempotent-replay'] ?? null);
        setIsReplay(replayHeader === 'true');

        const data = (await res.json()) as TriggerRunResponse;
        return data.runId;
      } catch (err) {
        setLastError((err as Error).message);
        return null;
      } finally {
        setIsTriggering(false);
      }
    },
    [baseUrl, idToken],
  );

  return { triggerRun, isTriggering, lastError, isReplay, source: getPipelineSource() };
}
