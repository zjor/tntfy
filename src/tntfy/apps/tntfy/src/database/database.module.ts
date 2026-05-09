import {
  Global,
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from 'kysely';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import type { Database } from './schema';

export const KYSELY = Symbol('KYSELY');

function createKysely(): Kysely<Database> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: createKysely,
    },
  ],
  exports: [KYSELY],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onModuleInit() {
    const migrator = new Migrator({
      db: this.db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(__dirname, 'migrations'),
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((r) => {
      if (r.status === 'Success') {
        this.logger.log(`migration "${r.migrationName}" applied`);
      } else if (r.status === 'Error') {
        this.logger.error(`migration "${r.migrationName}" failed`);
      }
    });

    if (error) {
      throw error instanceof Error ? error : new Error('migration failed');
    }
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
