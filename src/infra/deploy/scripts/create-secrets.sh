#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../../.env"

NS=app-tntfy
APP=tntfy

kubectl delete secret ${APP}-secrets -n ${NS} --ignore-not-found

kubectl create secret generic ${APP}-secrets \
  --from-env-file="$ENV_FILE" \
  -n ${NS}

kubectl rollout restart deployment/${APP} -n ${NS}
