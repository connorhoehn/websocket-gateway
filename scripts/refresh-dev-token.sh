#!/usr/bin/env bash
# scripts/refresh-dev-token.sh
#
# Authenticates with Cognito using credentials from .env.real and writes
# a fresh JWT to frontend/.env. Run from the repo root.
#
# Usage:
#   ./scripts/refresh-dev-token.sh
#   npm run token  (from frontend/)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_REAL="$REPO_ROOT/.env.real"
FRONTEND_ENV="$REPO_ROOT/frontend/.env"
FRONTEND_ENV_EXAMPLE="$REPO_ROOT/frontend/.env.example"

# ── Prerequisites ────────────────────────────────────────────────────────────

if ! command -v aws &>/dev/null; then
  echo "Error: AWS CLI not found. Install it: https://aws.amazon.com/cli/"
  exit 1
fi

if [ ! -f "$ENV_REAL" ]; then
  echo "Error: $ENV_REAL not found."
  echo "Copy .env.real.example to .env.real and fill in your Cognito credentials."
  exit 1
fi

# ── Load credentials ─────────────────────────────────────────────────────────

# Source without polluting the shell — parse manually for safety
get_env() {
  grep -E "^$1=" "$ENV_REAL" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

COGNITO_REGION=$(get_env COGNITO_REGION)
COGNITO_USER_POOL_ID=$(get_env COGNITO_USER_POOL_ID)
COGNITO_CLIENT_ID=$(get_env COGNITO_CLIENT_ID)
TEST_USERNAME=$(get_env TEST_USERNAME)
TEST_PASSWORD=$(get_env TEST_PASSWORD)

missing=()
[ -z "$COGNITO_REGION" ]        && missing+=("COGNITO_REGION")
[ -z "$COGNITO_USER_POOL_ID" ]  && missing+=("COGNITO_USER_POOL_ID")
[ -z "$COGNITO_CLIENT_ID" ]     && missing+=("COGNITO_CLIENT_ID")
[ -z "$TEST_USERNAME" ]         && missing+=("TEST_USERNAME")
[ -z "$TEST_PASSWORD" ]         && missing+=("TEST_PASSWORD")

if [ ${#missing[@]} -gt 0 ]; then
  echo "Error: Missing values in .env.real: ${missing[*]}"
  exit 1
fi

# ── Authenticate ─────────────────────────────────────────────────────────────

echo "Authenticating with Cognito ($COGNITO_REGION / $COGNITO_USER_POOL_ID)..."

RESPONSE=$(aws cognito-idp initiate-auth \
  --region "$COGNITO_REGION" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$TEST_USERNAME,PASSWORD=$TEST_PASSWORD" \
  --client-id "$COGNITO_CLIENT_ID" \
  --output json 2>&1) || {
  echo "Authentication failed:"
  echo "$RESPONSE"
  exit 1
}

# Extract IdToken using node (already required for the frontend project)
ID_TOKEN=$(node -e "
  const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const t = r?.AuthenticationResult?.IdToken;
  if (!t) { process.stderr.write('No IdToken in response\n'); process.exit(1); }
  process.stdout.write(t);
" <<< "$RESPONSE") || {
  echo "Error: Could not extract IdToken. Full response:"
  echo "$RESPONSE"
  exit 1
}

# ── Write frontend/.env ───────────────────────────────────────────────────────

# Create from example if it doesn't exist yet
if [ ! -f "$FRONTEND_ENV" ]; then
  cp "$FRONTEND_ENV_EXAMPLE" "$FRONTEND_ENV"
  echo "Created frontend/.env from .env.example"
fi

# Update VITE_COGNITO_TOKEN in place, preserving all other vars
node -e "
  const fs = require('fs');
  const path = '$FRONTEND_ENV';
  const token = process.argv[1];
  let content = fs.readFileSync(path, 'utf8');
  if (/^VITE_COGNITO_TOKEN=/m.test(content)) {
    content = content.replace(/^VITE_COGNITO_TOKEN=.*/m, 'VITE_COGNITO_TOKEN=' + token);
  } else {
    content = content.trimEnd() + '\nVITE_COGNITO_TOKEN=' + token + '\n';
  }
  fs.writeFileSync(path, content);
" "$ID_TOKEN"

# Also set VITE_WS_URL to localhost if still empty
if grep -qE "^VITE_WS_URL=$" "$FRONTEND_ENV"; then
  node -e "
    const fs = require('fs');
    const path = '$FRONTEND_ENV';
    let content = fs.readFileSync(path, 'utf8');
    content = content.replace(/^VITE_WS_URL=$/m, 'VITE_WS_URL=ws://localhost:8080');
    fs.writeFileSync(path, content);
  "
  echo "Set VITE_WS_URL=ws://localhost:8080 (edit frontend/.env to change)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

# Decode expiry from JWT payload (base64url middle segment)
EXPIRY=$(node -e "
  const token = process.argv[1];
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const exp = new Date(payload.exp * 1000);
  process.stdout.write(exp.toLocaleTimeString());
" "$ID_TOKEN" 2>/dev/null || echo "unknown")

echo ""
echo "✓ Token written to frontend/.env"
echo "  Expires at: $EXPIRY (Cognito ID tokens last ~1 hour)"
echo ""
echo "Next: cd frontend && npm run dev"
