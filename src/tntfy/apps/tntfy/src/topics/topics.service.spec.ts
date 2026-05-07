import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { TopicsService } from './topics.service';
import { TokensService, TOKEN_REGEX } from './tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { DuplicateTopicError, InvalidTopicNameError } from './errors';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  return { mod, users, topics, userId: u.id };
}

describe('TopicsService.create', () => {
  it('creates topic + first token in a transaction', async () => {
    const { topics, userId } = await setup();
    const result = await topics.create(userId, 'deploys');
    expect(result.topic.name).toBe('deploys');
    expect(result.topic.user_id).toBe(userId);
    expect(result.token).toMatch(TOKEN_REGEX);
  });

  it('rejects invalid names with InvalidTopicNameError', async () => {
    const { topics, userId } = await setup();
    await expect(topics.create(userId, 'BAD')).rejects.toThrow(InvalidTopicNameError);
  });

  it('rejects duplicate names with DuplicateTopicError', async () => {
    const { topics, userId } = await setup();
    await topics.create(userId, 'deploys');
    await expect(topics.create(userId, 'deploys')).rejects.toThrow(DuplicateTopicError);
  });

  it('allows the same name across different users', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const other = await users.createOrGet({ id: 2, username: null, first_name: null, last_name: null });
    await topics.create(userId, 'deploys');
    await expect(topics.create(other.id, 'deploys')).resolves.toBeDefined();
  });
});

describe('TopicsService.listByUser', () => {
  it('returns the user\'s topics ordered newest-first', async () => {
    const { topics, userId } = await setup();
    await topics.create(userId, 'first');
    await new Promise((r) => setTimeout(r, 5));
    await topics.create(userId, 'second');
    const list = await topics.listByUser(userId);
    expect(list.map((t) => t.name)).toEqual(['second', 'first']);
  });

  it('returns empty array when user has none', async () => {
    const { topics, userId } = await setup();
    expect(await topics.listByUser(userId)).toEqual([]);
  });

  it('does not leak other users\' topics', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const other = await users.createOrGet({ id: 2, username: null, first_name: null, last_name: null });
    await topics.create(other.id, 'theirs');
    expect(await topics.listByUser(userId)).toEqual([]);
  });
});

describe('TopicsService.findByUserAndName', () => {
  it('returns the topic when present', async () => {
    const { topics, userId } = await setup();
    const created = await topics.create(userId, 'deploys');
    const found = await topics.findByUserAndName(userId, 'deploys');
    expect(found.id).toBe(created.topic.id);
  });

  it('throws TopicNotFoundError when missing', async () => {
    const { topics, userId } = await setup();
    await expect(topics.findByUserAndName(userId, 'missing')).rejects.toThrow('topic not found');
  });
});

describe('TopicsService.findByUserAndId', () => {
  it('returns the topic when present and owned by user', async () => {
    const { topics, userId } = await setup();
    const created = await topics.create(userId, 'deploys');
    const found = await topics.findByUserAndId(userId, created.topic.id);
    expect(found.name).toBe('deploys');
  });

  it('throws TopicNotFoundError when topic belongs to a different user', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const created = await topics.create(userId, 'deploys');
    await expect(topics.findByUserAndId(intruder.id, created.topic.id)).rejects.toThrow('topic not found');
  });
});

describe('TopicsService.lookupByToken', () => {
  it('returns topic + user context when token exists', async () => {
    const { mod, topics, userId } = await setup();
    const { topic, token } = await topics.create(userId, 'deploys');
    const found = await topics.lookupByToken(token);
    expect(found).not.toBeNull();
    expect(found!.topic_id).toBe(topic.id);
    expect(found!.topic_name).toBe('deploys');
    expect(found!.user_id).toBe(userId);
    expect(typeof found!.chat_id).toBe('number');
    const users = mod.get(UsersService);
    const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
    expect(found!.chat_id).toBe(Number(u.ext_id));
  });

  it('returns null when token is unknown', async () => {
    const { topics } = await setup();
    const found = await topics.lookupByToken('tk_unknownnnnnnnnnnnnnnnn');
    expect(found).toBeNull();
  });
});

describe('TopicsService.removeById', () => {
  it('hard-deletes topic and cascades tokens + messages', async () => {
    const { topics, userId, mod } = await setup();
    const { topic } = await topics.create(userId, 'deploys');
    const db = mod.get<any>(KYSELY);

    await db
      .insertInto('topic_messages')
      .values([
        { id: 'm1xxxxxxxxxxxxxxxxxxxx', topic_id: topic.id, kind: 'text', status: 'delivered' },
        { id: 'm2xxxxxxxxxxxxxxxxxxxx', topic_id: topic.id, kind: 'text', status: 'failed' },
      ])
      .execute();

    const result = await topics.removeById(userId, topic.id);
    expect(result.cascaded_messages_count).toBe(2);
    expect(result.name).toBe('deploys');

    const t = await db.selectFrom('topics').selectAll().where('id', '=', topic.id).execute();
    const tk = await db.selectFrom('topic_tokens').selectAll().where('topic_id', '=', topic.id).execute();
    const m = await db.selectFrom('topic_messages').selectAll().where('topic_id', '=', topic.id).execute();
    expect(t).toEqual([]);
    expect(tk).toEqual([]);
    expect(m).toEqual([]);
  });

  it('throws TopicNotFoundError when topic does not belong to user', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const { topic } = await topics.create(userId, 'deploys');
    await expect(topics.removeById(intruder.id, topic.id)).rejects.toThrow('topic not found');
  });
});
