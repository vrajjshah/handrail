import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/** Where the committed migrations live, from source and from `dist` alike. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/**
 * One pool per process.
 *
 * Small on purpose: the worker runs at concurrency 1–2 and the API's queries
 * are short. A large pool against a small managed Postgres exhausts the
 * server's connection limit long before it helps anything, and the failure
 * looks like a mysterious timeout rather than a configuration mistake.
 */
export function connect(connectionString: string, max = 5): DatabaseHandle {
  const pool = new Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/**
 * Apply the committed migrations.
 *
 * Called by `db:migrate`, as an explicit step before the process starts —
 * never from the server's own boot path. Two containers starting at once would
 * otherwise race each other through the same DDL, and the loser's error is
 * indistinguishable from a real failure.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
