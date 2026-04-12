# Local Kubernetes Development

## Prerequisites

- [Colima](https://github.com/abiosoft/colima) — lightweight K8s runtime for macOS
- [Helm](https://helm.sh/) — Kubernetes package manager  
- [Tilt](https://tilt.dev/) — smart rebuilds and live updates
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Quick Start

### 1. Install tools
```bash
brew install colima helm kubectl tilt-dev/tap/tilt
```

### 2. Start Colima with Kubernetes
```bash
colima start --kubernetes --cpu 4 --memory 8
```

### 3. Start development
```bash
tilt up
```

Open the Tilt dashboard at http://localhost:10350

### 4. Access the app
- **Frontend**: http://localhost:5173 (Vite dev server with HMR)
- **Gateway**: ws://localhost:8080 (WebSocket)
- **Gateway Health**: http://localhost:8080/health
- **Redis**: localhost:6379
- **DynamoDB**: localhost:8000

## Daily Workflow

```bash
colima start --kubernetes   # If not already running
tilt up                     # Starts everything
# Edit code → auto-syncs → server restarts
# Ctrl+C → stops Tilt (services keep running)
tilt down                   # Tears down K8s resources
```

## Multi-Replica Testing

Test CRDT sync across multiple gateway pods:

```bash
tilt up -- --values k8s/helm/websocket-gateway/values-multi-replica.yaml
```

## Manual Helm Commands

```bash
# Install
helm install wsg k8s/helm/websocket-gateway -f k8s/helm/websocket-gateway/values-local.yaml

# Upgrade
helm upgrade wsg k8s/helm/websocket-gateway -f k8s/helm/websocket-gateway/values-local.yaml

# Uninstall
helm uninstall wsg

# Template (dry-run to see generated YAML)
helm template wsg k8s/helm/websocket-gateway -f k8s/helm/websocket-gateway/values-local.yaml
```

## Troubleshooting

### Pods not starting
```bash
kubectl get pods
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

### Reset everything
```bash
tilt down
colima stop
colima delete
colima start --kubernetes --cpu 4 --memory 8
tilt up
```

### DynamoDB table issues
```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1
```

## Architecture

```
Tilt Dashboard (:10350)
├── frontend-dev (local Vite :5173)
├── wsg-gateway (K8s pod :8080)
├── wsg-redis (K8s pod :6379)
├── wsg-dynamodb (K8s pod :8000)
└── dynamodb-setup (one-time init)
```

## Comparison with Docker Compose

| Aspect | Docker Compose | Colima + Tilt |
|--------|---------------|---------------|
| Start | `docker compose up -d` | `tilt up` |
| Hot reload | Volume mount | Tilt live_update |
| Dashboard | None | Tilt UI (:10350) |
| Multi-replica | Manual | `replicaCount: 3` |
| Logs | `docker logs` | Tilt UI (unified) |
| Prod parity | Docker only | K8s (closer to ECS) |
