#!/usr/bin/env bash
# deploy-image.sh — Build, push, and hot-deploy a new container image to ECS
# without touching CDK or CloudFormation.
#
# Usage:
#   ./scripts/deploy-image.sh              # build + push + force new deployment
#   ./scripts/deploy-image.sh --no-build   # skip build, just push latest local image + redeploy
#   ./scripts/deploy-image.sh --tail       # also tail ECS task logs after deploy

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
IMAGE_NAME="websocket-gateway"
ECR_REPOSITORY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${IMAGE_NAME}"
STACK_NAME="WebsockerGatewayStack"
BUILD=true
TAIL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --no-build) BUILD=false; shift ;;
    --tail)     TAIL=true;   shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Fast image deploy → ECS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Build ────────────────────────────────────────────────────────────────────

if [[ "$BUILD" == "true" ]]; then
  echo ""
  echo "🔨  Building image (linux/arm64)..."
  docker build --platform linux/arm64 -t "${IMAGE_NAME}:latest" .
  echo "   ✅  Build complete"
fi

# ─── Push to ECR ──────────────────────────────────────────────────────────────

echo ""
echo "📤  Pushing to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY" 2>/dev/null
docker tag "${IMAGE_NAME}:latest" "${ECR_REPOSITORY}:latest"
docker push "${ECR_REPOSITORY}:latest"
echo "   ✅  Pushed: ${ECR_REPOSITORY}:latest"

# ─── Discover cluster + service from CloudFormation ───────────────────────────

echo ""
echo "🔍  Resolving ECS cluster and service..."

CLUSTER_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterArn`].OutputValue' \
  --output text 2>/dev/null)

SERVICE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ServiceArn`].OutputValue' \
  --output text 2>/dev/null)

if [[ -z "$CLUSTER_ARN" || -z "$SERVICE_ARN" ]]; then
  echo "❌  Stack not deployed or missing ClusterArn/ServiceArn outputs."
  echo "   Run 'make cdk-deploy' first."
  exit 1
fi

echo "   Cluster : $CLUSTER_ARN"
echo "   Service : $SERVICE_ARN"

# ─── Force new deployment ─────────────────────────────────────────────────────

echo ""
echo "🚀  Forcing new ECS deployment..."
aws ecs update-service \
  --cluster "$CLUSTER_ARN" \
  --service "$SERVICE_ARN" \
  --force-new-deployment \
  --region "$AWS_REGION" \
  --output none

echo "   ✅  Deployment triggered"

# ─── Watch for task failures ──────────────────────────────────────────────────

echo ""
echo "👀  Watching for task failures (30s)..."
DEADLINE=$((SECONDS + 30))
while [[ $SECONDS -lt $DEADLINE ]]; do
  STOPPED=$(aws ecs list-tasks \
    --cluster "$CLUSTER_ARN" \
    --desired-status STOPPED \
    --started-by "ecs-svc" \
    --region "$AWS_REGION" \
    --query 'taskArns[0]' --output text 2>/dev/null || echo "")

  if [[ -n "$STOPPED" && "$STOPPED" != "None" ]]; then
    REASON=$(aws ecs describe-tasks \
      --cluster "$CLUSTER_ARN" --tasks "$STOPPED" --region "$AWS_REGION" \
      --query 'tasks[0].{Stop:stoppedReason,Code:containers[0].exitCode}' \
      --output json 2>/dev/null)
    echo ""
    echo "⚠️   Task stopped: $REASON"
    echo "   Check logs with: make ecs-logs"
    break
  fi
  sleep 5
done

# ─── Tail logs ────────────────────────────────────────────────────────────────

if [[ "$TAIL" == "true" ]]; then
  echo ""
  echo "📋  Tailing ECS logs (Ctrl+C to stop)..."
  # Find the log group for this stack
  LOG_GROUP=$(aws logs describe-log-groups --region "$AWS_REGION" \
    --log-group-name-prefix "${STACK_NAME}-TaskDef" \
    --query 'logGroups[-1].logGroupName' --output text 2>/dev/null)

  if [[ -n "$LOG_GROUP" && "$LOG_GROUP" != "None" ]]; then
    aws logs tail "$LOG_GROUP" --follow --region "$AWS_REGION" 2>/dev/null
  else
    echo "   No log group found. Check CloudWatch manually."
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  Done. Check service status with: make ecs-status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
