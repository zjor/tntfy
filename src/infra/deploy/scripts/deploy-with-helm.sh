#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART="$SCRIPT_DIR/../chart"

NS=app-tntfy
APP=tntfy
VERSION=$(git rev-parse --short HEAD)

set -x

helm upgrade --namespace ${NS} --create-namespace --install ${APP} --set image.tag="${VERSION}" "$CHART"
