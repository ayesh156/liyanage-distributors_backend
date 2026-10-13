import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabaseHealth } from '../config/database.ts';

/**
 * Health check router.
 * Provides a lightweight status check for network resilience and monitoring.
 */
const healthRouter = Router();

/**
 * GET /api/health
 * Returns a lightweight JSON 200 { status: "ok" } with system and database metrics.
 */
healthRouter.get('/', async (_req: Request, res: Response) => {
  const health = await getDatabaseHealth();
  res.status(200).json({
    status: 'ok',
    success: true,
    timestamp: new Date().toISOString(),
    service: 'liyanage-distributors-api',
    version: '1.0.0',
    ...health,
  });
});

export default healthRouter;
