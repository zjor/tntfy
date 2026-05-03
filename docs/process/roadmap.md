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

- [ ] Generate Turborepo via `pnpm dlx create-turbo@latest` into `src/tntfy/`
- [ ] Trim example apps; create `apps/tntfy/` (NestJS)
- [ ] Add `src/infra/docker-compose.yml` for local Postgres
- [ ] Wire Kysely as a NestJS provider; configure `DATABASE_URL`
- [ ] Migrations: `users`, `topics`, `topic_tokens`, `topic_messages` (+ indexes)
- [ ] `GET /v1/health` returns `200 { "status": "ok" }`

### Phase 2 — Telegram bot (control plane)

- [ ] Install `grammy` and `@grammyjs/nestjs`; wire long-polling
- [ ] `/start` — create-or-get user
- [ ] `/help` — list commands
- [ ] `/topic-create <name>` — validate, persist topic + token, reply with curl & Python snippets (token in `<tg-spoiler>`)
- [ ] `/topic-list` — list user's topics
- [ ] `/topic-new-token <name>` — rotate (hard-delete old, insert new)
- [ ] `/topic-remove <name>` — inline-keyboard confirmation, then cascade hard-delete

### Phase 3 — Publish API

- [ ] `POST /v1/publish/:topic` route + DTOs
- [ ] Auth guard: bearer → topic lookup → path topic must match (`401` / `404`)
- [ ] Content-Type dispatcher: `text/plain` / `text/markdown` / `text/html` → `sendMessage` with appropriate `parse_mode`
- [ ] Binary dispatcher: `image/*` → `sendPhoto`, others → `sendDocument`
- [ ] Size limits: text 4096, photo 10 MB, document 50 MB → `413`
- [ ] Persist `topic_messages` row on success and failure
- [ ] Map Telegram errors to `502 telegram_blocked` / `telegram_throttled` / `telegram_failed`

### Phase 4 — Polish

- [ ] `@nestjs/swagger` mounted at `/docs`
- [ ] Structured JSON audit logs for every modifying op (per PRD table)
- [ ] Production `Dockerfile` in `src/infra/`
- [ ] README dev-setup section verified end-to-end
- [ ] `LICENSE` (MIT) at repo root

## Next up (post-v1)

Items below are **not** in v1 — captured here so they don't get lost.

- Web dashboard for users who prefer GUI to slash commands
- Multi-subscriber topics: `/link <topic>` to forward a topic to a group/channel
- Per-token rate limits (likely the first need once v1 sees real traffic)
- Webhook bot transport with HTTPS termination, behind a config flag
- Server-side retry policy for transient Telegram failures
- Message retention controls (TTL or row-cap per topic)

## Later

- Helm chart and a production `docker-compose.prod.yml` for self-hosters
- Public landing page in `apps/landing/`
- Telegram mini-app (TWA) in `apps/web/`
- Rich payloads: tags, click actions, priorities, attachments-as-attachments
- Multi-tenant SaaS posture (sign-up, billing, hosted offering)
