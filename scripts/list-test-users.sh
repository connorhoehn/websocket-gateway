#!/usr/bin/env bash
# scripts/list-test-users.sh
# Lists all users in the Cognito user pool as a formatted table.
# Reads pool config from .env.real.
#
# Usage:
#   ./scripts/list-test-users.sh

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

# ── Fetch and format ──────────────────────────────────────────────────────────

echo "Users in pool $COGNITO_USER_POOL_ID ($COGNITO_REGION):"
echo ""

RESPONSE=$(aws cognito-idp list-users \
  --region "$COGNITO_REGION" \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --output json 2>&1) || {
  echo "Error listing users:"
  echo "$RESPONSE"
  exit 1
}

# Format as table using node (already required by the project)
node -e "
  const users = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).Users || [];
  if (users.length === 0) { console.log('No users found.'); process.exit(0); }

  const getAttr = (u, name) => (u.Attributes || []).find(a => a.Name === name)?.Value ?? '';

  // Build rows
  const rows = users.map(u => ({
    email: getAttr(u, 'email') || u.Username,
    status: u.UserStatus || '',
    created: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString().slice(0,10) : '',
    name: getAttr(u, 'given_name'),
  }));

  const cols = ['Email', 'Status', 'Created', 'given_name'];
  const widths = [
    Math.max(5, ...rows.map(r => r.email.length)),
    Math.max(6, ...rows.map(r => r.status.length)),
    Math.max(7, ...rows.map(r => r.created.length)),
    Math.max(10, ...rows.map(r => r.name.length)),
  ];

  const fmt = (vals) => vals.map((v,i) => v.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('  ');

  console.log(fmt(cols));
  console.log(sep);
  rows.forEach(r => console.log(fmt([r.email, r.status, r.created, r.name])));
  console.log('');
  console.log('Total: ' + users.length + ' user(s)');
" <<< "$RESPONSE"
