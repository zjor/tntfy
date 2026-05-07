import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';
import { BotModule } from './bot/bot.module';
import { PublishModule } from './publish/publish.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule,
    DatabaseModule,
    HealthModule,
    BotModule,
    PublishModule,
  ],
})
export class AppModule {}
