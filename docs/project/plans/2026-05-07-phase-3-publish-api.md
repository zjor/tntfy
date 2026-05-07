# Phase 3 — Publish API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /v1/publish/:topic` exactly as specified in [`docs/project/specs/2026-05-07-phase-3-publish-api.md`](../specs/2026-05-07-phase-3-publish-api.md). The endpoint accepts text/markdown/HTML/image/file payloads, dispatches to the right Telegram method, persists every attempt to `topic_messages`, and emits one `message.publish` audit log line per request.

**Architecture:** New `PublishModule` under `apps/tntfy/src/publish/`. `AuthGuard` resolves the per-request `TopicContext` from a single SQL JOIN. A pure content-type dispatcher classifies the body. `TelegramSender` reuses the existing grammY `Bot` instance via `@InjectBot()` (after `BotModule` re-exports `NestjsGrammyModule`). `MessagesService` writes `topic_messages` post-call. A NestJS exception filter emits the uniform `{ error, ... }` JSON shape across all error paths.

**Tech Stack:** TypeScript, NestJS 11, Express body-parser middleware, Kysely (Postgres), grammY 1.42 (`bot.api.sendMessage` / `sendPhoto` / `sendDocument`, `InputFile`), vitest, supertest.

**Working directory for all relative paths:** `src/tntfy/apps/tntfy/` unless noted. Run pnpm commands from `src/tntfy/`.

**Branch:** `phase-3-publish` (regular branch — no worktrees per CLAUDE.md). Create with `git checkout -b phase-3-publish` from current `master`.

**Postgres host port:** `6432` (per CLAUDE.md). Tests/dev use `postgres://tntfy:tntfy@localhost:6432/tntfy`.

---

## Phase A — Foundations (pure logic + DB lookup)

### Task 1: TopicsService.lookupByToken

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.ts`
- Modify: `src/tntfy/apps/tntfy/src/topics/topics.service.spec.ts`

This adds the JOIN query the auth guard will use.

- [ ] **Step 1: Append the failing tests** to `topics.service.spec.ts` (alongside existing describes):

```ts
describe('TopicsService.lookupByToken', () => {
  it('returns topic + user context when token exists', async () => {
    const { mod, topics, userId } = await setup();
    const { topic, token } = await topics.create(userId, 'deploys');
    const found = await topics.lookupByToken(token);
    expect(found).not.toBeNull();
    expect(found!.topic_id).toBe(topic.id);
    expect(found!.topic_name).toBe('deploys');
    expect(found!.user_id).toBe(userId);
    expect(typeof found!.chat_id).toBe('number');
    const users = mod.get(UsersService);
    const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
    expect(found!.chat_id).toBe(Number(u.ext_id));
  });

  it('returns null when token is unknown', async () => {
    const { topics } = await setup();
    const found = await topics.lookupByToken('tk_unknownnnnnnnnnnnnnnnn');
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```
Expected: FAIL on `lookupByToken` not defined.

- [ ] **Step 3: Add the method** to `TopicsService` in `topics.service.ts`:

```ts
async lookupByToken(token: string) {
  const row = await this.db
    .selectFrom('topic_tokens as tk')
    .innerJoin('topics as tp', 'tp.id', 'tk.topic_id')
    .innerJoin('users as u', 'u.id', 'tp.user_id')
    .select([
      'tk.id as token_id',
      'tp.id as topic_id',
      'tp.name as topic_name',
      'u.id as user_id',
      'u.ext_id as chat_id',
    ])
    .where('tk.token', '=', token)
    .executeTakeFirst();
  if (!row) return null;
  return {
    token_id: row.token_id,
    topic_id: row.topic_id,
    topic_name: row.topic_name,
    user_id: row.user_id,
    chat_id: Number(row.chat_id),
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```
Expected: prior tests + 2 new ones pass.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm --filter @tntfy/app check-types
```

- [ ] **Step 6: Commit**

```bash
git add src/tntfy/apps/tntfy/src/topics/
git commit -m "$(cat <<'EOF'
feat(topics): TopicsService.lookupByToken for publish auth

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Content-Type dispatcher (pure)

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/content-type.dispatcher.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/content-type.dispatcher.spec.ts`

- [ ] **Step 1: Write the failing test**

`content-type.dispatcher.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dispatch } from './content-type.dispatcher';

describe('dispatch', () => {
  it('classifies text/plain as text + sendMessage + parse_mode none', () => {
    const r = dispatch('text/plain', 'hello');
    expect(r).toEqual({ kind: 'text', method: 'sendMessage', parseMode: 'none', text: 'hello' });
  });

  it('classifies text/markdown as text + MarkdownV2', () => {
    const r = dispatch('text/markdown', 'hi *bold*');
    expect(r).toMatchObject({ kind: 'text', method: 'sendMessage', parseMode: 'MarkdownV2' });
  });

  it('classifies text/html as text + HTML', () => {
    const r = dispatch('text/html', '<b>x</b>');
    expect(r).toMatchObject({ kind: 'text', method: 'sendMessage', parseMode: 'HTML' });
  });

  it('classifies image/png as image + sendPhoto', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const r = dispatch('image/png', buf);
    expect(r).toMatchObject({ kind: 'image', method: 'sendPhoto', bytes: buf, mimeType: 'image/png' });
  });

  it('classifies image/jpeg, image/gif, image/webp', () => {
    for (const mime of ['image/jpeg', 'image/gif', 'image/webp']) {
      expect(dispatch(mime, Buffer.from([0]))).toMatchObject({ kind: 'image' });
    }
  });

  it('classifies application/octet-stream as file + sendDocument', () => {
    const buf = Buffer.from([1, 2, 3]);
    const r = dispatch('application/octet-stream', buf);
    expect(r).toMatchObject({ kind: 'file', method: 'sendDocument', bytes: buf, mimeType: 'application/octet-stream' });
  });

  it('classifies audio/* and video/* as file', () => {
    expect(dispatch('audio/mpeg', Buffer.from([0]))).toMatchObject({ kind: 'file' });
    expect(dispatch('video/mp4', Buffer.from([0]))).toMatchObject({ kind: 'file' });
  });

  it('throws UnsupportedContentTypeError for application/json', () => {
    expect(() => dispatch('application/json', Buffer.from('{}'))).toThrow(/unsupported_content_type/);
  });

  it('throws UnsupportedContentTypeError for empty/missing content-type', () => {
    expect(() => dispatch('', Buffer.from([0]))).toThrow();
  });

  it('honors parameters in content-type (charset, boundary)', () => {
    const r = dispatch('text/plain; charset=utf-8', 'hi');
    expect(r.kind).toBe('text');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Module not found.

- [ ] **Step 3: Implement `content-type.dispatcher.ts`**

```ts
export class UnsupportedContentTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`unsupported_content_type: ${contentType || '<missing>'}`);
  }
}

export type DispatchResult =
  | { kind: 'text'; method: 'sendMessage'; parseMode: 'none' | 'MarkdownV2' | 'HTML'; text: string }
  | { kind: 'image'; method: 'sendPhoto'; bytes: Buffer; mimeType: string }
  | { kind: 'file'; method: 'sendDocument'; bytes: Buffer; mimeType: string };

function baseType(contentType: string): string {
  return (contentType || '').split(';')[0]!.trim().toLowerCase();
}

export function dispatch(contentType: string, body: string | Buffer): DispatchResult {
  const ct = baseType(contentType);

  if (ct === 'text/plain') return { kind: 'text', method: 'sendMessage', parseMode: 'none', text: body as string };
  if (ct === 'text/markdown') return { kind: 'text', method: 'sendMessage', parseMode: 'MarkdownV2', text: body as string };
  if (ct === 'text/html') return { kind: 'text', method: 'sendMessage', parseMode: 'HTML', text: body as string };

  if (ct.startsWith('image/')) return { kind: 'image', method: 'sendPhoto', bytes: body as Buffer, mimeType: ct };
  if (ct === 'application/octet-stream' || ct.startsWith('audio/') || ct.startsWith('video/')) {
    return { kind: 'file', method: 'sendDocument', bytes: body as Buffer, mimeType: ct };
  }

  throw new UnsupportedContentTypeError(ct);
}
```

- [ ] **Step 4: Run, expect all tests pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/
git commit -m "$(cat <<'EOF'
feat(publish): content-type dispatcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Filename fallback helper

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/filename.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/filename.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveFilename, mimeToExt } from './filename';

describe('mimeToExt', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/anything', 'bin'],
    ['application/octet-stream', 'bin'],
    ['audio/mpeg', 'bin'],
    ['video/mp4', 'bin'],
    ['', 'bin'],
  ])('%s → %s', (mime, ext) => {
    expect(mimeToExt(mime)).toBe(ext);
  });
});

describe('resolveFilename', () => {
  it('returns the provided filename trimmed when set', () => {
    expect(resolveFilename({ filename: '  picture.png  ', mimeType: 'image/png' })).toBe('picture.png');
  });

  it('generates attachment-<8>.<ext> when filename missing', () => {
    const out = resolveFilename({ filename: undefined, mimeType: 'image/jpeg' });
    expect(out).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.jpg$/);
  });

  it('generates with bin extension for unknown mime', () => {
    const out = resolveFilename({ filename: undefined, mimeType: 'application/x-weird' });
    expect(out).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.bin$/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `filename.ts`**

```ts
import { customAlphabet } from 'nanoid';

const SHORT_ID = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  8,
);

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function mimeToExt(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

export function resolveFilename(input: { filename?: string; mimeType: string }): string {
  const trimmed = input.filename?.trim();
  if (trimmed) return trimmed;
  return `attachment-${SHORT_ID()}.${mimeToExt(input.mimeType)}`;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/filename.ts src/tntfy/apps/tntfy/src/publish/filename.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): filename fallback helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Publish error classes + grammY error mapper

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/errors.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { GrammyError } from 'grammy';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
  EmptyBodyError,
  PayloadTooLargeError,
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
  FormatError,
  mapGrammyError,
} from './errors';

function ge(code: number, description: string, parameters?: any) {
  // Construct a GrammyError-shaped object — the real class requires extra fields
  // but our mapper reads only error_code/description/parameters.
  const e: any = new Error(description);
  e.error_code = code;
  e.description = description;
  e.parameters = parameters;
  Object.setPrototypeOf(e, GrammyError.prototype);
  return e;
}

describe('publish error classes', () => {
  it('all extend Error and carry their tag', () => {
    expect(new MissingTokenError()).toBeInstanceOf(Error);
    expect(new InvalidTokenError()).toBeInstanceOf(Error);
    expect(new PathTopicMismatchError()).toBeInstanceOf(Error);
    expect(new EmptyBodyError()).toBeInstanceOf(Error);
    expect(new PayloadTooLargeError('over 4096 chars')).toBeInstanceOf(Error);
    expect(new TelegramBlockedError()).toBeInstanceOf(Error);
    expect(new TelegramThrottledError(30)).toMatchObject({ retryAfter: 30 });
    expect(new TelegramFailedError('boom')).toMatchObject({ reason: 'boom' });
    expect(new FormatError('parse error')).toBeInstanceOf(Error);
  });
});

describe('mapGrammyError', () => {
  it('403 → TelegramBlockedError', () => {
    expect(mapGrammyError(ge(403, 'Forbidden: bot was blocked by the user'))).toBeInstanceOf(TelegramBlockedError);
  });

  it('429 → TelegramThrottledError with retry_after', () => {
    const e = mapGrammyError(ge(429, 'Too Many Requests', { retry_after: 30 }));
    expect(e).toBeInstanceOf(TelegramThrottledError);
    expect((e as TelegramThrottledError).retryAfter).toBe(30);
  });

  it('400 with parse-related description → FormatError', () => {
    expect(mapGrammyError(ge(400, "Bad Request: can't parse entities"))).toBeInstanceOf(FormatError);
    expect(mapGrammyError(ge(400, 'Bad Request: invalid markdown'))).toBeInstanceOf(FormatError);
    expect(mapGrammyError(ge(400, 'Bad Request: invalid html'))).toBeInstanceOf(FormatError);
  });

  it('400 unrelated → TelegramFailedError', () => {
    expect(mapGrammyError(ge(400, 'Bad Request: PHOTO_INVALID_DIMENSIONS'))).toBeInstanceOf(TelegramFailedError);
  });

  it('500/other → TelegramFailedError with description as reason', () => {
    const e = mapGrammyError(ge(500, 'Internal Server Error'));
    expect(e).toBeInstanceOf(TelegramFailedError);
    expect((e as TelegramFailedError).reason).toBe('Internal Server Error');
  });

  it('non-GrammyError passes through unchanged', () => {
    const original = new Error('something else');
    expect(mapGrammyError(original)).toBe(original);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `errors.ts`**

```ts
import { GrammyError } from 'grammy';

export class MissingTokenError extends Error {
  readonly tag = 'missing_token';
  constructor() { super('missing_token'); }
}
export class InvalidTokenError extends Error {
  readonly tag = 'invalid_token';
  constructor() { super('invalid_token'); }
}
export class PathTopicMismatchError extends Error {
  readonly tag = 'topic_not_found';
  constructor() { super('topic_not_found'); }
}
export class EmptyBodyError extends Error {
  readonly tag = 'empty_body';
  constructor() { super('empty_body'); }
}
export class PayloadTooLargeError extends Error {
  readonly tag = 'payload_too_large';
  constructor(public readonly reason: string) { super(`payload_too_large: ${reason}`); }
}
export class FormatError extends Error {
  readonly tag = 'format_error';
  constructor(public readonly description: string) { super(`format_error: ${description}`); }
}
export class TelegramBlockedError extends Error {
  readonly tag = 'telegram_blocked';
  constructor() { super('telegram_blocked'); }
}
export class TelegramThrottledError extends Error {
  readonly tag = 'telegram_throttled';
  constructor(public readonly retryAfter: number) { super(`telegram_throttled: retry_after=${retryAfter}`); }
}
export class TelegramFailedError extends Error {
  readonly tag = 'telegram_failed';
  constructor(public readonly reason: string) { super(`telegram_failed: ${reason}`); }
}

const PARSE_HINT = /parse|markdown|html|entit/i;

export function mapGrammyError(err: unknown): unknown {
  if (!(err instanceof GrammyError)) return err;
  const code = err.error_code;
  const desc = err.description ?? '';
  if (code === 403) return new TelegramBlockedError();
  if (code === 429) {
    const retry = Number((err as any).parameters?.retry_after ?? 0);
    return new TelegramThrottledError(retry);
  }
  if (code === 400 && PARSE_HINT.test(desc)) return new FormatError(desc);
  return new TelegramFailedError(desc || `error_code=${code}`);
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/errors.ts src/tntfy/apps/tntfy/src/publish/errors.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): error classes + mapGrammyError

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — NestJS plumbing

### Task 5: TopicContext type + @CurrentTopic decorator

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/topic-context.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/current-topic.decorator.ts`

No tests for these — they are types/wiring exercised end-to-end by the controller tests in later tasks.

- [ ] **Step 1: Create `topic-context.ts`**

```ts
export interface TopicContext {
  topic_id: string;
  topic_name: string;
  user_id: string;
  chat_id: number;
}

declare module 'express' {
  interface Request {
    topicContext?: TopicContext;
  }
}
```

- [ ] **Step 2: Create `current-topic.decorator.ts`**

```ts
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
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @tntfy/app check-types
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/topic-context.ts src/tntfy/apps/tntfy/src/publish/current-topic.decorator.ts
git commit -m "$(cat <<'EOF'
feat(publish): TopicContext type and @CurrentTopic param decorator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: AuthGuard

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/auth.guard.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/auth.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`auth.guard.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `auth.guard.ts`**

```ts
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
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/auth.guard.ts src/tntfy/apps/tntfy/src/publish/auth.guard.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): AuthGuard resolves TopicContext from bearer token

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: PublishExceptionFilter

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/error.filter.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/error.filter.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import { PublishExceptionFilter } from './error.filter';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
  EmptyBodyError,
  PayloadTooLargeError,
  FormatError,
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
} from './errors';
import { UnsupportedContentTypeError } from './content-type.dispatcher';

function makeHost(): { host: ArgumentsHost; status: any; json: any } {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json };
  const host: any = {
    switchToHttp: () => ({ getResponse: () => res }),
  };
  return { host: host as ArgumentsHost, status, json };
}

describe('PublishExceptionFilter', () => {
  const filter = new PublishExceptionFilter();

  it.each([
    [new MissingTokenError(), 401, { error: 'missing_token' }],
    [new InvalidTokenError(), 401, { error: 'invalid_token' }],
    [new PathTopicMismatchError(), 404, { error: 'topic_not_found' }],
    [new EmptyBodyError(), 400, { error: 'empty_body' }],
    [new FormatError("can't parse entities"), 400, { error: 'format_error' }],
    [new PayloadTooLargeError('text > 4096'), 413, { error: 'payload_too_large' }],
    [new UnsupportedContentTypeError('application/json'), 415, { error: 'unsupported_content_type' }],
    [new TelegramBlockedError(), 502, { error: 'telegram_blocked' }],
    [new TelegramFailedError('boom'), 502, { error: 'telegram_failed', reason: 'boom' }],
  ])('maps %o to status/body', (err, statusCode, bodyShape) => {
    const { host, status, json } = makeHost();
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith(expect.objectContaining(bodyShape));
  });

  it('telegram_throttled includes retry_after', () => {
    const { host, status, json } = makeHost();
    filter.catch(new TelegramThrottledError(42), host);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: 'telegram_throttled', retry_after: 42 });
  });

  it('PayloadTooLargeError-from-bodyParser (express type) maps to 413', () => {
    // express bodyParser throws an error with .type === 'entity.too.large' and .status === 413
    const expressErr: any = new Error('request entity too large');
    expressErr.type = 'entity.too.large';
    expressErr.status = 413;
    const { host, status, json } = makeHost();
    filter.catch(expressErr, host);
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({ error: 'payload_too_large' });
  });

  it('falls back to 500 internal_error for unknown', () => {
    const { host, status, json } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'internal_error' });
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `error.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
  EmptyBodyError,
  PayloadTooLargeError,
  FormatError,
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
} from './errors';
import { UnsupportedContentTypeError } from './content-type.dispatcher';

@Catch()
export class PublishExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof MissingTokenError) return void res.status(401).json({ error: 'missing_token' });
    if (err instanceof InvalidTokenError) return void res.status(401).json({ error: 'invalid_token' });
    if (err instanceof PathTopicMismatchError) return void res.status(404).json({ error: 'topic_not_found' });
    if (err instanceof EmptyBodyError) return void res.status(400).json({ error: 'empty_body' });
    if (err instanceof FormatError) return void res.status(400).json({ error: 'format_error', description: err.description });
    if (err instanceof PayloadTooLargeError) return void res.status(413).json({ error: 'payload_too_large', reason: err.reason });
    if (err instanceof UnsupportedContentTypeError) {
      return void res.status(415).json({ error: 'unsupported_content_type', content_type: err.contentType });
    }
    if (err instanceof TelegramBlockedError) return void res.status(502).json({ error: 'telegram_blocked' });
    if (err instanceof TelegramThrottledError) {
      return void res.status(502).json({ error: 'telegram_throttled', retry_after: err.retryAfter });
    }
    if (err instanceof TelegramFailedError) return void res.status(502).json({ error: 'telegram_failed', reason: err.reason });

    // express bodyParser PayloadTooLargeError
    const e = err as any;
    if (e?.type === 'entity.too.large' || e?.status === 413) {
      return void res.status(413).json({ error: 'payload_too_large' });
    }

    res.status(500).json({ error: 'internal_error' });
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/error.filter.ts src/tntfy/apps/tntfy/src/publish/error.filter.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): exception filter maps domain errors to PRD response shapes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Re-export NestjsGrammyModule from BotModule

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/bot/bot.module.ts`

`NestjsGrammyModule` is not global (verified by inspecting `node_modules/.../@grammyjs/nestjs/src/nestjs-grammy.module.js`). Without re-export, `PublishModule` cannot resolve `@InjectBot()`. The fix: add the dynamic module to `BotModule.exports`.

- [ ] **Step 1: Read the current `bot.module.ts`**

You need the current `imports` and `providers` arrays.

- [ ] **Step 2: Modify the `@Module({...})` decorator**

Find the `@Module({ imports: [...], providers: [...] })` block. Add `exports`:
```ts
@Module({
  imports: [
    LoggerModule,
    UsersModule,
    TopicsModule,
    NestjsGrammyModule.forRootAsync({
      useFactory: () => ({ token: process.env.TELEGRAM_BOT_TOKEN as string }),
    }),
  ],
  providers: [EnsureUserMiddleware, BotUpdate, Callbacks],
  exports: [NestjsGrammyModule], // <-- add this line
})
```

This re-exports `NestjsGrammyModule` (and its bot provider) so any module that imports `BotModule` can use `@InjectBot()`.

- [ ] **Step 3: Verify build still passes**

```bash
pnpm --filter @tntfy/app build
```

- [ ] **Step 4: Verify all tests still pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```
Expected: existing tests pass; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/bot/bot.module.ts
git commit -m "$(cat <<'EOF'
feat(bot): re-export NestjsGrammyModule for cross-module @InjectBot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Side-effect services

### Task 9: TelegramSender

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/telegram-sender.service.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/telegram-sender.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`telegram-sender.service.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { TelegramSender } from './telegram-sender.service';
import {
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
  FormatError,
} from './errors';

function fakeGrammyError(code: number, description: string, parameters?: any) {
  const e: any = new Error(description);
  e.error_code = code;
  e.description = description;
  e.parameters = parameters;
  Object.setPrototypeOf(e, GrammyError.prototype);
  return e;
}

function makeSender(api: any) {
  return new TelegramSender({ api } as any);
}

describe('TelegramSender.sendText', () => {
  it('calls bot.api.sendMessage with parse_mode for HTML', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const sender = makeSender({ sendMessage });
    const out = await sender.sendText(100, '<b>x</b>', 'HTML');
    expect(sendMessage).toHaveBeenCalledWith(100, '<b>x</b>', { parse_mode: 'HTML' });
    expect(out.telegram_message_id).toBe(42);
  });

  it('omits parse_mode when parseMode is none', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const sender = makeSender({ sendMessage });
    await sender.sendText(100, 'plain', 'none');
    expect(sendMessage).toHaveBeenCalledWith(100, 'plain', {});
  });

  it('maps grammY 403 to TelegramBlockedError', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(403, 'Forbidden: bot was blocked'));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'none')).rejects.toThrow(TelegramBlockedError);
  });

  it('maps grammY 429 to TelegramThrottledError with retry_after', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(429, 'Too Many', { retry_after: 30 }));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'none')).rejects.toMatchObject({
      retryAfter: 30,
    });
  });

  it('maps grammY 400 parse error to FormatError', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(400, "can't parse entities"));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'MarkdownV2')).rejects.toThrow(FormatError);
  });
});

describe('TelegramSender.sendImage', () => {
  it('calls bot.api.sendPhoto with InputFile and caption', async () => {
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 7 });
    const sender = makeSender({ sendPhoto });
    const buf = Buffer.from([1, 2, 3]);
    await sender.sendImage(100, buf, 'pic.png', 'a caption');
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    const [chat, file, opts] = sendPhoto.mock.calls[0]!;
    expect(chat).toBe(100);
    expect(file).toBeDefined(); // grammy InputFile instance
    expect(opts).toMatchObject({ caption: 'a caption' });
  });
});

describe('TelegramSender.sendFile', () => {
  it('calls bot.api.sendDocument', async () => {
    const sendDocument = vi.fn().mockResolvedValue({ message_id: 9 });
    const sender = makeSender({ sendDocument });
    await sender.sendFile(100, Buffer.from([0]), 'data.bin');
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0]![0]).toBe(100);
  });

  it('maps generic 500 to TelegramFailedError', async () => {
    const sendDocument = vi.fn().mockRejectedValue(fakeGrammyError(500, 'Internal'));
    const sender = makeSender({ sendDocument });
    await expect(sender.sendFile(100, Buffer.from([0]), 'data.bin')).rejects.toBeInstanceOf(TelegramFailedError);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `telegram-sender.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Bot, InputFile } from 'grammy';
import { InjectBot } from '@grammyjs/nestjs';
import type { AppContext } from '../bot/context';
import { mapGrammyError } from './errors';

@Injectable()
export class TelegramSender {
  constructor(@InjectBot() private readonly bot: Bot<AppContext>) {}

  async sendText(
    chatId: number,
    text: string,
    parseMode: 'MarkdownV2' | 'HTML' | 'none',
  ): Promise<{ telegram_message_id: number }> {
    const opts = parseMode === 'none' ? {} : { parse_mode: parseMode };
    try {
      const msg = await this.bot.api.sendMessage(chatId, text, opts);
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }

  async sendImage(
    chatId: number,
    bytes: Buffer,
    filename: string,
    caption?: string,
  ): Promise<{ telegram_message_id: number }> {
    try {
      const msg = await this.bot.api.sendPhoto(
        chatId,
        new InputFile(bytes, filename),
        caption ? { caption } : {},
      );
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }

  async sendFile(
    chatId: number,
    bytes: Buffer,
    filename: string,
    caption?: string,
  ): Promise<{ telegram_message_id: number }> {
    try {
      const msg = await this.bot.api.sendDocument(
        chatId,
        new InputFile(bytes, filename),
        caption ? { caption } : {},
      );
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/telegram-sender.service.ts src/tntfy/apps/tntfy/src/publish/telegram-sender.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): TelegramSender wrapping bot.api with error mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: MessagesService.recordAttempt

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/messages.service.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/messages.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { TopicsService } from '../topics/topics.service';
import { TokensService } from '../topics/tokens.service';
import { UsersService } from '../users/users.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

const audit = { log: () => {}, fail: () => {} };

async function setup() {
  const mod = await Test.createTestingModule({
    providers: [
      MessagesService,
      TopicsService,
      TokensService,
      UsersService,
      { provide: KYSELY, useFactory: () => getTestDb() },
      { provide: AuditLogger, useValue: audit },
    ],
  }).compile();
  const messages = mod.get(MessagesService);
  const topics = mod.get(TopicsService);
  const users = mod.get(UsersService);
  const u = await users.createOrGet({ id: 1, username: null, first_name: null, last_name: null });
  const { topic } = await topics.create(u.id, 'deploys');
  return { mod, messages, topicId: topic.id };
}

describe('MessagesService.recordAttempt', () => {
  it('writes a delivered text row', async () => {
    const { mod, messages, topicId } = await setup();
    const out = await messages.recordAttempt({
      topicId,
      kind: 'text',
      format: 'markdown',
      textBody: 'hello *bold*',
      mimeType: null,
      contentLength: null,
      filename: null,
      caption: null,
      status: 'delivered',
      telegramMessageId: 42,
      error: null,
    });
    expect(out.id).toMatch(/^[A-Za-z0-9_-]{21}$/);

    const db = mod.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', out.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      kind: 'text',
      format: 'markdown',
      text_body: 'hello *bold*',
      status: 'delivered',
    });
    expect(Number(row.telegram_message_id)).toBe(42);
  });

  it('writes a failed image row with metadata only', async () => {
    const { mod, messages, topicId } = await setup();
    const out = await messages.recordAttempt({
      topicId,
      kind: 'image',
      format: null,
      textBody: null,
      mimeType: 'image/png',
      contentLength: 12345,
      filename: 'pic.png',
      caption: 'caption',
      status: 'failed',
      telegramMessageId: null,
      error: 'telegram_blocked',
    });
    const db = mod.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', out.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      kind: 'image',
      mime_type: 'image/png',
      filename: 'pic.png',
      caption: 'caption',
      status: 'failed',
      error: 'telegram_blocked',
      text_body: null,
    });
    expect(Number(row.content_length)).toBe(12345);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `messages.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';

export interface RecordAttemptInput {
  topicId: string;
  kind: 'text' | 'image' | 'file';
  format: 'text' | 'markdown' | 'html' | null;
  textBody: string | null;
  mimeType: string | null;
  contentLength: number | null;
  filename: string | null;
  caption: string | null;
  status: 'delivered' | 'failed';
  telegramMessageId: number | null;
  error: string | null;
}

@Injectable()
export class MessagesService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async recordAttempt(input: RecordAttemptInput): Promise<{ id: string }> {
    const id = nanoid();
    await this.db
      .insertInto('topic_messages')
      .values({
        id,
        topic_id: input.topicId,
        kind: input.kind,
        format: input.format,
        text_body: input.textBody,
        mime_type: input.mimeType,
        content_length: input.contentLength,
        filename: input.filename,
        caption: input.caption,
        status: input.status,
        telegram_message_id: input.telegramMessageId,
        error: input.error,
      })
      .execute();
    return { id };
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/messages.service.ts src/tntfy/apps/tntfy/src/publish/messages.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(publish): MessagesService.recordAttempt writes topic_messages row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Controller + module + main.ts

### Task 11: PublishController + PublishModule (happy paths)

**Files:**
- Create: `src/tntfy/apps/tntfy/src/publish/publish.controller.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/publish.module.ts`
- Create: `src/tntfy/apps/tntfy/src/publish/publish.controller.spec.ts`

This task implements the controller and tests the 5 happy paths (text/markdown/html/image/file). Error paths land in Task 12.

- [ ] **Step 1: Write the failing tests**

`publish.controller.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { PublishModule } from './publish.module';
import { TopicsService } from '../topics/topics.service';
import { UsersService } from '../users/users.service';
import { TelegramSender } from './telegram-sender.service';
import { KYSELY } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

let app: INestApplication;
let token: string;
let topicId: string;
let sender: { sendText: any; sendImage: any; sendFile: any };

beforeEach(async () => {
  const audit = { log: () => {}, fail: () => {} };
  sender = {
    sendText: vi.fn().mockResolvedValue({ telegram_message_id: 100 }),
    sendImage: vi.fn().mockResolvedValue({ telegram_message_id: 200 }),
    sendFile: vi.fn().mockResolvedValue({ telegram_message_id: 300 }),
  };

  const mod = await Test.createTestingModule({
    imports: [PublishModule],
  })
    .overrideProvider(KYSELY)
    .useFactory({ factory: () => getTestDb() })
    .overrideProvider(AuditLogger)
    .useValue(audit)
    .overrideProvider(TelegramSender)
    .useValue(sender)
    .compile();

  app = mod.createNestApplication();
  // Mount the same body parsers + 413 error handler as main.ts will.
  // Note: setGlobalPrefix is not used in tests (createNestApplication
  // doesn't apply main.ts logic), so the path is /publish, not /v1/publish.
  app.use(
    '/publish',
    express.text({ type: ['text/plain', 'text/markdown', 'text/html'], limit: '64kb' }),
  );
  app.use(
    '/publish',
    express.raw({
      type: ['application/octet-stream', 'image/*', 'audio/*', 'video/*'],
      limit: '50mb',
    }),
  );
  app.use('/publish', (err: any, _req: any, res: any, next: any) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    next(err);
  });
  await app.init();

  // Seed: one user, one topic
  const users = app.get(UsersService);
  const topics = app.get(TopicsService);
  const u = await users.createOrGet({ id: 100, username: null, first_name: null, last_name: null });
  const created = await topics.create(u.id, 'deploys');
  token = created.token;
  topicId = created.topic.id;
});

describe('POST /publish/:topic — happy paths', () => {
  it('text/plain → sendMessage parse_mode none → 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('Backup successful');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      topic: 'deploys',
      telegram_message_id: 100,
    });
    expect(res.body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(sender.sendText).toHaveBeenCalledWith(100, 'Backup successful', 'none');
    const db = app.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ kind: 'text', format: 'text', status: 'delivered', text_body: 'Backup successful' });
  });

  it('text/markdown → MarkdownV2', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/markdown')
      .send('hello *bold*');
    expect(res.status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith(100, 'hello *bold*', 'MarkdownV2');
  });

  it('text/html → HTML', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/html')
      .send('<b>x</b>');
    expect(res.status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith(100, '<b>x</b>', 'HTML');
  });

  it('image/png → sendPhoto with provided Filename', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .set('Filename', 'screenshot.png')
      .set('Caption', 'see attached')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topic: 'deploys', telegram_message_id: 200 });
    expect(sender.sendImage).toHaveBeenCalledWith(
      100,
      expect.any(Buffer),
      'screenshot.png',
      'see attached',
    );
  });

  it('application/octet-stream → sendDocument with generated filename', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    expect(sender.sendFile).toHaveBeenCalledTimes(1);
    const args = sender.sendFile.mock.calls[0]!;
    expect(args[0]).toBe(100);
    expect(args[2]).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.bin$/);
  });
});
```

- [ ] **Step 2: Run, expect failure** — modules don't exist.

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```

- [ ] **Step 3: Implement `publish.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PublishController } from './publish.controller';
import { TelegramSender } from './telegram-sender.service';
import { MessagesService } from './messages.service';
import { AuthGuard } from './auth.guard';
import { TopicsModule } from '../topics/topics.module';
import { BotModule } from '../bot/bot.module';
import { LoggerModule } from '../logging/logger.module';

@Module({
  imports: [LoggerModule, TopicsModule, BotModule],
  controllers: [PublishController],
  providers: [TelegramSender, MessagesService, AuthGuard],
})
export class PublishModule {}
```

- [ ] **Step 4: Implement `publish.controller.ts`**

```ts
import {
  Controller, Headers, Post, Req, UseFilters, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { TelegramSender } from './telegram-sender.service';
import { MessagesService } from './messages.service';
import { AuthGuard } from './auth.guard';
import { CurrentTopic } from './current-topic.decorator';
import type { TopicContext } from './topic-context';
import { dispatch } from './content-type.dispatcher';
import { resolveFilename } from './filename';
import { PublishExceptionFilter } from './error.filter';
import { EmptyBodyError, PayloadTooLargeError } from './errors';
import { AuditLogger } from '../logging/audit.service';

const TG_TEXT_MAX = 4096;
const TG_CAPTION_MAX = 1024;

@Controller('publish')
@UseFilters(PublishExceptionFilter)
export class PublishController {
  constructor(
    private readonly sender: TelegramSender,
    private readonly messages: MessagesService,
    private readonly audit: AuditLogger,
  ) {}

  @Post(':topic')
  @UseGuards(AuthGuard)
  async publish(
    @CurrentTopic() ctx: TopicContext,
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
  ) {
    const start = Date.now();
    const contentType = headers['content-type'] ?? '';
    const body = req.body as string | Buffer;
    const filenameHeader = headers['filename'];
    const caption = headers['caption'];

    const result = dispatch(contentType, body);

    if (result.kind === 'text') {
      const text = result.text ?? '';
      if (text.length === 0) throw new EmptyBodyError();
      if (text.length > TG_TEXT_MAX) throw new PayloadTooLargeError(`text > ${TG_TEXT_MAX}`);

      const format = result.parseMode === 'MarkdownV2' ? 'markdown' : result.parseMode === 'HTML' ? 'html' : 'text';
      let telegramMessageId: number | null = null;
      let status: 'delivered' | 'failed' = 'delivered';
      let errorStr: string | null = null;
      try {
        const r = await this.sender.sendText(ctx.chat_id, text, result.parseMode);
        telegramMessageId = r.telegram_message_id;
      } catch (err: any) {
        status = 'failed';
        errorStr = err?.tag ?? err?.message ?? 'unknown';
        const recorded = await this.messages.recordAttempt({
          topicId: ctx.topic_id,
          kind: 'text', format, textBody: text,
          mimeType: null, contentLength: null, filename: null, caption: null,
          status, telegramMessageId: null, error: errorStr,
        });
        this.audit.log({
          op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
          message_id: recorded.id, kind: 'text', status: 'failed',
          bytes: Buffer.byteLength(text), latency_ms: Date.now() - start,
        });
        throw err;
      }
      const recorded = await this.messages.recordAttempt({
        topicId: ctx.topic_id,
        kind: 'text', format, textBody: text,
        mimeType: null, contentLength: null, filename: null, caption: null,
        status, telegramMessageId, error: errorStr,
      });
      this.audit.log({
        op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
        message_id: recorded.id, kind: 'text', status: 'delivered',
        telegram_message_id: telegramMessageId!, bytes: Buffer.byteLength(text),
        latency_ms: Date.now() - start,
      });
      return {
        id: recorded.id, topic: ctx.topic_name,
        telegram_message_id: telegramMessageId, delivered_at: new Date().toISOString(),
      };
    }

    // image or file
    const bytes = result.bytes;
    const captionLen = caption ? Buffer.byteLength(caption) : 0;
    if (captionLen > TG_CAPTION_MAX) throw new PayloadTooLargeError(`caption > ${TG_CAPTION_MAX}`);
    const filename = resolveFilename({ filename: filenameHeader, mimeType: result.mimeType });
    const kind = result.kind; // 'image' | 'file'

    let telegramMessageId: number | null = null;
    let status: 'delivered' | 'failed' = 'delivered';
    let errorStr: string | null = null;
    try {
      const r = kind === 'image'
        ? await this.sender.sendImage(ctx.chat_id, bytes, filename, caption)
        : await this.sender.sendFile(ctx.chat_id, bytes, filename, caption);
      telegramMessageId = r.telegram_message_id;
    } catch (err: any) {
      status = 'failed';
      errorStr = err?.tag ?? err?.message ?? 'unknown';
      const recorded = await this.messages.recordAttempt({
        topicId: ctx.topic_id,
        kind, format: null, textBody: null,
        mimeType: result.mimeType, contentLength: bytes.length,
        filename, caption: caption ?? null,
        status, telegramMessageId: null, error: errorStr,
      });
      this.audit.log({
        op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
        message_id: recorded.id, kind, status: 'failed',
        bytes: bytes.length, latency_ms: Date.now() - start,
      });
      throw err;
    }
    const recorded = await this.messages.recordAttempt({
      topicId: ctx.topic_id,
      kind, format: null, textBody: null,
      mimeType: result.mimeType, contentLength: bytes.length,
      filename, caption: caption ?? null,
      status, telegramMessageId, error: errorStr,
    });
    this.audit.log({
      op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
      message_id: recorded.id, kind, status: 'delivered',
      telegram_message_id: telegramMessageId!, bytes: bytes.length,
      latency_ms: Date.now() - start,
    });
    return {
      id: recorded.id, topic: ctx.topic_name,
      telegram_message_id: telegramMessageId, delivered_at: new Date().toISOString(),
    };
  }
}
```

> Note: the duplicate "record + audit + return" blocks for delivered vs failed paths are intentional — we want the audit/record to fire even if the throw bypasses the rest of the method. A future refactor could extract a helper, but for now keep the explicit structure.

- [ ] **Step 5: Install supertest if missing**

From `src/tntfy/`:
```bash
pnpm --filter @tntfy/app add -D supertest @types/supertest
```

- [ ] **Step 6: Run tests, expect pass**

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```

If tests fail because `req.body` is empty (body parser not run), verify the `app.use('/publish', ...)` calls happen BEFORE `app.init()`. Adjust if needed.

- [ ] **Step 7: Verify build + typecheck**

```bash
pnpm --filter @tntfy/app build
pnpm --filter @tntfy/app check-types
```

- [ ] **Step 8: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/ src/tntfy/apps/tntfy/package.json src/tntfy/pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(publish): controller + module wiring (happy paths)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: PublishController error paths

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/publish/publish.controller.spec.ts`

The controller code is already complete from Task 11; this task adds tests for every error case the spec calls out.

- [ ] **Step 1: Append the failing tests** to `publish.controller.spec.ts`:

```ts
import { TelegramBlockedError, TelegramThrottledError, TelegramFailedError, FormatError } from './errors';

describe('POST /publish/:topic — error paths', () => {
  it('401 missing_token when no Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'missing_token' });
  });

  it('401 invalid_token when token does not exist', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', 'Bearer tk_unknownnnnnnnnnnnnnnnn')
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token' });
  });

  it('404 topic_not_found when path topic differs', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/other-topic')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'topic_not_found' });
  });

  it('400 empty_body on empty text', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'empty_body' });
  });

  it('413 payload_too_large for text over 4096 chars', async () => {
    const huge = 'a'.repeat(5000);
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: 'payload_too_large' });
  });

  it('413 payload_too_large from express body parser (binary > 50mb is too slow; use the text 64kb cap)', async () => {
    // text limit on the parser is 64kb. Send 70kb to trip it.
    const huge = 'a'.repeat(70 * 1024);
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: 'payload_too_large' });
  });

  it('415 unsupported_content_type for application/json', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ text: 'hi' });
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ error: 'unsupported_content_type' });
  });

  it('502 telegram_blocked when Telegram returns 403', async () => {
    sender.sendText.mockRejectedValueOnce(new TelegramBlockedError());
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'telegram_blocked' });
    // failed row persisted
    const db = app.get<any>(KYSELY);
    const rows = await db.selectFrom('topic_messages').selectAll().where('topic_id', '=', topicId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'telegram_blocked' });
  });

  it('502 telegram_throttled with retry_after', async () => {
    sender.sendText.mockRejectedValueOnce(new TelegramThrottledError(30));
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'telegram_throttled', retry_after: 30 });
  });

  it('502 telegram_failed with reason', async () => {
    sender.sendText.mockRejectedValueOnce(new TelegramFailedError('boom'));
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'telegram_failed', reason: 'boom' });
  });

  it('400 format_error when Telegram rejects parse', async () => {
    sender.sendText.mockRejectedValueOnce(new FormatError("can't parse entities"));
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/markdown')
      .send('bad *markdown');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'format_error' });
  });
});
```

- [ ] **Step 2: Run tests, expect all pass**

The controller and filter are already implemented; these tests should green up immediately.

```bash
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @tntfy/app check-types
```

- [ ] **Step 4: Commit**

```bash
git add src/tntfy/apps/tntfy/src/publish/publish.controller.spec.ts
git commit -m "$(cat <<'EOF'
test(publish): exhaustive error-path tests for the publish controller

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: AppModule wiring + main.ts body parsers

**Files:**
- Modify: `src/tntfy/apps/tntfy/src/app.module.ts`
- Modify: `src/tntfy/apps/tntfy/src/main.ts`

- [ ] **Step 1: Add `PublishModule` to `app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';
import { BotModule } from './bot/bot.module';
import { PublishModule } from './publish/publish.module';

@Module({
  imports: [LoggerModule, DatabaseModule, HealthModule, BotModule, PublishModule],
})
export class AppModule {}
```

- [ ] **Step 2: Mount Express body parsers + error handler in `main.ts`**

After `app.useLogger(...)` and BEFORE `app.listen(...)`, add:

```ts
import express from 'express';

// (existing imports / code)

// after app.useLogger(...)
app.use(
  '/v1/publish',
  express.text({
    type: ['text/plain', 'text/markdown', 'text/html'],
    limit: '64kb',
  }),
);
app.use(
  '/v1/publish',
  express.raw({
    type: ['application/octet-stream', 'image/*', 'audio/*', 'video/*'],
    limit: '50mb',
  }),
);
// Body-parser errors throw before NestJS routes run, so a controller-level
// exception filter cannot catch them. Translate them here to the PRD shape.
app.use(
  '/v1/publish',
  (err: any, _req: any, res: any, next: any) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    next(err);
  },
);
```

The route prefix matches `app.setGlobalPrefix('v1')` + `@Controller('publish')` → `/v1/publish/...`.

The error middleware is a 4-arg signature; Express uses the arity to recognize error handlers. It MUST come after the bodyParser middlewares.

- [ ] **Step 3: Verify build + typecheck + tests still pass**

```bash
pnpm --filter @tntfy/app check-types
pnpm --filter @tntfy/app build
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```

- [ ] **Step 4: Commit**

```bash
git add src/tntfy/apps/tntfy/src/app.module.ts src/tntfy/apps/tntfy/src/main.ts
git commit -m "$(cat <<'EOF'
feat(publish): wire PublishModule into AppModule and mount body parsers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Verify and finish

### Task 14: Tick roadmap, smoke-test instructions

**Files:**
- Modify: `docs/process/roadmap.md`
- Modify: `docs/project/specs/2026-05-07-phase-3-publish-api.md` (append a smoke-test section like Phase 2 has)

- [ ] **Step 1: Run the full suite + typecheck + build**

```bash
pnpm --filter @tntfy/app check-types
pnpm --filter @tntfy/app build
TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app test
```
All three must pass.

- [ ] **Step 2: Tick all Phase 3 checkboxes** in `docs/process/roadmap.md`. Find the section "### Phase 3 — Publish API" and change every `- [ ]` under it to `- [x]`.

- [ ] **Step 3: Append a smoke test section** to `docs/project/specs/2026-05-07-phase-3-publish-api.md`:

```markdown
## Smoke test (manual, post-implementation)

1. From `src/infra/`: `docker compose up -d`.
2. From `src/tntfy/`: `DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app migrate`.
3. Run the app:
   ```bash
   DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy \
   TELEGRAM_BOT_TOKEN=<from-botfather> \
   PUBLIC_BASE_URL=http://localhost:3000 \
   pnpm --filter @tntfy/app dev
   ```
4. In Telegram: `/start` → `/topic-create deploys` → copy the curl snippet.
5. Run the snippet: `curl -H "Authorization: Bearer tk_..." -d "Hello from tntfy" http://localhost:3000/v1/publish/deploys`. Expect 200 with `{ id, topic, telegram_message_id, delivered_at }` and the message arrives in the bot DM.
6. Verify other content types:
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: text/markdown" -d "hi *bold*" http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: text/html" -d "<b>x</b>" http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: image/png" -H "Filename: pic.png" --data-binary @pic.png http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: application/octet-stream" --data-binary @data.bin http://localhost:3000/v1/publish/deploys`
7. Verify error paths: missing Authorization (401), wrong path (`/publish/other`, 404), `Content-Type: application/json` (415), text > 4096 chars (413).
8. In the app log, confirm one structured `audit` line per request with `op: "message.publish"`, latency_ms, bytes, kind, status.
```

- [ ] **Step 4: Commit**

```bash
git add docs/process/roadmap.md docs/project/specs/2026-05-07-phase-3-publish-api.md
git commit -m "$(cat <<'EOF'
docs(phase-3): mark Phase 3 complete; add smoke-test instructions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done criteria recap

- All 14 tasks completed.
- `pnpm --filter @tntfy/app test` passes (60 prior + ~30 new tests).
- `pnpm --filter @tntfy/app build` passes.
- The full publish flow exercised manually as in Task 14 step 7.
- `docs/process/roadmap.md` Phase 3 boxes ticked.
