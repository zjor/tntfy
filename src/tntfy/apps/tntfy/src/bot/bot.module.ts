import { Global, Module, OnModuleInit } from '@nestjs/common';
import { NestjsGrammyModule, InjectBot } from '@grammyjs/nestjs';
import { Logger } from 'nestjs-pino';
import { Bot } from 'grammy';
import { UsersModule } from '../users/users.module';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';
import { EnsureUserMiddleware } from './ensure-user.middleware';
import { LogUpdateMiddleware } from './log-update.middleware';
import { BotUpdate } from './bot.update';
import { Callbacks } from './callbacks';
import type { AppContext } from './context';

@Global()
@Module({
  imports: [
    LoggerModule,
    UsersModule,
    TopicsModule,
    NestjsGrammyModule.forRootAsync({
      useFactory: () => ({ token: process.env.TELEGRAM_BOT_TOKEN as string }),
    }),
  ],
  providers: [EnsureUserMiddleware, LogUpdateMiddleware, BotUpdate, Callbacks],
  exports: [NestjsGrammyModule],
})
export class BotModule implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Bot<AppContext>,
    private readonly ensureUser: EnsureUserMiddleware,
    private readonly logUpdate: LogUpdateMiddleware,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.bot.use(this.ensureUser.middleware());
    this.bot.use(this.logUpdate.middleware());
    this.bot.catch((err) => {
      this.logger.error(
        {
          err: err?.error,
          update_id: err?.ctx?.update?.update_id,
        },
        'unhandled-bot-error',
        BotModule.name,
      );
    });
  }
}
