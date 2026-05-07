import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { Database } from '../src/database/schema';

// Parse int8 (OID 20) as JS number instead of string so that ext_id, content_length,
// and telegram_message_id round-trip as numbers in tests and in app code.
// Values are Telegram user IDs / message counts — safely within Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (val) => parseInt(val, 10));

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
