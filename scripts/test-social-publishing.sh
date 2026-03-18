#!/bin/bash
# Verifies all 8 social event types route correctly through EventBridge -> SQS.
# Tests the exact detail-type strings used by publishSocialEvent() in social-api routes.
# Prerequisite: docker compose up with LocalStack running.
set -e

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

test_route() {
  local DETAIL_TYPE=$1
  local EXPECTED_QUEUE=$2
  local DETAIL=$3

  echo "--- Testing: $DETAIL_TYPE -> $EXPECTED_QUEUE ---"

  awslocal sqs purge-queue --queue-url "http://sqs.${REGION}.localhost.localstack.cloud:4566/000000000000/${EXPECTED_QUEUE}" 2>/dev/null || true
  sleep 1

  awslocal events put-events --entries "[{
    \"Source\": \"social-api\",
    \"DetailType\": \"${DETAIL_TYPE}\",
    \"Detail\": \"${DETAIL}\",
    \"EventBusName\": \"social-events\"
  }]"

  sleep 2

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

# Room membership events (SEVT-01) -> social-rooms queue
test_route "social.room.join" "social-rooms" '{"roomId":"r1","userId":"u1","timestamp":"2026-03-18T00:00:00Z"}'
test_route "social.room.leave" "social-rooms" '{"roomId":"r1","userId":"u1","timestamp":"2026-03-18T00:00:00Z"}'

# Social graph events (SEVT-02) -> social-follows queue
test_route "social.follow" "social-follows" '{"followerId":"u1","followeeId":"u2","timestamp":"2026-03-18T00:00:00Z"}'
test_route "social.unfollow" "social-follows" '{"followerId":"u1","followeeId":"u2","timestamp":"2026-03-18T00:00:00Z"}'

# Reaction/like events (SEVT-03) -> social-reactions queue
test_route "social.reaction" "social-reactions" '{"targetId":"post:p1:reaction","userId":"u1","roomId":"r1","postId":"p1","emoji":"fire","timestamp":"2026-03-18T00:00:00Z"}'
test_route "social.like" "social-reactions" '{"targetId":"post:p1","userId":"u1","roomId":"r1","postId":"p1","timestamp":"2026-03-18T00:00:00Z"}'

# Content events (SEVT-04) -> social-posts queue
test_route "social.post.created" "social-posts" '{"roomId":"r1","postId":"p1","authorId":"u1","timestamp":"2026-03-18T00:00:00Z"}'
test_route "social.comment.created" "social-posts" '{"roomId":"r1","postId":"p1","commentId":"c1","authorId":"u1","timestamp":"2026-03-18T00:00:00Z"}'

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL 8 SOCIAL PUBLISHING TESTS PASSED"
else
  echo "FAILURES: $FAILURES"
  exit 1
fi
