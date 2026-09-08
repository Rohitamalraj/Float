import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '@float/config';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

export interface CreateDbOptions {
  url?: string;
  /** Max pool connections. Keep low for serverless / edge. */
  max?: number;
  /** Close idle connections after N seconds. */
  idleTimeout?: number;
}

/**
 * Build a Drizzle client over a fresh postgres.js pool. Prefer {@link getDb} for
 * the shared app instance; use this directly in tests or one-off scripts.
 */
export function createDb(options: CreateDbOptions = {}): {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
} {
  const url = options.url ?? loadEnv().DATABASE_URL;
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 20,
    prepare: true,
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

let shared: { db: Database; sql: postgres.Sql; close: () => Promise<void> } | undefined;

/** Process-wide shared client. Lazily created from `DATABASE_URL`. */
export function getDb(): Database {
  shared ??= createDb();
  return shared.db;
}

/** Close the shared client (graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (shared) {
    await shared.close();
    shared = undefined;
  }
}
