#!/usr/bin/env bash
# Seeds a deterministic demo scenario: 3 friends, 2 rooms, conversations with reactions.
# Usage: ./scripts/create-scenario.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npx tsx --tsconfig "$REPO_ROOT/scripts/tsconfig.scripts.json" "$REPO_ROOT/scripts/create-scenario.ts" "$@"
