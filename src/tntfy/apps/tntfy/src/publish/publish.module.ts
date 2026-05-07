import { Module } from '@nestjs/common';
import { PublishController } from './publish.controller';
import { TelegramSender } from './telegram-sender.service';
import { MessagesService } from './messages.service';
import { AuthGuard } from './auth.guard';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';

// BotModule is NOT imported here — it is imported by AppModule, which makes
// NestjsGrammyModule (and @InjectBot()) available globally at runtime.
// In tests, TelegramSender is overridden so the bot is never instantiated.
@Module({
  imports: [LoggerModule, TopicsModule],
  controllers: [PublishController],
  providers: [TelegramSender, MessagesService, AuthGuard],
})
export class PublishModule {}
