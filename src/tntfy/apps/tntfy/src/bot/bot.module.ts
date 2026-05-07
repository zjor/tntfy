import { Module } from '@nestjs/common';
import { NestjsGrammyModule } from '@grammyjs/nestjs';
import { UsersModule } from '../users/users.module';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [
    LoggerModule,
    UsersModule,
    TopicsModule,
    NestjsGrammyModule.forRootAsync({
      useFactory: () => ({ token: process.env.TELEGRAM_BOT_TOKEN as string }),
    }),
  ],
  providers: [],
})
export class BotModule {}
