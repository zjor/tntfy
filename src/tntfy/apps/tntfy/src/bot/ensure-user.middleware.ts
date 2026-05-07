import { Injectable } from '@nestjs/common';
import type { MiddlewareFn, NextFunction } from 'grammy';
import { UsersService } from '../users/users.service';
import type { AppContext } from './context';

@Injectable()
export class EnsureUserMiddleware {
  constructor(private readonly users: UsersService) {}

  middleware(): MiddlewareFn<AppContext> {
    return async (ctx, next: NextFunction) => {
      if (ctx.from?.id == null) {
        await next();
        return;
      }
      const u = await this.users.createOrGet({
        id: ctx.from.id,
        username: ctx.from.username ?? null,
        first_name: ctx.from.first_name ?? null,
        last_name: ctx.from.last_name ?? null,
      });
      ctx.user = { id: u.id, ext_id: Number(u.ext_id) };
      await next();
    };
  }
}
