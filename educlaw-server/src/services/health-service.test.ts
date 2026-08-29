import { describe, expect, it, vi } from 'vitest';

import { createHealthService } from './health-service.js';

describe('health service', () => {
  it('reports ready only after required dependencies respond', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const checkObjectStorage = vi.fn().mockResolvedValue(undefined);
    const service = createHealthService({
      checkDatabase,
      checkObjectStorage,
      now: () => new Date('2026-08-29T08:00:00.000Z'),
    });

    await expect(service.check()).resolves.toEqual({
      ok: true,
      status: 'ready',
      service: 'educlaw-lite-server',
      checks: {
        database: 'ok',
        objectStorage: 'ok',
      },
      checkedAt: '2026-08-29T08:00:00.000Z',
    });
  });

  it('marks optional object storage as disabled outside configured deployments', async () => {
    const service = createHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      now: () => new Date('2026-08-29T08:00:00.000Z'),
    });

    await expect(service.check()).resolves.toMatchObject({
      ok: true,
      checks: { database: 'ok', objectStorage: 'disabled' },
    });
  });

  it('reports unavailable without exposing dependency error details', async () => {
    const service = createHealthService({
      checkDatabase: vi.fn().mockRejectedValue(new Error('password=secret')),
      checkObjectStorage: vi.fn().mockResolvedValue(undefined),
      now: () => new Date('2026-08-29T08:00:00.000Z'),
    });

    const result = await service.check();
    expect(result).toMatchObject({
      ok: false,
      status: 'unavailable',
      checks: { database: 'failed', objectStorage: 'ok' },
    });
    expect(JSON.stringify(result)).not.toContain('password=secret');
  });

  it('uses a short cache to avoid turning health polling into dependency load', async () => {
    let nowMs = Date.parse('2026-08-29T08:00:00.000Z');
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const service = createHealthService({
      checkDatabase,
      now: () => new Date(nowMs),
      cacheTtlMs: 5_000,
    });

    await service.check();
    nowMs += 4_000;
    await service.check();
    expect(checkDatabase).toHaveBeenCalledTimes(1);

    nowMs += 2_000;
    await service.check();
    expect(checkDatabase).toHaveBeenCalledTimes(2);
  });
});
