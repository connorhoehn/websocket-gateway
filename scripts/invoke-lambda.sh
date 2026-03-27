#!/bin/bash
# Usage: ./scripts/invoke-lambda.sh [function-name] [json-payload]
# Example: ./scripts/invoke-lambda.sh activity-log '{"source":"social","detail-type":"social.follow","detail":{"followerId":"u1","followeeId":"u2"}}'
set -e

FUNCTION_NAME=${1:-activity-log}
PAYLOAD=${2:-'{"source":"social","detail-type":"social.follow","detail":{"followerId":"test-user-1","followeeId":"test-user-2"}}'}
LAMBDA_DIR="lambdas/$FUNCTION_NAME"

if [ ! -d "$LAMBDA_DIR" ]; then
  echo "ERROR: Lambda directory $LAMBDA_DIR does not exist"
  exit 1
fi

echo "==> Building $FUNCTION_NAME..."
cd "$LAMBDA_DIR"
npm install --silent
npx tsc
cd dist

echo "==> Packaging $FUNCTION_NAME..."
zip -r /tmp/$FUNCTION_NAME.zip . -x "node_modules/*" > /dev/null
# Include node_modules for runtime
cd ..
zip -r /tmp/$FUNCTION_NAME.zip node_modules > /dev/null
cd ../..

echo "==> Deploying $FUNCTION_NAME to LocalStack..."
awslocal lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime nodejs22.x \
  --zip-file "fileb:///tmp/$FUNCTION_NAME.zip" \
  --handler handler.handler \
  --timeout 30 \
  --environment "Variables={AWS_REGION=us-east-1,LOCALSTACK_ENDPOINT=http://localstack:4566,REDIS_ENDPOINT=localstack-redis,REDIS_PORT=6379}" \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || \
awslocal lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb:///tmp/$FUNCTION_NAME.zip" > /dev/null

echo "==> Invoking $FUNCTION_NAME..."
awslocal lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out \
  /tmp/$FUNCTION_NAME-output.json

echo ""
echo "==> Response:"
cat /tmp/$FUNCTION_NAME-output.json
echo ""
