import { Pool, type QueryResultRow } from "pg";
import { config } from "../config.js";

const pool = new Pool({ connectionString: config.databaseUrl });

export async function checkDbConnection() {
  await pool.query("select 1");
}

export async function closeDbPool() {
  await pool.end();
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
