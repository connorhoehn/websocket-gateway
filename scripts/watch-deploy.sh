#!/usr/bin/env bash
# watch-deploy.sh — Run cdk deploy and surface ECS task failures immediately
# instead of waiting for CloudFormation's 3-minute timeout.
#
# Usage:
#   ./scripts/watch-deploy.sh [extra cdk args...]

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="WebsockerGatewayStack"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CDK Deploy with ECS task monitoring"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Run cdk deploy in background ─────────────────────────────────────────────

npm run build
npm run cdk -- deploy --require-approval never "$@" &
CDK_PID=$!

echo ""
echo "🚀  CDK deploying (PID $CDK_PID)..."
echo "    Monitoring for ECS task failures in parallel..."
echo ""

# ─── Monitor for task failures while CDK deploys ──────────────────────────────

LAST_SEEN=""
while kill -0 "$CDK_PID" 2>/dev/null; do
  # Only check once ECS service exists
  CLUSTER_ARN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ClusterArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

  if [[ -n "$CLUSTER_ARN" && "$CLUSTER_ARN" != "None" ]]; then
    STOPPED_TASKS=$(aws ecs list-tasks \
      --cluster "$CLUSTER_ARN" \
      --desired-status STOPPED \
      --region "$AWS_REGION" \
      --query 'taskArns' --output json 2>/dev/null || echo "[]")

    TASK_ARN=$(echo "$STOPPED_TASKS" | python3 -c "
import json,sys
tasks = json.load(sys.stdin)
print(tasks[0] if tasks else '')
" 2>/dev/null || echo "")

    if [[ -n "$TASK_ARN" && "$TASK_ARN" != "$LAST_SEEN" ]]; then
      LAST_SEEN="$TASK_ARN"
      DETAIL=$(aws ecs describe-tasks \
        --cluster "$CLUSTER_ARN" --tasks "$TASK_ARN" --region "$AWS_REGION" \
        --query 'tasks[0].{StopCode:stopCode,Reason:stoppedReason,ExitCode:containers[0].exitCode}' \
        --output json 2>/dev/null)
      EXIT=$(echo "$DETAIL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ExitCode','?'))" 2>/dev/null)

      echo "⚠️  [$(date -u +%H:%M:%S)] Task stopped (exit $EXIT):"
      echo "$DETAIL" | python3 -m json.tool 2>/dev/null || echo "$DETAIL"

      # Fetch latest logs
      LOG_GROUP=$(aws logs describe-log-groups --region "$AWS_REGION" \
        --log-group-name-prefix "${STACK_NAME}-TaskDef" \
        --query 'sort_by(logGroups, &creationTime)[-1].logGroupName' \
        --output text 2>/dev/null || echo "")

      if [[ -n "$LOG_GROUP" && "$LOG_GROUP" != "None" ]]; then
        STREAM=$(aws logs describe-log-streams --region "$AWS_REGION" \
          --log-group-name "$LOG_GROUP" \
          --order-by LastEventTime --descending \
          --query 'logStreams[0].logStreamName' --output text 2>/dev/null || echo "")

        if [[ -n "$STREAM" && "$STREAM" != "None" ]]; then
          echo ""
          echo "📋  Last container logs:"
          aws logs get-log-events --region "$AWS_REGION" \
            --log-group-name "$LOG_GROUP" \
            --log-stream-name "$STREAM" \
            --limit 20 --query 'events[*].message' --output text 2>/dev/null || true
        fi
      fi
      echo ""
    fi
  fi

  sleep 10
done

wait "$CDK_PID"
CDK_EXIT=$?

echo ""
if [[ $CDK_EXIT -eq 0 ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅  Deploy complete"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "❌  Deploy failed (exit $CDK_EXIT)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit $CDK_EXIT
fi
