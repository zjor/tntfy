#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../../tntfy/apps/tntfy/.env.local"

IMAGE=tntfy
PORT=3000
DOCKER_DATABASE_URL="postgres://tntfy:tntfy@host.docker.internal:6432/tntfy"
set -x

docker run --rm \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL="$DOCKER_DATABASE_URL" \
  --add-host=host.docker.internal:host-gateway \
  -p ${PORT}:${PORT} ${IMAGE}
