import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

async function main() {
  const direction = process.argv[2] ?? 'up';
  if (direction !== 'up' && direction !== 'down') {
    console.error(`Unknown direction: ${direction}. Use "up" or "down".`);
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(__dirname, '..', 'migrations'),
    }),
  });

  const { error, results } =
    direction === 'up'
      ? await migrator.migrateToLatest()
      : await migrator.migrateDown();

  for (const r of results ?? []) {
    if (r.status === 'Success') {
      console.log(`✓ ${direction} ${r.migrationName}`);
    } else if (r.status === 'Error') {
      console.error(`✗ ${direction} ${r.migrationName}`);
    }
  }

  await db.destroy();

  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
