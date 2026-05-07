import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';

export interface TelegramUserInput {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly audit: AuditLogger,
  ) {}

  async createOrGet(from: TelegramUserInput) {
    const id = nanoid();
    const inserted = await this.db
      .insertInto('users')
      .values({
        id,
        ext_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
      })
      .onConflict((oc) => oc.column('ext_id').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      this.audit.log({ op: 'user.create_or_get', user_id: inserted.id, ext_id: from.id });
      return inserted;
    }

    const existing = await this.db
      .selectFrom('users')
      .selectAll()
      .where('ext_id', '=', from.id)
      .executeTakeFirstOrThrow();
    return existing;
  }

  async upsertProfile(from: TelegramUserInput) {
    const id = nanoid();
    return await this.db
      .insertInto('users')
      .values({
        id,
        ext_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
      })
      .onConflict((oc) =>
        oc.column('ext_id').doUpdateSet({
          username: (eb) => eb.ref('excluded.username'),
          first_name: (eb) => eb.ref('excluded.first_name'),
          last_name: (eb) => eb.ref('excluded.last_name'),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
