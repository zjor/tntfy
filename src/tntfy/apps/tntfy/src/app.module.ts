import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';

@Module({
  imports: [LoggerModule, DatabaseModule, HealthModule],
})
export class AppModule {}
