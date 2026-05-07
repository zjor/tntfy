import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TopicsService } from '../topics/topics.service';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
} from './errors';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly topics: TopicsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) throw new MissingTokenError();
    const token = auth.slice('Bearer '.length).trim();
    if (!token) throw new MissingTokenError();

    const found = await this.topics.lookupByToken(token);
    if (!found) throw new InvalidTokenError();
    if (found.topic_name !== req.params.topic) throw new PathTopicMismatchError();

    req.topicContext = {
      topic_id: found.topic_id,
      topic_name: found.topic_name,
      user_id: found.user_id,
      chat_id: found.chat_id,
    };
    return true;
  }
}
