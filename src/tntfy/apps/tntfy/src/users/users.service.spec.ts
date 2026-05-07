import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

async function makeModule() {
  return Test.createTestingModule({
    providers: [
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: { log: () => {}, fail: () => {} } },
    ],
  }).compile();
}

describe('UsersService.createOrGet', () => {
  it('inserts a new user and returns it', async () => {
    const svc = (await makeModule()).get(UsersService);
    const u = await svc.createOrGet({ id: 42, username: 'bob', first_name: 'Bob', last_name: null });
    expect(u.ext_id).toBe(42);
    expect(u.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(u.username).toBe('bob');
  });

  it('returns the same row on second call', async () => {
    const svc = (await makeModule()).get(UsersService);
    const a = await svc.createOrGet({ id: 42, username: 'bob', first_name: 'Bob', last_name: null });
    const b = await svc.createOrGet({ id: 42, username: 'bob-renamed', first_name: 'Bob', last_name: null });
    expect(b.id).toBe(a.id);
    expect(b.username).toBe('bob'); // createOrGet does NOT update profile
  });

  it('audits exactly once on insert', async () => {
    const calls: any[] = [];
    const audit = { log: (e: any) => calls.push(e), fail: () => {} };
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: KYSELY, useFactory: () => getTestDb() },
        { provide: AuditLogger, useValue: audit },
      ],
    }).compile();
    const svc = mod.get(UsersService);
    await svc.createOrGet({ id: 99, username: null, first_name: null, last_name: null });
    await svc.createOrGet({ id: 99, username: null, first_name: null, last_name: null });
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ op: 'user.create_or_get', ext_id: 99 });
  });
});

describe('UsersService.upsertProfile', () => {
  it('updates username/first_name/last_name on conflict', async () => {
    const svc = (await makeModule()).get(UsersService);
    await svc.createOrGet({ id: 7, username: 'old', first_name: 'O', last_name: null });
    const updated = await svc.upsertProfile({ id: 7, username: 'new', first_name: 'N', last_name: 'X' });
    expect(updated.username).toBe('new');
    expect(updated.first_name).toBe('N');
    expect(updated.last_name).toBe('X');
  });

  it('inserts when user does not exist yet', async () => {
    const svc = (await makeModule()).get(UsersService);
    const u = await svc.upsertProfile({ id: 8, username: 'fresh', first_name: 'F', last_name: null });
    expect(u.ext_id).toBe(8);
    expect(u.username).toBe('fresh');
  });
});
