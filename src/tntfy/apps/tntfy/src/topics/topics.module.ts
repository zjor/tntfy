import { Module } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { TokensService } from './tokens.service';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [TopicsService, TokensService],
  exports: [TopicsService, TokensService],
})
export class TopicsModule {}
