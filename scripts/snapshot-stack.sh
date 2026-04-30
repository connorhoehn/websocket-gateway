#!/usr/bin/env bash
# Phase 51 / hub#53 — manage the local Dynamo + Redis containers used by
# the snapshot capture run.
#
# Usage:
#   scripts/snapshot-stack.sh up      # start ddb + redis (idempotent)
#   scripts/snapshot-stack.sh down    # stop + remove the containers
#   scripts/snapshot-stack.sh status  # print state
#
# Containers:
#   gateway-snapshot-ddb    amazon/dynamodb-local:latest         :8000
#   gateway-snapshot-redis  redis:7-alpine                       :6379

set -euo pipefail

DDB_NAME="gateway-snapshot-ddb"
REDIS_NAME="gateway-snapshot-redis"
DDB_IMAGE="amazon/dynamodb-local:latest"
REDIS_IMAGE="redis:7-alpine"
DDB_PORT=8000
REDIS_PORT=6379

# Detect whether a container with the given name is currently running.
is_running() {
  local name="$1"
  [[ "$(docker ps --filter "name=^${name}$" --format '{{.Names}}' 2>/dev/null)" == "$name" ]]
}

# Detect whether a container with the given name exists (running or stopped).
exists() {
  local name="$1"
  [[ -n "$(docker ps -a --filter "name=^${name}$" --format '{{.Names}}' 2>/dev/null)" ]]
}

up() {
  if is_running "$DDB_NAME"; then
    echo "[snapshot-stack] ${DDB_NAME} already running"
  elif exists "$DDB_NAME"; then
    echo "[snapshot-stack] starting existing ${DDB_NAME}"
    docker start "$DDB_NAME" >/dev/null
  else
    echo "[snapshot-stack] creating ${DDB_NAME} from ${DDB_IMAGE} on :${DDB_PORT}"
    docker run -d --name "$DDB_NAME" \
      -p "${DDB_PORT}:8000" \
      "$DDB_IMAGE" \
      -jar DynamoDBLocal.jar -sharedDb -inMemory >/dev/null
  fi

  if is_running "$REDIS_NAME"; then
    echo "[snapshot-stack] ${REDIS_NAME} already running"
  elif exists "$REDIS_NAME"; then
    echo "[snapshot-stack] starting existing ${REDIS_NAME}"
    docker start "$REDIS_NAME" >/dev/null
  else
    echo "[snapshot-stack] creating ${REDIS_NAME} from ${REDIS_IMAGE} on :${REDIS_PORT}"
    docker run -d --name "$REDIS_NAME" \
      -p "${REDIS_PORT}:6379" \
      "$REDIS_IMAGE" >/dev/null
  fi

  echo "[snapshot-stack] up — ddb=$(is_running "$DDB_NAME" && echo yes || echo no), redis=$(is_running "$REDIS_NAME" && echo yes || echo no)"
}

down() {
  for name in "$DDB_NAME" "$REDIS_NAME"; do
    if is_running "$name"; then
      echo "[snapshot-stack] stopping ${name}"
      docker stop "$name" >/dev/null
    fi
    if exists "$name"; then
      echo "[snapshot-stack] removing ${name}"
      docker rm "$name" >/dev/null
    fi
  done
  echo "[snapshot-stack] down"
}

status() {
  echo "[snapshot-stack] ddb   running=$(is_running "$DDB_NAME" && echo yes || echo no)"
  echo "[snapshot-stack] redis running=$(is_running "$REDIS_NAME" && echo yes || echo no)"
}

cmd="${1:-status}"
case "$cmd" in
  up)     up ;;
  down)   down ;;
  status) status ;;
  *)      echo "usage: $0 {up|down|status}" ; exit 2 ;;
esac
