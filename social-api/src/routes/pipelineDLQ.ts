// social-api/src/routes/pipelineDLQ.ts
//
// Operator surface for the EventBus dead-letter queue, backed by
// distributed-core v0.11.0 T9 (lib-expansion-3) `InMemoryDeadLetterQueue`.
// The DLQ is populated by the bootstrap's `eventBusDeadLetterHandler`
// whenever a subscriber throws or a publish path fails on the pipeline
// EventBus. This route exposes that store for operator inspection +
// targeted redrive.
//
// Endpoints:
//   GET  /api/pipelines/dlq                       → paginated list (filters: sinceMs, failureKindMatches)
//   GET  /api/pipelines/dlq/peek/:id              → single envelope by id
//   POST /api/pipelines/dlq/redrive               → re-publish selected entries via the EventBus
//   POST /api/pipelines/dlq/purge                 → drop selected entries
//
// Auth: requireAuth (mounted in app.ts) + pipelineReadRateLimit GET budget
// (also in app.ts). Redrive + purge are destructive-shaped — the library does
// NOT ship authz, the gateway is responsible for any role gating. Today the
// social-api does not yet have an admin-role middleware in /api/pipelines, so
// these endpoints reuse the same Cognito-authenticated session as the rest of
// the pipeline routes; folding in an admin gate when one exists is a Phase 50
// follow-up.

import { Router, type Response } from 'express';
import type { BusEvent as DCBusEvent, DeadLetterQueue } from 'distributed-core';
import { asyncHandler } from '../middleware/error-handler';
import { getPipelineBridge } from './pipelineTriggers';

export const pipelineDLQRouter = Router();

function dlqOr503(res: Response): DeadLetterQueue<DCBusEvent> | null {
  const bridge = getPipelineBridge();
  if (!bridge || typeof bridge.getDLQ !== 'function') {
    res.status(503).json({ error: 'pipeline DLQ unavailable' });
    return null;
  }
  const dlq = bridge.getDLQ();
  if (!dlq) {
    res.status(503).json({ error: 'pipeline DLQ disabled' });
    return null;
  }
  return dlq;
}

function parseLimit(raw: unknown, def = 50, max = 200): number {
  if (typeof raw !== 'string') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(Math.floor(n), max);
}

function parseSinceMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

pipelineDLQRouter.get('/', asyncHandler(async (req, res) => {
  const dlq = dlqOr503(res);
  if (!dlq) return;
  const query = req.query as Record<string, unknown>;
  const limit = parseLimit(query.limit);
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
  const sinceMs = parseSinceMs(query.sinceMs);
  const page = await dlq.list({ limit, cursor, ...(sinceMs !== undefined ? { sinceMs } : {}) });
  res.status(200).json(page);
}));

pipelineDLQRouter.get('/peek/:id', asyncHandler(async (req, res) => {
  const dlq = dlqOr503(res);
  if (!dlq) return;
  const params = req.params as { id: string };
  const entry = await dlq.peek(params.id);
  if (!entry) {
    res.status(404).json({ error: 'dlq entry not found', id: params.id });
    return;
  }
  res.status(200).json(entry);
}));

pipelineDLQRouter.post('/redrive', asyncHandler(async (req, res) => {
  const dlq = dlqOr503(res);
  if (!dlq) return;
  const body = (req.body ?? {}) as { ids?: unknown; resetAttempts?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== 'string')) {
    res.status(400).json({ error: 'body.ids must be an array of strings' });
    return;
  }
  const resetAttempts = body.resetAttempts === true;
  const result = await dlq.redrive(body.ids as string[], { resetAttempts });
  res.status(200).json(result);
}));

pipelineDLQRouter.post('/purge', asyncHandler(async (req, res) => {
  const dlq = dlqOr503(res);
  if (!dlq) return;
  const body = (req.body ?? {}) as { ids?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== 'string')) {
    res.status(400).json({ error: 'body.ids must be an array of strings' });
    return;
  }
  const result = await dlq.purge(body.ids as string[]);
  res.status(200).json(result);
}));
