# tntfy — Deployment

Kubernetes deployment via Docker + Helm. All scripts are self-contained and can be run from any directory.

## Prerequisites

- Docker with `buildx`
- `kubectl` configured against the target cluster
- `helm` 3.x
- cert-manager + NGINX ingress controller on the cluster
- DNS record for `api.tntfy.royz.cc` pointing to the cluster ingress

## File structure

```
src/
├── tntfy/
│   ├── Dockerfile          # multi-stage build (Node 22 Alpine + pnpm + Turbo)
│   └── .dockerignore
└── infra/
    └── deploy/
        ├── chart/          # Helm chart
        │   ├── Chart.yaml
        │   ├── values.yaml
        │   └── templates/
        │       ├── deployment.yaml
        │       ├── service.yaml
        │       └── ingress.yaml
        └── scripts/
            ├── docker-build-and-push.sh
            ├── create-secrets.sh
            ├── deploy-with-helm.sh
            └── run-local-docker.sh
```

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `PORT` | `values.yaml` | Defaults to `3000` |
| `DATABASE_URL` | K8s secret | Postgres connection string |
| `TELEGRAM_BOT_TOKEN` | K8s secret | From BotFather |
| `PUBLIC_BASE_URL` | K8s secret | Public HTTPS base URL of the service |

## Deploy steps

### 1. Build and push the image

```bash
./src/infra/deploy/scripts/docker-build-and-push.sh
```

Tags the image with the current git SHA and pushes to `zjor/tntfy:<sha>`.

### 2. Create Kubernetes secrets

Create `src/.env` with production values (never commit it):

```bash
DATABASE_URL=postgres://...
TELEGRAM_BOT_TOKEN=...
PUBLIC_BASE_URL=https://api.tntfy.royz.cc
```

Then:

```bash
./src/infra/deploy/scripts/create-secrets.sh
```

Creates (or replaces) the `tntfy-secrets` secret in namespace `app-tntfy`.

### 3. Deploy with Helm

```bash
./src/infra/deploy/scripts/deploy-with-helm.sh
```

Runs `helm upgrade --install` using the current git SHA as the image tag.

## Run locally with Docker

First build the image without pushing:

```bash
docker buildx build -t tntfy src/tntfy
```

Then run it using your local env file:

```bash
./src/infra/deploy/scripts/run-local-docker.sh
```

Uses `src/tntfy/apps/tntfy/.env.local`. The app will be available at `http://localhost:3000`.
