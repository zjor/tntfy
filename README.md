# tntfy

> Curl-to-Telegram notification service. Per-topic bearer tokens, text & file payloads, self-hostable.

`tntfy` is a small, open-source notification service: any app, script, or device sends an HTTP request, and the message arrives in your Telegram DM. Inspired by [ntfy.sh](https://ntfy.sh), spiritual successor to `mqtt2telegram`.

```bash
curl -H "Authorization: Bearer tk_..." \
     -d "Backup successful" \
     https://tntfy.example.com/v1/publish/deploys
```

## Status

Early development. v1 scope is documented in [`docs/project/prd.md`](docs/project/prd.md); see [`docs/process/roadmap.md`](docs/process/roadmap.md) for what is being built and in what order. Phase 1 (data layer + health endpoint) is in place; bot and publish API are next.

## How it works

- The Telegram bot is the control plane. You run `/start` to register, then manage topics with `/create`, `/list`, `/rotate`, and `/remove`.
- Each topic gets its own bearer token. The `/create` reply includes copy-paste-ready `curl` and Python snippets.
- The HTTP publish endpoint accepts plain text, Markdown, HTML, images, and arbitrary files. Each request returns the Telegram message id.
- Single NestJS process: HTTP API + bot + workers in one deployable.

## Guides

- [Publishing messages](docs/guides/publishing.md) — `curl` recipes for every supported content type, plus headers, limits, and error codes.

## Stack

- TypeScript, NestJS
- [grammY](https://grammy.dev) via `@grammyjs/nestjs`
- Postgres + [Kysely](https://kysely.dev)
- pnpm + Turborepo (`src/tntfy/`)

## Repository layout

```
tntfy/
├── docs/        # PRD, roadmap, guides, ops content
├── src/
│   ├── tntfy/   # turborepo: apps/tntfy/, packages/
│   ├── infra/   # Dockerfile, docker-compose for local Postgres
│   └── tools/   # poly-language utilities (empty for now)
└── ...
```

The `docs/` ↔ `src/` split is "anything that reads" vs. "anything that runs." See [`docs/project/prd.md`](docs/project/prd.md) for details.

## Development

Requires Node.js 20+, pnpm 10+, and Docker.

```bash
# 1. Start local Postgres (host port 6432 → container 5432)
cd src/infra && docker compose up -d

# 2. Install workspace dependencies
cd ../tntfy && pnpm install

# 3. Configure the app
cd apps/tntfy
cp .env.example .env

# 4. Run migrations
pnpm migrate

# 5. Run the app
pnpm dev
```

Smoke test the health endpoint:

```bash
curl http://localhost:3000/v1/health
# {"status":"ok"}
```

## License

[MIT](LICENSE)
