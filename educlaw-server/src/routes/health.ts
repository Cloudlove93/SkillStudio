import { Router } from 'express';
import type { HealthSnapshot } from '../services/health-service.js';

interface HealthService {
  check(): Promise<HealthSnapshot>;
}

export function createHealthRouter(healthService: HealthService) {
  const router: import('express').Router = Router();

  router.get('/livez', (_req, res) => {
    res.json({
      ok: true,
      status: 'alive',
      service: 'educlaw-lite-server',
    });
  });

  const readinessHandler: import('express').RequestHandler = async (
    _req,
    res,
  ) => {
    const health = await healthService.check();
    res.status(health.ok ? 200 : 503).json(health);
  };
  router.get('/readyz', readinessHandler);
  router.get('/healthz', readinessHandler);

  return router;
}
