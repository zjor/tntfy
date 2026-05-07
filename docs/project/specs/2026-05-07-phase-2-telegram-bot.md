---
created: 2026-05-07
status: active
phase: 2
tags: [spec, phase-2, telegram, bot]
---

# Phase 2 — Telegram bot (control plane) — Design Spec

Detailed design for [`docs/process/roadmap.md`](../../process/roadmap.md) Phase 2. The PRD ([`prd.md`](../prd.md)) defines *what* the bot does; the architecture doc ([`architecture.md`](../architecture.md)) shows the module graph and ERD; this spec resolves the implementation choices left open by both.

## Goals

A user runs `/start`, then `/create deploys`, and receives a `<tg-spoiler>`-wrapped bearer token plus a copy-paste `curl` snippet. They can list their topics, rotate a token, and remove a topic with confirmation. Every state-changing operation emits an audit log line. Phase 2 is purely the control plane — the publish endpoint is Phase 3.

## Out of scope

- `POST /v1/publish/:topic` — Phase 3
- Swagger UI, production `Dockerfile`, README dev-setup verification — Phase 4
- Group/channel commands — undefined per PRD

Long-polling is the permanent transport for this project; webhooks are not on the roadmap.
- Per-token rate limiting — post-v1

## Module structure

Three new NestJS modules under `apps/tntfy/src/`, matching the architecture doc:

| Module | Owns |
|---|---|
| `UsersModule` | `UsersService`: `createOrGet(from)`, `getByExtId(extId)` |
| `TopicsModule` | `TopicsService` (validation, CRUD, list); `TokensService` (generate, rotate, lookup-by-token) |
| `BotModule` | grammY long-polling, `EnsureUserMiddleware`, `BotUpdate` (commands), callback-query handlers |

`BotModule` `imports` `UsersModule` and `TopicsModule`. `UsersModule` and `TopicsModule` `imports` only `DatabaseModule` (already global; injects `KYSELY`).

## File layout (new files only)

```
apps/tntfy/src/
├── users/
│   ├── users.module.ts
│   └── users.service.ts
├── topics/
│   ├── topics.module.ts
│   ├── topics.service.ts
│   ├── tokens.service.ts
│   └── topic-name.ts            # regex constant + validate(name) helper
└── bot/
    ├── bot.module.ts
    ├── bot.update.ts            # @Update() class, methods per slash command
    ├── ensure-user.middleware.ts
    ├── callbacks.ts             # /remove confirm/cancel handlers
    ├── snippets.ts              # renderCurl(topic, token, baseUrl), renderPython(...)
    └── errors.ts                # user-facing message formatter for known errors
```

`AppModule` adds `UsersModule`, `TopicsModule`, `BotModule` to its `imports`.

## Dependencies to add

In `apps/tntfy/package.json`:

- `grammy` — Telegram client/framework
- `@grammyjs/nestjs` — NestJS integration (`@Update()`, `@Command()`, `@On()` decorators, `BotModule.forRoot({ token })`)
- `vitest` — test runner (devDep)
- `@vitest/coverage-v8` — coverage (devDep)

`pnpm-workspace.yaml` already covers `apps/*`.

## Configuration

Read directly from `process.env` in `BotModule.forRootAsync` (no `@nestjs/config` yet — single boundary):

| Variable | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | From BotFather. Fail fast in `main.ts` if missing. |
| `PUBLIC_BASE_URL` | yes | Used by `renderCurl`. Fail fast if missing. |

Update `src/infra/docker-compose.yml` and any local `.env.example` so contributors see the new variables.

## Identity resolution

`EnsureUserMiddleware` is registered as the first grammY middleware. On every update:

1. If `ctx.from?.id` is missing (channel post, etc.), short-circuit with no-op.
2. Call `usersService.createOrGet(ctx.from)`.
3. Set `ctx.user = { id, ext_id }` (typed via grammY `Context` flavor).

`UsersService.createOrGet`:

- Single `INSERT INTO users (id, ext_id, username, first_name, last_name) VALUES (...) ON CONFLICT (ext_id) DO NOTHING RETURNING *`.
- If no row returned, run a `SELECT` by `ext_id`.
- Audit `user.create_or_get` only when the insert actually inserted.

`/start` calls a separate `UsersService.upsertProfile(from)` that runs `INSERT ... ON CONFLICT (ext_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name` to refresh handle changes. (Other commands rely on the middleware's create-or-get path; they don't touch profile fields.)

## Token generation

`TokensService.generate()` returns `tk_<24 url-safe chars>` using `nanoid` with a custom alphabet matching `[A-Za-z0-9_-]`. Stored format: `^tk_[A-Za-z0-9_-]{24}$`. Tokens are stored raw (PRD: no hash). The 24-char body gives ~140 bits of entropy.

## Command behavior

All command handlers live as methods on a single `BotUpdate` class in `bot.update.ts`. Methods are `async`, return `Promise<void>`, and use `await ctx.reply(...)`. Each command is decorated with `@Command('start')`, `@Command('create')`, etc.

### `/start`

1. `usersService.upsertProfile(ctx.from)`.
2. Reply with welcome text + the same body as `/help`.

### `/help`

Static reply listing all commands with one-line usage examples and the topic-name rule.

### `/create <name>`

1. Parse `name` from `ctx.match` (grammY exposes the args string after the command).
2. `topicName.validate(name)` — throws `InvalidTopicNameError` on regex mismatch.
3. `topicsService.create(ctx.user.id, name)` — wraps in a Kysely transaction:
   - Insert `topics` row (catches `UNIQUE(user_id, name)` violation → throws `DuplicateTopicError`).
   - Insert `topic_tokens` row with `tokensService.generate()`.
   - Returns `{ topic, token }`.
4. Audit `topic.create`.
5. Reply with the message body composed from `snippets.ts`:
   ```
   Topic: <name>

   Token: <tg-spoiler><token></tg-spoiler>

   curl -H "Authorization: Bearer <token>" \
        -d "Hello from tntfy" \
        <PUBLIC_BASE_URL>/v1/publish/<name>

   Python:
   import requests
   requests.post(
       "<PUBLIC_BASE_URL>/v1/publish/<name>",
       headers={"Authorization": "Bearer <token>"},
       data="Hello from tntfy",
   )
   ```
   Sent with `parse_mode: "HTML"`. Token, name, and base URL are HTML-escaped before interpolation.

### `/list`

`topicsService.listByUser(ctx.user.id)` — `SELECT name, created_at FROM topics WHERE user_id = $1 ORDER BY created_at DESC`. Reply with one line per topic. Empty list → "you have no topics; create one with `/create <name>`".

### `/rotate <name>`

1. Parse name; validate format.
2. `topicsService.findByUserAndName(ctx.user.id, name)` — throws `TopicNotFoundError` if missing.
3. `tokensService.rotate(topic.id)` — transaction: `DELETE FROM topic_tokens WHERE topic_id = $1`, then insert a new row. Returns the new token string.
4. Audit `token.rotate`.
5. Reply with the new token in `<tg-spoiler>` plus a fresh `curl` snippet.

### `/remove <name>`

1. Parse name; validate format.
2. `topicsService.findByUserAndName(...)` — throws `TopicNotFoundError` if missing.
3. Reply with inline keyboard:
   ```
   Delete topic '<name>'? This removes its token and all message history.
   [Yes, delete]   [Cancel]
   ```
   Callback data: `topic-remove:y:<topic_id>` and `topic-remove:n:<topic_id>`.
4. Callback handler in `callbacks.ts` (`@On('callback_query:data')`):
   - Parse the prefix; reject if not `topic-remove`.
   - Verify the topic still belongs to `ctx.user.id` (owner check; defensive against stale buttons).
   - On `n`: edit message to "cancelled" and answer the callback.
   - On `y`: in a transaction, `SELECT count(*) FROM topic_messages WHERE topic_id = $1`, then `DELETE FROM topics WHERE id = $1` (FK cascades to `topic_tokens` and `topic_messages`). Audit `topic.delete` with `cascaded_messages_count`. Edit message to "removed".

## User-facing errors

`bot/errors.ts` exports a `formatError(err): string` that maps known service errors to friendly text per PRD §"Bot-side errors":

| Error | Reply |
|---|---|
| `InvalidTopicNameError` | "topic names must match `^[a-z0-9][a-z0-9-_]{1,63}$` — e.g. `deploys`, `app-1`" |
| `DuplicateTopicError` | "you already have a topic '\<name\>'" |
| `TopicNotFoundError` | "no topic '\<name\>', see /list" |
| anything else | "something went wrong, try again later" — full error logged via Pino |

A `bot.catch(...)` handler is the last-resort safety net, plus per-command `try { ... } catch (err) { await ctx.reply(formatError(err)); throw err }` so unhandled errors still surface and log.

## Audit logging

`AuditLogger` already types every event needed (`user.create_or_get`, `topic.create`, `token.rotate`, `topic.delete`). Each service method that mutates state takes an `AuditLogger` dependency and emits the event after a successful commit. Failures emit nothing audit-side; the Pino HTTP/error layer captures them.

## Bootstrap & shutdown

- `main.ts` already calls `app.enableShutdownHooks()`. grammY's `bot.start()` runs as a long-poll loop; on `app.close()`, `BotModule` calls `bot.stop()` in `onApplicationShutdown`.
- `bot.start()` is fire-and-forget after `app.listen()` (long-polling does not block startup).

## Testing

Vitest + service-layer integration tests against the real Postgres from `src/infra/docker-compose.yml`. TDD per Superpowers — every command and service method is red → green.

### Wiring

- Add `vitest.config.ts` and a `test` script to `apps/tntfy/package.json`.
- Configure vitest with `pool: 'forks'`, `poolOptions.forks.singleFork: true` so test files share one Postgres connection and don't race on TRUNCATE across workers.
- A `test/setup.ts`:
  - On suite start: connect to Postgres at `TEST_DATABASE_URL` (defaults to the local docker-compose), run all migrations once.
  - Per test: `TRUNCATE users, topics, topic_tokens, topic_messages RESTART IDENTITY CASCADE` to start clean. (Faster than schema-per-test; FK cascade keeps the truncate cheap.)
  - On suite end: close the pool.

### Service tests

`*.service.spec.ts` files exercise services through `Test.createTestingModule` with the real `KYSELY` provider pointed at the test DB. Cover:

- `UsersService.createOrGet` — first call inserts and returns row; second call returns the same row, does not duplicate.
- `UsersService.upsertProfile` — second call with new handle updates fields.
- `TopicsService.create` — happy path; duplicate name rejected with `DuplicateTopicError`; invalid name rejected with `InvalidTopicNameError`.
- `TopicsService.listByUser`, `findByUserAndName`, `remove` (and the cascade behavior).
- `TokensService.generate`, `rotate` (old token gone, new token works), token format regex.

### Handler tests

`bot.update.spec.ts` and `callbacks.spec.ts`. Each test instantiates `BotUpdate` with a real `Test.createTestingModule` (so `UsersService`, `TopicsService` use the test DB) and a stubbed grammY `Context`:

```
type StubCtx = {
  from: { id: number; username?: string; first_name?: string; last_name?: string };
  match?: string;
  user?: { id: string; ext_id: number };
  reply: vi.fn(...);
  callbackQuery?: { data: string };
  answerCallbackQuery: vi.fn(...);
  editMessageText: vi.fn(...);
};
```

Assert on the `reply`/`editMessageText` mock call args (text content, `parse_mode`, presence of `<tg-spoiler>`, inline-keyboard shape). The middleware is invoked manually before each command test to populate `ctx.user`, mirroring the real flow.

### What is *not* tested

- Real Telegram API calls (no integration with `api.telegram.org` in the test suite).
- The `bot.start()` long-poll loop itself.

## Roadmap link

Update [`docs/process/roadmap.md`](../../process/roadmap.md) Phase 2 header to reference this spec: `### Phase 2 — Telegram bot (control plane) — [design spec](../project/specs/2026-05-07-phase-2-telegram-bot.md)`.

## Done criteria for Phase 2

All checkboxes in roadmap §Phase 2 ticked, and:

- `pnpm --filter @tntfy/app test` passes.
- Running the bot locally against a real BotFather token, the full user journey from PRD §"User journey" works end-to-end in Telegram.
- Every command emits the audit log line documented in PRD §"Audit logging".

## Smoke test (manual, post-implementation)

1. Get a bot token from `@BotFather` and set commands via `/setcommands`:
   ```
   start - register or refresh your account
   help - list commands
   create - create a topic and get a curl snippet
   list - list your topics
   rotate - rotate a topic's token
   remove - delete a topic and its history
   ```
2. From `src/infra/`: `docker compose up -d`.
3. From `src/tntfy/`: `DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy pnpm --filter @tntfy/app migrate`.
4. Run the app:
   ```bash
   DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy \
   TELEGRAM_BOT_TOKEN=<from-botfather> \
   PUBLIC_BASE_URL=http://localhost:3000 \
   pnpm --filter @tntfy/app dev
   ```
5. In Telegram: `/start` → `/help` → `/create deploys` → copy the curl snippet (publishing returns 404 for now — the publish endpoint lands in Phase 3) → `/list` → `/rotate deploys` → `/remove deploys` → confirm via inline button → `/list` (now empty).
6. Confirm the app log emits one structured `audit` line per state-changing command (per PRD §"Audit logging").
