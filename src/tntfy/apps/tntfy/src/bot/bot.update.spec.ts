import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { BotUpdate } from './bot.update';
import { UsersService } from '../users/users.service';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { makeStubCtx } from '../../test/stub-ctx';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      BotUpdate,
      UsersService,
      TopicsService,
      TokensService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const update = mod.get(BotUpdate);
  const users = mod.get(UsersService);
  const u = await users.createOrGet({ id: 100, username: 'alice', first_name: 'A', last_name: null });
  return { update, mod, userId: u.id };
}

describe('/start', () => {
  it('upserts profile and replies with welcome', async () => {
    const { update } = await setup();
    const ctx = makeStubCtx({
      from: { id: 100, username: 'new-handle', first_name: 'A', last_name: undefined },
      user: { id: 'irrelevant', ext_id: 100 },
    });
    await update.onStart(ctx as any);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/welcome/i);
  });
});

describe('/help', () => {
  it('lists every command', async () => {
    const { update } = await setup();
    const ctx = makeStubCtx({ user: { id: 'x', ext_id: 100 } });
    await update.onHelp(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    for (const cmd of ['/start', '/help', '/topic-create', '/topic-list', '/topic-new-token', '/topic-remove']) {
      expect(text).toContain(cmd);
    }
  });
});

describe('/topic-create', () => {
  it('creates the topic and replies with snippets', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      match: 'deploys',
    });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toContain('<b>Topic:</b> deploys');
    expect(text).toMatch(/<tg-spoiler>tk_[A-Za-z0-9_-]{24}<\/tg-spoiler>/);
    expect(text).toContain('https://tntfy.example.com/v1/publish/deploys');
    expect(options.parse_mode).toBe('HTML');
  });

  it('replies with format help on invalid name', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'BAD' });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/topic names must match/);
  });

  it('replies with duplicate hint on conflict', async () => {
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("you already have a topic 'deploys'");
  });
});
