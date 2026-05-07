# tntfy — project memory

`tntfy` is a curl-to-Telegram notification service. HTTP publish in, Telegram message out. Bot is the control plane.

## Source of truth

- **PRD (v1 scope, full design):** [docs/project/prd.md](docs/project/prd.md)
- **Architecture (modules, ERD, flows):** [docs/project/architecture.md](docs/project/architecture.md)
- **Roadmap (phased build):** [docs/process/roadmap.md](docs/process/roadmap.md)

Read the PRD before changing anything structural. The roadmap is the working checklist.

## Stack

- TypeScript, NestJS (single process: HTTP API + Telegram bot + workers)
- [grammY](https://grammy.dev) via `@grammyjs/nestjs` — long-polling for v1
- Postgres + [Kysely](https://kysely.dev) (typed SQL builder; built-in migrations)
- pnpm + Turborepo, generated via `pnpm dlx create-turbo@latest` into `src/tntfy/`
- License: MIT

## Conventions

- All primary keys are `nanoid` (21 chars). Generated in app code, stored as `text`.
- All timestamps are `timestamptz`.
- Topics and tokens are **hard-deleted** (FK cascade); `users.deleted_at` exists but is unused in v1.
- Token format: `tk_<24 url-safe chars>`, raw value stored (no hash).
- Tokens, message bodies, and binary payload contents are **never** logged.
- Every state-changing operation emits a structured JSON audit log line — see PRD "Audit logging" table.
- Topic name regex: `^[a-z0-9][a-z0-9-_]{1,63}$`.
- `kebab-case` for filenames; NestJS module/file naming follows its own convention.

## Repo layout

```
docs/   # project/prd.md, process/roadmap.md, ops/ (placeholder)
src/
  tntfy/   # turborepo: apps/tntfy/, packages/
  infra/   # Dockerfile, docker-compose.yml (local Postgres)
  tools/   # poly-language utilities (empty for now)
```

`docs/` = anything that reads, `src/` = anything that runs.

## Workflow

- **No git worktrees.** Use ordinary feature branches (`git checkout -b <name>`) for development. Do not run `git worktree add`, the `EnterWorktree` tool, or any worktree-creating skill (`superpowers:using-git-worktrees`).
- The local Postgres (`src/infra/docker-compose.yml`) maps to host port **6432**, not 5432. Tests/dev use `postgres://tntfy:tntfy@localhost:6432/tntfy`.

## Status

Phase 1 done — turborepo at `src/tntfy/`, NestJS app at `apps/tntfy/`, Kysely wired, four PRD tables migrated, `GET /v1/health` returns `{"status":"ok"}`.

Phase 2 done — merged to master. Bot control plane (long-polling) with all 6 commands, audit logging, 60 tests. Spec: [docs/project/specs/2026-05-07-phase-2-telegram-bot.md](docs/project/specs/2026-05-07-phase-2-telegram-bot.md). Plan: [docs/project/plans/2026-05-07-phase-2-telegram-bot.md](docs/project/plans/2026-05-07-phase-2-telegram-bot.md).

Phase 3 (publish API) is next. Spec: [docs/project/specs/2026-05-07-phase-3-publish-api.md](docs/project/specs/2026-05-07-phase-3-publish-api.md).
