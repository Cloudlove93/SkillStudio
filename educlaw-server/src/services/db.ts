import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import { config } from "../config.js";

const pool = new Pool({ connectionString: config.databaseUrl });

export async function initDb() {
  await pool.query("select 1");

  await pool.query(`
    create table if not exists users (
      id text primary key,
      username text unique not null,
      password_hash text not null,
      created_at text not null
    )
  `);

  await pool.query(`
    create table if not exists agent_packages (
      id text primary key,
      user_id text not null,
      name text not null,
      description text not null default '',
      current_version_id text not null,
      created_at text not null,
      updated_at text not null
    )
  `);

  await pool.query(`
    create table if not exists agent_package_versions (
      id text primary key,
      package_id text not null,
      version_number integer not null,
      source text not null,
      snapshot_json text not null,
      created_at text not null
    )
  `);

  await pool.query(`
    create table if not exists arena_threads (
      id text primary key,
      user_id text not null,
      package_id text not null,
      title text not null,
      model text,
      created_at text not null,
      updated_at text not null
    )
  `);

  await pool.query(`
    create table if not exists arena_messages (
      id text primary key,
      thread_id text not null,
      user_id text not null,
      side text not null,
      role text not null,
      content text not null,
      created_at text not null
    )
  `);
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export function newId() {
  return randomUUID();
}