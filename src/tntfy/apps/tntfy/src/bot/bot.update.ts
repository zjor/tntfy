import { Injectable } from '@nestjs/common';
import { Update, Command, Ctx } from '@grammyjs/nestjs';
import { InlineKeyboard } from 'grammy';
import { UsersService } from '../users/users.service';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { renderTopicCreatedMessage, renderTokenRotatedMessage } from './snippets';
import { formatError } from './errors';
import type { AppContext } from './context';

const HELP_TEXT = [
  'Welcome to tntfy — curl-to-Telegram notifications.',
  '',
  'Commands:',
  '  /start — register or refresh your account',
  '  /help — show this list',
  '  /topic-create <name> — create a topic and get a curl snippet',
  '  /topic-list — list your topics',
  "  /topic-new-token <name> — rotate a topic's token",
  '  /topic-remove <name> — delete a topic and its history',
  '',
  'Topic name rule: lowercase letters, digits, hyphen, underscore; 2–64 chars; must start with a letter or digit.',
].join('\n');

@Update()
@Injectable()
export class BotUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly topics: TopicsService,
    private readonly tokens: TokensService,
  ) {}

  @Command('start')
  async onStart(@Ctx() ctx: AppContext) {
    if (ctx.from?.id != null) {
      await this.users.upsertProfile({
        id: ctx.from.id,
        username: ctx.from.username ?? null,
        first_name: ctx.from.first_name ?? null,
        last_name: ctx.from.last_name ?? null,
      });
    }
    await ctx.reply(HELP_TEXT);
  }

  @Command('help')
  async onHelp(@Ctx() ctx: AppContext) {
    await ctx.reply(HELP_TEXT);
  }

  @Command('topic-create')
  async onTopicCreate(@Ctx() ctx: AppContext) {
    if (!ctx.user) return;
    const name = (typeof ctx.match === 'string' ? ctx.match : '').trim();
    try {
      const { token } = await this.topics.create(ctx.user.id, name);
      const text = renderTopicCreatedMessage({
        name,
        token,
        baseUrl: process.env.PUBLIC_BASE_URL!,
      });
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(formatError(err));
    }
  }

  @Command('topic-list')
  async onTopicList(@Ctx() ctx: AppContext) {
    if (!ctx.user) return;
    const list = await this.topics.listByUser(ctx.user.id);
    if (list.length === 0) {
      await ctx.reply('You have no topics yet. Create one with /topic-create <name>.');
      return;
    }
    const lines = list.map((t) => `• ${t.name} — created ${new Date(t.created_at as any).toISOString()}`);
    await ctx.reply(['Your topics:', ...lines].join('\n'));
  }

  @Command('topic-new-token')
  async onTopicNewToken(@Ctx() ctx: AppContext) {
    if (!ctx.user) return;
    const name = (typeof ctx.match === 'string' ? ctx.match : '').trim();
    try {
      const topic = await this.topics.findByUserAndName(ctx.user.id, name);
      const newToken = await this.tokens.rotate(topic.id);
      const text = renderTokenRotatedMessage({ name, token: newToken, baseUrl: process.env.PUBLIC_BASE_URL! });
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(formatError(err));
    }
  }

  @Command('topic-remove')
  async onTopicRemove(@Ctx() ctx: AppContext) {
    if (!ctx.user) return;
    const name = (typeof ctx.match === 'string' ? ctx.match : '').trim();
    try {
      const topic = await this.topics.findByUserAndName(ctx.user.id, name);
      const kb = new InlineKeyboard()
        .text('Yes, delete', `topic-remove:y:${topic.id}`)
        .text('Cancel', `topic-remove:n:${topic.id}`);
      await ctx.reply(
        `Delete topic '${name}'? This removes its token and all message history.`,
        { reply_markup: kb },
      );
    } catch (err) {
      await ctx.reply(formatError(err));
    }
  }
}
