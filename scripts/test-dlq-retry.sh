#!/bin/bash
# Verifies SQS retry + DLQ behavior: a failing Lambda retries maxReceiveCount times,
# then the message lands in the DLQ with the original EventBridge event payload intact.
# Prerequisite: docker compose up with LocalStack running + bootstrap.sh completed.
set -e

REGION="us-east-1"
SQS_BASE="http://sqs.${REGION}.localhost.localstack.cloud:4566/000000000000"

echo "==> Step 1: Deploy a FAILING Lambda..."
FAIL_DIR="/tmp/lambda-fail-test"
mkdir -p "$FAIL_DIR"
cat > "$FAIL_DIR/handler.js" << 'EOF'
exports.handler = async function(event) {
  console.log("DELIBERATE FAILURE:", JSON.stringify(event));
  throw new Error("Intentional failure for DLQ test");
};
EOF
cd "$FAIL_DIR"
zip -r /tmp/fail-lambda.zip handler.js > /dev/null
cd -

awslocal lambda update-function-code \
  --function-name activity-log \
  --zip-file fileb:///tmp/fail-lambda.zip > /dev/null

echo "==> Step 2: Purge queues..."
awslocal sqs purge-queue --queue-url "${SQS_BASE}/social-follows" 2>/dev/null || true
awslocal sqs purge-queue --queue-url "${SQS_BASE}/social-follows-dlq" 2>/dev/null || true
sleep 2

echo "==> Step 3: Publish a test event..."
awslocal events put-events --entries "[{
  \"Source\": \"social-api\",
  \"DetailType\": \"social.follow\",
  \"Detail\": \"{\\\"followerId\\\":\\\"dlq-test-user\\\",\\\"followeeId\\\":\\\"dlq-test-target\\\"}\",
  \"EventBusName\": \"social-events\"
}]"

echo "==> Step 4: Wait for retries to exhaust (maxReceiveCount=3)..."
echo "    Checking DLQ every 5 seconds for up to 60 seconds..."

DLQ_MSG=0
for i in $(seq 1 12); do
  sleep 5
  DLQ_MSG=$(awslocal sqs get-queue-attributes \
    --queue-url "${SQS_BASE}/social-follows-dlq" \
    --attribute-names ApproximateNumberOfMessagesVisible \
    --query 'Attributes.ApproximateNumberOfMessagesVisible' --output text 2>/dev/null || echo 0)
  echo "    Attempt $i: DLQ message count = $DLQ_MSG"
  if [ "$DLQ_MSG" -gt 0 ]; then
    break
  fi
done

echo ""
if [ "$DLQ_MSG" -gt 0 ]; then
  echo "==> Step 5: Verify DLQ message contains original payload..."
  MSG=$(awslocal sqs receive-message \
    --queue-url "${SQS_BASE}/social-follows-dlq" \
    --max-number-of-messages 1 \
    --query 'Messages[0].Body' --output text)
  echo "DLQ message body: $MSG"

  if echo "$MSG" | grep -q "dlq-test-user"; then
    echo ""
    echo "PASS: Message landed in DLQ with original payload preserved"
  else
    echo ""
    echo "FAIL: DLQ message does not contain original payload"
    exit 1
  fi
else
  echo "FAIL: No message appeared in DLQ after 60 seconds"
  exit 1
fi

echo ""
echo "==> Step 6: Restore working Lambda stub..."
STUB_DIR="/tmp/lambda-stub-restore"
mkdir -p "$STUB_DIR"
cat > "$STUB_DIR/handler.js" << 'EOF'
exports.handler = async function(event) {
  console.log("activity-log stub handler:", JSON.stringify(event));
  return { statusCode: 200, body: "ok" };
};
EOF
cd "$STUB_DIR"
zip -r /tmp/stub-lambda.zip handler.js > /dev/null
cd -

awslocal lambda update-function-code \
  --function-name activity-log \
  --zip-file fileb:///tmp/stub-lambda.zip > /dev/null

echo "==> Lambda restored to working stub. DLQ retry test complete."
