import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createHealthRouter } from './health.js';

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('health routes', () => {
  it('keeps liveness independent from failing dependencies', async () => {
    const check = vi.fn().mockResolvedValue({ ok: false, status: 'unavailable' });
    const app = express().use(createHealthRouter({ check }));
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/livez`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        status: 'alive',
        service: 'educlaw-lite-server',
      });
      expect(check).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('uses the dependency snapshot for readiness and the compatibility endpoint', async () => {
    const snapshot = {
      ok: false,
      status: 'unavailable' as const,
      service: 'educlaw-lite-server' as const,
      checks: { database: 'failed' as const, objectStorage: 'ok' as const },
      checkedAt: '2026-08-29T08:00:00.000Z',
    };
    const check = vi.fn().mockResolvedValue(snapshot);
    const app = express().use(createHealthRouter({ check }));
    const { server, url } = await listen(app);

    try {
      for (const path of ['/readyz', '/healthz']) {
        const response = await fetch(`${url}${path}`);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(snapshot);
      }
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      await close(server);
    }
  });
});
