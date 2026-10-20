import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { config } from '../src/config.js';

/** Only creates/drops its own random database on the existing local instance. */
export async function isolatedPostgres() {
  const business = new URL(config.databaseUrl);
  if (business.hostname === 'educlaw-db') {
    business.hostname = '127.0.0.1';
    // Published host port of the compose database. config.ts loads .env, so
    // POSTGRES_PORT is available here; fall back to the standard 5432 mapping.
    business.port = process.env.POSTGRES_PORT ?? '5432';
  }
  if (!['127.0.0.1', 'localhost'].includes(business.hostname))
    throw new Error('Isolation fixture requires the existing local PostgreSQL instance');
  const name = `eduskill_hardening_${randomUUID().replaceAll('-', '')}`;
  if (name === decodeURIComponent(business.pathname.slice(1))) throw new Error('Unsafe test database');
  const adminUrl = new URL(business); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  const target = new URL(business); target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.toString(), max: 5 });
  if ((await pool.query('select current_database() as name')).rows[0].name !== name)
    throw new Error('Unsafe test connection');
  return {
    name, pool,
    async close() {
      await pool.end();
      if (!/^eduskill_hardening_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup');
      await admin.query(`drop database "${name}"`);
      await admin.end();
    },
  };
}

export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
