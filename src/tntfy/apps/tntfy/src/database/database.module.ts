import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
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
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
