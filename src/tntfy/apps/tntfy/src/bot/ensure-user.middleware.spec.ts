import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { EnsureUserMiddleware } from './ensure-user.middleware';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

async function makeModule() {
  return Test.createTestingModule({
    providers: [
      EnsureUserMiddleware,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: { log: () => {}, fail: () => {} } },
    ],
  }).compile();
}

describe('EnsureUserMiddleware', () => {
  it('attaches ctx.user when ctx.from is present', async () => {
    const mw = (await makeModule()).get(EnsureUserMiddleware);
    const ctx: any = { from: { id: 42, username: 'a', first_name: 'A', last_name: null } };
    const next = vi.fn(async () => {});
    await mw.middleware()(ctx, next);
    expect(ctx.user.ext_id).toBe(42);
    expect(ctx.user.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips and still calls next when ctx.from is missing', async () => {
    const mw = (await makeModule()).get(EnsureUserMiddleware);
    const ctx: any = {};
    const next = vi.fn(async () => {});
    await mw.middleware()(ctx, next);
    expect(ctx.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
