import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../core/config.js';
import * as schema from './schema.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.isTest ? 4 : 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };

export async function checkDatabase(): Promise<{ ok: boolean; message?: string }> {
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
