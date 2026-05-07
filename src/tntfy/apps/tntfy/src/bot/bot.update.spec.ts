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

describe('/topic-list', () => {
  it('replies with empty-state hint when none', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 } });
    await update.onTopicList(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/no topics/i);
  });

  it('lists topics newest first', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'first' });
    await update.onTopicCreate(ctx as any);
    await new Promise((r) => setTimeout(r, 5));
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'second' });
    await update.onTopicCreate(ctx as any);
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 } });
    await update.onTopicList(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'));
  });
});

describe('/topic-new-token', () => {
  it('rotates the token and replies with the new one', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    const oldToken = (ctx.reply.mock.calls[0][0] as string).match(/tk_[A-Za-z0-9_-]{24}/)![0];

    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicNewToken(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    const newToken = text.match(/tk_[A-Za-z0-9_-]{24}/)![0];
    expect(newToken).not.toBe(oldToken);
  });

  it('rejects unknown topic with helpful message', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'missing' });
    await update.onTopicNewToken(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("no topic 'missing', see /topic-list");
  });
});

describe('/topic-remove', () => {
  it('replies with a confirmation prompt and inline keyboard', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);

    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicRemove(ctx as any);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toMatch(/Delete topic 'deploys'/);
    expect(options.reply_markup.inline_keyboard).toHaveLength(1);
    const buttons = options.reply_markup.inline_keyboard[0];
    expect(buttons[0].text).toMatch(/yes/i);
    expect(buttons[1].text).toMatch(/cancel/i);
    expect(buttons[0].callback_data).toMatch(/^topic-remove:y:/);
    expect(buttons[1].callback_data).toMatch(/^topic-remove:n:/);
  });

  it('rejects unknown topic', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'missing' });
    await update.onTopicRemove(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("no topic 'missing', see /topic-list");
  });
});
