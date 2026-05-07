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
