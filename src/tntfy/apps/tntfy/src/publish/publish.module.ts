import { Module } from '@nestjs/common';
import { PublishController } from './publish.controller';
import { TelegramSender } from './telegram-sender.service';
import { MessagesService } from './messages.service';
import { AuthGuard } from './auth.guard';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';

// @InjectBot() in TelegramSender resolves via BotModule, which is @Global().
@Module({
  imports: [LoggerModule, TopicsModule],
  controllers: [PublishController],
  providers: [TelegramSender, MessagesService, AuthGuard],
})
export class PublishModule {}
