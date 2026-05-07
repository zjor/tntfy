import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../src/database/schema';

let cached: Kysely<Database> | undefined;

export function getTestDb(): Kysely<Database> {
  if (cached) return cached;
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set for tests');
  }
  cached = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }),
  });
  return cached;
}

export async function closeTestDb(): Promise<void> {
  if (cached) {
    await cached.destroy();
    cached = undefined;
  }
}
