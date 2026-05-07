import { Module, OnModuleInit } from '@nestjs/common';
import { NestjsGrammyModule, InjectBot } from '@grammyjs/nestjs';
import { Bot } from 'grammy';
import { UsersModule } from '../users/users.module';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';
import { EnsureUserMiddleware } from './ensure-user.middleware';
import type { AppContext } from './context';

@Module({
  imports: [
    LoggerModule,
    UsersModule,
    TopicsModule,
    NestjsGrammyModule.forRootAsync({
      useFactory: () => ({ token: process.env.TELEGRAM_BOT_TOKEN as string }),
    }),
  ],
  providers: [EnsureUserMiddleware],
})
export class BotModule implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Bot<AppContext>,
    private readonly ensureUser: EnsureUserMiddleware,
  ) {}

  onModuleInit() {
    this.bot.use(this.ensureUser.middleware());
  }
}
