#!/usr/bin/env bash
# scripts/create-test-user.sh
# Creates a Cognito test user with a confirmed (non-temporary) password.
# Reads pool config from .env.real. Uses admin API — no email verification required.
#
# Usage:
#   ./scripts/create-test-user.sh user@example.com TempPass1! [--name "First Last"]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_REAL="$REPO_ROOT/.env.real"

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

# ── Argument parsing ─────────────────────────────────────────────────────────

if [ $# -lt 2 ]; then
  echo "Usage: $(basename "$0") EMAIL PASSWORD [--name \"First Last\"]"
  echo ""
  echo "  EMAIL     Cognito username (email address)"
  echo "  PASSWORD  Permanent password for the user"
  echo "  --name    Optional: set given_name attribute"
  echo ""
  echo "Example:"
  echo "  ./scripts/create-test-user.sh alice@example.com MyPass1! --name \"Alice Smith\""
  exit 1
fi

EMAIL="$1"
PASSWORD="$2"
GIVEN_NAME=""

# Parse remaining args for --name flag
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --name)
      if [ $# -lt 2 ]; then
        echo "Error: --name requires a value"
        exit 1
      fi
      GIVEN_NAME="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ── Load env ──────────────────────────────────────────────────────────────────

# Source without polluting the shell — parse manually for safety
get_env() {
  grep -E "^$1=" "$ENV_REAL" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

COGNITO_REGION=$(get_env COGNITO_REGION)
COGNITO_USER_POOL_ID=$(get_env COGNITO_USER_POOL_ID)

missing=()
[ -z "$COGNITO_REGION" ]       && missing+=("COGNITO_REGION")
[ -z "$COGNITO_USER_POOL_ID" ] && missing+=("COGNITO_USER_POOL_ID")

if [ ${#missing[@]} -gt 0 ]; then
  echo "Error: Missing values in .env.real: ${missing[*]}"
  exit 1
fi

# ── Create user ───────────────────────────────────────────────────────────────

echo "Creating user $EMAIL in pool $COGNITO_USER_POOL_ID..."

CREATE_OUT=$(aws cognito-idp admin-create-user \
  --region "$COGNITO_REGION" \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$EMAIL" \
  --temporary-password "$PASSWORD" \
  --message-action SUPPRESS \
  --output json 2>&1) || {
  echo "Error creating user:"
  echo "$CREATE_OUT"
  exit 1
}

echo "Setting permanent password..."

PASS_OUT=$(aws cognito-idp admin-set-user-password \
  --region "$COGNITO_REGION" \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent \
  --output json 2>&1) || {
  echo "Error setting permanent password:"
  echo "$PASS_OUT"
  exit 1
}

if [ -n "$GIVEN_NAME" ]; then
  echo "Setting given_name to '$GIVEN_NAME'..."

  ATTR_OUT=$(aws cognito-idp admin-update-user-attributes \
    --region "$COGNITO_REGION" \
    --user-pool-id "$COGNITO_USER_POOL_ID" \
    --username "$EMAIL" \
    --user-attributes "Name=given_name,Value=$GIVEN_NAME" \
    --output json 2>&1) || {
    echo "Error setting given_name attribute:"
    echo "$ATTR_OUT"
    exit 1
  }
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "User created successfully:"
echo "  Email    : $EMAIL"
echo "  Status   : CONFIRMED"
[ -n "$GIVEN_NAME" ] && echo "  Name     : $GIVEN_NAME"
echo ""
echo "Sign in at the app or test with:"
echo "  ./scripts/refresh-dev-token.sh  (update .env.real TEST_USERNAME/TEST_PASSWORD first)"
