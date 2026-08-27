import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import { multimodalSchemaStatements } from './db-schema.js';
import { createMultimodalJobService } from './multimodal-job-service.js';
import { createMultimodalJobStore } from './multimodal-job-store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function validateIntegrationDatabaseUrl(value: string | undefined): {
  shouldSkip: boolean;
  connectionString: string | null;
} {
  if (!value) {
    return { shouldSkip: true, connectionString: null };
  }

  const parsed = new URL(value);
  const protocol = parsed.protocol.replace(/:$/, '');
  if (protocol !== 'postgres' && protocol !== 'postgresql') {
    throw new Error(
      'Refusing to run multimodal integration tests with a non-PostgreSQL protocol',
    );
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(
      'Refusing to run multimodal integration tests outside 127.0.0.1',
    );
  }
  if (parsed.port !== '55432') {
    throw new Error(
      'Refusing to run multimodal integration tests outside port 55432',
    );
  }
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (databaseName !== 'educlaw_multimodal_slice1') {
    throw new Error(
      'Refusing to run multimodal integration tests outside educlaw_multimodal_slice1',
    );
  }

  return { shouldSkip: false, connectionString: value };
}

const integrationDatabase = validateIntegrationDatabaseUrl(testDatabaseUrl);
const describeIfDatabase = integrationDatabase.shouldSkip
  ? describe.skip
  : describe;

describe('multimodal integration URL guard', () => {
  it('skips cleanly when TEST_DATABASE_URL is missing', () => {
    expect(validateIntegrationDatabaseUrl(undefined)).toEqual({
      shouldSkip: true,
      connectionString: null,
    });
  });

  it('accepts only the exact approved local test URL', () => {
    expect(
      validateIntegrationDatabaseUrl(
        'postgres://postgres:postgres@127.0.0.1:55432/educlaw_multimodal_slice1',
      ),
    ).toEqual({
      shouldSkip: false,
      connectionString:
        'postgres://postgres:postgres@127.0.0.1:55432/educlaw_multimodal_slice1',
    });
  });

  it('rejects production-like and remote URLs before any pool is created', () => {
    for (const input of [
      'postgres://postgres:postgres@127.0.0.1:5435/educlaw',
      'postgres://postgres:postgres@10.0.0.5:55432/educlaw_multimodal_slice1',
      'postgres://postgres:postgres@127.0.0.1:55432/wrong_db',
      'https://127.0.0.1:55432/educlaw_multimodal_slice1',
    ]) {
      expect(() => validateIntegrationDatabaseUrl(input)).toThrowError();
    }
  });
});

function getSafeDatabaseUrl() {
  if (integrationDatabase.shouldSkip) {
    return null;
  }
  return integrationDatabase.connectionString;
}

const safeDatabaseUrl = getSafeDatabaseUrl();

describeIfDatabase('multimodal job store integration', () => {
  let pool: Pool;
  let service: ReturnType<typeof createMultimodalJobService>;
  let sessionId: string;
  let currentTime = new Date('2026-08-21T15:00:00.000Z');

  beforeAll(async () => {
    pool = new Pool({ connectionString: safeDatabaseUrl! });
    const store = createMultimodalJobStore();

    async function testWithTransaction<T>(
      work: (client: PoolClient) => Promise<T>,
    ) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await work(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    service = createMultimodalJobService({
      store,
      withTransaction: testWithTransaction,
      now: () => currentTime,
    });

    await pool.query(`
      create table if not exists skill_guided_creation_sessions (
        id bigserial primary key,
        user_id text not null,
        status text not null,
        deleted_at timestamptz null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    for (const statement of multimodalSchemaStatements) {
      await pool.query(statement);
    }

    await pool.query('delete from skill_media_jobs');
    await pool.query('delete from skill_guided_creation_sessions');

    const sessionResult = await pool.query(
      `
        insert into skill_guided_creation_sessions (
          user_id,
          status,
          creation_mode
        )
        values ($1, $2, $3)
        returning id
      `,
      ['integration-user', 'collecting', 'multimodal_distill'],
    );
    sessionId = String(sessionResult.rows[0].id);
  });

  afterAll(async () => {
    try {
      await pool.query('delete from skill_media_jobs');
      await pool.query('delete from skill_guided_creation_sessions');
    } finally {
      await pool.end();
    }
  });

  it('leases exactly one job across two concurrent workers and re-leases exactly at expiry without a manual recycle call', async () => {
    currentTime = new Date('2026-08-21T15:00:00.000Z');
    const job = await service.createMediaJob({
      sessionId,
      jobType: 'transcribe',
      requestHash: 'a'.repeat(64),
      idempotencyKey: 'claim-race',
      inputManifest: {},
    });

    const [workerA, workerB] = await Promise.all([
      service.claimMediaJob({
        workerIdentity: 'worker-a',
        acceptedJobTypes: ['transcribe'],
      }),
      service.claimMediaJob({
        workerIdentity: 'worker-b',
        acceptedJobTypes: ['transcribe'],
      }),
    ]);

    expect([workerA, workerB].filter(Boolean)).toHaveLength(1);
    const leased = workerA ?? workerB;
    expect(leased?.jobId).toBe(job.id);
    expect(leased?.attemptNo).toBe(1);

    currentTime = new Date(leased.leaseExpiresAt);

    const notYetAvailable = await service.claimMediaJob({
      workerIdentity: 'worker-b',
      acceptedJobTypes: ['transcribe'],
    });

    expect(notYetAvailable).toBeNull();

    const recycledRow = await pool.query(
      `
        select status, available_at
        from skill_media_jobs
        where id = $1
      `,
      [job.id],
    );
    expect(recycledRow.rows[0]).toMatchObject({
      status: 'queued',
    });
    expect(recycledRow.rows[0].available_at).not.toBeNull();

    currentTime = new Date(recycledRow.rows[0].available_at);

    const reclaimed = await service.claimMediaJob({
      workerIdentity: 'worker-b',
      acceptedJobTypes: ['transcribe'],
    });

    expect(reclaimed?.jobId).toBe(job.id);
    expect(reclaimed?.attemptNo).toBe(2);
  });

  it('turns a cancel-requested leased job into cancelled at expiry and never re-claims it', async () => {
    currentTime = new Date('2026-08-21T16:00:00.000Z');
    const job = await service.createMediaJob({
      sessionId,
      jobType: 'media_quality_check',
      requestHash: 'b'.repeat(64),
      idempotencyKey: 'cancel-expiry',
      inputManifest: {},
    });

    const leased = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['media_quality_check'],
    });

    expect(leased?.jobId).toBe(job.id);

    await service.cancelMediaJob({
      jobId: job.id,
    });

    currentTime = new Date(leased.leaseExpiresAt);

    await service.recycleExpiredLeases();

    const reclaimed = await service.claimMediaJob({
      workerIdentity: 'worker-b',
      acceptedJobTypes: ['media_quality_check'],
    });

    expect(reclaimed).toBeNull();

    const row = await pool.query(
      'select status, finished_at from skill_media_jobs where id = $1',
      [job.id],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'cancelled',
    });
    expect(row.rows[0].finished_at).not.toBeNull();
  });
});
