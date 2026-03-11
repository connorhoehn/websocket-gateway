#!/usr/bin/env bash
# validate-fargate.sh — Bare-minimum Fargate validation (no ALB, no VPC endpoints)
#
# Spin up ECR + task def + Fargate service in the default VPC with a public IP
# to confirm container config before a full CDK deployment.
#
# Usage:
#   ./scripts/validate-fargate.sh              # setup infra + build + deploy
#   ./scripts/validate-fargate.sh --no-build   # skip docker build (reuse local image)
#   ./scripts/validate-fargate.sh --redeploy   # push new image + force redeploy (infra already exists)
#   ./scripts/validate-fargate.sh --status     # show running tasks and recent events
#   ./scripts/validate-fargate.sh --logs       # tail CloudWatch logs
#   ./scripts/validate-fargate.sh --teardown   # delete all created resources

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

PREFIX="ws-validate"
ECR_REPO_NAME="$PREFIX"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
CLUSTER="${PREFIX}-cluster"
SERVICE="${PREFIX}-service"
TASK_FAMILY="$PREFIX"
LOG_GROUP="/ecs/${PREFIX}"
EXEC_ROLE_NAME="${PREFIX}-exec-role"
TASK_ROLE_NAME="${PREFIX}-task-role"
SG_NAME="${PREFIX}-sg"
IMAGE_NAME="websocket-gateway"

BUILD=true
MODE="setup"

for arg in "$@"; do
  case $arg in
    --no-build) BUILD=false ;;
    --redeploy) MODE=redeploy ;;
    --status)   MODE=status ;;
    --logs)     MODE=logs ;;
    --teardown) MODE=teardown ;;
  esac
done

sep() { echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }
info() { echo "   $*"; }

# ─── Auto-discover Cognito (server hard-exits without these) ──────────────────
# Priority: env vars → .env.real → CloudFormation outputs → list pools

resolve_cognito() {
  # 1. Already set
  if [[ -n "${COGNITO_USER_POOL_ID:-}" && -n "${COGNITO_REGION:-}" ]]; then
    return 0
  fi

  # 2. .env.real
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$(dirname "$SCRIPT_DIR")/.env.real"
  if [[ -f "$ENV_FILE" ]]; then
    set -a; source "$ENV_FILE"; set +a
    if [[ -n "${COGNITO_USER_POOL_ID:-}" && -n "${COGNITO_REGION:-}" ]]; then
      info "Cognito from .env.real: $COGNITO_USER_POOL_ID"
      return 0
    fi
  fi

  # 3. CloudFormation stack outputs
  STACK_OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "WebsockerGatewayStack" \
    --query 'Stacks[0].Outputs' \
    --output json 2>/dev/null || echo "[]")
  if [[ "$STACK_OUTPUTS" != "[]" && -n "$STACK_OUTPUTS" ]]; then
    COGNITO_USER_POOL_ID=$(echo "$STACK_OUTPUTS" | python3 -c \
      "import json,sys; o=json.load(sys.stdin); print(next((x['OutputValue'] for x in o if x['OutputKey']=='CognitoUserPoolId'), ''))")
    COGNITO_REGION="${AWS_REGION}"
    if [[ -n "$COGNITO_USER_POOL_ID" ]]; then
      info "Cognito from CloudFormation: $COGNITO_USER_POOL_ID"
      export COGNITO_USER_POOL_ID COGNITO_REGION
      return 0
    fi
  fi

  # 4. List pools — use most recently modified
  POOL_JSON=$(aws cognito-idp list-user-pools --max-results 20 \
    --query 'UserPools[*].{Id:Id,Name:Name,LastModifiedDate:LastModifiedDate}' \
    --output json 2>/dev/null || echo "[]")
  COGNITO_USER_POOL_ID=$(echo "$POOL_JSON" | python3 -c "
import json,sys
pools = json.load(sys.stdin)
pools.sort(key=lambda x: x.get('LastModifiedDate',''), reverse=True)
print(pools[0]['Id']) if pools else print('')
")
  if [[ -n "$COGNITO_USER_POOL_ID" ]]; then
    COGNITO_REGION="${AWS_REGION}"
    info "Cognito discovered: $COGNITO_USER_POOL_ID"
    export COGNITO_USER_POOL_ID COGNITO_REGION
    return 0
  fi

  echo "Error: no Cognito user pool found."
  echo "Run 'make cdk-deploy' or './scripts/generate-env.sh' first."
  exit 1
}

if [[ "$MODE" != "teardown" && "$MODE" != "status" && "$MODE" != "logs" ]]; then
  resolve_cognito
fi

# ─── Status ───────────────────────────────────────────────────────────────────

if [[ "$MODE" == "status" ]]; then
  sep; echo " Task status: $CLUSTER / $SERVICE"; sep
  aws ecs describe-services \
    --cluster "$CLUSTER" --services "$SERVICE" --region "$AWS_REGION" \
    --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount,Events:events[0:5]}' \
    --output json 2>/dev/null || echo "Service not found — run without --status to set up first."

  echo ""
  echo "Running tasks:"
  TASK_ARNS=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
    --region "$AWS_REGION" --query 'taskArns[]' --output text 2>/dev/null || echo "")
  if [[ -n "$TASK_ARNS" ]]; then
    # shellcheck disable=SC2086
    aws ecs describe-tasks --cluster "$CLUSTER" --tasks $TASK_ARNS --region "$AWS_REGION" \
      --query 'tasks[*].{Task:taskArn,Status:lastStatus,Health:healthStatus,Reason:stoppedReason,ExitCode:containers[0].exitCode}' \
      --output json 2>/dev/null
  else
    echo "   No running tasks."
    echo ""
    echo "Stopped tasks (most recent):"
    STOPPED=$(aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED \
      --region "$AWS_REGION" --query 'taskArns[0]' --output text 2>/dev/null || echo "")
    if [[ -n "$STOPPED" && "$STOPPED" != "None" ]]; then
      aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$STOPPED" --region "$AWS_REGION" \
        --query 'tasks[0].{Status:lastStatus,Reason:stoppedReason,ExitCode:containers[0].exitCode,StartedAt:startedAt,StoppedAt:stoppedAt}' \
        --output json 2>/dev/null
    fi
  fi
  exit 0
fi

# ─── Logs ─────────────────────────────────────────────────────────────────────

if [[ "$MODE" == "logs" ]]; then
  sep; echo " Tailing logs: $LOG_GROUP"; sep
  aws logs tail "$LOG_GROUP" --follow --region "$AWS_REGION"
  exit 0
fi

# ─── Teardown ─────────────────────────────────────────────────────────────────

if [[ "$MODE" == "teardown" ]]; then
  sep; echo " Teardown: deleting all ws-validate resources"; sep

  # Scale down and delete service first
  SERVICE_STATUS=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null || echo "")
  if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
    echo "Scaling service to 0..."
    aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
      --desired-count 0 --region "$AWS_REGION" > /dev/null
    echo "Waiting for tasks to stop..."
    aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
      --region "$AWS_REGION" 2>/dev/null || true
    echo "Deleting service..."
    aws ecs delete-service --cluster "$CLUSTER" --service "$SERVICE" \
      --region "$AWS_REGION" > /dev/null
    info "✓ Service deleted"
  fi

  # Deregister task definitions
  TASK_ARNS=$(aws ecs list-task-definitions --family-prefix "$TASK_FAMILY" \
    --region "$AWS_REGION" --query 'taskDefinitionArns[]' --output text 2>/dev/null || echo "")
  if [[ -n "$TASK_ARNS" ]]; then
    for arn in $TASK_ARNS; do
      aws ecs deregister-task-definition --task-definition "$arn" \
        --region "$AWS_REGION" > /dev/null
    done
    info "✓ Task definitions deregistered"
  fi

  # Delete cluster
  CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER" \
    --region "$AWS_REGION" --query 'clusters[0].status' --output text 2>/dev/null || echo "")
  if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
    aws ecs delete-cluster --cluster "$CLUSTER" --region "$AWS_REGION" > /dev/null
    info "✓ Cluster deleted"
  fi

  # Delete IAM roles
  for role in "$EXEC_ROLE_NAME" "$TASK_ROLE_NAME"; do
    if aws iam get-role --role-name "$role" > /dev/null 2>&1; then
      POLICIES=$(aws iam list-attached-role-policies --role-name "$role" \
        --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null || echo "")
      for policy in $POLICIES; do
        aws iam detach-role-policy --role-name "$role" --policy-arn "$policy"
      done
      INLINE=$(aws iam list-role-policies --role-name "$role" \
        --query 'PolicyNames[]' --output text 2>/dev/null || echo "")
      for p in $INLINE; do
        aws iam delete-role-policy --role-name "$role" --policy-name "$p"
      done
      aws iam delete-role --role-name "$role"
      info "✓ IAM role $role deleted"
    fi
  done

  # Delete log group
  LOG_EXISTS=$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
    --region "$AWS_REGION" --query 'logGroups[0].logGroupName' --output text 2>/dev/null || echo "")
  if [[ -n "$LOG_EXISTS" && "$LOG_EXISTS" != "None" ]]; then
    aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION"
    info "✓ Log group deleted"
  fi

  # Delete security group (may need a moment after service/tasks are gone)
  DEFAULT_VPC=$(aws ec2 describe-vpcs --filters 'Name=isDefault,Values=true' \
    --query 'Vpcs[0].VpcId' --output text --region "$AWS_REGION")
  SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${DEFAULT_VPC}" \
    --region "$AWS_REGION" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "")
  if [[ -n "$SG_ID" && "$SG_ID" != "None" ]]; then
    aws ec2 delete-security-group --group-id "$SG_ID" --region "$AWS_REGION" 2>/dev/null || \
      echo "   ⚠ SG still in use — retry: aws ec2 delete-security-group --group-id $SG_ID --region $AWS_REGION"
    info "✓ Security group deleted"
  fi

  # Delete ECR repo
  if aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" \
    --region "$AWS_REGION" > /dev/null 2>&1; then
    aws ecr delete-repository --repository-name "$ECR_REPO_NAME" \
      --force --region "$AWS_REGION" > /dev/null
    info "✓ ECR repository deleted"
  fi

  sep; echo "✅  Teardown complete"; sep
  exit 0
fi

# ─── Redeploy (infra already exists — just push image + update task def) ──────

if [[ "$MODE" == "redeploy" ]]; then
  sep; echo " Redeploy → $SERVICE"; sep

  if [[ "$BUILD" == "true" ]]; then
    echo ""; echo "Building image (linux/arm64)..."
    docker build --platform linux/arm64 -t "${IMAGE_NAME}:latest" .
    info "✓ Build complete"
  fi

  echo ""; echo "Pushing to ECR..."
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_URI" 2>/dev/null
  docker tag "${IMAGE_NAME}:latest" "${ECR_URI}:latest"
  docker push "${ECR_URI}:latest"
  info "✓ Pushed: ${ECR_URI}:latest"

  echo ""; echo "Registering new task definition revision..."
  CURRENT_TASK_DEF=$(aws ecs describe-task-definition --task-definition "$TASK_FAMILY" \
    --region "$AWS_REGION" --query 'taskDefinition' --output json)
  TMPFILE=$(mktemp /tmp/ws-validate-taskdef-XXXX.json)
  echo "$CURRENT_TASK_DEF" | python3 -c "
import json,sys
td = json.load(sys.stdin)
for k in ['taskDefinitionArn','revision','status','requiresAttributes','placementConstraints','compatibilities','registeredAt','registeredBy']:
    td.pop(k, None)
print(json.dumps(td))
" > "$TMPFILE"
  NEW_TASK_DEF_ARN=$(aws ecs register-task-definition --region "$AWS_REGION" \
    --cli-input-json "file://${TMPFILE}" \
    --query 'taskDefinition.taskDefinitionArn' --output text)
  rm "$TMPFILE"
  info "✓ New revision: $NEW_TASK_DEF_ARN"

  echo ""; echo "Updating service..."
  aws ecs update-service \
    --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$NEW_TASK_DEF_ARN" \
    --force-new-deployment \
    --region "$AWS_REGION" > /dev/null
  info "✓ Deployment triggered"

  echo ""
  echo "Watch:   ./scripts/validate-fargate.sh --status"
  echo "Logs:    ./scripts/validate-fargate.sh --logs"
  sep; echo "✅  Redeploy complete"; sep
  exit 0
fi

# ─── Setup + initial deploy ────────────────────────────────────────────────────

sep; echo " Validate Fargate (bare-minimum, no ALB)"; sep

# ─── 1. ECR Repository ────────────────────────────────────────────────────────

echo ""; echo "1/7  ECR repository..."
if ! aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" \
  --region "$AWS_REGION" > /dev/null 2>&1; then
  aws ecr create-repository \
    --repository-name "$ECR_REPO_NAME" \
    --region "$AWS_REGION" > /dev/null
  info "✓ Created: $ECR_URI"
else
  info "✓ Exists:  $ECR_URI"
fi

# ─── 2. IAM Roles ─────────────────────────────────────────────────────────────

echo ""; echo "2/7  IAM roles..."

TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

# Execution role (pull images, write logs)
if ! aws iam get-role --role-name "$EXEC_ROLE_NAME" > /dev/null 2>&1; then
  aws iam create-role \
    --role-name "$EXEC_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" > /dev/null
  aws iam attach-role-policy \
    --role-name "$EXEC_ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  info "✓ Created exec role: $EXEC_ROLE_NAME"
else
  info "✓ Exists:  $EXEC_ROLE_NAME"
fi

# Task role (minimal — add DynamoDB etc. here if needed)
if ! aws iam get-role --role-name "$TASK_ROLE_NAME" > /dev/null 2>&1; then
  aws iam create-role \
    --role-name "$TASK_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" > /dev/null
  info "✓ Created task role: $TASK_ROLE_NAME"
else
  info "✓ Exists:  $TASK_ROLE_NAME"
fi

EXEC_ROLE_ARN=$(aws iam get-role --role-name "$EXEC_ROLE_NAME" \
  --query 'Role.Arn' --output text)
TASK_ROLE_ARN=$(aws iam get-role --role-name "$TASK_ROLE_NAME" \
  --query 'Role.Arn' --output text)

# ─── 3. CloudWatch Log Group ──────────────────────────────────────────────────

echo ""; echo "3/7  Log group..."
if ! aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
  --region "$AWS_REGION" --query 'logGroups[0].logGroupName' \
  --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
  aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION"
  aws logs put-retention-policy \
    --log-group-name "$LOG_GROUP" \
    --retention-in-days 7 \
    --region "$AWS_REGION"
  info "✓ Created: $LOG_GROUP"
else
  info "✓ Exists:  $LOG_GROUP"
fi

# ─── 4. Build + Push Image ────────────────────────────────────────────────────

echo ""; echo "4/7  Container image..."
if [[ "$BUILD" == "true" ]]; then
  echo "   Building (linux/arm64)..."
  docker build --platform linux/arm64 -t "${IMAGE_NAME}:latest" .
  info "✓ Build complete"
fi

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_URI" 2>/dev/null
docker tag "${IMAGE_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
info "✓ Pushed: ${ECR_URI}:latest"

# ─── 5. Task Definition ───────────────────────────────────────────────────────

echo ""; echo "5/7  Task definition..."

# Redis sidecar runs alongside the app — containers share localhost in awsvpc mode
# Mirrors local docker-compose.local.yml but in ECS task form
ENV_VARS='[{"name":"REDIS_ENDPOINT","value":"localhost"}'
ENV_VARS+=',{"name":"REDIS_PORT","value":"6379"}'
ENV_VARS+=',{"name":"COGNITO_USER_POOL_ID","value":"'"$COGNITO_USER_POOL_ID"'"}'
ENV_VARS+=',{"name":"COGNITO_REGION","value":"'"$COGNITO_REGION"'"}'
[[ -n "${DYNAMODB_CRDT_TABLE:-}" ]] && ENV_VARS+=',{"name":"DYNAMODB_CRDT_TABLE","value":"'"$DYNAMODB_CRDT_TABLE"'"}'
ENV_VARS+=']'

# cpu/memory split: 256/512 for app + 128/128 for redis sidecar = 384/640 total
TASK_DEF_JSON=$(cat <<EOF
{
  "family": "$TASK_FAMILY",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": {
    "cpuArchitecture": "ARM64",
    "operatingSystemFamily": "LINUX"
  },
  "containerDefinitions": [
    {
      "name": "redis",
      "image": "redis:7-alpine",
      "essential": true,
      "portMappings": [{"containerPort": 6379, "protocol": "tcp"}],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "$LOG_GROUP",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "redis"
        }
      }
    },
    {
      "name": "websocket-gateway",
      "image": "${ECR_URI}:latest",
      "essential": true,
      "portMappings": [{"containerPort": 8080, "protocol": "tcp"}],
      "environment": $ENV_VARS,
      "dependsOn": [{"containerName": "redis", "condition": "START"}],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "$LOG_GROUP",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "websocket-gateway"
        }
      }
    }
  ]
}
EOF
)

TMPFILE=$(mktemp /tmp/ws-validate-taskdef-XXXX.json)
echo "$TASK_DEF_JSON" > "$TMPFILE"
TASK_DEF_ARN=$(aws ecs register-task-definition --region "$AWS_REGION" \
  --cli-input-json "file://${TMPFILE}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
rm "$TMPFILE"
info "✓ Registered: $TASK_DEF_ARN"

# ─── 6. ECS Cluster ───────────────────────────────────────────────────────────

echo ""; echo "6/7  ECS cluster..."
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER" \
  --region "$AWS_REGION" --query 'clusters[0].status' --output text 2>/dev/null || echo "")
if [[ "$CLUSTER_STATUS" != "ACTIVE" ]]; then
  aws ecs create-cluster --cluster-name "$CLUSTER" --region "$AWS_REGION" > /dev/null
  info "✓ Created: $CLUSTER"
else
  info "✓ Exists:  $CLUSTER"
fi

# ─── 7. Network + Fargate Service ─────────────────────────────────────────────

echo ""; echo "7/7  Fargate service..."

# Default VPC — all subnets are public, tasks get a real IP, no VPC endpoints needed
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --region "$AWS_REGION" \
  --query 'Vpcs[0].VpcId' --output text)

SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --region "$AWS_REGION" \
  --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')

info "VPC:     $VPC_ID"
info "Subnets: $SUBNET_IDS"

# Security group — outbound-only (tasks pull ECR + push logs over public internet)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --region "$AWS_REGION" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "")

if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "ws-validate: outbound-only for Fargate validation" \
    --vpc-id "$VPC_ID" \
    --region "$AWS_REGION" \
    --query 'GroupId' --output text)
  info "✓ Created SG: $SG_ID"
else
  info "✓ Exists SG: $SG_ID"
fi

# Create or update service
EXISTING_STATUS=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null || echo "")

if [[ "$EXISTING_STATUS" == "ACTIVE" ]]; then
  info "Service exists — updating task definition..."
  aws ecs update-service \
    --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$TASK_DEF_ARN" \
    --force-new-deployment \
    --region "$AWS_REGION" > /dev/null
  info "✓ Service updated: $SERVICE"
else
  aws ecs create-service \
    --cluster "$CLUSTER" \
    --service-name "$SERVICE" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_IDS}],securityGroups=[${SG_ID}],assignPublicIp=ENABLED}" \
    --region "$AWS_REGION" > /dev/null
  info "✓ Created service: $SERVICE"
fi

# ─── Poll until task is RUNNING or STOPPED ────────────────────────────────────

echo ""
echo "Waiting for task to start (polling every 5s)..."
DEADLINE=$((SECONDS + 120))
while [[ $SECONDS -lt $DEADLINE ]]; do
  TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
    --region "$AWS_REGION" --query 'taskArns[0]' --output text 2>/dev/null || echo "")

  if [[ -n "$TASK_ARN" && "$TASK_ARN" != "None" ]]; then
    STATUS=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
      --region "$AWS_REGION" --query 'tasks[0].lastStatus' --output text 2>/dev/null || echo "")
    echo "  Task: $(basename "$TASK_ARN") — $STATUS"
    if [[ "$STATUS" == "RUNNING" || "$STATUS" == "STOPPED" ]]; then
      break
    fi
  else
    echo "  Waiting for task to be assigned..."
  fi
  sleep 5
done

# Show final task state
TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
  --region "$AWS_REGION" --query 'taskArns[0]' --output text 2>/dev/null || echo "")
# Also check stopped tasks if none running
if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
  TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED \
    --region "$AWS_REGION" --query 'taskArns[0]' --output text 2>/dev/null || echo "")
fi
if [[ -n "$TASK_ARN" && "$TASK_ARN" != "None" ]]; then
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION" \
    --query 'tasks[0].{Status:lastStatus,Reason:stoppedReason,ExitCode:containers[0].exitCode}' \
    --output json 2>/dev/null
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
sep
echo "Tail logs:     ./scripts/validate-fargate.sh --logs"
echo "Watch status:  ./scripts/validate-fargate.sh --status"
echo "Redeploy:      ./scripts/validate-fargate.sh --redeploy"
echo "Teardown:      ./scripts/validate-fargate.sh --teardown"
