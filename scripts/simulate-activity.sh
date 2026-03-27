#!/usr/bin/env bash
# Runs the random activity simulation against LocalStack social-api.
# Usage: ./scripts/simulate-activity.sh --users 5 --duration 60
#
# Prerequisites:
#   - docker compose up (LocalStack, social-api, gateway)
#   - .env.real with Cognito credentials
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npx tsx --tsconfig "$REPO_ROOT/scripts/tsconfig.scripts.json" "$REPO_ROOT/scripts/simulate-activity.ts" "$@"
