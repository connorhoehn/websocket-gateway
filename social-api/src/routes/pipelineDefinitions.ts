// social-api/src/routes/pipelineDefinitions.ts
//
// Phase 1 stub: REST endpoints for pipeline definitions. Keeps localStorage
// authoritative on the frontend for now; these endpoints exist purely to
// lock the wire contract so Phase 4 can flip a feature flag and start
// mirroring / flushing writes without touching the route shapes.
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
// Phase 3/4: replace `stubStore` with distributed-core's `StateStore` via a
// ResourceRouter-owned resource per pipeline. The shape-compat is
// intentional — endpoint contracts don't change. Phase 4 also considers
// wiring frontend's `pipelineStorage.ts` to write through to these endpoints
// via an event-sourced strategy (local first, then flush to remote).
//
// Shape is deliberately compatible with the frontend's `PipelineDefinition`
// type; this file keeps its own untyped view so the two repos can evolve
// independently (standalone mirror — see TYPES_SYNC.md).

import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/error-handler';

// In-memory by user; resets on server restart.
const stubStore = new Map<string, Map<string, unknown>>(); // userId -> pipelineId -> def

function bucketFor(userId: string): Map<string, unknown> {
  let b = stubStore.get(userId);
  if (!b) {
    b = new Map();
    stubStore.set(userId, b);
  }
  return b;
}

export const pipelineDefinitionsRouter = Router();

// List
pipelineDefinitionsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const items = Array.from(bucketFor(userId).values());
    res.json({ pipelines: items });
  }),
);

// Get one
pipelineDefinitionsRouter.get(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const def = bucketFor(userId).get(req.params.pipelineId);
    if (!def) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(def);
  }),
);

// Upsert
pipelineDefinitionsRouter.put(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const def = req.body as { id?: unknown } | undefined;
    if (!def || typeof def !== 'object' || def.id !== req.params.pipelineId) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    bucketFor(userId).set(req.params.pipelineId, def);
    res.json(def);
  }),
);

// Delete
pipelineDefinitionsRouter.delete(
  '/:pipelineId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    bucketFor(userId).delete(req.params.pipelineId);
    res.status(204).end();
  }),
);

// Publish — convenience route
pipelineDefinitionsRouter.post(
  '/:pipelineId/publish',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const def = bucketFor(userId).get(req.params.pipelineId) as
      | { status?: string; version?: number; publishedVersion?: number }
      | undefined;
    if (!def) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    def.version = (def.version ?? 0) + 1;
    def.status = 'published';
    def.publishedVersion = def.version;
    res.json(def);
  }),
);
