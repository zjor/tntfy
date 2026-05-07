---
created: 2026-05-07
status: active
phase: 3
tags: [spec, phase-3, publish, http-api]
---

# Phase 3 — Publish API — Design Spec

Detailed design for [`docs/process/roadmap.md`](../../process/roadmap.md) Phase 3. The PRD ([`prd.md`](../prd.md) §API) defines the HTTP contract; the architecture doc ([`architecture.md`](../architecture.md) §"Publish request flow") shows the sequence; this spec resolves the implementation choices left open by both.

## Goals

A user runs `curl -H "Authorization: Bearer tk_..." -d "Backup successful" https://tntfy.example.com/v1/publish/deploys` and a notification arrives in their Telegram DM within seconds. Same endpoint accepts text, markdown, HTML, images, and arbitrary files. Every attempt — success or failure — is persisted to `topic_messages` and audited.

## Out of scope

- Server-side retries on transient Telegram errors
- Async queue / background workers
- Per-token rate limits — post-v1
- Media groups, video uploads above 50 MB
- Streaming uploads to Telegram (whole body buffered in memory)

## Module structure

One new NestJS module under `apps/tntfy/src/`:

| Module | Owns |
|---|---|
| `PublishModule` | `PublishController` (`POST /v1/publish/:topic`), `AuthGuard`, `TelegramSender`, `MessagesService`, content-type dispatcher, `@CurrentTopic()` param decorator, error filter |

`PublishModule` `imports` `TopicsModule` (for `TokensService.lookupByToken`) and `BotModule` (to consume the same grammY `Bot` instance via `@InjectBot()` — single Telegram session for the process).

Note on cross-module `@InjectBot()`: `NestjsGrammyModule` registers the bot under a token derived from `botName` (default `DEFAULT_BOT_NAME`). For `@InjectBot()` to resolve in `PublishModule`, either (a) `BotModule` re-exports the bot provider via its `exports` array, or (b) `PublishModule` imports `NestjsGrammyModule.forRootAsync(...)` itself with the same config. **Pick (a)** — single configuration, single Bot. The implementer should add `exports: [/* bot provider */]` to `BotModule` so `PublishModule` gets it via the import chain. The provider token to re-export comes from `getBotToken()` (or equivalent helper) in `@grammyjs/nestjs`; the implementer verifies the exact API at implementation time.

`AppModule` adds `PublishModule` to its `imports`.

## File layout (new files only)

```
apps/tntfy/src/publish/
├── publish.module.ts
├── publish.controller.ts        # POST /v1/publish/:topic
├── auth.guard.ts                # bearer → DB lookup → req.topicContext
├── current-topic.decorator.ts   # @CurrentTopic() parameter decorator
├── topic-context.ts             # TopicContext type
├── content-type.dispatcher.ts   # pure function: ContentType → { kind, method, parse_mode? }
├── telegram-sender.service.ts   # wraps bot.api.sendMessage / sendPhoto / sendDocument
├── messages.service.ts          # INSERT into topic_messages
├── filename.ts                  # generate fallback filename from MIME
├── errors.ts                    # PublishError variants + HTTP exception classes
└── error.filter.ts              # NestJS exception filter — uniform { error, ... } JSON
```

`TokensService` (existing) gains one method: `lookupByToken(token)`.

## Dependencies to add

None. Express ships with NestJS; `body-parser` is already a transitive dep. grammY is installed; `InputFile` is part of `grammy`.

## Body parsing wiring

NestJS defaults to JSON body parsing on every route. Phase 3 needs raw text and raw bytes. We attach Express middleware on `/v1/publish/*` **before** Nest's body parser kicks in.

In `apps/tntfy/src/main.ts`, after `NestFactory.create(...)` and before `app.listen()`:

```ts
import express from 'express';

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
```

The two middlewares are mutually exclusive by `Content-Type` — only one populates `req.body`. After both, `req.body` is either a `string`, a `Buffer`, or `{}` (no recognized type → 415 in the controller).

`bodyParser.text` and `bodyParser.raw` throw `PayloadTooLargeError` on over-limit. The error filter maps that to **413 `payload_too_large`**. No router config is needed for the limit check itself.

The `64kb` text limit is generous; Telegram's text cap is 4096 chars (~12 KB UTF-8 worst case). The 64kb leaves headroom for over-limit detection inside the controller (which produces a more specific error message naming the Telegram cap).

## Configuration

No new env. Uses `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` (already required by `BotModule`).

## Auth flow

`AuthGuard` (a `CanActivate`) runs before `PublishController.publish`:

1. Read `Authorization` header. Missing or not starting with `Bearer ` → throw `MissingTokenError` → **401 `missing_token`**.
2. Strip the `Bearer ` prefix. `TokensService.lookupByToken(raw)` runs the JOIN from PRD §"Token verification":
   ```sql
   SELECT
     tk.id     AS token_id,
     tp.id     AS topic_id,
     tp.name   AS topic_name,
     u.id      AS user_id,
     u.ext_id  AS chat_id
   FROM topic_tokens tk
   JOIN topics tp ON tp.id = tk.topic_id
   JOIN users  u  ON u.id  = tp.user_id
   WHERE tk.token = $1;
   ```
3. No row → throw `InvalidTokenError` → **401 `invalid_token`**.
4. `topic_name !== request.params.topic` → throw `TopicNotFoundError` → **404 `topic_not_found`**.
5. Attach `req.topicContext = { topic_id, topic_name, user_id, chat_id }` (typed via `TopicContext`). Return `true`.

`@CurrentTopic()` is a small `createParamDecorator` that returns `req.topicContext`.

No caching; one query per request. v1 traffic does not warrant a cache layer.

## Content-Type dispatcher

`content-type.dispatcher.ts` exports `dispatch(contentType: string, body: string | Buffer): DispatchResult` where:

```ts
type DispatchResult =
  | { kind: 'text'; method: 'sendMessage'; parseMode: 'none' | 'MarkdownV2' | 'HTML'; text: string }
  | { kind: 'image'; method: 'sendPhoto'; bytes: Buffer }
  | { kind: 'file'; method: 'sendDocument'; bytes: Buffer; mimeType: string };
```

Mapping table:

| Content-Type matches | `kind` | Method | `parse_mode` | Body type |
|---|---|---|---|---|
| `text/plain`, `application/x-www-form-urlencoded` | text | sendMessage | `none` | string |
| `text/markdown` | text | sendMessage | `MarkdownV2` | string |
| `text/html` | text | sendMessage | `HTML` | string |
| `image/*` | image | sendPhoto | — | Buffer |
| `application/octet-stream`, `audio/*`, `video/*` | file | sendDocument | — | Buffer |
| anything else (incl. `application/json`, missing Content-Type, unrecognized types) | (throws `UnsupportedContentTypeError`) | — | — | — → **415** |

`application/x-www-form-urlencoded` is treated as plaintext because `curl -d "..."` defaults to that header — and the marquee one-liner from the PRD assumes raw text bodies. We forward the body verbatim to Telegram; it is *not* parsed as `key=value` form fields.

`application/json` is **not** treated as a file upload — a user sending JSON to the publish endpoint almost certainly meant something else, and silently forwarding it to Telegram as a generic document is surprising. They get a clear 415 instead. If they actually want to send JSON as a document, they set `Content-Type: application/octet-stream`.

Validation (in `dispatch` or in the controller right after it):
- text body empty (length 0) → `EmptyBodyError` → **400 `empty_body`**.
- text body length > 4096 (Telegram cap) → `PayloadTooLargeError` → **413 `payload_too_large`** (with a message naming the Telegram cap, distinct from the express limit).
- Caption header length > 1024 (Telegram cap) → **413 `payload_too_large`**.
- Empty binary body (length 0): allowed; Telegram accepts 0-byte documents.

Markdown escaping is the **caller's** responsibility. We pass `body` verbatim to Telegram. Telegram-side parse failures bubble back as `400 format_error`.

## Headers

| Header | Required | Notes |
|---|---|---|
| `Authorization: Bearer <token>` | yes | per-topic token |
| `Content-Type` | yes | drives dispatch |
| `Filename` | no | UTF-8 raw string. Used as `InputFile` filename for image/file uploads. When missing, generated as `attachment-<nanoid8>.<ext>` where `ext` is derived from MIME (`image/jpeg` → `jpg`, `image/png` → `png`, `image/gif` → `gif`, `image/webp` → `webp`, anything else → `bin`). The mapping lives in `filename.ts`. |
| `Caption` | no | UTF-8 raw string. Forwarded as Telegram `caption` for image/file uploads. Ignored for text. |

Non-ASCII filenames/captions are passed through; Express accepts UTF-8 in headers without RFC 5987 encoding by default.

## TelegramSender

`telegram-sender.service.ts`:

```ts
@Injectable()
export class TelegramSender {
  constructor(@InjectBot() private readonly bot: Bot<AppContext>) {}

  async sendText(chatId: number, text: string, parseMode: 'MarkdownV2' | 'HTML' | 'none'): Promise<{ telegram_message_id: number }> { ... }
  async sendImage(chatId: number, bytes: Buffer, filename: string, caption?: string): Promise<{ telegram_message_id: number }> { ... }
  async sendFile(chatId: number, bytes: Buffer, filename: string, caption?: string): Promise<{ telegram_message_id: number }> { ... }
}
```

Each method calls `this.bot.api.sendMessage / sendPhoto / sendDocument`. Photo/document use `new InputFile(bytes, filename)`. `parseMode === 'none'` omits the `parse_mode` option from the call.

On a `GrammyError`, the sender rethrows tagged variants from `errors.ts`:

| grammY shape | Tagged error | HTTP outcome |
|---|---|---|
| `error_code === 403` (bot blocked by user) | `TelegramBlockedError` | 502 `telegram_blocked` |
| `error_code === 429` | `TelegramThrottledError(retry_after)` | 502 `telegram_throttled` (response body includes `retry_after`) |
| `error_code === 400` and `description` matches `/parse|markdown|html|entities/i` | `FormatError` | 400 `format_error` |
| anything else | `TelegramFailedError(reason)` | 502 `telegram_failed` (response body includes `reason`) |

The 400 → format vs. other 400 split is conservative: we narrow on the description so only parse-related 400s map to `format_error`. Other 400s (Telegram rejecting an oversized photo, etc.) become `telegram_failed`.

## topic_messages persistence

`MessagesService` exposes one method, written post-call:

```ts
recordAttempt(input: {
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
}): Promise<{ id: string }>
```

Single `INSERT INTO topic_messages (...) RETURNING id`. `id = nanoid()` generated in app code. Returns the new id for inclusion in the success response.

For text payloads we store `text_body` (PRD: bodies are persisted for text but never logged). For binary, we store mime/length/filename/caption metadata only — the bytes are not persisted (PRD §"Data model" topic_messages note).

## Audit logging

After the response is sent, emit one `message.publish` line per PRD §"Audit logging":

```json
{
  "op": "message.publish",
  "user_id": "u_...",
  "topic_id": "t_...",
  "message_id": "m_...",
  "kind": "text|image|file",
  "status": "delivered|failed",
  "telegram_message_id": 12345,
  "bytes": 1234,
  "latency_ms": 87
}
```

`latency_ms` is measured from request received (controller entry) to response sent. `bytes` is the raw body length. On failure, an `error` field is appended (e.g. `"telegram_blocked"`).

## Controller shape

```ts
@Controller('publish')
@UseGuards(AuthGuard)
@UseFilters(PublishExceptionFilter)
export class PublishController {
  constructor(
    private readonly sender: TelegramSender,
    private readonly messages: MessagesService,
    private readonly audit: AuditLogger,
  ) {}

  @Post(':topic')
  async publish(
    @CurrentTopic() ctx: TopicContext,
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
  ): Promise<PublishSuccessDto> {
    // 1. dispatch by Content-Type → kind/method/parseMode
    // 2. validate body length / caption length
    // 3. call TelegramSender; catch GrammyError → tagged errors
    // 4. record topic_messages row (delivered or failed)
    // 5. emit audit log
    // 6. return success DTO, OR rethrow tagged error so the filter formats the response
  }
}
```

The tagged error path:
- On a Telegram failure that should produce a 502, the controller still records `topic_messages` with `status='failed'` and the error string before rethrowing.
- The exception filter centralizes the response shape `{ error: '...', ...details }` for every error case (401/404/400/413/415/502).

## Success response (PRD shape)

```json
{
  "id": "m_4f9...",
  "topic": "deploys",
  "telegram_message_id": 12345,
  "delivered_at": "2026-05-08T10:42:11Z"
}
```

`delivered_at` is the response timestamp; `id` is the `topic_messages.id`.

## Error responses (PRD §error responses)

The filter emits `{ error: '<code>', ... }` for every non-200. Specific error codes per PRD:

| Status | `error` | When |
|---|---|---|
| 400 | `empty_body` | text body length 0 |
| 400 | `format_error` | Telegram parse-mode rejection |
| 401 | `missing_token` | no `Authorization` header |
| 401 | `invalid_token` | token unknown |
| 404 | `topic_not_found` | path `:topic` ≠ token's topic |
| 413 | `payload_too_large` | exceeds Telegram cap (text 4096, photo 10 MB doc 50 MB) OR Express limit |
| 415 | `unsupported_content_type` | unrecognized `Content-Type` |
| 502 | `telegram_blocked` | Telegram 403 |
| 502 | `telegram_throttled` | Telegram 429 (response includes `retry_after`) |
| 502 | `telegram_failed` | other Telegram error (response includes `reason`) |

## Testing

Vitest is already wired (Phase 2). Three layers:

### Unit tests (pure)

- `content-type.dispatcher.spec.ts`: every row of the dispatch table, plus `UnsupportedContentTypeError` cases.
- `errors.spec.ts`: `mapGrammyError(err)` returns the right tagged class for each `error_code` / description shape.
- `filename.spec.ts`: MIME → extension fallback.

### Service-layer integration tests (real Postgres)

- `tokens.service.spec.ts` (extend): `lookupByToken` happy path, missing token, joined fields.
- `messages.service.spec.ts`: `recordAttempt` writes the right row for each `kind` + `status`.

### Controller tests via `Test.createTestingModule` + supertest

- `publish.controller.spec.ts`: build a Nest app with the real `PublishModule` but mock `TelegramSender`. Use `app.use(express.text/raw)` exactly as in `main.ts` so body parsing matches production. Cover at least:
  - 200 happy path × 5 (text/markdown/html/image/file). Assert response body shape AND that `topic_messages` got the row.
  - 400 `empty_body` (text) — also assert no `topic_messages` row written.
  - 401 `missing_token`, 401 `invalid_token`, 404 `topic_not_found`.
  - 413 from Express (over 50 MB raw) and from Telegram-cap pre-check (text > 4096).
  - 415 unsupported content type.
  - 502 `telegram_blocked` / `telegram_throttled` (with `retry_after` echoed) / `telegram_failed`. Assert `topic_messages` row with `status='failed'` and the error string.

`TelegramSender` mocking: a NestJS provider override returns a stub object whose three methods either resolve `{ telegram_message_id: 123 }` or throw a constructed `GrammyError`-equivalent (we throw the tagged class directly to test the filter without needing real grammY internals).

### What is not tested

- Real `api.telegram.org` calls (no integration suite for the Bot API).
- Concurrent request behavior (single-fork test pool; concurrency isn't exercised).

## Bot snippet update

After Phase 3 lands, the curl/Python snippets generated by `/create` (in `apps/tntfy/src/bot/snippets.ts`) are still correct — they already use `Authorization: Bearer ...`, `text/plain` (default for `-d`), and the right URL shape. Verify and confirm in the smoke test.

## Done criteria for Phase 3

- All checkboxes in roadmap §Phase 3 ticked.
- `pnpm --filter @tntfy/app test` passes (60 prior + new tests).
- Manual smoke test: `/create deploys` → `curl -H 'Authorization: Bearer ...' -d 'Hello' <PUBLIC_BASE_URL>/v1/publish/deploys` returns 200 with `{ id, topic, telegram_message_id, delivered_at }` and the message arrives in the bot DM. Repeat for `text/markdown`, `text/html`, `image/png`, `application/octet-stream`. Each emits exactly one `message.publish` audit line.

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
4. In Telegram: `/start` → `/create deploys` → copy the curl snippet.
5. Run the snippet: `curl -H "Authorization: Bearer tk_..." -d "Hello from tntfy" http://localhost:3000/v1/publish/deploys`. Expect 200 with `{ id, topic, telegram_message_id, delivered_at }` and the message arrives in the bot DM.
6. Verify other content types:
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: text/markdown" -d "hi *bold*" http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: text/html" -d "<b>x</b>" http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: image/png" -H "Filename: pic.png" --data-binary @pic.png http://localhost:3000/v1/publish/deploys`
   - `curl -H "Authorization: Bearer tk_..." -H "Content-Type: application/octet-stream" --data-binary @data.bin http://localhost:3000/v1/publish/deploys`
7. Verify error paths:
   - missing Authorization header → `401 missing_token`
   - wrong path: `/v1/publish/other` → `404 topic_not_found`
   - `Content-Type: application/json` → `415 unsupported_content_type`
   - text body > 4096 chars → `413 payload_too_large`
8. In the app log, confirm one structured `audit` line per request with `op: "message.publish"`, `latency_ms`, `bytes`, `kind`, `status`.
