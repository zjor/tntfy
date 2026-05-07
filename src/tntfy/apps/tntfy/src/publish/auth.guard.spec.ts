import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { MissingTokenError, InvalidTokenError, PathTopicMismatchError } from './errors';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      AuthGuard,
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const guard = mod.get(AuthGuard);
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const u = await users.createOrGet({ id: 100, username: null, first_name: null, last_name: null });
  const { topic, token } = await topics.create(u.id, 'deploys');
  return { guard, topic, token };
}

function makeCtx(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

describe('AuthGuard', () => {
  it('throws MissingTokenError when Authorization header is absent', async () => {
    const { guard } = await setup();
    const ctx = makeCtx({ headers: {}, params: { topic: 'deploys' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(MissingTokenError);
  });

  it('throws MissingTokenError when scheme is not Bearer', async () => {
    const { guard } = await setup();
    const ctx = makeCtx({ headers: { authorization: 'Basic abc' }, params: { topic: 'deploys' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(MissingTokenError);
  });

  it('throws InvalidTokenError when token does not exist', async () => {
    const { guard } = await setup();
    const ctx = makeCtx({
      headers: { authorization: 'Bearer tk_unknownnnnnnnnnnnnnnnn' },
      params: { topic: 'deploys' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(InvalidTokenError);
  });

  it('throws PathTopicMismatchError when path topic differs from token topic', async () => {
    const { guard, token } = await setup();
    const ctx = makeCtx({
      headers: { authorization: `Bearer ${token}` },
      params: { topic: 'wrong-topic' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(PathTopicMismatchError);
  });

  it('attaches topicContext and returns true on happy path', async () => {
    const { guard, token, topic } = await setup();
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      params: { topic: 'deploys' },
    };
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.topicContext).toMatchObject({
      topic_id: topic.id,
      topic_name: 'deploys',
      chat_id: 100,
    });
  });
});
