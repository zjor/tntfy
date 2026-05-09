---
created: 2026-05-03
status: active
tags: [roadmap, milestones]
---

# tntfy — Roadmap

This document tracks what is being built in what order. Detailed scope for the current milestone lives in [`docs/project/prd.md`](../project/prd.md).

## v1 — MVP (current)

A single-process NestJS app: HTTP publish endpoint + Telegram bot control plane + Postgres. End goal: a user runs `/start`, creates a topic, pastes the returned `curl` snippet into their app, and notifications arrive in Telegram.

Phased build:

### Phase 1 — Repo bootstrap & data layer

- [x] Generate Turborepo via `pnpm dlx create-turbo@latest` into `src/tntfy/`
- [x] Trim example apps; create `apps/tntfy/` (NestJS)
- [x] Add `src/infra/docker-compose.yml` for local Postgres
- [x] Wire Kysely as a NestJS provider; configure `DATABASE_URL`
- [x] Migrations: `users`, `topics`, `topic_tokens`, `topic_messages` (+ indexes)
- [x] `GET /v1/health` returns `200 { "status": "ok" }`

### Phase 2 — Telegram bot (control plane)

Design spec: [`docs/project/specs/2026-05-07-phase-2-telegram-bot.md`](../project/specs/2026-05-07-phase-2-telegram-bot.md)

- [x] Install `grammy` and `@grammyjs/nestjs`; wire long-polling
- [x] `/start` — create-or-get user
- [x] `/help` — list commands
- [x] `/create <name>` — validate, persist topic + token, reply with curl & Python snippets (token in `<tg-spoiler>`)
- [x] `/list` — list user's topics
- [x] `/rotate <name>` — rotate (hard-delete old, insert new)
- [x] `/remove <name>` — inline-keyboard confirmation, then cascade hard-delete

### Phase 3 — Publish API

Design spec: [`docs/project/specs/2026-05-07-phase-3-publish-api.md`](../project/specs/2026-05-07-phase-3-publish-api.md)

- [x] `POST /v1/publish/:topic` route + DTOs
- [x] Auth guard: bearer → topic lookup → path topic must match (`401` / `404`)
- [x] Content-Type dispatcher: `text/plain` / `text/markdown` / `text/html` → `sendMessage` with appropriate `parse_mode`
- [x] Binary dispatcher: `image/*` → `sendPhoto`, others → `sendDocument`
- [x] Size limits: text 4096, photo 10 MB, document 50 MB → `413`
- [x] Persist `topic_messages` row on success and failure
- [x] Map Telegram errors to `502 telegram_blocked` / `telegram_throttled` / `telegram_failed`

### Phase 4 — Polish

- [x] `@nestjs/swagger` mounted at `/docs`
- [x] Structured JSON audit logs for every modifying op (per PRD table)
- [ ] Production `Dockerfile` in `src/infra/`
- [ ] README dev-setup section verified end-to-end
- [ ] `LICENSE` (MIT) at repo root
- [ ] Isolate test database from local dev database (see below)

#### Isolate test database from local dev database

**Problem.** Running the test suite (e.g. `vitest run src/publish`) against `DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy` wipes the local development database. `apps/tntfy/test/setup.ts` runs `TRUNCATE users, topics, topic_tokens, topic_messages RESTART IDENTITY CASCADE` in `beforeEach`, and `apps/tntfy/test/db.ts` falls back to `DATABASE_URL` when `TEST_DATABASE_URL` is not set, so a developer who has only `DATABASE_URL` exported loses their dev data on every test run.

**Context.** Single Postgres instance at `localhost:6432` (via `src/infra/docker-compose.yml`), one logical DB `tntfy` shared by app and tests. There is no safeguard against pointing tests at it.

**Proposed solution.**
1. Create a separate logical database `tntfy_test` on the same Postgres container. One-time bootstrap for the existing volume:
   ```
   docker exec -i tntfy-postgres psql -U tntfy -d postgres -c "CREATE DATABASE tntfy_test OWNER tntfy;"
   ```
2. Add `src/infra/init/01-create-test-db.sql` (`CREATE DATABASE tntfy_test OWNER tntfy;`) and mount it at `/docker-entrypoint-initdb.d` in `docker-compose.yml` so fresh volumes get the test DB automatically.
3. Add a guard in `apps/tntfy/test/db.ts` that parses the connection URL and throws if the database name does not end in `_test` — making it impossible to wipe dev data even with a misconfigured env.
4. Drop a `.env.test` (or `.env.test.example`) in `apps/tntfy/` with `TEST_DATABASE_URL=postgres://tntfy:tntfy@localhost:6432/tntfy_test`, loaded by vitest so devs don't have to pass it on the command line.
5. Update CLAUDE.md and README dev-setup to document the dev/test DB split.

## Next up (post-v1)

Items below are **not** in v1 — captured here so they don't get lost.

- Web dashboard for users who prefer GUI to slash commands
- Multi-subscriber topics: `/link <topic>` to forward a topic to a group/channel
- Per-token rate limits (likely the first need once v1 sees real traffic)
- Server-side retry policy for transient Telegram failures
- Message retention controls (TTL or row-cap per topic)

## Later

- Helm chart and a production `docker-compose.prod.yml` for self-hosters
- Public landing page in `apps/landing/`
- Telegram mini-app (TWA) in `apps/web/`
- Rich payloads: tags, click actions, priorities, attachments-as-attachments
- Multi-tenant SaaS posture (sign-up, billing, hosted offering)
