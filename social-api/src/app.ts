import express from 'express';
import { requireAuth } from './middleware/auth';
import healthRouter from './routes/health';
import apiRouter from './routes/index';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // Health check — no auth required
  app.use('/health', healthRouter);

  // All routes below this line require a valid Cognito JWT
  app.use(requireAuth);

  // API routes (profiles, groups, rooms, etc.) mounted here in later phases
  app.use('/api', apiRouter);

  return app;
}
