# WebSocket Gateway - Local K8s Development with Tilt
# Usage: colima start --kubernetes && tilt up

# --- Configuration ---
allow_k8s_contexts('colima')

# --- Build gateway Docker image ---
docker_build(
    'websocket-gateway',
    '.',
    dockerfile='Dockerfile',
    live_update=[
        # Sync server source files into running container
        sync('./src', '/app'),
        # Restart node process when server files change
        run('kill -HUP 1 || true', trigger=['./src']),
    ],
    ignore=[
        'frontend/node_modules',
        'node_modules',
        '.planning',
        'k8s',
        'test',
        'lib',
        'bin',
        'cdk.json',
        'cdk-outputs.json',
        '.git',
    ],
)

# --- Build social-api Docker image ---
docker_build(
    'social-api',
    './social-api',
    dockerfile='social-api/Dockerfile',
    live_update=[
        sync('./social-api/src', '/app/src'),
        run('cd /app && npx tsc', trigger=['./social-api/src']),
    ],
    ignore=[
        'node_modules',
        'dist',
        '.git',
    ],
)

# --- Deploy Helm chart ---
k8s_yaml(helm(
    'k8s/helm/websocket-gateway',
    name='wsg',
    values=['k8s/helm/websocket-gateway/values-local.yaml'],
))

# --- Resource configuration ---
# Resource names match Helm deployment names: {release}-{chart}-{component}
k8s_resource('wsg-websocket-gateway-gateway',
    port_forwards=['8080:8080'],
    labels=['app'],
    resource_deps=['wsg-websocket-gateway-redis', 'wsg-websocket-gateway-dynamodb'],
)
k8s_resource('wsg-websocket-gateway-redis',
    port_forwards=['6379:6379'],
    labels=['infra'],
)
k8s_resource('wsg-websocket-gateway-dynamodb',
    port_forwards=['8000:8000'],
    labels=['infra'],
)
k8s_resource('wsg-websocket-gateway-social-api',
    port_forwards=['3001:3001'],
    labels=['app'],
    resource_deps=['wsg-websocket-gateway-redis', 'wsg-websocket-gateway-dynamodb'],
)

# --- Frontend dev server (runs locally, not in K8s) ---
local_resource(
    'frontend-dev',
    serve_cmd='cd frontend && npm run dev',
    deps=['frontend/src', 'frontend/index.html'],
    labels=['app'],
    links=['http://localhost:5174'],
    auto_init=True,
)

# --- DynamoDB table setup (runs once after DynamoDB is ready) ---
local_resource(
    'dynamodb-setup',
    cmd='''
        sleep 5
        ENDPOINT="--endpoint-url http://localhost:8000 --region us-east-1"

        # Gateway CRDT table (key names must match crdt-service.js _ensureTable / retrieveLatestSnapshot)
        aws dynamodb create-table \
            --table-name crdt-snapshots \
            --attribute-definitions \
                AttributeName=documentId,AttributeType=S \
                AttributeName=timestamp,AttributeType=N \
            --key-schema \
                AttributeName=documentId,KeyType=HASH \
                AttributeName=timestamp,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            $ENDPOINT 2>/dev/null || echo "crdt-snapshots exists"

        # Social API tables + gateway doc registry
        CT="aws dynamodb create-table --billing-mode PAY_PER_REQUEST $ENDPOINT"

        $CT --table-name social-profiles --attribute-definitions AttributeName=userId,AttributeType=S --key-schema AttributeName=userId,KeyType=HASH 2>/dev/null || echo "social-profiles exists"
        aws dynamodb create-table --table-name social-relationships \
            --attribute-definitions AttributeName=followerId,AttributeType=S AttributeName=followeeId,AttributeType=S \
            --key-schema AttributeName=followerId,KeyType=HASH AttributeName=followeeId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"followeeId-followerId-index","KeySchema":[{"AttributeName":"followeeId","KeyType":"HASH"},{"AttributeName":"followerId","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "social-relationships exists"
        aws dynamodb create-table --table-name social-outbox \
            --attribute-definitions AttributeName=outboxId,AttributeType=S AttributeName=status,AttributeType=S AttributeName=createdAt,AttributeType=S \
            --key-schema AttributeName=outboxId,KeyType=HASH \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"status-index","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "social-outbox exists"
        $CT --table-name social-rooms --attribute-definitions AttributeName=roomId,AttributeType=S --key-schema AttributeName=roomId,KeyType=HASH 2>/dev/null || echo "social-rooms exists"
        aws dynamodb create-table --table-name social-room-members \
            --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=userId,AttributeType=S \
            --key-schema AttributeName=roomId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"userId-roomId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"roomId","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "social-room-members exists"
        $CT --table-name social-groups --attribute-definitions AttributeName=groupId,AttributeType=S --key-schema AttributeName=groupId,KeyType=HASH 2>/dev/null || echo "social-groups exists"
        $CT --table-name social-group-members --attribute-definitions AttributeName=groupId,AttributeType=S AttributeName=userId,AttributeType=S --key-schema AttributeName=groupId,KeyType=HASH AttributeName=userId,KeyType=RANGE 2>/dev/null || echo "social-group-members exists"
        aws dynamodb create-table --table-name social-posts \
            --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=postId,AttributeType=S AttributeName=authorId,AttributeType=S \
            --key-schema AttributeName=roomId,KeyType=HASH AttributeName=postId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"authorId-postId-index","KeySchema":[{"AttributeName":"authorId","KeyType":"HASH"},{"AttributeName":"postId","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "social-posts exists"
        $CT --table-name social-comments --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=commentId,AttributeType=S --key-schema AttributeName=postId,KeyType=HASH AttributeName=commentId,KeyType=RANGE 2>/dev/null || echo "social-comments exists"
        $CT --table-name social-likes --attribute-definitions AttributeName=targetId,AttributeType=S AttributeName=userId,AttributeType=S --key-schema AttributeName=targetId,KeyType=HASH AttributeName=userId,KeyType=RANGE 2>/dev/null || echo "social-likes exists"
        $CT --table-name user-activity --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=timestamp,AttributeType=S --key-schema AttributeName=userId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE 2>/dev/null || echo "user-activity exists"
        $CT --table-name crdt-documents --attribute-definitions AttributeName=documentId,AttributeType=S --key-schema AttributeName=documentId,KeyType=HASH 2>/dev/null || echo "crdt-documents exists"
        $CT --table-name chat-messages --attribute-definitions AttributeName=channelId,AttributeType=S AttributeName=messageId,AttributeType=S --key-schema AttributeName=channelId,KeyType=HASH AttributeName=messageId,KeyType=RANGE 2>/dev/null || echo "chat-messages exists"
        $CT --table-name document-video-sessions --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=sessionId,AttributeType=S --key-schema AttributeName=documentId,KeyType=HASH AttributeName=sessionId,KeyType=RANGE 2>/dev/null || echo "document-video-sessions exists"

        aws dynamodb create-table --table-name section-items \
            --attribute-definitions AttributeName=sectionKey,AttributeType=S AttributeName=itemId,AttributeType=S AttributeName=assignee,AttributeType=S AttributeName=status,AttributeType=S AttributeName=documentId,AttributeType=S \
            --key-schema AttributeName=sectionKey,KeyType=HASH AttributeName=itemId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"assignee-status-index","KeySchema":[{"AttributeName":"assignee","KeyType":"HASH"},{"AttributeName":"status","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"documentId-index","KeySchema":[{"AttributeName":"documentId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "section-items exists"
        $CT --table-name document-sections --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=sectionId,AttributeType=S --key-schema AttributeName=documentId,KeyType=HASH AttributeName=sectionId,KeyType=RANGE 2>/dev/null || echo "document-sections exists"

        aws dynamodb create-table --table-name approval-workflows \
            --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=workflowId,AttributeType=S AttributeName=workflowStatus,AttributeType=S AttributeName=createdAt,AttributeType=S \
            --key-schema AttributeName=documentId,KeyType=HASH AttributeName=workflowId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"status-index","KeySchema":[{"AttributeName":"workflowStatus","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "approval-workflows exists"
        aws dynamodb create-table --table-name document-comments \
            --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=commentId,AttributeType=S AttributeName=sectionId,AttributeType=S AttributeName=timestamp,AttributeType=S \
            --key-schema AttributeName=documentId,KeyType=HASH AttributeName=commentId,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"sectionId-timestamp-index","KeySchema":[{"AttributeName":"sectionId","KeyType":"HASH"},{"AttributeName":"timestamp","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "document-comments exists"
        aws dynamodb create-table --table-name section-reviews \
            --attribute-definitions AttributeName=documentId,AttributeType=S AttributeName=reviewKey,AttributeType=S AttributeName=userId,AttributeType=S AttributeName=sectionId,AttributeType=S AttributeName=timestamp,AttributeType=S \
            --key-schema AttributeName=documentId,KeyType=HASH AttributeName=reviewKey,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --global-secondary-indexes '[{"IndexName":"userId-documentId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"documentId","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"sectionId-timestamp-index","KeySchema":[{"AttributeName":"sectionId","KeyType":"HASH"},{"AttributeName":"timestamp","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
            $ENDPOINT 2>/dev/null || echo "section-reviews exists"

        # Phase 51 Phase A — document-type schemas + typed-document instances.
        $CT --table-name document-types --attribute-definitions AttributeName=typeId,AttributeType=S --key-schema AttributeName=typeId,KeyType=HASH 2>/dev/null || echo "document-types exists"
        $CT --table-name typed-documents --attribute-definitions AttributeName=documentId,AttributeType=S --key-schema AttributeName=documentId,KeyType=HASH 2>/dev/null || echo "typed-documents exists"

        echo "All tables ready"
    ''',
    resource_deps=['wsg-websocket-gateway-dynamodb'],
    labels=['setup'],
)
