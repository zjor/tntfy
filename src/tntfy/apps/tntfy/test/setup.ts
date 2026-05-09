import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { Migrator, sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely';
import { getTestDb, closeTestDb } from './db';

const migrationsFolder = path.resolve(__dirname, '..', 'src', 'database', 'migrations');

/**
 * Custom migration provider that uses vite-aware dynamic `import()`.
 * Vitest intercepts dynamic imports and can transform .ts files,
 * whereas the built-in FileMigrationProvider's import() call is not
 * intercepted (it runs in the kysely ESM bundle context, outside vite).
 */
class VitestMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const files = await fs.readdir(migrationsFolder);
    const migrations: Record<string, Migration> = {};

    for (const fileName of files) {
      if (
        (fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')) ||
        fileName.endsWith('.js')
      ) {
        const filePath = path.join(migrationsFolder, fileName);
        const mod = (await import(filePath)) as { default?: Migration } & Migration;
        const migration = mod.default ?? (mod as unknown as Migration);
        if (typeof migration?.up === 'function') {
          const key = fileName.substring(0, fileName.lastIndexOf('.'));
          migrations[key] = migration;
        }
      }
    }

    return migrations;
  }
}

beforeAll(async () => {
  const db = getTestDb();
  const migrator = new Migrator({
    db,
    provider: new VitestMigrationProvider(),
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') {
      throw new Error(`migration failed: ${r.migrationName}`);
    }
  }
  if (error) throw error;
});

beforeEach(async () => {
  const db = getTestDb();
  await sql`TRUNCATE users, topics, topic_tokens, topic_messages RESTART IDENTITY CASCADE`.execute(db);
});

afterAll(async () => {
  await closeTestDb();
});
