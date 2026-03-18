#!/bin/bash
# Verifies EventBridge -> SQS routing for all 4 event categories against LocalStack.
# Prerequisite: docker compose up with LocalStack running.
set -e

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

# Helper: publish event and verify it lands in the expected queue
test_route() {
  local DETAIL_TYPE=$1
  local EXPECTED_QUEUE=$2
  local DETAIL=$3

  echo "--- Testing: $DETAIL_TYPE -> $EXPECTED_QUEUE ---"

  # Purge target queue first
  awslocal sqs purge-queue --queue-url "http://sqs.${REGION}.localhost.localstack.cloud:4566/000000000000/${EXPECTED_QUEUE}" 2>/dev/null || true
  sleep 1

  # Publish event
  awslocal events put-events --entries "[{
    \"Source\": \"social-api\",
    \"DetailType\": \"${DETAIL_TYPE}\",
    \"Detail\": \"${DETAIL}\",
    \"EventBusName\": \"social-events\"
  }]"

  sleep 2

  # Check target queue has message
  MSG_COUNT=$(awslocal sqs get-queue-attributes \
    --queue-url "http://sqs.${REGION}.localhost.localstack.cloud:4566/000000000000/${EXPECTED_QUEUE}" \
    --attribute-names ApproximateNumberOfMessagesVisible \
    --query 'Attributes.ApproximateNumberOfMessagesVisible' --output text)

  if [ "$MSG_COUNT" -gt 0 ]; then
    echo "PASS: $DETAIL_TYPE routed to $EXPECTED_QUEUE ($MSG_COUNT messages)"
  else
    echo "FAIL: $DETAIL_TYPE did NOT arrive in $EXPECTED_QUEUE"
    FAILURES=$((FAILURES + 1))
  fi
}

FAILURES=0

test_route "social.follow" "social-follows" '{"followerId":"u1","followeeId":"u2"}'
test_route "social.room.join" "social-rooms" '{"roomId":"r1","userId":"u1"}'
test_route "social.post.created" "social-posts" '{"roomId":"r1","postId":"p1","authorId":"u1"}'
test_route "social.reaction" "social-reactions" '{"postId":"p1","userId":"u1","emoji":"thumbsup"}'

# Also test social.comment routes to posts queue
test_route "social.comment.created" "social-posts" '{"postId":"p1","commentId":"c1","authorId":"u1"}'

# Also test social.like routes to reactions queue
test_route "social.like" "social-reactions" '{"targetId":"p1","userId":"u1"}'

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL ROUTING TESTS PASSED"
else
  echo "FAILURES: $FAILURES"
  exit 1
fi
