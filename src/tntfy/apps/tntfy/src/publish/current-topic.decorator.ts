import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TopicContext } from './topic-context';

export const CurrentTopic = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TopicContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.topicContext) {
      throw new Error('CurrentTopic used on a route with no AuthGuard');
    }
    return req.topicContext;
  },
);
