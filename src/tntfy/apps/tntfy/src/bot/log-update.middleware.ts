import { Injectable } from '@nestjs/common';
import type { MiddlewareFn, NextFunction } from 'grammy';
import { Logger } from 'nestjs-pino';
import type { AppContext } from './context';

const TEXT_MAX = 500;

function truncate(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) + '…' : s;
}

@Injectable()
export class LogUpdateMiddleware {
  constructor(private readonly logger: Logger) {}

  middleware(): MiddlewareFn<AppContext> {
    return async (ctx, next: NextFunction) => {
      const update = ctx.update;
      const from = ctx.from;
      const message = ctx.message;
      const callbackQuery = ctx.callbackQuery;
      const type = message ? 'message' : callbackQuery ? 'callback_query' : 'other';

      this.logger.log(
        {
          update_id: update.update_id,
          ext_id: from?.id,
          user_id: ctx.user?.id,
          username: from?.username,
          type,
          text: truncate(message?.text),
          callback_data: truncate(callbackQuery?.data),
        },
        'bot.update',
        'BotModule',
      );

      await next();
    };
  }
}
