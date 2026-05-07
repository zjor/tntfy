import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
