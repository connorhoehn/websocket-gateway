#!/bin/bash
set -e
echo "==> Bootstrapping LocalStack resources..."

# EventBridge custom bus
awslocal events create-event-bus --name social-events || true

# SQS queues (Phase 35 will add rules routing to these)
awslocal sqs create-queue --queue-name social-follows || true
awslocal sqs create-queue --queue-name social-rooms || true
awslocal sqs create-queue --queue-name social-posts || true
awslocal sqs create-queue --queue-name social-reactions || true

# ---- Existing social DynamoDB tables (from lib/social-stack.ts) ----
awslocal dynamodb create-table --table-name social-profiles \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-relationships \
  --attribute-definitions AttributeName=followerId,AttributeType=S AttributeName=followeeId,AttributeType=S \
  --key-schema AttributeName=followerId,KeyType=HASH AttributeName=followeeId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"followeeId-followerId-index",
    "KeySchema":[
      {"AttributeName":"followeeId","KeyType":"HASH"},
      {"AttributeName":"followerId","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true

awslocal dynamodb create-table --table-name social-groups \
  --attribute-definitions AttributeName=groupId,AttributeType=S \
  --key-schema AttributeName=groupId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-group-members \
  --attribute-definitions AttributeName=groupId,AttributeType=S AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=groupId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-rooms \
  --attribute-definitions AttributeName=roomId,AttributeType=S \
  --key-schema AttributeName=roomId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-room-members \
  --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=roomId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"userId-roomId-index",
    "KeySchema":[
      {"AttributeName":"userId","KeyType":"HASH"},
      {"AttributeName":"roomId","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true

awslocal dynamodb create-table --table-name social-posts \
  --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=postId,AttributeType=S AttributeName=authorId,AttributeType=S \
  --key-schema AttributeName=roomId,KeyType=HASH AttributeName=postId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"authorId-postId-index",
    "KeySchema":[
      {"AttributeName":"authorId","KeyType":"HASH"},
      {"AttributeName":"postId","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true

awslocal dynamodb create-table --table-name social-comments \
  --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=commentId,AttributeType=S \
  --key-schema AttributeName=postId,KeyType=HASH AttributeName=commentId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-likes \
  --attribute-definitions AttributeName=targetId,AttributeType=S AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=targetId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- Pipeline definitions table (replaces in-memory stubStore) ----
awslocal dynamodb create-table --table-name pipeline-definitions \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=pipelineId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=pipelineId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- pipeline-audit table (append-only audit log for pipeline operations) ----
# PK: auditId (S, caller-supplied ULID)
# GSI actor-time-index: actorUserId (S) HASH, timestamp (S, ISO 8601) RANGE
# GSI pipeline-time-index: pipelineId (S) HASH, timestamp (S, ISO 8601) RANGE
awslocal dynamodb create-table --table-name pipeline-audit \
  --attribute-definitions \
    AttributeName=auditId,AttributeType=S \
    AttributeName=actorUserId,AttributeType=S \
    AttributeName=pipelineId,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=auditId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"actor-time-index",
    "KeySchema":[
      {"AttributeName":"actorUserId","KeyType":"HASH"},
      {"AttributeName":"timestamp","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  },{
    "IndexName":"pipeline-time-index",
    "KeySchema":[
      {"AttributeName":"pipelineId","KeyType":"HASH"},
      {"AttributeName":"timestamp","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true

# ---- New v3.0 table (Phase 37 Activity Log) ----
awslocal dynamodb create-table --table-name user-activity \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- Document Video Sessions table ----
awslocal dynamodb create-table --table-name document-video-sessions \
  --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=sessionId,AttributeType=S \
  --key-schema AttributeName=documentId,KeyType=HASH AttributeName=sessionId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- Outbox table (Phase 43 Transactional Outbox) ----
awslocal dynamodb create-table --table-name social-outbox \
  --attribute-definitions \
    AttributeName=outboxId,AttributeType=S \
    AttributeName=status,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=outboxId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName":"status-index",
    "KeySchema":[
      {"AttributeName":"status","KeyType":"HASH"},
      {"AttributeName":"createdAt","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' || true

# ---- DLQ sibling queues (Phase 35) ----
awslocal sqs create-queue --queue-name social-follows-dlq || true
awslocal sqs create-queue --queue-name social-rooms-dlq || true
awslocal sqs create-queue --queue-name social-posts-dlq || true
awslocal sqs create-queue --queue-name social-reactions-dlq || true

# ---- Set VisibilityTimeout=60s and RedrivePolicy on main queues (Phase 35) ----
# VisibilityTimeout is set to 60s to match CDK EventBusStack (production parity).
# Without this, LocalStack defaults to 30s while production runs at 60s.

FOLLOWS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$FOLLOWS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" || true

ROOMS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$ROOMS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" || true

POSTS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$POSTS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" || true

REACTIONS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$REACTIONS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" || true

# ---- EventBridge routing rules (Phase 35) ----
# Routes social events by detail-type prefix to the correct typed SQS queue.

awslocal events put-rule \
  --name follow-events \
  --event-bus-name social-events \
  --event-pattern '{"detail-type":[{"prefix":"social.follow"}]}' || true

FOLLOWS_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal events put-targets \
  --rule follow-events \
  --event-bus-name social-events \
  --targets "Id=social-follows-target,Arn=$FOLLOWS_QUEUE_ARN" || true

awslocal events put-rule \
  --name room-events \
  --event-bus-name social-events \
  --event-pattern '{"detail-type":[{"prefix":"social.room"}]}' || true

ROOMS_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal events put-targets \
  --rule room-events \
  --event-bus-name social-events \
  --targets "Id=social-rooms-target,Arn=$ROOMS_QUEUE_ARN" || true

awslocal events put-rule \
  --name post-events \
  --event-bus-name social-events \
  --event-pattern '{"detail-type":[{"prefix":"social.post"},{"prefix":"social.comment"}]}' || true

POSTS_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal events put-targets \
  --rule post-events \
  --event-bus-name social-events \
  --targets "Id=social-posts-target,Arn=$POSTS_QUEUE_ARN" || true

awslocal events put-rule \
  --name reaction-events \
  --event-bus-name social-events \
  --event-pattern '{"detail-type":[{"prefix":"social.reaction"},{"prefix":"social.like"}]}' || true

REACTIONS_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal events put-targets \
  --rule reaction-events \
  --event-bus-name social-events \
  --targets "Id=social-reactions-target,Arn=$REACTIONS_QUEUE_ARN" || true

# ---- CloudWatch alarms for DLQ depth (Phase 35) ----
# Each alarm fires when ApproximateNumberOfMessagesVisible > 0.

awslocal cloudwatch put-metric-alarm \
  --alarm-name social-follows-dlq-depth \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=social-follows-dlq \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching || true

awslocal cloudwatch put-metric-alarm \
  --alarm-name social-rooms-dlq-depth \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=social-rooms-dlq \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching || true

awslocal cloudwatch put-metric-alarm \
  --alarm-name social-posts-dlq-depth \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=social-posts-dlq \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching || true

awslocal cloudwatch put-metric-alarm \
  --alarm-name social-reactions-dlq-depth \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=social-reactions-dlq \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching || true

# ---- crdt-snapshots DynamoDB table (Phase 38) ----
# timestamp is N (number) — crdt-service.js writes Date.now() and reads item.timestamp.N
awslocal dynamodb create-table --table-name crdt-snapshots \
  --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=timestamp,AttributeType=N \
  --key-schema AttributeName=documentId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- crdt-snapshots SQS queue + DLQ (Phase 38) ----
awslocal sqs create-queue --queue-name crdt-snapshots || true
awslocal sqs create-queue --queue-name crdt-snapshots-dlq || true

CRDT_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/crdt-snapshots-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/crdt-snapshots \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$CRDT_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" || true

# ---- EventBridge rule routing crdt.checkpoint events to crdt-snapshots (Phase 38) ----
awslocal events put-rule \
  --name crdt-checkpoint-events \
  --event-bus-name social-events \
  --event-pattern '{"detail-type":[{"prefix":"crdt.checkpoint"}]}' || true

CRDT_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/crdt-snapshots \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal events put-targets \
  --rule crdt-checkpoint-events \
  --event-bus-name social-events \
  --targets "Id=crdt-snapshots-target,Arn=$CRDT_QUEUE_ARN" || true

# ---- CloudWatch alarm for crdt-snapshots DLQ depth (Phase 38) ----
awslocal cloudwatch put-metric-alarm \
  --alarm-name crdt-snapshots-dlq-depth \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=crdt-snapshots-dlq \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching || true

# ---- Lambda deployment (Phase 35 - SQS consumer) ----
echo "==> Deploying activity-log Lambda..."
LAMBDA_DIR="/tmp/lambda-build"
mkdir -p "$LAMBDA_DIR"

# Note: In bootstrap context, we create a minimal stub that will be replaced
# by the real handler via invoke-lambda.sh during development.
# The stub just logs and returns — enough to verify event-source-mapping works.
cat > "$LAMBDA_DIR/handler.js" << 'HANDLER_EOF'
exports.handler = async function(event) {
  console.log("activity-log stub handler:", JSON.stringify(event));
  return { statusCode: 200, body: "ok" };
};
HANDLER_EOF

cd "$LAMBDA_DIR"
zip -r /tmp/activity-log-stub.zip handler.js > /dev/null
cd /

awslocal lambda create-function \
  --function-name activity-log \
  --runtime nodejs20.x \
  --zip-file fileb:///tmp/activity-log-stub.zip \
  --handler handler.handler \
  --timeout 30 \
  --environment "Variables={AWS_REGION=us-east-1,LOCALSTACK_ENDPOINT=http://localstack:4566,REDIS_ENDPOINT=localstack-redis,REDIS_PORT=6379}" \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || true

# SQS -> Lambda event source mapping
FOLLOWS_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal lambda create-event-source-mapping \
  --function-name activity-log \
  --event-source-arn "$FOLLOWS_QUEUE_ARN" \
  --batch-size 1 \
  --enabled 2>/dev/null || true

ROOMS_ESM_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal lambda create-event-source-mapping \
  --function-name activity-log \
  --event-source-arn "$ROOMS_ESM_ARN" \
  --batch-size 1 \
  --enabled 2>/dev/null || true

POSTS_ESM_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal lambda create-event-source-mapping \
  --function-name activity-log \
  --event-source-arn "$POSTS_ESM_ARN" \
  --batch-size 1 \
  --enabled 2>/dev/null || true

REACTIONS_ESM_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal lambda create-event-source-mapping \
  --function-name activity-log \
  --event-source-arn "$REACTIONS_ESM_ARN" \
  --batch-size 1 \
  --enabled 2>/dev/null || true

echo "==> Lambda event-source-mappings:"
awslocal lambda list-event-source-mappings --function-name activity-log

# ---- crdt-snapshot Lambda deployment (Phase 38) ----
echo "==> Deploying crdt-snapshot Lambda..."
LAMBDA_DIR_CRDT="/tmp/lambda-build-crdt"
mkdir -p "$LAMBDA_DIR_CRDT"

cat > "$LAMBDA_DIR_CRDT/handler.js" << 'HANDLER_EOF'
exports.handler = async function(event) {
  console.log("crdt-snapshot stub handler:", JSON.stringify(event));
  return { statusCode: 200, body: "ok" };
};
HANDLER_EOF

cd "$LAMBDA_DIR_CRDT"
zip -r /tmp/crdt-snapshot-stub.zip handler.js > /dev/null
cd /

awslocal lambda create-function \
  --function-name crdt-snapshot \
  --runtime nodejs20.x \
  --zip-file fileb:///tmp/crdt-snapshot-stub.zip \
  --handler handler.handler \
  --timeout 30 \
  --environment "Variables={AWS_REGION=us-east-1,LOCALSTACK_ENDPOINT=http://localstack:4566,DYNAMODB_CRDT_TABLE=crdt-snapshots}" \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || true

# SQS -> crdt-snapshot Lambda event source mapping
CRDT_QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/crdt-snapshots \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal lambda create-event-source-mapping \
  --function-name crdt-snapshot \
  --event-source-arn "$CRDT_QUEUE_ARN" \
  --batch-size 1 \
  --enabled 2>/dev/null || true

echo "==> crdt-snapshot Lambda event-source-mappings:"
awslocal lambda list-event-source-mappings --function-name crdt-snapshot

# ---- outbox-relay Lambda deployment (Phase 43 - Transactional Outbox) ----
echo "==> Deploying outbox-relay Lambda..."
LAMBDA_DIR_OUTBOX="/tmp/lambda-build-outbox"
mkdir -p "$LAMBDA_DIR_OUTBOX"

cat > "$LAMBDA_DIR_OUTBOX/handler.js" << 'HANDLER_EOF'
exports.handler = async function(event) {
  console.log("outbox-relay stub handler:", JSON.stringify(event));
  return { statusCode: 200, body: "ok" };
};
HANDLER_EOF

cd "$LAMBDA_DIR_OUTBOX"
zip -r /tmp/outbox-relay-stub.zip handler.js > /dev/null
cd /

awslocal lambda create-function \
  --function-name outbox-relay \
  --runtime nodejs20.x \
  --zip-file fileb:///tmp/outbox-relay-stub.zip \
  --handler handler.handler \
  --timeout 60 \
  --environment "Variables={AWS_REGION=us-east-1,LOCALSTACK_ENDPOINT=http://localstack:4566,SQS_FOLLOWS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-follows,SQS_ROOMS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-rooms,SQS_POSTS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-posts,SQS_REACTIONS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/social-reactions}" \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || true

echo "==> Bootstrap complete. Tables:"
awslocal dynamodb list-tables
echo "==> EventBridge buses:"
awslocal events list-event-buses
echo "==> SQS queues:"
awslocal sqs list-queues
echo "==> EventBridge rules:"
awslocal events list-rules --event-bus-name social-events
echo "==> CloudWatch alarms:"
awslocal cloudwatch describe-alarms --query 'MetricAlarms[].AlarmName'
