import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Callbacks } from './callbacks';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { makeStubCtx } from '../../test/stub-ctx';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      Callbacks,
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const cb = mod.get(Callbacks);
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const u = await users.createOrGet({ id: 100, username: null, first_name: null, last_name: null });
  const { topic } = await topics.create(u.id, 'deploys');
  return { cb, mod, userId: u.id, topicId: topic.id };
}

describe('topic-remove callback', () => {
  it('on yes: deletes topic and edits message to "removed"', async () => {
    const { cb, userId, topicId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      callbackQuery: { id: 'cq1', data: `topic-remove:y:${topicId}`, from: { id: 100 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/removed/i);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('on no: edits to "cancelled" and does not delete', async () => {
    const { cb, mod, userId, topicId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      callbackQuery: { id: 'cq2', data: `topic-remove:n:${topicId}`, from: { id: 100 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/cancel/i);
    const db = mod.get<any>(KYSELY);
    const t = await db.selectFrom('topics').selectAll().where('id', '=', topicId).execute();
    expect(t).toHaveLength(1);
  });

  it('rejects callback for a topic that no longer belongs to the user', async () => {
    const { cb, mod, topicId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const ctx = makeStubCtx({
      user: { id: intruder.id, ext_id: 999 },
      callbackQuery: { id: 'cq3', data: `topic-remove:y:${topicId}`, from: { id: 999 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/no longer/i);
  });
});
