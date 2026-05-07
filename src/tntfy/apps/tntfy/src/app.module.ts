import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [LoggerModule, DatabaseModule, HealthModule, BotModule],
})
export class AppModule {}
