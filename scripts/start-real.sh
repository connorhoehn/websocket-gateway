#!/usr/bin/env bash
# start-real.sh — Run WebSocket gateway with real AWS Cognito auth
#
# Usage:
#   ./scripts/start-real.sh            # start server only (uses existing JWT in .env.real)
#   ./scripts/start-real.sh --token    # also fetch a fresh JWT and print wscat command
#
# Setup: copy .env.real.example to .env.real and fill in your values

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.real"

# ─── Load env file ─────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  Missing .env.real — copy .env.real.example and fill in your values:"
  echo "    cp .env.real.example .env.real"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# ─── Validate required vars ────────────────────────────────────────────────────

missing=()
[[ -z "$COGNITO_REGION" ]]      && missing+=("COGNITO_REGION")
[[ -z "$COGNITO_USER_POOL_ID" ]] && missing+=("COGNITO_USER_POOL_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "❌  Missing required env vars in .env.real: ${missing[*]}"
  exit 1
fi

# ─── Ensure local Redis is running ─────────────────────────────────────────────

if ! redis-cli -h "${REDIS_ENDPOINT:-localhost}" -p "${REDIS_PORT:-6379}" ping &>/dev/null; then
  echo "🔄  Local Redis not running — starting via docker compose..."
  docker compose -f "$ROOT_DIR/docker-compose.local.yml" up -d redis
  sleep 2
fi

echo "✅  Redis ready at ${REDIS_ENDPOINT:-localhost}:${REDIS_PORT:-6379}"

# ─── Optionally fetch a fresh JWT ──────────────────────────────────────────────

JWT=""

if [[ "$1" == "--token" ]]; then
  if [[ -z "$COGNITO_CLIENT_ID" || -z "$TEST_USERNAME" || -z "$TEST_PASSWORD" ]]; then
    echo "⚠️   --token requires COGNITO_CLIENT_ID, TEST_USERNAME, TEST_PASSWORD in .env.real"
    echo "    Skipping token fetch — start server and get a token manually."
  else
    echo "🔑  Fetching JWT from Cognito..."
    JWT=$(aws cognito-idp initiate-auth \
      --region "$COGNITO_REGION" \
      --auth-flow USER_PASSWORD_AUTH \
      --client-id "$COGNITO_CLIENT_ID" \
      --auth-parameters "USERNAME=$TEST_USERNAME,PASSWORD=$TEST_PASSWORD" \
      --query 'AuthenticationResult.IdToken' \
      --output text 2>/dev/null) || true

    if [[ -z "$JWT" || "$JWT" == "None" ]]; then
      echo "⚠️   Could not fetch token (check credentials / client ID). Continuing without."
      JWT=""
    else
      echo "✅  JWT obtained (expires ~1hr)"
    fi
  fi
fi

# ─── Print connection info ──────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " WebSocket Gateway — Real Auth Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Cognito pool : $COGNITO_USER_POOL_ID ($COGNITO_REGION)"
echo " Redis        : ${REDIS_ENDPOINT:-localhost}:${REDIS_PORT:-6379}"
echo " Server       : http://localhost:${PORT:-8080}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -n "$JWT" ]]; then
  echo ""
  echo "Connect with:"
  echo "  wscat -c \"ws://localhost:${PORT:-8080}?token=$JWT\""
  echo ""
  echo "Or send a message:"
  echo "  wscat -c \"ws://localhost:${PORT:-8080}?token=$JWT\" -x '{\"service\":\"chat\",\"action\":\"send\",\"channel\":\"public:test\",\"data\":{\"text\":\"hello\"}}'"
else
  echo ""
  echo "To get a token and connect (run in a new terminal):"
  echo "  TOKEN=\$(aws cognito-idp initiate-auth \\"
  echo "    --region $COGNITO_REGION \\"
  echo "    --auth-flow USER_PASSWORD_AUTH \\"
  echo "    --client-id $COGNITO_CLIENT_ID \\"
  echo "    --auth-parameters USERNAME=$TEST_USERNAME,PASSWORD=$TEST_PASSWORD \\"
  echo "    --query 'AuthenticationResult.IdToken' --output text)"
  echo "  wscat -c \"ws://localhost:${PORT:-8080}?token=\$TOKEN\""
fi

echo ""
echo "Starting server... (Ctrl+C to stop)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Start server ──────────────────────────────────────────────────────────────

export REDIS_URL="redis://${REDIS_ENDPOINT:-localhost}:${REDIS_PORT:-6379}"
export NODE_ENV="${NODE_ENV:-development}"
export LOG_LEVEL="${LOG_LEVEL:-debug}"
export ENABLED_SERVICES="${ENABLED_SERVICES:-chat,presence,cursor,reaction}"
export PORT="${PORT:-8080}"

cd "$ROOT_DIR/src"
node server.js
