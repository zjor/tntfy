#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT="$SCRIPT_DIR/../../../tntfy"

DOCKER_USER=zjor
IMAGE=tntfy
VERSION=$(git rev-parse --short HEAD)
set -x

docker buildx build --platform linux/amd64 -t ${IMAGE} "$CONTEXT"
docker tag ${IMAGE} ${DOCKER_USER}/${IMAGE}:"${VERSION}"
docker push ${DOCKER_USER}/${IMAGE}:"${VERSION}"
