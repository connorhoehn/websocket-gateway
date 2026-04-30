import express from 'express';
import { requireAuth } from './middleware/auth';
import { requestLogger } from './middleware/request-logger';
import { errorHandler } from './middleware/error-handler';
import { pipelineReadRateLimit } from './middleware/rateLimit';
import healthRouter from './routes/health';
import apiRouter from './routes/index';
import { pipelineWebhooksRouter } from './routes/pipelineWebhooks';
import { renderPrometheusText } from './observability/metrics';

export function createApp(): express.Application {
  const app = express();

  // CORS — allow frontend dev server
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json());
  app.use(requestLogger);

  // Health check — no auth required. Mounted at /health (canonical) and
  // /api/health (alias) so callers using the /api/* convention don't 404.
  // Both mounts use the same router so behaviour stays identical.
  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);

  // Prometheus scrape endpoint — distributed-core MetricsRegistry shadow.
  // Public (no auth) so a Prometheus server can scrape it; matches the
  // gateway's `GET /internal/metrics` mount. See observability/metrics.ts.
  app.get('/internal/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(renderPrometheusText());
  });

  // Pipeline webhooks — public endpoints (no auth) for external systems to
  // fire pipelines. Mounted BEFORE requireAuth because webhook callers don't
  // carry a Cognito JWT. See routes/pipelineWebhooks.ts.
  app.use('/hooks/pipeline', pipelineWebhooksRouter);

  // All routes below this line require a valid Cognito JWT
  app.use(requireAuth);

  // Pipeline READ rate limit — applied at the mount level so we don't have
  // to touch any individual pipeline route file (those are owned by other
  // agents in this wave). Method-aware: only GETs are limited; POST/PUT/etc
  // pass straight through to their own per-route limiters (trigger/cancel/
  // approval each have their own budget). Mounted AFTER `requireAuth` so
  // `req.user.sub` is available as the bucket key. The webhook path
  // (`/hooks/pipeline/*`) is mounted ABOVE `requireAuth` and is NOT
  // affected by this limiter.
  const pipelineGetLimiter = pipelineReadRateLimit();
  app.use('/api/pipelines', (req, res, next) => {
    if (req.method !== 'GET') { next(); return; }
    pipelineGetLimiter(req, res, next);
  });

  // API routes (profiles, groups, rooms, etc.) mounted here in later phases
  app.use('/api', apiRouter);

  // Central error middleware — MUST be last
  app.use(errorHandler);

  return app;
}
