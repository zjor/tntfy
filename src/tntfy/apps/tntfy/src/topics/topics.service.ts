import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';
import { TokensService } from './tokens.service';
import { validateTopicName } from './topic-name';
import { DuplicateTopicError, TopicNotFoundError } from './errors';

@Injectable()
export class TopicsService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly tokens: TokensService,
    private readonly audit: AuditLogger,
  ) {}

  async create(userId: string, name: string) {
    validateTopicName(name);
    const topicId = nanoid();
    const tokenId = nanoid();
    const tokenValue = this.tokens.generate();

    try {
      const { topic } = await this.db.transaction().execute(async (trx) => {
        const topic = await trx
          .insertInto('topics')
          .values({ id: topicId, user_id: userId, name })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('topic_tokens')
          .values({ id: tokenId, topic_id: topic.id, token: tokenValue })
          .execute();
        return { topic };
      });

      this.audit.log({ op: 'topic.create', user_id: userId, topic_id: topic.id, name });
      return { topic, token: tokenValue };
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new DuplicateTopicError(name);
      }
      throw err;
    }
  }

  async listByUser(userId: string) {
    return await this.db
      .selectFrom('topics')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async findByUserAndName(userId: string, name: string) {
    const row = await this.db
      .selectFrom('topics')
      .selectAll()
      .where('user_id', '=', userId)
      .where('name', '=', name)
      .executeTakeFirst();
    if (!row) throw new TopicNotFoundError(name);
    return row;
  }

  async findByUserAndId(userId: string, topicId: string) {
    const row = await this.db
      .selectFrom('topics')
      .selectAll()
      .where('user_id', '=', userId)
      .where('id', '=', topicId)
      .executeTakeFirst();
    if (!row) throw new TopicNotFoundError(topicId);
    return row;
  }

  async lookupByToken(token: string) {
    const row = await this.db
      .selectFrom('topic_tokens as tk')
      .innerJoin('topics as tp', 'tp.id', 'tk.topic_id')
      .innerJoin('users as u', 'u.id', 'tp.user_id')
      .select([
        'tk.id as token_id',
        'tp.id as topic_id',
        'tp.name as topic_name',
        'u.id as user_id',
        'u.ext_id as chat_id',
      ])
      .where('tk.token', '=', token)
      .executeTakeFirst();
    if (!row) return null;
    return {
      token_id: row.token_id,
      topic_id: row.topic_id,
      topic_name: row.topic_name,
      user_id: row.user_id,
      chat_id: Number(row.chat_id),
    };
  }

  async removeById(userId: string, topicId: string) {
    const result = await this.db.transaction().execute(async (trx) => {
      const counted = await trx
        .selectFrom('topic_messages')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('topic_id', '=', topicId)
        .executeTakeFirstOrThrow();
      const deleted = await trx
        .deleteFrom('topics')
        .where('id', '=', topicId)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirst();
      if (!deleted) return null;
      return { name: deleted.name, cascaded_messages_count: Number(counted.n) };
    });
    if (!result) throw new TopicNotFoundError(topicId);
    this.audit.log({
      op: 'topic.delete',
      user_id: userId,
      topic_id: topicId,
      name: result.name,
      cascaded_messages_count: result.cascaded_messages_count,
    });
    return result;
  }
}
