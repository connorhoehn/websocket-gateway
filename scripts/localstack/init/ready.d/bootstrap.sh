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

echo "==> Bootstrap complete. Tables:"
awslocal dynamodb list-tables
echo "==> EventBridge buses:"
awslocal events list-event-buses
echo "==> SQS queues:"
awslocal sqs list-queues
