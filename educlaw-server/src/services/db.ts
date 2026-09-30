import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';

const pool = new Pool({ connectionString: config.databaseUrl });
// Session-level advisory locks must not consume the same pool that pipeline work
// uses. Otherwise enough concurrent lock holders can starve every operation that
// is supposed to run while those locks are held.
const advisoryPool = new Pool({
  connectionString: config.databaseUrl,
  max: config.multimodalPipelineRunnerConcurrency,
});

export interface Queryable {
  query<T extends QueryResultRow = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export async function checkDbConnection() {
  await pool.query('select 1');
}

export async function closeDbPool() {
  await Promise.all([pool.end(), advisoryPool.end()]);
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
) {
  return pool.query<T>(text, values);
}

export async function withConnection<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function withAdvisoryConnection<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await advisoryPool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
