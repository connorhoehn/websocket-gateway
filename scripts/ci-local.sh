#!/usr/bin/env bash
set -euo pipefail

echo "=== Frontend: typecheck ==="
(cd frontend && npm ci && npx tsc --noEmit)

echo "=== Social API: typecheck ==="
(cd social-api && npm ci && npx tsc --noEmit)

echo "=== Gateway: syntax check ==="
npm ci && node --check src/server.js

echo "=== Docker: gateway build ==="
docker build -t gateway:test .

echo "=== Docker: social-api build ==="
docker build -t social-api:test social-api/

echo "✅ All CI checks passed"
