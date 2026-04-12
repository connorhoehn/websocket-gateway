import express from 'express';
import { requireAuth } from './middleware/auth';
import { requestLogger } from './middleware/request-logger';
import healthRouter from './routes/health';
import apiRouter from './routes/index';

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

  // Health check — no auth required
  app.use('/health', healthRouter);

  // All routes below this line require a valid Cognito JWT
  app.use(requireAuth);

  // API routes (profiles, groups, rooms, etc.) mounted here in later phases
  app.use('/api', apiRouter);

  return app;
}
