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

# --- Frontend dev server (runs locally, not in K8s) ---
local_resource(
    'frontend-dev',
    serve_cmd='cd frontend && npm run dev',
    deps=['frontend/src', 'frontend/index.html'],
    labels=['app'],
    links=['http://localhost:5173'],
    auto_init=True,
)

# --- DynamoDB table setup (runs once after DynamoDB is ready) ---
local_resource(
    'dynamodb-setup',
    cmd='''
        sleep 5
        aws dynamodb create-table \
            --table-name crdt-snapshots \
            --attribute-definitions \
                AttributeName=channelId,AttributeType=S \
                AttributeName=timestamp,AttributeType=N \
            --key-schema \
                AttributeName=channelId,KeyType=HASH \
                AttributeName=timestamp,KeyType=RANGE \
            --billing-mode PAY_PER_REQUEST \
            --endpoint-url http://localhost:8000 \
            --region us-east-1 2>/dev/null || echo "Table already exists"
    ''',
    resource_deps=['wsg-websocket-gateway-dynamodb'],
    labels=['setup'],
)
