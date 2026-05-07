# Phase 2 — Telegram bot (control plane) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Telegram bot control plane: `/start`, `/help`, `/topic-create`, `/topic-list`, `/topic-new-token`, `/topic-remove`, with audit logging and integration tests, exactly as specified in [`docs/project/specs/2026-05-07-phase-2-telegram-bot.md`](../specs/2026-05-07-phase-2-telegram-bot.md).

**Architecture:** Three new NestJS modules under `apps/tntfy/src/` — `UsersModule`, `TopicsModule`, `BotModule`. Bot uses grammY long-polling via `@grammyjs/nestjs`. A grammY middleware resolves the user once per update. Service-layer integration tests run against the real Postgres from `src/infra/docker-compose.yml`; handler tests stub the grammY `Context`.

**Tech Stack:** TypeScript, NestJS 11, Kysely (Postgres), grammY + `@grammyjs/nestjs`, vitest, nanoid, pino.

**Working directory for all relative paths in this plan:** `src/tntfy/apps/tntfy/` unless stated otherwise. Run pnpm commands from `src/tntfy/`.

**Branch:** Implement on a dedicated branch (e.g. `phase-2-bot`). Execution skill handles worktree/branch creation.

---

## Phase A — Test infrastructure

### Task 1: Wire vitest with single-fork pool

**Files:**
- Modify: `src/tntfy/apps/tntfy/package.json`
- Create: `src/tntfy/apps/tntfy/vitest.config.ts`
- Create: `src/tntfy/apps/tntfy/test/.gitkeep` (placeholder; real test files come later)

- [ ] **Step 1: Add vitest devDeps**

Run from `src/tntfy/`:
```bash
pnpm --filter @tntfy/app add -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Add test script to `apps/tntfy/package.json`**

In `scripts`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `apps/tntfy/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globals: false,
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run from `src/tntfy/`:
```bash
pnpm --filter @tntfy/app test
```
Expected: vitest reports "No test files found" or similar (exit 1 is OK at this stage).

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/package.json src/tntfy/apps/tntfy/pnpm-lock.yaml src/tntfy/pnpm-lock.yaml src/tntfy/apps/tntfy/vitest.config.ts
git commit -m "test(infra): add vitest with single-fork pool"
```

---

### Task 2: Test DB helper — migrate once, truncate per test

**Files:**
- Create: `src/tntfy/apps/tntfy/test/setup.ts`
- Create: `src/tntfy/apps/tntfy/test/db.ts`
- Create: `src/tntfy/apps/tntfy/test/db.spec.ts` (smoke test)

- [ ] **Step 1: Write the smoke test first**

Create `apps/tntfy/test/db.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTestDb } from './db';

describe('test db', () => {
  it('connects and runs a trivial query', async () => {
    const db = getTestDb();
    const result = await db.selectNoFrom([db.fn.countAll<number>().as('n')]).execute();
    expect(Array.isArray(result)).toBe(true);
  });

  it('starts each test with empty tables', async () => {
    const db = getTestDb();
    const users = await db.selectFrom('users').selectAll().execute();
    const topics = await db.selectFrom('topics').selectAll().execute();
    expect(users).toEqual([]);
    expect(topics).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm --filter @tntfy/app test
```
Expected: FAIL — `./db` does not exist.

- [ ] **Step 3: Create `test/db.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../src/database/schema';

let cached: Kysely<Database> | undefined;

export function getTestDb(): Kysely<Database> {
  if (cached) return cached;
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set for tests');
  }
  cached = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }),
  });
  return cached;
}

export async function closeTestDb(): Promise<void> {
  if (cached) {
    await cached.destroy();
    cached = undefined;
  }
}
```

- [ ] **Step 4: Create `test/setup.ts` (migrate once, truncate per test)**

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { FileMigrationProvider, Migrator, sql } from 'kysely';
import { getTestDb, closeTestDb } from './db';

beforeAll(async () => {
  const db = getTestDb();
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(__dirname, '..', 'migrations'),
    }),
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') {
      throw new Error(`migration failed: ${r.migrationName}`);
    }
  }
  if (error) throw error;
});

beforeEach(async () => {
  const db = getTestDb();
  await sql`TRUNCATE users, topics, topic_tokens, topic_messages RESTART IDENTITY CASCADE`.execute(db);
});

afterAll(async () => {
  await closeTestDb();
});
```

- [ ] **Step 5: Start the local Postgres if not already running**

From `src/infra/`:
```bash
docker compose up -d
```

- [ ] **Step 6: Run the test, expect pass**

From `src/tntfy/`:
```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: PASS for both cases in `db.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/tntfy/apps/tntfy/test/
git commit -m "test(infra): add test db helper, migrate-once + truncate-per-test"
```

---

### Task 3: Test stub helper for grammY Context

**Files:**
- Create: `src/tntfy/apps/tntfy/test/stub-ctx.ts`

This helper has no behavior of its own, so no test. It's used by handler tests in Phase C.

- [ ] **Step 1: Create the stub helper**

```ts
import { vi, type Mock } from 'vitest';

export type StubCtx = {
  from: { id: number; username?: string; first_name?: string; last_name?: string };
  match?: string;
  user?: { id: string; ext_id: number };
  reply: Mock;
  answerCallbackQuery: Mock;
  editMessageText: Mock;
  callbackQuery?: { id: string; data: string; from: { id: number } };
};

export function makeStubCtx(overrides: Partial<StubCtx> = {}): StubCtx {
  return {
    from: { id: 100, username: 'alice', first_name: 'Alice', last_name: undefined },
    match: '',
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
    editMessageText: vi.fn(),
    ...overrides,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tntfy/apps/tntfy/test/stub-ctx.ts
git commit -m "test(infra): add grammY Context stub helper"
```

---

## Phase B — Domain services

### Task 4: UsersService.createOrGet

**Files:**
- Create: `src/tntfy/apps/tntfy/src/users/users.service.ts`
- Create: `src/tntfy/apps/tntfy/src/users/users.module.ts`
- Create: `src/tntfy/apps/tntfy/src/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`users.service.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run, expect failure**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: FAIL — `UsersService` not found.

- [ ] **Step 3: Implement `users.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';

export interface TelegramUserInput {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly audit: AuditLogger,
  ) {}

  async createOrGet(from: TelegramUserInput) {
    const id = nanoid();
    const inserted = await this.db
      .insertInto('users')
      .values({
        id,
        ext_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
      })
      .onConflict((oc) => oc.column('ext_id').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      this.audit.log({ op: 'user.create_or_get', user_id: inserted.id, ext_id: from.id });
      return inserted;
    }

    const existing = await this.db
      .selectFrom('users')
      .selectAll()
      .where('ext_id', '=', from.id)
      .executeTakeFirstOrThrow();
    return existing;
  }
}
```

- [ ] **Step 4: Implement `users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: PASS for all three cases.

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/users/
git commit -m "feat(users): add UsersService.createOrGet with audit"
```

---

### Task 5: UsersService.upsertProfile

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/users/users.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/users/users.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `users.service.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run, expect failure**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: FAIL — `upsertProfile` not defined.

- [ ] **Step 3: Add the method to `UsersService`**

```ts
async upsertProfile(from: TelegramUserInput) {
  const id = nanoid();
  return await this.db
    .insertInto('users')
    .values({
      id,
      ext_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
    })
    .onConflict((oc) =>
      oc.column('ext_id').doUpdateSet({
        username: (eb) => eb.ref('excluded.username'),
        first_name: (eb) => eb.ref('excluded.first_name'),
        last_name: (eb) => eb.ref('excluded.last_name'),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/users/
git commit -m "feat(users): add UsersService.upsertProfile for /start"
```

---

### Task 6: Topic-name validation

**Files:**
- Create: `src/tntfy/apps/tntfy/src/topics/topic-name.ts`
- Create: `src/tntfy/apps/tntfy/src/topics/topic-name.spec.ts`
- Create: `src/tntfy/apps/tntfy/src/topics/errors.ts`

- [ ] **Step 1: Write the failing test**

`topic-name.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TOPIC_NAME_REGEX, validateTopicName } from './topic-name';
import { InvalidTopicNameError } from './errors';

describe('topic-name', () => {
  it('regex matches the spec exactly', () => {
    expect(TOPIC_NAME_REGEX.source).toBe('^[a-z0-9][a-z0-9-_]{1,63}$');
  });

  it.each(['a1', 'deploys', 'app-1', 'foo_bar', '0lead'])('accepts %s', (n) => {
    expect(() => validateTopicName(n)).not.toThrow();
  });

  it.each([
    ['', 'too short'],
    ['a', 'too short'],
    ['-leading', 'leading hyphen'],
    ['UPPER', 'uppercase'],
    ['has space', 'space'],
    ['a'.repeat(65), 'too long'],
  ])('rejects %s (%s)', (n) => {
    expect(() => validateTopicName(n)).toThrow(InvalidTopicNameError);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @tntfy/app test
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `errors.ts`**

```ts
export class InvalidTopicNameError extends Error {
  constructor(public readonly name: string) {
    super(`invalid topic name: ${name}`);
  }
}

export class DuplicateTopicError extends Error {
  constructor(public readonly name: string) {
    super(`duplicate topic name: ${name}`);
  }
}

export class TopicNotFoundError extends Error {
  constructor(public readonly name: string) {
    super(`topic not found: ${name}`);
  }
}
```

- [ ] **Step 4: Implement `topic-name.ts`**

```ts
import { InvalidTopicNameError } from './errors';

export const TOPIC_NAME_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;

export function validateTopicName(name: string): void {
  if (!TOPIC_NAME_REGEX.test(name)) {
    throw new InvalidTopicNameError(name);
  }
}
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @tntfy/app test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): add topic-name validation and error classes"
```

---

### Task 7: TokensService.generate

**Files:**
- Create: `src/tntfy/apps/tntfy/src/topics/tokens.service.ts`
- Create: `src/tntfy/apps/tntfy/src/topics/tokens.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`tokens.service.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TokensService, TOKEN_REGEX } from './tokens.service';

describe('TokensService.generate', () => {
  it('produces tokens matching tk_<24 url-safe chars>', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    for (let i = 0; i < 50; i++) {
      const t = svc.generate();
      expect(t).toMatch(TOKEN_REGEX);
    }
  });

  it('does not collide across many calls', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(svc.generate());
    expect(set.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL — `TokensService` not found.

- [ ] **Step 3: Implement `tokens.service.ts` (just `generate` for now)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { customAlphabet } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';

export const TOKEN_REGEX = /^tk_[A-Za-z0-9_-]{24}$/;
const TOKEN_BODY = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  24,
);

@Injectable()
export class TokensService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly audit: AuditLogger,
  ) {}

  generate(): string {
    return `tk_${TOKEN_BODY()}`;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @tntfy/app test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/tokens.service.ts src/tntfy/apps/tntfy/src/topics/tokens.service.spec.ts
git commit -m "feat(topics): add TokensService.generate"
```

---

### Task 8: TopicsService.create + first token (in transaction)

**Files:**
- Create: `src/tntfy/apps/tntfy/src/topics/topics.service.ts`
- Create: `src/tntfy/apps/tntfy/src/topics/topics.module.ts`
- Create: `src/tntfy/apps/tntfy/src/topics/topics.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

`topics.service.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { TopicsService } from './topics.service';
import { TokensService, TOKEN_REGEX } from './tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { DuplicateTopicError, InvalidTopicNameError } from './errors';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  return { mod, users, topics, userId: u.id };
}

describe('TopicsService.create', () => {
  it('creates topic + first token in a transaction', async () => {
    const { topics, userId } = await setup();
    const result = await topics.create(userId, 'deploys');
    expect(result.topic.name).toBe('deploys');
    expect(result.topic.user_id).toBe(userId);
    expect(result.token).toMatch(TOKEN_REGEX);
  });

  it('rejects invalid names with InvalidTopicNameError', async () => {
    const { topics, userId } = await setup();
    await expect(topics.create(userId, 'BAD')).rejects.toThrow(InvalidTopicNameError);
  });

  it('rejects duplicate names with DuplicateTopicError', async () => {
    const { topics, userId } = await setup();
    await topics.create(userId, 'deploys');
    await expect(topics.create(userId, 'deploys')).rejects.toThrow(DuplicateTopicError);
  });

  it('allows the same name across different users', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const other = await users.createOrGet({ id: 2, username: null, first_name: null, last_name: null });
    await topics.create(userId, 'deploys');
    await expect(topics.create(other.id, 'deploys')).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL — `TopicsService` not found.

- [ ] **Step 3: Implement `topics.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';
import { TokensService } from './tokens.service';
import { validateTopicName } from './topic-name';
import { DuplicateTopicError } from './errors';

@Injectable()
export class TopicsService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly tokens: TokensService,
    private readonly audit: AuditLogger,
  ) {}

  async create(userId: string, name: string) {
    validateTopicName(name);
    const topicId = nanoid();
    const tokenId = nanoid();
    const tokenValue = this.tokens.generate();

    try {
      const { topic } = await this.db.transaction().execute(async (trx) => {
        const topic = await trx
          .insertInto('topics')
          .values({ id: topicId, user_id: userId, name })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('topic_tokens')
          .values({ id: tokenId, topic_id: topic.id, token: tokenValue })
          .execute();
        return { topic };
      });

      this.audit.log({ op: 'topic.create', user_id: userId, topic_id: topic.id, name });
      return { topic, token: tokenValue };
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new DuplicateTopicError(name);
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Implement `topics.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { TokensService } from './tokens.service';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [TopicsService, TokensService],
  exports: [TopicsService, TokensService],
})
export class TopicsModule {}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): TopicsService.create with transactional token insert"
```

---

### Task 9: TopicsService.listByUser

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `topics.service.spec.ts`:
```ts
describe('TopicsService.listByUser', () => {
  it('returns the user\'s topics ordered newest-first', async () => {
    const { topics, userId } = await setup();
    await topics.create(userId, 'first');
    await new Promise((r) => setTimeout(r, 5));
    await topics.create(userId, 'second');
    const list = await topics.listByUser(userId);
    expect(list.map((t) => t.name)).toEqual(['second', 'first']);
  });

  it('returns empty array when user has none', async () => {
    const { topics, userId } = await setup();
    expect(await topics.listByUser(userId)).toEqual([]);
  });

  it('does not leak other users\' topics', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const other = await users.createOrGet({ id: 2, username: null, first_name: null, last_name: null });
    await topics.create(other.id, 'theirs');
    expect(await topics.listByUser(userId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL — `listByUser` not defined.

- [ ] **Step 3: Add the method**

```ts
async listByUser(userId: string) {
  return await this.db
    .selectFrom('topics')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute();
}
```

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): TopicsService.listByUser"
```

---

### Task 10: TopicsService.findByUserAndName + findByUserAndId

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.spec.ts`

- [ ] **Step 1: Add the failing tests**

```ts
describe('TopicsService.findByUserAndName', () => {
  it('returns the topic when present', async () => {
    const { topics, userId } = await setup();
    const created = await topics.create(userId, 'deploys');
    const found = await topics.findByUserAndName(userId, 'deploys');
    expect(found.id).toBe(created.topic.id);
  });

  it('throws TopicNotFoundError when missing', async () => {
    const { topics, userId } = await setup();
    await expect(topics.findByUserAndName(userId, 'missing')).rejects.toThrow('topic not found');
  });
});

describe('TopicsService.findByUserAndId', () => {
  it('returns the topic when present and owned by user', async () => {
    const { topics, userId } = await setup();
    const created = await topics.create(userId, 'deploys');
    const found = await topics.findByUserAndId(userId, created.topic.id);
    expect(found.name).toBe('deploys');
  });

  it('throws TopicNotFoundError when topic belongs to a different user', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const created = await topics.create(userId, 'deploys');
    await expect(topics.findByUserAndId(intruder.id, created.topic.id)).rejects.toThrow('topic not found');
  });
});
```

Make sure the file imports `TopicNotFoundError` from `./errors`.

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add both methods (and import `TopicNotFoundError` in service file)**

```ts
async findByUserAndName(userId: string, name: string) {
  const row = await this.db
    .selectFrom('topics')
    .selectAll()
    .where('user_id', '=', userId)
    .where('name', '=', name)
    .executeTakeFirst();
  if (!row) throw new TopicNotFoundError(name);
  return row;
}

async findByUserAndId(userId: string, topicId: string) {
  const row = await this.db
    .selectFrom('topics')
    .selectAll()
    .where('user_id', '=', userId)
    .where('id', '=', topicId)
    .executeTakeFirst();
  if (!row) throw new TopicNotFoundError(topicId);
  return row;
}
```

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): TopicsService.findByUserAndName and findByUserAndId"
```

---

### Task 11: TokensService.rotate

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/topics/tokens.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/topics/tokens.service.spec.ts` (extend with integration test)

- [ ] **Step 1: Add the failing test (integration, against the test DB)**

Append to `tokens.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { UsersService } from '../users/users.service';
import { TopicsService } from './topics.service';
import { getTestDb } from '../../test/db';

async function setupRotate() {
  const audit = { log: () => {}, fail: () => {} };
  const mod = await Test.createTestingModule({
    providers: [
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const tokens = mod.get(TokensService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  const { topic, token } = await topics.create(u.id, 'deploys');
  return { tokens, topic, oldToken: token };
}

describe('TokensService.rotate', () => {
  it('replaces the existing token with a new one', async () => {
    const { tokens, topic, oldToken } = await setupRotate();
    const newToken = await tokens.rotate(topic.id);
    expect(newToken).not.toBe(oldToken);
    expect(newToken).toMatch(TOKEN_REGEX);

    const db = getTestDb();
    const rows = await db.selectFrom('topic_tokens').selectAll().where('topic_id', '=', topic.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(newToken);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL — `rotate` not defined.

- [ ] **Step 3: Add `rotate` to `TokensService`**

```ts
async rotate(topicId: string): Promise<string> {
  const newToken = this.generate();
  const newId = (await import('nanoid')).nanoid();
  await this.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('topic_tokens').where('topic_id', '=', topicId).execute();
    await trx
      .insertInto('topic_tokens')
      .values({ id: newId, topic_id: topicId, token: newToken })
      .execute();
  });

  // Look up user_id for audit
  const owner = await this.db
    .selectFrom('topics')
    .select('user_id')
    .where('id', '=', topicId)
    .executeTakeFirstOrThrow();
  this.audit.log({ op: 'token.rotate', user_id: owner.user_id, topic_id: topicId });
  return newToken;
}
```

Note: the dynamic `import('nanoid')` is awkward. Replace with a top-of-file static import: `import { nanoid } from 'nanoid';` and use `nanoid()` directly.

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): TokensService.rotate (delete + insert in txn)"
```

---

### Task 12: TopicsService.removeById (returns cascaded message count)

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.spec.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('TopicsService.removeById', () => {
  it('hard-deletes topic and cascades tokens + messages', async () => {
    const { topics, userId, mod } = await setup();
    const { topic } = await topics.create(userId, 'deploys');
    const db = mod.get<any>(KYSELY);

    await db
      .insertInto('topic_messages')
      .values([
        { id: 'm1xxxxxxxxxxxxxxxxxxxx', topic_id: topic.id, kind: 'text', status: 'delivered' },
        { id: 'm2xxxxxxxxxxxxxxxxxxxx', topic_id: topic.id, kind: 'text', status: 'failed' },
      ])
      .execute();

    const result = await topics.removeById(userId, topic.id);
    expect(result.cascaded_messages_count).toBe(2);

    const t = await db.selectFrom('topics').selectAll().where('id', '=', topic.id).execute();
    const tk = await db.selectFrom('topic_tokens').selectAll().where('topic_id', '=', topic.id).execute();
    const m = await db.selectFrom('topic_messages').selectAll().where('topic_id', '=', topic.id).execute();
    expect(t).toEqual([]);
    expect(tk).toEqual([]);
    expect(m).toEqual([]);
  });

  it('throws TopicNotFoundError when topic does not belong to user', async () => {
    const { mod, topics, userId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const { topic } = await topics.create(userId, 'deploys');
    await expect(topics.removeById(intruder.id, topic.id)).rejects.toThrow('topic not found');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add the method**

```ts
async removeById(userId: string, topicId: string) {
  const topic = await this.findByUserAndId(userId, topicId);
  const cascaded = await this.db.transaction().execute(async (trx) => {
    const counted = await trx
      .selectFrom('topic_messages')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('topic_id', '=', topic.id)
      .executeTakeFirstOrThrow();
    await trx.deleteFrom('topics').where('id', '=', topic.id).execute();
    return Number(counted.n);
  });
  this.audit.log({
    op: 'topic.delete',
    user_id: userId,
    topic_id: topic.id,
    name: topic.name,
    cascaded_messages_count: cascaded,
  });
  return { cascaded_messages_count: cascaded, name: topic.name };
}
```

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "feat(topics): TopicsService.removeById with cascade message count"
```

---

## Phase C — Bot layer

### Task 13: Add grammY deps and BotModule scaffold

**Files:**
- Modify: `src/tntfy/apps/tntfy/package.json`
- Create: `src/tntfy/apps/tntfy/src/bot/bot.module.ts`
- Modify: `src/tntfy/apps/tntfy/src/app.module.ts`
- Modify: `src/tntfy/apps/tntfy/src/main.ts`

No tests for the scaffold itself; tests come with the middleware and handlers.

- [ ] **Step 1: Add dependencies**

From `src/tntfy/`:
```bash
pnpm --filter @tntfy/app add grammy @grammyjs/nestjs
```

- [ ] **Step 2: Add fail-fast env validation in `main.ts`**

Modify `apps/tntfy/src/main.ts` to fail early if Phase 2 envs are missing. Replace the existing `bootstrap` function:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

const REQUIRED_ENV = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'PUBLIC_BASE_URL'] as const;

function assertEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
```

- [ ] **Step 3: Create `bot.module.ts` (scaffold only — no commands yet)**

```ts
import { Module } from '@nestjs/common';
import { NestjsGrammyModule } from '@grammyjs/nestjs';
import { UsersModule } from '../users/users.module';
import { TopicsModule } from '../topics/topics.module';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [
    LoggerModule,
    UsersModule,
    TopicsModule,
    NestjsGrammyModule.forRootAsync({
      useFactory: () => ({ token: process.env.TELEGRAM_BOT_TOKEN as string }),
    }),
  ],
  providers: [],
})
export class BotModule {}
```

> **Note:** the actual export name from `@grammyjs/nestjs` may be `GrammyModule` or `NestjsGrammyModule` depending on the version installed. Check `node_modules/@grammyjs/nestjs/package.json` and the package's README; adjust the import to match. The rest of this plan refers to it as `NestjsGrammyModule` for consistency.

- [ ] **Step 4: Wire `BotModule` into `AppModule`**

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [LoggerModule, DatabaseModule, HealthModule, BotModule],
})
export class AppModule {}
```

- [ ] **Step 5: Verify the app boots**

From `src/tntfy/`:
```bash
DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy \
TELEGRAM_BOT_TOKEN=000:fake \
PUBLIC_BASE_URL=http://localhost:3000 \
pnpm --filter @tntfy/app build
```
Expected: build succeeds. (We will not actually start the bot with a fake token — just verify TypeScript compiles.)

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/package.json src/tntfy/apps/tntfy/src/bot/ src/tntfy/apps/tntfy/src/app.module.ts src/tntfy/apps/tntfy/src/main.ts src/tntfy/pnpm-lock.yaml src/tntfy/apps/tntfy/pnpm-lock.yaml
git commit -m "feat(bot): scaffold BotModule with grammY long-polling"
```

---

### Task 14: EnsureUserMiddleware

**Files:**
- Create: `src/tntfy/apps/tntfy/src/bot/ensure-user.middleware.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/ensure-user.middleware.spec.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/context.ts` (typed context flavor)
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.module.ts`

- [ ] **Step 1: Write the failing test**

`ensure-user.middleware.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL — middleware not defined.

- [ ] **Step 3: Implement `context.ts`**

```ts
import type { Context } from 'grammy';

export interface UserCtx {
  user?: { id: string; ext_id: number };
}

export type AppContext = Context & UserCtx;
```

- [ ] **Step 4: Implement `ensure-user.middleware.ts`**

```ts
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
```

- [ ] **Step 5: Register the middleware in `BotModule`**

Add `EnsureUserMiddleware` as a provider, then in `BotModule` use the grammY bot's `bot.use(...)` hook. The exact registration depends on `@grammyjs/nestjs`. Most likely pattern:

```ts
import { Module, OnModuleInit, Inject } from '@nestjs/common';
// ... other imports
import { EnsureUserMiddleware } from './ensure-user.middleware';
import { Bot } from 'grammy';
import { InjectBot } from '@grammyjs/nestjs';
import type { AppContext } from './context';

@Module({
  // ...as before, but add EnsureUserMiddleware to providers
  providers: [EnsureUserMiddleware],
})
export class BotModule implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Bot<AppContext>,
    private readonly ensureUser: EnsureUserMiddleware,
  ) {}

  onModuleInit() {
    this.bot.use(this.ensureUser.middleware());
  }
}
```

> If `@InjectBot` is not exported from the installed version, fall back to obtaining the bot via the package's documented provider token (check the package's README). Adjust accordingly.

- [ ] **Step 6: Run tests, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/
git commit -m "feat(bot): EnsureUserMiddleware attaches ctx.user on every update"
```

---

### Task 15: bot/errors.ts — formatError

**Files:**
- Create: `src/tntfy/apps/tntfy/src/bot/errors.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/errors.spec.ts`

- [ ] **Step 1: Write the failing test**

`errors.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatError } from './errors';
import {
  InvalidTopicNameError,
  DuplicateTopicError,
  TopicNotFoundError,
} from '../topics/errors';

describe('formatError', () => {
  it('formats InvalidTopicNameError', () => {
    expect(formatError(new InvalidTopicNameError('BAD'))).toMatch(/^topic names must match/);
  });
  it('formats DuplicateTopicError', () => {
    expect(formatError(new DuplicateTopicError('deploys'))).toBe(
      "you already have a topic 'deploys'",
    );
  });
  it('formats TopicNotFoundError', () => {
    expect(formatError(new TopicNotFoundError('deploys'))).toBe(
      "no topic 'deploys', see /topic-list",
    );
  });
  it('falls back for unknown errors', () => {
    expect(formatError(new Error('boom'))).toBe('something went wrong, try again later');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Implement `errors.ts`**

```ts
import {
  DuplicateTopicError,
  InvalidTopicNameError,
  TopicNotFoundError,
} from '../topics/errors';
import { TOPIC_NAME_REGEX } from '../topics/topic-name';

export function formatError(err: unknown): string {
  if (err instanceof InvalidTopicNameError) {
    return `topic names must match \`${TOPIC_NAME_REGEX.source}\` — e.g. \`deploys\`, \`app-1\``;
  }
  if (err instanceof DuplicateTopicError) {
    return `you already have a topic '${err.name}'`;
  }
  if (err instanceof TopicNotFoundError) {
    return `no topic '${err.name}', see /topic-list`;
  }
  return 'something went wrong, try again later';
}
```

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/errors.ts src/tntfy/apps/tntfy/src/bot/errors.spec.ts
git commit -m "feat(bot): user-facing error formatter"
```

---

### Task 16: snippets.ts (renderCurl, renderPython)

**Files:**
- Create: `src/tntfy/apps/tntfy/src/bot/snippets.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/snippets.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderTopicCreatedMessage, htmlEscape } from './snippets';

describe('snippets', () => {
  it('renders topic + spoiler-wrapped token + curl + python', () => {
    const out = renderTopicCreatedMessage({
      name: 'deploys',
      token: 'tk_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://tntfy.example.com',
    });
    expect(out).toContain('<b>Topic:</b> deploys');
    expect(out).toContain('<tg-spoiler>tk_aaaaaaaaaaaaaaaaaaaaaaaa</tg-spoiler>');
    expect(out).toContain('curl -H "Authorization: Bearer tk_aaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(out).toContain('https://tntfy.example.com/v1/publish/deploys');
    expect(out).toContain('import requests');
  });

  it('html-escapes inputs to prevent injection', () => {
    expect(htmlEscape('<script>')).toBe('&lt;script&gt;');
    expect(htmlEscape('a & b')).toBe('a &amp; b');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Implement `snippets.ts`**

```ts
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SnippetInput {
  name: string;
  token: string;
  baseUrl: string;
}

export function renderTopicCreatedMessage(input: SnippetInput): string {
  const { name, token, baseUrl } = input;
  const en = htmlEscape(name);
  const et = htmlEscape(token);
  const eu = htmlEscape(baseUrl);
  return [
    `<b>Topic:</b> ${en}`,
    '',
    `<b>Token:</b> <tg-spoiler>${et}</tg-spoiler>`,
    '',
    '<b>curl:</b>',
    `<pre>curl -H "Authorization: Bearer ${et}" \\\n     -d "Hello from tntfy" \\\n     ${eu}/v1/publish/${en}</pre>`,
    '',
    '<b>Python:</b>',
    [
      '<pre>import requests',
      'requests.post(',
      `    "${eu}/v1/publish/${en}",`,
      `    headers={"Authorization": "Bearer ${et}"},`,
      '    data="Hello from tntfy",',
      ')</pre>',
    ].join('\n'),
  ].join('\n');
}

export function renderTokenRotatedMessage(input: SnippetInput): string {
  const { name, token, baseUrl } = input;
  const en = htmlEscape(name);
  const et = htmlEscape(token);
  const eu = htmlEscape(baseUrl);
  return [
    `<b>New token for</b> ${en}: <tg-spoiler>${et}</tg-spoiler>`,
    '',
    `<pre>curl -H "Authorization: Bearer ${et}" \\\n     -d "Hello from tntfy" \\\n     ${eu}/v1/publish/${en}</pre>`,
  ].join('\n');
}
```

- [ ] **Step 4: Run, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/snippets.ts src/tntfy/apps/tntfy/src/bot/snippets.spec.ts
git commit -m "feat(bot): topic-created and token-rotated message snippets"
```

---

### Task 17: BotUpdate — `/start` and `/help`

**Files:**
- Create: `src/tntfy/apps/tntfy/src/bot/bot.update.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.module.ts` (register `BotUpdate` as provider)

- [ ] **Step 1: Write the failing tests for /start and /help**

`bot.update.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { BotUpdate } from './bot.update';
import { UsersService } from '../users/users.service';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { makeStubCtx } from '../../test/stub-ctx';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      BotUpdate,
      UsersService,
      TopicsService,
      TokensService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const update = mod.get(BotUpdate);
  const users = mod.get(UsersService);
  const u = await users.createOrGet({ id: 100, username: 'alice', first_name: 'A', last_name: null });
  return { update, mod, userId: u.id };
}

describe('/start', () => {
  it('upserts profile and replies with welcome', async () => {
    const { update } = await setup();
    const ctx = makeStubCtx({
      from: { id: 100, username: 'new-handle', first_name: 'A', last_name: null },
      user: { id: 'irrelevant', ext_id: 100 },
    });
    await update.onStart(ctx as any);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/welcome/i);
  });
});

describe('/help', () => {
  it('lists every command', async () => {
    const { update } = await setup();
    const ctx = makeStubCtx({ user: { id: 'x', ext_id: 100 } });
    await update.onHelp(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    for (const cmd of ['/start', '/help', '/topic-create', '/topic-list', '/topic-new-token', '/topic-remove']) {
      expect(text).toContain(cmd);
    }
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Implement `bot.update.ts` (start + help only)**

```ts
import { Injectable } from '@nestjs/common';
import { Update, Command, Ctx } from '@grammyjs/nestjs';
import { UsersService } from '../users/users.service';
import type { AppContext } from './context';

const HELP_TEXT = [
  'Welcome to tntfy — curl-to-Telegram notifications.',
  '',
  'Commands:',
  '  /start — register or refresh your account',
  '  /help — show this list',
  '  /topic-create <name> — create a topic and get a curl snippet',
  '  /topic-list — list your topics',
  '  /topic-new-token <name> — rotate a topic\'s token',
  '  /topic-remove <name> — delete a topic and its history',
  '',
  'Topic name rule: lowercase letters, digits, hyphen, underscore; 2–64 chars; must start with a letter or digit.',
].join('\n');

@Update()
@Injectable()
export class BotUpdate {
  constructor(private readonly users: UsersService) {}

  @Command('start')
  async onStart(@Ctx() ctx: AppContext) {
    if (ctx.from?.id != null) {
      await this.users.upsertProfile({
        id: ctx.from.id,
        username: ctx.from.username ?? null,
        first_name: ctx.from.first_name ?? null,
        last_name: ctx.from.last_name ?? null,
      });
    }
    await ctx.reply(HELP_TEXT);
  }

  @Command('help')
  async onHelp(@Ctx() ctx: AppContext) {
    await ctx.reply(HELP_TEXT);
  }
}
```

> `@Update`, `@Command`, `@Ctx` are from `@grammyjs/nestjs`. Verify the exact export names against the installed version's exports; if they differ, alias on import.

- [ ] **Step 4: Register `BotUpdate` in `BotModule`**

Add to `providers: [..., BotUpdate]`.

- [ ] **Step 5: Run tests, expect pass**

Expected: PASS for `/start` and `/help`.

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/bot.update.ts src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts src/tntfy/apps/tntfy/src/bot/bot.module.ts
git commit -m "feat(bot): /start and /help commands"
```

---

### Task 18: `/topic-create`

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('/topic-create', () => {
  it('creates the topic and replies with snippets', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      match: 'deploys',
    });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toContain('<b>Topic:</b> deploys');
    expect(text).toMatch(/<tg-spoiler>tk_[A-Za-z0-9_-]{24}<\/tg-spoiler>/);
    expect(text).toContain('https://tntfy.example.com/v1/publish/deploys');
    expect(options.parse_mode).toBe('HTML');
  });

  it('replies with format help on invalid name', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'BAD' });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/topic names must match/);
  });

  it('replies with duplicate hint on conflict', async () => {
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("you already have a topic 'deploys'");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add `onTopicCreate` to `BotUpdate`**

```ts
import { TopicsService } from '../topics/topics.service';
import { renderTopicCreatedMessage } from './snippets';
import { formatError } from './errors';

// inside BotUpdate, add to constructor params: private readonly topics: TopicsService

@Command('topic-create')
async onTopicCreate(@Ctx() ctx: AppContext) {
  if (!ctx.user) return;
  const name = (ctx.match ?? '').trim();
  try {
    const { token } = await this.topics.create(ctx.user.id, name);
    const text = renderTopicCreatedMessage({
      name,
      token,
      baseUrl: process.env.PUBLIC_BASE_URL!,
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply(formatError(err));
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/
git commit -m "feat(bot): /topic-create with snippets and error mapping"
```

---

### Task 19: `/topic-list`

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('/topic-list', () => {
  it('replies with empty-state hint when none', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 } });
    await update.onTopicList(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/no topics/i);
  });

  it('lists topics newest first', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'first' });
    await update.onTopicCreate(ctx as any);
    await new Promise((r) => setTimeout(r, 5));
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'second' });
    await update.onTopicCreate(ctx as any);
    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 } });
    await update.onTopicList(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'));
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add `onTopicList` to `BotUpdate`**

```ts
@Command('topic-list')
async onTopicList(@Ctx() ctx: AppContext) {
  if (!ctx.user) return;
  const list = await this.topics.listByUser(ctx.user.id);
  if (list.length === 0) {
    await ctx.reply('You have no topics yet. Create one with /topic-create <name>.');
    return;
  }
  const lines = list.map((t) => `• ${t.name} — created ${new Date(t.created_at as any).toISOString()}`);
  await ctx.reply(['Your topics:', ...lines].join('\n'));
}
```

- [ ] **Step 4: Run tests, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/
git commit -m "feat(bot): /topic-list"
```

---

### Task 20: `/topic-new-token`

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('/topic-new-token', () => {
  it('rotates the token and replies with the new one', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);
    const oldToken = (ctx.reply.mock.calls[0][0] as string).match(/tk_[A-Za-z0-9_-]{24}/)![0];

    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicNewToken(ctx as any);
    const text = ctx.reply.mock.calls[0][0] as string;
    const newToken = text.match(/tk_[A-Za-z0-9_-]{24}/)![0];
    expect(newToken).not.toBe(oldToken);
  });

  it('rejects unknown topic with helpful message', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'missing' });
    await update.onTopicNewToken(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("no topic 'missing', see /topic-list");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add `onTopicNewToken`**

```ts
import { renderTokenRotatedMessage } from './snippets';

@Command('topic-new-token')
async onTopicNewToken(@Ctx() ctx: AppContext) {
  if (!ctx.user) return;
  const name = (ctx.match ?? '').trim();
  try {
    const topic = await this.topics.findByUserAndName(ctx.user.id, name);
    const newToken = await this.tokens.rotate(topic.id);
    const text = renderTokenRotatedMessage({ name, token: newToken, baseUrl: process.env.PUBLIC_BASE_URL! });
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply(formatError(err));
  }
}
```

Add `private readonly tokens: TokensService` to the constructor and import `TokensService`.

- [ ] **Step 4: Run tests, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/
git commit -m "feat(bot): /topic-new-token"
```

---

### Task 21: `/topic-remove` — confirmation prompt

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.update.spec.ts`

This task only adds the *prompt*. Confirm/cancel handling lands in Task 22.

- [ ] **Step 1: Add the failing test**

```ts
describe('/topic-remove', () => {
  it('replies with a confirmation prompt and inline keyboard', async () => {
    process.env.PUBLIC_BASE_URL = 'https://tntfy.example.com';
    const { update, userId } = await setup();
    let ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicCreate(ctx as any);

    ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'deploys' });
    await update.onTopicRemove(ctx as any);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toMatch(/Delete topic 'deploys'/);
    expect(options.reply_markup.inline_keyboard).toHaveLength(1);
    const buttons = options.reply_markup.inline_keyboard[0];
    expect(buttons[0].text).toMatch(/yes/i);
    expect(buttons[1].text).toMatch(/cancel/i);
    expect(buttons[0].callback_data).toMatch(/^topic-remove:y:/);
    expect(buttons[1].callback_data).toMatch(/^topic-remove:n:/);
  });

  it('rejects unknown topic', async () => {
    const { update, userId } = await setup();
    const ctx = makeStubCtx({ user: { id: userId, ext_id: 100 }, match: 'missing' });
    await update.onTopicRemove(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toBe("no topic 'missing', see /topic-list");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Add `onTopicRemove`**

```ts
import { InlineKeyboard } from 'grammy';

@Command('topic-remove')
async onTopicRemove(@Ctx() ctx: AppContext) {
  if (!ctx.user) return;
  const name = (ctx.match ?? '').trim();
  try {
    const topic = await this.topics.findByUserAndName(ctx.user.id, name);
    const kb = new InlineKeyboard()
      .text('Yes, delete', `topic-remove:y:${topic.id}`)
      .text('Cancel', `topic-remove:n:${topic.id}`);
    await ctx.reply(
      `Delete topic '${name}'? This removes its token and all message history.`,
      { reply_markup: kb },
    );
  } catch (err) {
    await ctx.reply(formatError(err));
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/
git commit -m "feat(bot): /topic-remove confirmation prompt"
```

---

### Task 22: callbacks.ts — confirm/cancel handlers

**Files:**
- Create: `src/tntfy/apps/tntfy/src/bot/callbacks.ts`
- Create: `src/tntfy/apps/tntfy/src/bot/callbacks.spec.ts`
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.module.ts` (register `Callbacks` provider)

- [ ] **Step 1: Write the failing test**

`callbacks.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Callbacks } from './callbacks';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';
import { makeStubCtx } from '../../test/stub-ctx';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      Callbacks,
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const cb = mod.get(Callbacks);
  const users = mod.get(UsersService);
  const topics = mod.get(TopicsService);
  const u = await users.createOrGet({ id: 100, username: null, first_name: null, last_name: null });
  const { topic } = await topics.create(u.id, 'deploys');
  return { cb, mod, userId: u.id, topicId: topic.id };
}

describe('topic-remove callback', () => {
  it('on yes: deletes topic and edits message to "removed"', async () => {
    const { cb, userId, topicId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      callbackQuery: { id: 'cq1', data: `topic-remove:y:${topicId}`, from: { id: 100 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/removed/i);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('on no: edits to "cancelled" and does not delete', async () => {
    const { cb, mod, userId, topicId } = await setup();
    const ctx = makeStubCtx({
      user: { id: userId, ext_id: 100 },
      callbackQuery: { id: 'cq2', data: `topic-remove:n:${topicId}`, from: { id: 100 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/cancel/i);
    const db = mod.get<any>(KYSELY);
    const t = await db.selectFrom('topics').selectAll().where('id', '=', topicId).execute();
    expect(t).toHaveLength(1);
  });

  it('rejects callback for a topic that no longer belongs to the user', async () => {
    const { cb, mod, topicId } = await setup();
    const users = mod.get(UsersService);
    const intruder = await users.createOrGet({ id: 999, username: null, first_name: null, last_name: null });
    const ctx = makeStubCtx({
      user: { id: intruder.id, ext_id: 999 },
      callbackQuery: { id: 'cq3', data: `topic-remove:y:${topicId}`, from: { id: 999 } },
    });
    await cb.onTopicRemoveCallback(ctx as any);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/no longer/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL.

- [ ] **Step 3: Implement `callbacks.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Update, On, Ctx } from '@grammyjs/nestjs';
import { TopicsService } from '../topics/topics.service';
import { TopicNotFoundError } from '../topics/errors';
import type { AppContext } from './context';

@Update()
@Injectable()
export class Callbacks {
  constructor(private readonly topics: TopicsService) {}

  @On('callback_query:data')
  async onTopicRemoveCallback(@Ctx() ctx: AppContext) {
    const data = ctx.callbackQuery?.data ?? '';
    if (!data.startsWith('topic-remove:')) return;
    const [, action, topicId] = data.split(':');
    if (!ctx.user || !topicId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === 'n') {
      await ctx.editMessageText('Cancelled.');
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === 'y') {
      try {
        const result = await this.topics.removeById(ctx.user.id, topicId);
        await ctx.editMessageText(`Removed topic '${result.name}'.`);
      } catch (err) {
        if (err instanceof TopicNotFoundError) {
          await ctx.editMessageText('That topic no longer exists or is not yours.');
        } else {
          await ctx.editMessageText('Something went wrong, try again later.');
        }
      } finally {
        await ctx.answerCallbackQuery();
      }
      return;
    }
    await ctx.answerCallbackQuery();
  }
}
```

`Callbacks` consumes `TopicsService.findByUserAndId` (added in Task 10) and `TopicsService.removeById` (added in Task 12).

- [ ] **Step 4: Register `Callbacks` in `BotModule`**

Add to `providers: [..., Callbacks]`.

- [ ] **Step 5: Run tests, expect pass**

Expected: PASS for all three callback cases.

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/callbacks.ts src/tntfy/apps/tntfy/src/bot/callbacks.spec.ts src/tntfy/apps/tntfy/src/bot/bot.module.ts
git commit -m "feat(bot): /topic-remove confirm/cancel callbacks with owner check"
```

---

### Task 23: bot.catch safety net

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.module.ts`

- [ ] **Step 1: Add `bot.catch` in `BotModule.onModuleInit`**

After `this.bot.use(this.ensureUser.middleware());`, add:
```ts
this.bot.catch((err) => {
  // Pino logger is wired globally; using console.error here is acceptable
  // as a last-resort fallback. Replace with InjectPinoLogger if needed.
  console.error({ err: err?.error, ctx: err?.ctx?.update?.update_id }, 'unhandled-bot-error');
});
```

This is defensive — handlers already catch known errors and reply via `formatError`. The catch is for thrown errors from the middleware or any code path the per-command try/catch missed.

- [ ] **Step 2: Build to confirm no type errors**

```bash
pnpm --filter @tntfy/app build
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/bot.module.ts
git commit -m "feat(bot): bot.catch safety net for unhandled errors"
```

---

## Phase D — Wire-up & verify

### Task 24: docker-compose env example, roadmap checkboxes, manual smoke test

**Files:**
- Modify: `src/infra/docker-compose.yml` (if it has any app envs to update)
- Modify: `docs/process/roadmap.md` (tick Phase 2 boxes)
- Modify: `README.md` (add `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL` to dev-setup if a dev section already exists)

- [ ] **Step 1: Run the full test suite**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app test
```
Expected: every test passes.

- [ ] **Step 2: Run typecheck and build**

```bash
pnpm --filter @tntfy/app check-types
pnpm --filter @tntfy/app build
```
Expected: both PASS.

- [ ] **Step 3: Manual smoke test against a real bot**

1. Get a bot token from @BotFather.
2. Set commands via @BotFather (`/setcommands`):
   ```
   start - register or refresh your account
   help - list commands
   topic-create - create a topic and get a curl snippet
   topic-list - list your topics
   topic-new-token - rotate a topic's token
   topic-remove - delete a topic and its history
   ```
3. From `src/infra/`, ensure Postgres is up: `docker compose up -d`
4. From `src/tntfy/`, run migrations: `DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy pnpm --filter @tntfy/app migrate`
5. Run the app:
   ```bash
   DATABASE_URL=postgres://tntfy:tntfy@localhost:5433/tntfy \
   TELEGRAM_BOT_TOKEN=<token-from-botfather> \
   PUBLIC_BASE_URL=http://localhost:3000 \
   pnpm --filter @tntfy/app dev
   ```
6. In Telegram, run through the journey: `/start` → `/help` → `/topic-create deploys` → copy curl snippet to a terminal and post (will get a 404 — Phase 3 not built yet, that's expected) → `/topic-list` → `/topic-new-token deploys` → `/topic-remove deploys` → confirm via inline button → `/topic-list` (now empty).
7. Watch the app logs — every state-changing command should emit one structured `audit` log line per the PRD table.

- [ ] **Step 4: Tick the Phase 2 checkboxes in roadmap**

In `docs/process/roadmap.md`, change every `- [ ]` under "Phase 2 — Telegram bot (control plane)" to `- [x]`.

- [ ] **Step 5: Commit**

```bash
git add docs/process/roadmap.md
git commit -m "docs(roadmap): mark Phase 2 complete"
```

---

## Done criteria recap

- All 24 tasks completed.
- `pnpm --filter @tntfy/app test` passes.
- `pnpm --filter @tntfy/app build` passes.
- The full PRD §"User journey" is exercised manually in Telegram and works end-to-end (publish step from journey is Phase 3 — skip).
- Every state-changing command emits an audit log line per PRD §"Audit logging".
- `docs/process/roadmap.md` Phase 2 boxes ticked.
