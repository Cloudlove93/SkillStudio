export type HealthCheckStatus = 'ok' | 'failed' | 'disabled';

export interface HealthSnapshot {
  ok: boolean;
  status: 'ready' | 'unavailable';
  service: 'educlaw-lite-server';
  checks: {
    database: HealthCheckStatus;
    objectStorage: HealthCheckStatus;
  };
  checkedAt: string;
}

type DependencyCheck = () => Promise<void>;

export function createHealthService(options: {
  checkDatabase: DependencyCheck;
  checkObjectStorage?: DependencyCheck;
  now?: () => Date;
  cacheTtlMs?: number;
}) {
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? 5_000;
  let cached: { expiresAtMs: number; snapshot: HealthSnapshot } | null = null;
  let pending: Promise<HealthSnapshot> | null = null;

  async function runCheck(): Promise<HealthSnapshot> {
    const checks = await Promise.allSettled([
      options.checkDatabase(),
      options.checkObjectStorage?.() ?? Promise.resolve(),
    ]);
    const database = checks[0].status === 'fulfilled' ? 'ok' : 'failed';
    const objectStorage = options.checkObjectStorage
      ? checks[1].status === 'fulfilled'
        ? 'ok'
        : 'failed'
      : 'disabled';
    const ok = database === 'ok' && objectStorage !== 'failed';
    const checkedAt = now();
    const snapshot: HealthSnapshot = {
      ok,
      status: ok ? 'ready' : 'unavailable',
      service: 'educlaw-lite-server',
      checks: { database, objectStorage },
      checkedAt: checkedAt.toISOString(),
    };
    cached = {
      expiresAtMs: checkedAt.getTime() + cacheTtlMs,
      snapshot,
    };
    return snapshot;
  }

  return {
    async check() {
      const currentTimeMs = now().getTime();
      if (cached && currentTimeMs < cached.expiresAtMs) {
        return cached.snapshot;
      }
      if (!pending) {
        pending = runCheck().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}
