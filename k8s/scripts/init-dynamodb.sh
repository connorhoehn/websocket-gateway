#!/bin/bash
# Initialize DynamoDB Local with required tables
# Usage: ./k8s/scripts/init-dynamodb.sh [endpoint]

ENDPOINT="${1:-http://localhost:8000}"
REGION="${2:-us-east-1}"

echo "Initializing DynamoDB tables at $ENDPOINT..."

# Create CRDT snapshots table (key names match crdt-service.js _ensureTable)
aws dynamodb create-table \
    --table-name crdt-snapshots \
    --attribute-definitions \
        AttributeName=documentId,AttributeType=S \
        AttributeName=timestamp,AttributeType=N \
    --key-schema \
        AttributeName=documentId,KeyType=HASH \
        AttributeName=timestamp,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$ENDPOINT" \
    --region "$REGION" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ crdt-snapshots table created"
else
    echo "ℹ️  crdt-snapshots table already exists"
fi

# List tables to verify
echo ""
echo "Tables:"
aws dynamodb list-tables --endpoint-url "$ENDPOINT" --region "$REGION" --output text

echo ""
echo "✅ DynamoDB initialization complete"
