---
created: 2026-05-07
status: active
version: v1
tags: [architecture, modules, erd]
---

# tntfy — Architecture (v1)

Visual companion to [`prd.md`](prd.md). Diagrams are authored in Mermaid; column-level details live in the PRD's data-model section.

## System context

A single NestJS process exposes the HTTP API and runs the Telegram bot via long-polling. Postgres is the only stateful dependency.

```mermaid
graph LR
    Caller["Client app / script / cron"]
    TGUser["Telegram user"]
    TG["Telegram Bot API"]

    subgraph tntfy["tntfy (single process)"]
        API["HTTP API (NestJS)"]
        Bot["Bot worker (grammY)"]
    end
    DB[("Postgres")]

    Caller -->|"POST /v1/publish/:topic"| API
    TGUser -->|"/start, /topic-* commands"| TG
    TG <-.->|"long-poll updates"| Bot
    API -->|"sendMessage / sendPhoto / sendDocument"| TG
    TG -->|"deliver to DM"| TGUser
    API <--> DB
    Bot <--> DB
```

## NestJS module graph

Solid arrows are `imports` edges (one module pulls another in). Dotted arrows are runtime `KYSELY` injection — `DatabaseModule` is `@Global()` so consumers inject without re-importing.

Boxes marked `(Phase 2)` and `(Phase 3)` are planned, not yet built.

```mermaid
graph TD
    AppModule --> DatabaseModule
    AppModule --> HealthModule
    AppModule --> UsersModule["UsersModule (Phase 2)"]
    AppModule --> TopicsModule["TopicsModule (Phase 2)"]
    AppModule --> BotModule["BotModule (Phase 2)"]
    AppModule --> PublishModule["PublishModule (Phase 3)"]

    BotModule --> UsersModule
    BotModule --> TopicsModule
    PublishModule --> TopicsModule

    UsersModule -.->|KYSELY| DatabaseModule
    TopicsModule -.->|KYSELY| DatabaseModule
    PublishModule -.->|KYSELY| DatabaseModule

    classDef planned stroke-dasharray: 4 3,fill:#f9f9f9,color:#666;
    class UsersModule,TopicsModule,BotModule,PublishModule planned;
```

### Module responsibilities

| Module | Owns | Notes |
|---|---|---|
| `DatabaseModule` | `KYSELY` provider, pool teardown on shutdown | Global; built |
| `HealthModule` | `GET /v1/health` | Built |
| `UsersModule` | `users` CRUD; `create_or_get` by `ext_id` | Phase 2 |
| `TopicsModule` | `topics` + `topic_tokens` (tightly coupled — rotation, cascade) | Phase 2 |
| `BotModule` | grammY bot, slash commands, `<tg-spoiler>` snippets | Phase 2 |
| `PublishModule` | `POST /v1/publish/:topic`, auth guard, content-type dispatcher, `TelegramSender`, `topic_messages` writes | Phase 3 |

## Entity-relationship diagram

Schema-level cardinalities. The full column list with types, defaults, and indexes lives in [`prd.md` §Data model](prd.md#data-model).

```mermaid
erDiagram
    USERS ||--o{ TOPICS : owns
    TOPICS ||--o{ TOPIC_TOKENS : "authorized by"
    TOPICS ||--o{ TOPIC_MESSAGES : "logs delivery of"

    USERS {
        text id PK
        bigint ext_id UK "Telegram user_id == DM chat_id"
        text username
        text first_name
        text last_name
        timestamptz created_at
        timestamptz deleted_at "reserved, unused in v1"
    }
    TOPICS {
        text id PK
        text user_id FK "ON DELETE CASCADE"
        text name "UNIQUE(user_id, name)"
        timestamptz created_at
    }
    TOPIC_TOKENS {
        text id PK
        text topic_id FK "ON DELETE CASCADE"
        text token UK "tk_<24 chars>"
        timestamptz created_at
    }
    TOPIC_MESSAGES {
        text id PK
        text topic_id FK "ON DELETE CASCADE"
        text kind "text | image | file"
        text format "text | markdown | html (text only)"
        text status "delivered | failed"
        bigint telegram_message_id
        text error
        timestamptz created_at
    }
```

Application invariants on top of the schema (not enforced by constraints):

- One *active* token per topic at a time — `/rotate` hard-deletes the old row before inserting the new one. The schema allows N rows; the app keeps it at 1.
- Topic names match `^[a-z0-9][a-z0-9-_]{1,63}$` — validated in `TopicsService` before insert.

## Publish request flow

`POST /v1/publish/:topic` — single synchronous attempt, no server-side retry.

```mermaid
sequenceDiagram
    actor Caller
    participant API as PublishController
    participant Guard as AuthGuard
    participant Topics as TopicsService
    participant Sender as TelegramSender
    participant TG as Telegram
    participant DB as Postgres

    Caller->>API: POST /v1/publish/:topic<br/>Authorization: Bearer tk_…
    API->>Guard: canActivate()
    Guard->>Topics: lookupByToken(tk)
    Topics->>DB: SELECT tk + tp + u (join)
    DB-->>Topics: chat_id, topic_id, topic_name
    Topics-->>Guard: row | null

    alt token unknown
        Guard-->>Caller: 401 invalid_token
    else path topic ≠ token's topic
        Guard-->>Caller: 404 topic_not_found
    else
        Guard-->>API: ctx { chat_id, topic_id }
        API->>Sender: dispatch by Content-Type
        Sender->>TG: sendMessage / sendPhoto / sendDocument
        alt Telegram ok
            TG-->>Sender: message_id
            Sender->>DB: INSERT topic_messages (status=delivered)
            Sender-->>Caller: 200 { id, telegram_message_id, delivered_at }
        else Telegram error
            TG-->>Sender: 4xx / 5xx
            Sender->>DB: INSERT topic_messages (status=failed, error)
            Sender-->>Caller: 502 telegram_blocked / _throttled / _failed
        end
    end
```

## Bot command flow — `/create`

Representative for the topic-management commands. Other commands (`/list`, `/rotate`, `/remove`) follow the same shape with different DB operations.

```mermaid
sequenceDiagram
    actor User as Telegram User
    participant TG as Telegram
    participant Bot as BotModule (grammY)
    participant Topics as TopicsService
    participant DB as Postgres

    User->>TG: /create deploys
    TG->>Bot: update (ext_id, args)
    Bot->>Topics: createTopic(ext_id, "deploys")
    Topics->>Topics: validate name regex
    Topics->>DB: INSERT topics + topic_tokens (txn)
    DB-->>Topics: topic_id, token
    Topics-->>Bot: { topic, token }
    Bot-->>TG: reply with curl + Python snippets,<br/>token wrapped in &lt;tg-spoiler&gt;
    TG-->>User: rendered message
```

## Cross-cutting concerns

- **Audit logging.** Every state-changing operation emits one structured JSON log line with `op`, `request_id`, `user_id`. See [`prd.md` §Audit logging](prd.md#audit-logging) for the table of `op` values. Bodies and tokens are never logged.
- **Shutdown.** `app.enableShutdownHooks()` in `main.ts` triggers `DatabaseModule.onModuleDestroy()`, which calls `Kysely.destroy()` to drain the pg pool.
- **Configuration.** Read directly from `process.env` in v1: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `PORT`. No `@nestjs/config` until a second consumer needs it.

## Phase status (2026-05-07)

| Phase | Scope | Status |
|---|---|---|
| 1 | Repo bootstrap, data layer, `/v1/health` | Done |
| 2 | Telegram bot (control plane) | Pending |
| 3 | Publish API | Pending |
| 4 | Polish (Swagger, audit logs, Dockerfile, README) | Pending |
