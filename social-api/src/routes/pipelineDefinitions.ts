// social-api/src/routes/pipelineDefinitions.ts
//
// REST endpoints for pipeline definitions, backed by DynamoDB via the
// `definitionsRepo` singleton (see `../pipeline/definitions-repository.ts`).
//
// Wave 3 of the persistence migration removed the synchronous in-memory
// mirror that earlier waves kept around for cross-module consumers.
// Those consumers (the schedule evaluator in `src/index.ts` and the
// webhook lookups in `pipelineWebhooks.ts`) now read from
// `pipelineDefinitionsCache`, a Scan-backed snapshot refreshed every
// 60s. We poke the cache from the write paths below so the common "save
// the pipeline then immediately test the webhook" UX doesn't have to
// wait a minute for the cache to catch up.
//
// Endpoints (mounted at /api/pipelines/defs in routes/index.ts — see the
// collision note below):
//   GET    /                         — list the caller's pipeline defs
//   GET    /:pipelineId              — fetch one
//   PUT    /:pipelineId              — upsert (body.id must match :pipelineId)
//   DELETE /:pipelineId              — remove
//   POST   /:pipelineId/publish      — bump version, mark published
//
// Collision note: the existing `pipelineMetricsRouter` is mounted at
// `/api/pipelines/metrics`. To avoid shadowing the static `metrics` segment
// under a `/:pipelineId` route, this router is mounted at `/pipelines/defs`
// (see routes/index.ts). The metrics mount must come BEFORE the defs mount
// anyway — Express resolves mounts in registration order.
//
// Shape is deliberately compatible with the frontend's `PipelineDefinition`
// type; this file keeps its own untyped view so the two repos can evolve
// independently (standalone mirror — see TYPES_SYNC.md).

import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { generateWebhookSecret } from '../lib/webhookSignature';
import { definitionsRepo } from '../pipeline/definitions-repository';
import { pipelineDefinitionsCache } from '../pipeline/definitions-cache';
import { withContext } from '../lib/logger';

const log = withContext({ route: 'pipelineDefinitions' });

/**
 * Best-effort cache poke after a write. Errors are swallowed because the
 * cache will refresh again within `intervalMs` (default 60s) — losing one
 * write-side refresh is strictly less bad than failing the response. We
 * fire-and-forget so the HTTP latency is unaffected by the Scan.
 */
function pokeCacheAfterWrite(): void {
  pipelineDefinitionsCache.refresh().catch((err) => {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'pipelineDefinitionsCache refresh-after-write failed',
    );
  });
}

export const pipelineDefinitionsRouter = Router();

// List
pipelineDefinitionsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    try {
      const items = await definitionsRepo.list(userId);
      res.json({ pipelines: items });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ err: message, action: 'def.list' }, 'failed to list definitions');
      res.status(500).json({ error: 'internal_error', detail: 'failed to list definitions' });
    }
  }),
);

// Get one
pipelineDefinitionsRouter.get(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const pipelineId = req.params.pipelineId;
    try {
      const def = await definitionsRepo.get(userId, pipelineId);
      if (!def) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(def);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ err: message, pipelineId, action: 'def.get' }, 'failed to get definition');
      res.status(500).json({ error: 'internal_error', detail: 'failed to get definition' });
    }
  }),
);

// Upsert
pipelineDefinitionsRouter.put(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const pipelineId = req.params.pipelineId;
    const def = req.body as
      | {
          id?: unknown;
          triggerBinding?: {
            event?: string;
            webhookPath?: string;
            webhookSecret?: string;
          };
        }
      | undefined;
    if (!def || typeof def !== 'object' || def.id !== pipelineId) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    // Mint a webhook secret server-side the first time a webhook trigger
    // binding is saved so the secret never has to round-trip through the
    // browser unprotected. Idempotent — once a secret exists we leave it
    // alone (rotation is a separate, explicit operation Phase-5 will add).
    const tb = def.triggerBinding;
    if (
      tb &&
      tb.event === 'webhook' &&
      typeof tb.webhookPath === 'string' &&
      tb.webhookPath.length > 0 &&
      (typeof tb.webhookSecret !== 'string' || tb.webhookSecret.length === 0)
    ) {
      tb.webhookSecret = generateWebhookSecret();
    }

    try {
      await definitionsRepo.put(userId, def as { id: string; [k: string]: unknown });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ err: message, pipelineId, action: 'def.put' }, 'failed to persist definition');
      res.status(500).json({ error: 'internal_error', detail: 'failed to persist definition' });
      return;
    }

    // Refresh the cross-user cache so the webhook router and the schedule
    // evaluator see the new definition without waiting for the next tick.
    pokeCacheAfterWrite();

    log.info({ pipelineId, action: 'def.put' }, 'definition updated');
    res.json(def);
  }),
);

// Delete
pipelineDefinitionsRouter.delete(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const pipelineId = req.params.pipelineId;
    try {
      await definitionsRepo.delete(userId, pipelineId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ err: message, pipelineId, action: 'def.delete' }, 'failed to delete definition');
      res.status(500).json({ error: 'internal_error', detail: 'failed to delete definition' });
      return;
    }

    // Refresh the cross-user cache so removed definitions stop firing
    // schedules / matching webhook paths immediately.
    pokeCacheAfterWrite();

    log.info({ pipelineId, action: 'def.delete' }, 'definition deleted');
    res.status(204).end();
  }),
);

// Publish — convenience route
pipelineDefinitionsRouter.post(
  '/:pipelineId/publish',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const pipelineId = req.params.pipelineId;

    let current: { id: string; [k: string]: unknown } | null;
    try {
      current = (await definitionsRepo.get(userId, pipelineId)) as
        | { id: string; [k: string]: unknown }
        | null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(
        { err: message, pipelineId, action: 'def.publish.read' },
        'failed to read definition for publish',
      );
      res.status(500).json({ error: 'internal_error', detail: 'failed to read definition' });
      return;
    }

    if (!current) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const next = current as {
      id: string;
      status?: string;
      version?: number;
      publishedVersion?: number;
      [k: string]: unknown;
    };
    next.version = (next.version ?? 0) + 1;
    next.status = 'published';
    next.publishedVersion = next.version;

    try {
      await definitionsRepo.put(userId, next);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(
        { err: message, pipelineId, action: 'def.publish.write' },
        'failed to persist published definition',
      );
      res.status(500).json({ error: 'internal_error', detail: 'failed to persist publish' });
      return;
    }

    pokeCacheAfterWrite();

    log.info(
      { pipelineId, version: next.version, action: 'def.publish' },
      'definition published',
    );
    res.json(next);
  }),
);
