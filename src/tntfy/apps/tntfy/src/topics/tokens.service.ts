import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { customAlphabet, nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';

export const TOKEN_REGEX = /^tk_[A-Za-z0-9_-]{24}$/;
const TOKEN_BODY = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  24,
);

@Injectable()
export class TokensService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly audit: AuditLogger,
  ) {}

  generate(): string {
    return `tk_${TOKEN_BODY()}`;
  }

  async rotate(topicId: string): Promise<string> {
    const newToken = this.generate();
    const newId = nanoid();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('topic_tokens').where('topic_id', '=', topicId).execute();
      await trx
        .insertInto('topic_tokens')
        .values({ id: newId, topic_id: topicId, token: newToken })
        .execute();
    });

    const owner = await this.db
      .selectFrom('topics')
      .select('user_id')
      .where('id', '=', topicId)
      .executeTakeFirstOrThrow();
    this.audit.log({ op: 'token.rotate', user_id: owner.user_id, topic_id: topicId });
    return newToken;
  }
}
