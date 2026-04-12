# Local Dev Migration: Docker Compose → Colima + Helm + Tilt

## Prerequisites

```bash
# Install Colima (Kubernetes runtime for macOS)
brew install colima
colima start --kubernetes --cpu 4 --memory 8

# Install Helm
brew install helm

# Install Tilt (live-reload for K8s)
brew install tilt-dev/tap/tilt

# Install kubectl (if not already)
brew install kubectl
```

## Directory Structure

```
k8s/
├── helm/
│   └── websocket-gateway/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values-local.yaml        # Local dev overrides
│       ├── templates/
│       │   ├── _helpers.tpl
│       │   ├── deployment-gateway.yaml
│       │   ├── deployment-redis.yaml
│       │   ├── deployment-dynamodb.yaml
│       │   ├── service-gateway.yaml
│       │   ├── service-redis.yaml
│       │   ├── service-dynamodb.yaml
│       │   ├── configmap.yaml
│       │   └── secret.yaml
│       └── .helmignore
├── Tiltfile                         # Tilt configuration
└── README.md
```

## Phase 1: Helm Chart (maps 1:1 to docker-compose)

### Chart.yaml
```yaml
apiVersion: v2
name: websocket-gateway
description: Real-time collaborative document editing platform
version: 0.1.0
appVersion: "1.0.0"
```

### values.yaml (defaults = local dev)
```yaml
gateway:
  replicaCount: 1
  image:
    repository: websocket-gateway
    tag: latest
    pullPolicy: Never  # Local builds, no registry pull
  port: 8080
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 250m
      memory: 256Mi
  env:
    NODE_ENV: development
    LOG_LEVEL: debug
    PORT: "8080"
    ENABLED_SERVICES: "chat,presence,cursor,reaction,crdt"
    SKIP_AUTH: "true"
    COGNITO_REGION: us-east-1
    COGNITO_USER_POOL_ID: us-east-1_localdev000
    REDIS_ENDPOINT: redis
    REDIS_PORT: "6379"
    REDIS_URL: redis://redis:6379
    DIRECT_DYNAMO_WRITE: "true"
    DYNAMODB_CRDT_TABLE: crdt-snapshots
    SNAPSHOT_INTERVAL_MS: "30000"
    AWS_ACCESS_KEY_ID: DUMMYIDEXAMPLE
    AWS_SECRET_ACCESS_KEY: DUMMYEXAMPLEKEY000000000000000000000000000
    AWS_REGION: us-east-1
  healthCheck:
    path: /health
    initialDelaySeconds: 10
    periodSeconds: 15
    timeoutSeconds: 5

redis:
  enabled: true
  image: redis:7-alpine
  port: 6379

dynamodb:
  enabled: true
  image: amazon/dynamodb-local:1.25.0
  port: 8000
  persistence:
    enabled: true
    size: 1Gi

frontend:
  devServer:
    enabled: true  # Run Vite dev server separately via Tilt
    port: 5173
```

### Templates

**deployment-gateway.yaml** — Deployment with:
- Container from local image
- All env vars from configmap
- Liveness/readiness probes on /health
- Volume mount for src/ (via Tilt live_update)

**deployment-redis.yaml** — Single-pod Redis
- redis:7-alpine
- Port 6379
- No persistence needed for dev

**deployment-dynamodb.yaml** — DynamoDB Local
- amazon/dynamodb-local:1.25.0
- Port 8000
- PVC for data persistence

**service-gateway.yaml** — ClusterIP on 8080
**service-redis.yaml** — ClusterIP on 6379
**service-dynamodb.yaml** — ClusterIP on 8000

**configmap.yaml** — All non-secret env vars
**secret.yaml** — AWS dummy credentials

## Phase 2: Tiltfile (hot-reload dev workflow)

```python
# Tiltfile

# --- Build gateway image ---
docker_build(
    'websocket-gateway',
    '.',
    dockerfile='Dockerfile',
    live_update=[
        # Sync server source for hot-reload (no rebuild needed)
        sync('./src', '/app'),
        # Restart server when JS files change
        run('kill -HUP 1', trigger=['./src']),
    ],
    ignore=[
        'frontend/node_modules',
        'node_modules',
        '.planning',
        'k8s',
        'test',
        'lib',
    ],
)

# --- Deploy Helm chart ---
k8s_yaml(helm(
    'k8s/helm/websocket-gateway',
    name='wsg',
    values=['k8s/helm/websocket-gateway/values-local.yaml'],
))

# --- Port forwards ---
k8s_resource('wsg-gateway',
    port_forwards=['8080:8080'],
    labels=['app'],
)
k8s_resource('wsg-redis',
    port_forwards=['6379:6379'],
    labels=['infra'],
)
k8s_resource('wsg-dynamodb',
    port_forwards=['8000:8000'],
    labels=['infra'],
)

# --- Frontend dev server (runs locally, not in K8s) ---
local_resource(
    'frontend-dev',
    serve_cmd='cd frontend && npm run dev',
    deps=['frontend/src'],
    labels=['app'],
    links=['http://localhost:5173'],
)

# --- DynamoDB table creation (one-time setup) ---
local_resource(
    'dynamodb-setup',
    cmd='sleep 5 && aws dynamodb create-table --table-name crdt-snapshots --attribute-definitions AttributeName=channelId,AttributeType=S AttributeName=timestamp,AttributeType=N --key-schema AttributeName=channelId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE --billing-mode PAY_PER_REQUEST --endpoint-url http://localhost:8000 --region us-east-1 2>/dev/null || true',
    resource_deps=['wsg-dynamodb'],
    labels=['setup'],
)
```

## Phase 3: Developer Workflow

### First-time setup
```bash
# Start Colima with K8s
colima start --kubernetes --cpu 4 --memory 8

# Start everything
tilt up

# Open Tilt dashboard
# → http://localhost:10350
```

### Daily workflow
```bash
colima start --kubernetes   # If not running
tilt up                     # Starts all services + frontend
# Edit code → Tilt auto-syncs → Server restarts
# Frontend HMR via Vite dev server
# Ctrl+C to stop
```

### What Tilt provides
- **Dashboard** at localhost:10350 showing all services status
- **Live update** — edit src/*.js → synced to pod → server restarts (no image rebuild)
- **Frontend HMR** — Vite dev server runs locally with hot module replacement
- **Log streaming** — all service logs in one UI
- **Health monitoring** — shows readiness/liveness status
- **One command** — `tilt up` replaces `docker compose up -d && cd frontend && npm run dev`

## Phase 4: Multi-replica testing

```yaml
# values-multi-replica.yaml
gateway:
  replicaCount: 3  # Test CRDT sync across 3 nodes
```

```bash
tilt up -- --values k8s/helm/websocket-gateway/values-multi-replica.yaml
```

This lets you test:
- CRDT document sync across multiple gateway pods
- Redis pub/sub message routing between nodes
- Session recovery when a pod restarts
- Load balancing WebSocket connections

## Migration Checklist

- [ ] Install prerequisites (Colima, Helm, Tilt, kubectl)
- [ ] Create `k8s/helm/websocket-gateway/` chart structure
- [ ] Write Helm templates (3 deployments, 3 services, configmap, secret)
- [ ] Write `Tiltfile` with live_update
- [ ] Test `tilt up` starts all services
- [ ] Verify WebSocket connection from frontend
- [ ] Verify CRDT sync between tabs
- [ ] Verify Redis pub/sub works
- [ ] Verify DynamoDB table creation
- [ ] Add `values-multi-replica.yaml` for scaling tests
- [ ] Update README with new dev workflow
- [ ] Keep docker-compose.local.yml as fallback

## Files to Create (8 total)

1. `k8s/helm/websocket-gateway/Chart.yaml`
2. `k8s/helm/websocket-gateway/values.yaml`
3. `k8s/helm/websocket-gateway/values-local.yaml`
4. `k8s/helm/websocket-gateway/templates/_helpers.tpl`
5. `k8s/helm/websocket-gateway/templates/deployment-gateway.yaml`
6. `k8s/helm/websocket-gateway/templates/deployment-redis.yaml`
7. `k8s/helm/websocket-gateway/templates/deployment-dynamodb.yaml`
8. `k8s/helm/websocket-gateway/templates/service-gateway.yaml`
9. `k8s/helm/websocket-gateway/templates/service-redis.yaml`
10. `k8s/helm/websocket-gateway/templates/service-dynamodb.yaml`
11. `k8s/helm/websocket-gateway/templates/configmap.yaml`
12. `k8s/helm/websocket-gateway/templates/secret.yaml`
13. `Tiltfile`
14. `k8s/README.md`
