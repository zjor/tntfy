import type { Context } from 'grammy';

export interface UserCtx {
  user?: { id: string; ext_id: number };
}

export type AppContext = Context & UserCtx;
