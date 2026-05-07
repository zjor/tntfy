import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { TokensService, TOKEN_REGEX } from './tokens.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { UsersService } from '../users/users.service';
import { TopicsService } from './topics.service';
import { getTestDb } from '../../test/db';

describe('TokensService.generate', () => {
  it('produces tokens matching tk_<24 url-safe chars>', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    for (let i = 0; i < 50; i++) {
      const t = svc.generate();
      expect(t).toMatch(TOKEN_REGEX);
    }
  });

  it('does not collide across many calls', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(svc.generate());
    expect(set.size).toBe(1000);
  });
});

async function setupRotate() {
  const audit = { log: () => {}, fail: () => {} };
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
  const tokens = mod.get(TokensService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  const { topic, token } = await topics.create(u.id, 'deploys');
  return { tokens, topic, oldToken: token };
}

describe('TokensService.rotate', () => {
  it('replaces the existing token with a new one', async () => {
    const { tokens, topic, oldToken } = await setupRotate();
    const newToken = await tokens.rotate(topic.id);
    expect(newToken).not.toBe(oldToken);
    expect(newToken).toMatch(TOKEN_REGEX);

    const db = getTestDb();
    const rows = await db.selectFrom('topic_tokens').selectAll().where('topic_id', '=', topic.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(newToken);
  });
});
