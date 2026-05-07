import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      MessagesService,
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const messages = mod.get(MessagesService);
  const topics = mod.get(TopicsService);
  const users = mod.get(UsersService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  const { topic } = await topics.create(u.id, 'deploys');
  return { mod, messages, topicId: topic.id };
}

describe('MessagesService.recordAttempt', () => {
  it('writes a delivered text row', async () => {
    const { mod, messages, topicId } = await setup();
    const out = await messages.recordAttempt({
      topicId,
      kind: 'text',
      format: 'markdown',
      textBody: 'hello *bold*',
      mimeType: null,
      contentLength: null,
      filename: null,
      caption: null,
      status: 'delivered',
      telegramMessageId: 42,
      error: null,
    });
    expect(out.id).toMatch(/^[A-Za-z0-9_-]{21}$/);

    const db = mod.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', out.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      kind: 'text',
      format: 'markdown',
      text_body: 'hello *bold*',
      status: 'delivered',
    });
    expect(Number(row.telegram_message_id)).toBe(42);
  });

  it('writes a failed image row with metadata only', async () => {
    const { mod, messages, topicId } = await setup();
    const out = await messages.recordAttempt({
      topicId,
      kind: 'image',
      format: null,
      textBody: null,
      mimeType: 'image/png',
      contentLength: 12345,
      filename: 'pic.png',
      caption: 'caption',
      status: 'failed',
      telegramMessageId: null,
      error: 'telegram_blocked',
    });
    const db = mod.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', out.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      kind: 'image',
      mime_type: 'image/png',
      filename: 'pic.png',
      caption: 'caption',
      status: 'failed',
      error: 'telegram_blocked',
      text_body: null,
    });
    expect(Number(row.content_length)).toBe(12345);
  });
});
