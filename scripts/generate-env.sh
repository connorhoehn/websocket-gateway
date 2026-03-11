#!/usr/bin/env bash
# generate-env.sh — Discover provisioned AWS resources, create a test user, write .env.real
#
# Usage:
#   ./scripts/generate-env.sh                        # auto-discover everything
#   ./scripts/generate-env.sh --stack MyStackName    # use specific CF stack for Redis/URL
#   ./scripts/generate-env.sh --pool us-east-1_XXXX  # use specific Cognito pool

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.real"
STACK_NAME="WebsockerGatewayStack"
POOL_ID=""
TEST_USERNAME="wsgateway-test@local.dev"

# ─── Parse args ──────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --stack) STACK_NAME="$2"; shift 2 ;;
    --pool)  POOL_ID="$2";    shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Generating .env.real from AWS resources"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

# ─── Query CloudFormation stack (if deployed) ─────────────────────────────────

REDIS_ENDPOINT="localhost"
REDIS_PORT="6379"
WS_URL=""

echo "🔍  Checking CloudFormation stack: $STACK_NAME"

STACK_OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output json 2>/dev/null || echo "[]")

STACK_DEPLOYED=false

if [[ "$STACK_OUTPUTS" != "[]" && -n "$STACK_OUTPUTS" ]]; then
  echo "✅  Stack found — reading outputs"
  STACK_DEPLOYED=true

  get_output() {
    echo "$STACK_OUTPUTS" | python3 -c \
      "import json,sys; outputs=json.load(sys.stdin); print(next((o['OutputValue'] for o in outputs if o['OutputKey']=='$1'), ''))"
  }

  REDIS_RAW=$(get_output "RedisEndpoint")
  if [[ -n "$REDIS_RAW" ]]; then
    REDIS_ENDPOINT=$(echo "$REDIS_RAW" | cut -d: -f1)
    REDIS_PORT=$(echo "$REDIS_RAW" | cut -d: -f2)
    echo "   Redis   : $REDIS_ENDPOINT:$REDIS_PORT"
  else
    echo "   Redis   : not in stack — using local (localhost:6379)"
  fi

  WS_URL=$(get_output "WebSocketURL")
  [[ -n "$WS_URL" ]] && echo "   WS URL  : $WS_URL"

  # Read Cognito resources from stack outputs
  POOL_ID_FROM_STACK=$(get_output "CognitoUserPoolId")
  CLIENT_ID_FROM_STACK=$(get_output "CognitoClientId")
else
  echo "   Stack not deployed — using local Redis (localhost:6379)"
fi

# ─── Resolve Cognito user pool ────────────────────────────────────────────────

echo ""
echo "🔍  Resolving Cognito user pool..."

if [[ -n "$POOL_ID_FROM_STACK" && -n "$CLIENT_ID_FROM_STACK" ]]; then
  # Stack is deployed — use outputs directly, no discovery needed
  POOL_ID="$POOL_ID_FROM_STACK"
  CLIENT_ID="$CLIENT_ID_FROM_STACK"
  echo "   Pool    : $POOL_ID (from stack outputs)"
  echo "   Client  : $CLIENT_ID (from stack outputs)"
else
  # Stack not deployed or pre-CDK pool — fall back to discovery
  if [[ -z "$POOL_ID" ]]; then
    POOL_JSON=$(aws cognito-idp list-user-pools --max-results 20 \
      --query 'UserPools[*].{Id:Id,Name:Name,LastModifiedDate:LastModifiedDate}' \
      --output json 2>/dev/null)

    POOL_ID=$(echo "$POOL_JSON" | python3 -c "
import json, sys
pools = json.load(sys.stdin)
pools.sort(key=lambda x: x.get('LastModifiedDate', ''), reverse=True)
print(pools[0]['Id']) if pools else print('')
")
    POOL_NAME=$(echo "$POOL_JSON" | python3 -c "
import json, sys
pools = json.load(sys.stdin)
pools.sort(key=lambda x: x.get('LastModifiedDate', ''), reverse=True)
print(pools[0]['Name']) if pools else print('')
")
  fi

  if [[ -z "$POOL_ID" ]]; then
    echo "❌  No Cognito user pools found."
    echo "   Run 'make cdk-deploy' to deploy the stack (creates pool + client automatically)."
    exit 1
  fi

  echo "   Pool    : $POOL_ID ($POOL_NAME)"

  CLIENT_JSON=$(aws cognito-idp list-user-pool-clients \
    --user-pool-id "$POOL_ID" \
    --query 'UserPoolClients[0].{Id:ClientId,Name:ClientName}' \
    --output json 2>/dev/null)

  CLIENT_ID=$(echo "$CLIENT_JSON" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('Id','') if c else '')")
  CLIENT_NAME=$(echo "$CLIENT_JSON" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('Name','') if c else '')")

  if [[ -z "$CLIENT_ID" ]]; then
    echo "❌  No app clients found in pool $POOL_ID"
    echo "   Run 'make cdk-deploy' to deploy the stack (creates the app client automatically)."
    exit 1
  fi

  echo "   Client  : $CLIENT_ID ($CLIENT_NAME)"
fi

echo "   Client  : $CLIENT_ID ($CLIENT_NAME)"

# ─── Generate password meeting Cognito requirements ──────────────────────────
# Requirements: min 8 chars, uppercase, lowercase, number, special char

TEST_PASSWORD=$(python3 -c "
import secrets, string
upper  = secrets.choice(string.ascii_uppercase)
lower  = secrets.choice(string.ascii_lowercase)
digit  = secrets.choice(string.digits)
special = secrets.choice('!@#\$%^&*')
rest   = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12))
pwd    = list(upper + lower + digit + special + rest)
secrets.SystemRandom().shuffle(pwd)
print(''.join(pwd))
")

# ─── Create / reset test user in Cognito ─────────────────────────────────────

echo ""
echo "👤  Provisioning test user: $TEST_USERNAME"

# Create user (suppress welcome email, force no verification needed)
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$TEST_USERNAME" \
  --temporary-password "$TEST_PASSWORD" \
  --message-action SUPPRESS \
  --output none 2>/dev/null || \
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$TEST_USERNAME" \
  --password "$TEST_PASSWORD" \
  --permanent \
  --output none 2>/dev/null || true

# Set permanent password (bypasses FORCE_CHANGE_PASSWORD state)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$TEST_USERNAME" \
  --password "$TEST_PASSWORD" \
  --permanent \
  --output none 2>/dev/null || true

echo "   ✅  User ready"

# ─── Write .env.real ──────────────────────────────────────────────────────────

cat > "$ENV_FILE" <<EOF
# Auto-generated by scripts/generate-env.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Re-run to refresh after infrastructure changes or to rotate test credentials.

# Cognito
COGNITO_REGION=$REGION
COGNITO_USER_POOL_ID=$POOL_ID
COGNITO_CLIENT_ID=$CLIENT_ID

# Test user (auto-provisioned in Cognito)
TEST_USERNAME=$TEST_USERNAME
TEST_PASSWORD=$TEST_PASSWORD

# Redis
REDIS_ENDPOINT=$REDIS_ENDPOINT
REDIS_PORT=$REDIS_PORT

# Server
PORT=8080
LOG_LEVEL=debug
ENABLED_SERVICES=chat,presence,cursor,reaction
NODE_ENV=development
EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  .env.real written with auto-generated credentials"
echo ""
echo "Start server + connect:  make dev-real"
[[ -n "$WS_URL" ]] && echo "Deployed WS endpoint:    $WS_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
