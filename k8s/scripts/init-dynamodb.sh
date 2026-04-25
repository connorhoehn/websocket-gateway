#!/bin/bash
# Initialize DynamoDB Local with all tables required by crdt-service and social-api.
# Usage: ./k8s/scripts/init-dynamodb.sh [endpoint] [region]

ENDPOINT="${1:-http://localhost:8000}"
REGION="${2:-us-east-1}"

AWS="aws dynamodb --endpoint-url $ENDPOINT --region $REGION"

create_table() {
  local name="$1"
  shift
  $AWS create-table --table-name "$name" --billing-mode PAY_PER_REQUEST "$@" 2>/dev/null \
    && echo "✅  $name" \
    || echo "ℹ️   $name (already exists)"
}

echo "Initializing DynamoDB tables at $ENDPOINT..."
echo ""

# ── crdt-service ────────────────────────────────────────────────────────────

create_table crdt-snapshots \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=timestamp,AttributeType=N \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE

create_table crdt-documents \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH

# ── social-api: document features ───────────────────────────────────────────

create_table document-sections \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=sectionId,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=sectionId,KeyType=RANGE

create_table section-items \
  --attribute-definitions \
    AttributeName=sectionKey,AttributeType=S \
    AttributeName=itemId,AttributeType=S \
    AttributeName=assignee,AttributeType=S \
    AttributeName=status,AttributeType=S \
    AttributeName=documentId,AttributeType=S \
  --key-schema \
    AttributeName=sectionKey,KeyType=HASH \
    AttributeName=itemId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"assignee-status-index",
      "KeySchema":[
        {"AttributeName":"assignee","KeyType":"HASH"},
        {"AttributeName":"status","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    },
    {
      "IndexName":"documentId-index",
      "KeySchema":[
        {"AttributeName":"documentId","KeyType":"HASH"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

create_table document-comments \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=commentId,AttributeType=S \
    AttributeName=sectionId,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=commentId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"sectionId-timestamp-index",
      "KeySchema":[
        {"AttributeName":"sectionId","KeyType":"HASH"},
        {"AttributeName":"timestamp","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

create_table section-reviews \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=reviewKey,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=reviewKey,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"userId-documentId-index",
      "KeySchema":[
        {"AttributeName":"userId","KeyType":"HASH"},
        {"AttributeName":"documentId","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

create_table approval-workflows \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=workflowId,AttributeType=S \
    AttributeName=workflowStatus,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=workflowId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"status-index",
      "KeySchema":[
        {"AttributeName":"workflowStatus","KeyType":"HASH"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

create_table document-video-sessions \
  --attribute-definitions \
    AttributeName=documentId,AttributeType=S \
    AttributeName=sessionId,AttributeType=S \
  --key-schema \
    AttributeName=documentId,KeyType=HASH \
    AttributeName=sessionId,KeyType=RANGE

# ── social-api: social graph & profiles ─────────────────────────────────────

create_table social-profiles \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=userId,KeyType=HASH

create_table social-relationships \
  --attribute-definitions \
    AttributeName=followerId,AttributeType=S \
    AttributeName=followeeId,AttributeType=S \
  --key-schema \
    AttributeName=followerId,KeyType=HASH \
    AttributeName=followeeId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"followeeId-followerId-index",
      "KeySchema":[
        {"AttributeName":"followeeId","KeyType":"HASH"},
        {"AttributeName":"followerId","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

# ── social-api: rooms ────────────────────────────────────────────────────────

create_table social-rooms \
  --attribute-definitions \
    AttributeName=roomId,AttributeType=S \
  --key-schema \
    AttributeName=roomId,KeyType=HASH

create_table social-room-members \
  --attribute-definitions \
    AttributeName=roomId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=roomId,KeyType=HASH \
    AttributeName=userId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"userId-roomId-index",
      "KeySchema":[
        {"AttributeName":"userId","KeyType":"HASH"},
        {"AttributeName":"roomId","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

# ── social-api: groups ───────────────────────────────────────────────────────

create_table social-groups \
  --attribute-definitions \
    AttributeName=groupId,AttributeType=S \
  --key-schema \
    AttributeName=groupId,KeyType=HASH

create_table social-group-members \
  --attribute-definitions \
    AttributeName=groupId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=groupId,KeyType=HASH \
    AttributeName=userId,KeyType=RANGE

# ── social-api: posts, comments, likes ──────────────────────────────────────

create_table social-posts \
  --attribute-definitions \
    AttributeName=roomId,AttributeType=S \
    AttributeName=postId,AttributeType=S \
    AttributeName=authorId,AttributeType=S \
  --key-schema \
    AttributeName=roomId,KeyType=HASH \
    AttributeName=postId,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName":"authorId-postId-index",
      "KeySchema":[
        {"AttributeName":"authorId","KeyType":"HASH"},
        {"AttributeName":"postId","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

create_table social-comments \
  --attribute-definitions \
    AttributeName=postId,AttributeType=S \
    AttributeName=commentId,AttributeType=S \
  --key-schema \
    AttributeName=postId,KeyType=HASH \
    AttributeName=commentId,KeyType=RANGE

create_table social-likes \
  --attribute-definitions \
    AttributeName=targetId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=targetId,KeyType=HASH \
    AttributeName=userId,KeyType=RANGE

# ── social-api: activity log & outbox ───────────────────────────────────────

create_table user-activity \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=userId,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE

create_table social-outbox \
  --attribute-definitions \
    AttributeName=outboxId,AttributeType=S \
    AttributeName=status,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema \
    AttributeName=outboxId,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName":"status-index",
      "KeySchema":[
        {"AttributeName":"status","KeyType":"HASH"},
        {"AttributeName":"createdAt","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }
  ]'

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "Tables in DynamoDB Local:"
$AWS list-tables --output text
echo ""
echo "✅ DynamoDB initialization complete"
