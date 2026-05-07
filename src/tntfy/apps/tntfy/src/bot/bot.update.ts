import { Injectable } from '@nestjs/common';
import { Update, Command, Ctx } from '@grammyjs/nestjs';
import { UsersService } from '../users/users.service';
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
  constructor(private readonly users: UsersService) {}

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
}
