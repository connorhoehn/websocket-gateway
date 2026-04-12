import { Request, Response, NextFunction } from 'express';

/**
 * Lightweight request logging middleware.
 * Logs: method, path, status code, and response time in ms.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
}
