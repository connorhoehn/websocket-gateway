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
  --billing-mode PAY_PER_REQUEST || true

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
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-posts \
  --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=postId,AttributeType=S \
  --key-schema AttributeName=roomId,KeyType=HASH AttributeName=postId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-comments \
  --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=commentId,AttributeType=S \
  --key-schema AttributeName=postId,KeyType=HASH AttributeName=commentId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

awslocal dynamodb create-table --table-name social-likes \
  --attribute-definitions AttributeName=targetId,AttributeType=S AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=targetId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

# ---- New v3.0 table (Phase 37 Activity Log) ----
awslocal dynamodb create-table --table-name user-activity \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

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
