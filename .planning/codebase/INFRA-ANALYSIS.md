# Infrastructure & Deployment Analysis

**Analysis Date:** 2026-04-12

## Dockerfile Patterns

### Gateway (`Dockerfile`)

Multi-stage build: frontend Vite build in stage 1, Node.js 20-alpine production server in stage 2. Runs as non-root user (`websocket:nodejs`, uid 1001). Includes `curl` for health checks. Uses `npm install --only=production`. Has a `HEALTHCHECK` directive for container-level health.

**Strengths:**
- Non-root user
- Multi-stage build keeps image small
- Production-only deps

**Concerns:**
- `--legacy-peer-deps` in frontend stage masks dependency conflicts
- No `.dockerignore` at project root -- every `docker build` sends the entire repo context (including `node_modules/`, `.git/`, `cdk.out/`) to the daemon, slowing builds significantly
- `COPY src/ ./` copies all source files including test files, configs, etc. into the production image

### Social API (`social-api/Dockerfile`)

Single-stage build. Runs as root (no `USER` directive). No health check. Uses `npm ci` (good). Compiles TypeScript inline with `npx tsc`.

**Concerns:**
- **Runs as root** -- container compromise gives attacker root access
- **No HEALTHCHECK directive** -- Docker/ECS cannot detect unhealthy containers at the Docker level (K8s probes cover this in Helm, but not in docker-compose)
- **No `.dockerignore`** in `social-api/` -- copies `node_modules/`, test files, etc.
- **Includes devDependencies** -- `npm ci` installs everything; TypeScript compiler stays in production image
- Should use multi-stage build: compile in stage 1, copy `dist/` to stage 2 with production-only deps

### Fix Approach (social-api Dockerfile)
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:20-alpine
RUN addgroup -g 1001 -S nodejs && adduser -S social -u 1001 -G nodejs
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER social
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
```

---

## Helm Chart Quality

**Location:** `k8s/helm/websocket-gateway/`

### Structure
- `Chart.yaml` -- v0.1.0, appVersion 2.0.0
- `values.yaml` -- defaults (local dev oriented)
- `values-local.yaml` -- Colima/Tilt overrides
- `values-multi-replica.yaml` -- 3-replica CRDT sync testing
- Templates: gateway, social-api, redis, dynamodb deployments + services + configmaps

### Strengths
- Clean Helm idioms: `_helpers.tpl` with standard label/name helpers
- Components toggle with `.Values.socialApi.enabled`, `.Values.redis.enabled`, `.Values.dynamodb.enabled`
- Resource limits and requests defined for gateway and social-api
- `terminationGracePeriodSeconds: 30` + `preStop` sleep for graceful drain
- Liveness and readiness probes on both app deployments

### Concerns

**1. No production values file:**
- `values.yaml` is labeled "Default values for LOCAL development" and has `SKIP_AUTH: "true"`, dummy AWS keys, `pullPolicy: Never`
- There is no `values-production.yaml` or `values-staging.yaml`
- Files: `k8s/helm/websocket-gateway/values.yaml`

**2. Secrets in ConfigMaps:**
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are stored in plain ConfigMaps (`configmap.yaml`, `configmap-social-api.yaml`)
- Even though these are dummy values for local dev, the pattern does not support real secrets in production
- No K8s Secret resources in the chart at all
- Fix: Add a Secret template for sensitive values; use `envFrom: secretRef` in deployments

**3. No Ingress/NetworkPolicy templates:**
- Gateway service is ClusterIP only -- no Ingress for external access outside port-forwarding
- No NetworkPolicy to restrict pod-to-pod traffic
- Files: `k8s/helm/websocket-gateway/templates/service-gateway.yaml`

**4. Redis and DynamoDB have no resource limits:**
- `deployment-redis.yaml` and `deployment-dynamodb.yaml` have no `resources:` block
- Redis and DynamoDB-Local can consume unbounded memory on the dev node
- Files: `k8s/helm/websocket-gateway/templates/deployment-redis.yaml`, `k8s/helm/websocket-gateway/templates/deployment-dynamodb.yaml`

**5. DynamoDB-Local has no health check:**
- `deployment-dynamodb.yaml` has no liveness or readiness probe
- Gateway and social-api may start before DynamoDB is ready (Tilt `resource_deps` handles ordering, but K8s itself does not)
- Files: `k8s/helm/websocket-gateway/templates/deployment-dynamodb.yaml`

**6. No PersistentVolumeClaim for DynamoDB-Local or Redis:**
- Data is ephemeral; any pod restart loses all local DynamoDB tables and Redis state
- Acceptable for dev, but should be documented

---

## Tiltfile Local Dev Experience

**Location:** `Tiltfile`

### Strengths
- Clean resource dependencies: gateway and social-api wait for redis and dynamodb
- Frontend runs as a local_resource (not in K8s), avoiding slow container rebuilds
- `dynamodb-setup` local_resource creates all 12 tables after DynamoDB pod is ready
- Port forwards for all services (8080, 3001, 6379, 8000)
- `live_update` for gateway hot-reload (sync `src/` + send HUP)
- Sensible ignore lists

### Concerns

**1. `sleep 5` race condition in dynamodb-setup:**
- The `dynamodb-setup` resource uses `sleep 5` before creating tables
- If DynamoDB takes longer than 5s to become ready, table creation silently fails (each command has `|| echo "exists"`)
- Fix: Use a retry loop with `aws dynamodb list-tables` as readiness check, or add a readiness probe to the DynamoDB deployment

**2. social-api live_update recompiles TypeScript on every change:**
- `run('cd /app && npx tsc', trigger=['./social-api/src'])` runs full `tsc` compilation inside the container on every file save
- This is slow compared to using `ts-node` or `tsx` for dev mode
- Files: `Tiltfile` lines 37-40

**3. Gateway live_update sends SIGHUP to PID 1:**
- `run('kill -HUP 1 || true', trigger=['./src'])` attempts to restart by sending HUP to the node process
- Node.js does not handle SIGHUP as a restart by default -- this likely kills the process and triggers container restart, which is slower than a proper nodemon/ts-node-dev setup
- Files: `Tiltfile` lines 14-16

**4. No frontend proxy configuration documented:**
- Frontend dev server runs on :5173, gateway on :8080
- WebSocket connections from frontend must target the correct port
- The Vite dev server presumably has a proxy config, but it is not referenced in the Tiltfile

---

## K8s Resource Limits and Requests

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|------------|-----------|----------------|--------------|
| Gateway | 250m | 500m | 256Mi | 512Mi |
| Social API | 250m | 500m | 256Mi | 512Mi |
| Redis | None | None | None | None |
| DynamoDB-Local | None | None | None | None |

**Production (CDK/Fargate):**
- Gateway: 512 CPU units, 1024 MiB memory
- Redis: 256 CPU units, 512 MiB memory

**Concern:** Local K8s limits (512Mi) are half of production (1024 MiB). If the gateway is memory-hungry under load, local testing will not surface the issue at the right threshold. Redis and DynamoDB-Local have zero limits, risking node-level OOM.

---

## Health Check Robustness

### Gateway (`src/server.js` line 639)
- Always returns HTTP 200 with status "healthy"
- Reports Redis connection state, uptime, connection count, memory usage
- **Does NOT fail when Redis is disconnected** -- returns 200 with `redis: 'disconnected'`
- K8s readiness probe will keep routing traffic to a pod that cannot pub/sub
- Fix: Return 503 when Redis is disconnected (at least for readiness)

### Social API (`social-api/src/routes/health.ts`)
- Checks both DynamoDB (DescribeTable) and Redis (PING) with latency measurements
- Returns 503 if any check fails -- this is correct
- **Better than the gateway health check** -- social-api is the model to follow

### ALB Health Check (CDK `lib/fargate-service.ts` line 127)
- Path: `/health`, interval 30s, timeout 5s, healthy 2, unhealthy 3
- Matches Dockerfile HEALTHCHECK timing

**Concern:** Gateway health check never returns unhealthy. A pod with a dead Redis connection will continue receiving WebSocket upgrades but cannot relay messages cross-node. This is the highest-impact health check gap.

---

## Secrets Management

**Current state: No secrets management.**

- All env vars (including AWS keys) are passed via ConfigMaps or hardcoded in docker-compose files
- `values.yaml` contains `AWS_ACCESS_KEY_ID: DUMMYIDEXAMPLE` and `AWS_SECRET_ACCESS_KEY: DUMMYEXAMPLEKEY...` -- these are dummy values for local DynamoDB, not real credentials
- Production CDK stack uses IAM task roles (no static keys needed) -- this is correct
- `ACM_CERTIFICATE_ARN` and `ALARM_EMAIL` are read from `process.env` at CDK synth time (`lib/fargate-service.ts` line 111, `lib/websocket-gateway-stack.ts` line 134)
- `.gitignore` correctly excludes `.env` and `.env.*` files
- `.env.real` file exists (gitignored) -- contains real AWS-fetched values

**Concerns:**
- No K8s Secrets in Helm chart -- if this chart is ever used for non-local deployment, secrets will be in ConfigMaps
- No SSM Parameter Store or Secrets Manager integration in the Helm chart
- `process.env.IMAGE_URI` fallback in `lib/task-definition.ts` line 78 contains a hardcoded ECR URI with account ID `264161986065` -- not a secret, but tightly couples to one AWS account

---

## CI/CD Gaps

**Current state: No CI/CD pipeline exists.**

- No `.github/workflows/` directory (only node_modules contain `.github/` files)
- No Jenkinsfile, Buildkite, CircleCI, or GitLab CI config
- Deployment is fully manual via `deploy.sh` or `make deploy-image`

**Manual deployment flow (`deploy.sh`):**
1. Query AWS for account ID, cluster name, service name, Redis endpoint, IAM roles
2. `docker build` locally
3. Push to ECR
4. `sed` template substitution on task definition JSON
5. `aws ecs register-task-definition` + `aws ecs update-service`

**What is missing:**
- Automated tests before deploy (no gate)
- Image tagging strategy (always `:latest`)
- Rollback mechanism beyond ECS circuit breaker
- Social API has no deploy script at all -- only the gateway has `deploy.sh`
- No CDK pipeline for infrastructure changes
- No PR checks, linting, or type checking in automation

---

## Monitoring & Alerting Gaps

### What exists (production CDK):
- CloudWatch Dashboard (`lib/dashboard.ts`)
- Memory utilization alarm at 80% (`lib/alarms.ts`)
- Connection failure alarm (custom metric `WebSocketGateway/ConnectionFailures`)
- Authorization denial alarm (custom metric `WebSocketGateway/AuthorizationDenials`)
- DLQ depth alarms for all SQS queues (`lib/event-bus-stack.ts`)
- SNS alarm topic (requires `ALARM_EMAIL` env var at deploy time)

### What is missing:
- **No application-level metrics emission** -- the alarms reference custom metrics (`ConnectionFailures`, `AuthorizationDenials`) but grep shows no CloudWatch `putMetricData` calls in `src/server.js` or elsewhere. The alarms will never fire because no code publishes to those metric namespaces.
- **No Redis health monitoring** -- Redis is a critical single point of failure; no alarm for Redis being down
- **No WebSocket connection count tracking** -- no CloudWatch metric for active connections
- **No latency tracking** -- no P50/P99 message delivery latency metrics
- **No structured logging** -- gateway uses `console.log`-style logging via a custom logger, not a structured JSON logger that CloudWatch Logs Insights can query
- **No distributed tracing** -- no X-Ray, OpenTelemetry, or correlation IDs

---

## Developer Environment Setup

### Steps required for Tilt/K8s path (primary):
1. Install Colima (`brew install colima`)
2. Start Colima with K8s (`colima start --kubernetes`)
3. Install Tilt (`brew install tilt`)
4. Install AWS CLI (needed for `dynamodb-setup`)
5. Clone repo
6. `cd frontend && npm install` (frontend runs locally, not in Docker)
7. `tilt up`
8. Wait for dynamodb-setup to complete (tables created)

**Manual steps: 8** (6 one-time installs, 2 per-session)

### Steps required for docker-compose path (legacy):
1. Install Docker
2. Create `config/full-service.env` (or use existing)
3. Create external Docker network: `docker network create shared-network` (referenced in `docker-compose.yml`)
4. `make dev-local` or `docker compose -f docker-compose.local.yml up --build`
5. Manually create DynamoDB tables (no auto-setup in docker-compose path)

**Concern:** The `docker-compose.yml` references `shared-network` as `external: true` but never documents creating it. `docker-compose.local.yml` does not need it. The `docker-compose.yml` also does not include Redis -- it expects an external `core-redis`. These are leftover patterns from an earlier architecture.

### Undocumented prerequisites:
- AWS CLI must be configured (even for local -- the Tiltfile dynamodb-setup calls `aws dynamodb create-table` which needs credentials, though they can be dummy)
- `frontend/node_modules` must be installed separately (not handled by Tilt)
- No `make setup-local` or equivalent one-command bootstrap

---

## DynamoDB Table Schema Drift

This is the most dangerous infrastructure issue. The `crdt-snapshots` table has **three different schemas** across environments:

### Schema 1: `k8s/scripts/init-dynamodb.sh` and Tiltfile `dynamodb-setup`
```
Partition key: channelId (S)
Sort key: timestamp (N)
```

### Schema 2: `scripts/localstack/init/ready.d/bootstrap.sh` (line 236)
```
Partition key: documentId (S)
Sort key: timestamp (S)   # String, not Number!
```

### Schema 3: CDK production (`lib/dynamodb-table.ts`)
```
# References existing table by name only -- does not define schema
Table.fromTableName(scope, 'CrdtSnapshotsTable', 'crdt-snapshots')
```

**Impact:**
- Code in `src/services/crdt-service.js` uses one key structure; the table created locally may have a different one
- The Tiltfile creates the table with `channelId`/`timestamp(N)` while LocalStack uses `documentId`/`timestamp(S)` -- these are fundamentally different schemas
- If production was created manually with yet another schema, queries will silently return empty results or fail
- The CDK stack does not manage the table schema at all -- it only references it by name

**Additionally, tables missing from CDK production stacks:**
- `social-outbox` -- used by `social-api/src/routes/social.ts`, `posts.ts`, `reactions.ts`, `room-members.ts` but only created in LocalStack bootstrap and Tiltfile, not in `lib/social-stack.ts`
- `user-activity` -- used by `social-api/src/routes/activity.ts` but only created in LocalStack bootstrap and Tiltfile, not in CDK
- `crdt-documents` -- used by `src/services/crdt-service.js` but only created in Tiltfile dynamodb-setup, not in CDK or LocalStack bootstrap

**Fix approach:**
1. Define a single source of truth for all DynamoDB table schemas (e.g., a shared JSON or TypeScript config)
2. Add missing tables to `lib/social-stack.ts` (social-outbox, user-activity, crdt-documents)
3. Reconcile crdt-snapshots schema: determine whether the key is `channelId`/`documentId` and `N`/`S` for timestamp
4. Generate Tiltfile and LocalStack bootstrap table definitions from the single source

---

## Multiple Conflicting Dev Environment Paths

The project has accumulated four different ways to run locally:

| Path | Files | Status |
|------|-------|--------|
| Tilt + Colima K8s | `Tiltfile`, `k8s/helm/` | **Primary/current** |
| docker-compose.local.yml | `docker-compose.local.yml` | Working but missing social-api, table setup |
| docker-compose.localstack.yml | `docker-compose.localstack.yml` | Full LocalStack with EventBridge/SQS/Lambda |
| docker-compose.yml | `docker-compose.yml` | Broken -- needs external network, no Redis |

**Concern:** `docker-compose.yml` and `docker-compose.local.yml` are likely stale. The Tiltfile is the current primary path but `docker-compose.localstack.yml` has the richest environment (EventBridge, SQS, Lambda). These two paths have different DynamoDB schemas and different table sets. A developer choosing the wrong path will get confusing errors.

---

## Production CDK Stack Gaps

**Files:** `lib/websocket-gateway-stack.ts`, `lib/fargate-service.ts`, `lib/task-definition.ts`

1. **Social API not deployed to production** -- CDK stack only deploys the gateway. Social API has no Fargate service, task definition, or ALB target in CDK.

2. **Hardcoded ECR URI** -- `lib/task-definition.ts` line 78 contains `264161986065.dkr.ecr.us-east-1.amazonaws.com/websocket-gateway:latest` as fallback. This breaks for any other AWS account.

3. **No WAF** -- ALB is internet-facing with no WAF or rate limiting (`lib/fargate-service.ts`)

4. **Single-AZ Redis** -- Redis runs as a single Fargate task with no replication, failover, or persistence. If the task dies, all pub/sub state and presence data is lost.

5. **EventBridge custom metrics never emitted** -- `lib/alarms.ts` defines alarms for `WebSocketGateway/ConnectionFailures` and `WebSocketGateway/AuthorizationDenials` namespaces, but no application code calls `cloudwatch.putMetricData` for these metrics. The alarms are dead infrastructure.

6. **No auto-scaling for Redis** -- Redis is `desiredCount: 1` with no scaling policy. If connections grow, Redis becomes the bottleneck.

---

## Summary of Critical Issues (Priority Order)

| Priority | Issue | Impact | Files |
|----------|-------|--------|-------|
| **P0** | DynamoDB schema drift (3 different `crdt-snapshots` schemas) | Data corruption, silent query failures | `Tiltfile`, `scripts/localstack/init/ready.d/bootstrap.sh`, `k8s/scripts/init-dynamodb.sh` |
| **P0** | Gateway health check never returns unhealthy | Traffic routed to pods with dead Redis | `src/server.js` line 639 |
| **P1** | Tables missing from CDK (social-outbox, user-activity, crdt-documents) | Production deploy will fail when these features ship | `lib/social-stack.ts` |
| **P1** | No CI/CD pipeline | Manual deploys, no test gate, no rollback | Project root (no workflow files) |
| **P1** | CloudWatch alarms reference metrics that are never emitted | Alarms provide false sense of monitoring | `lib/alarms.ts`, `src/server.js` |
| **P2** | social-api Dockerfile runs as root, no multi-stage build | Security risk, large image | `social-api/Dockerfile` |
| **P2** | No `.dockerignore` files | Slow builds, large context sent to daemon | Project root, `social-api/` |
| **P2** | Social API not in CDK production stack | Cannot deploy social-api to AWS | `lib/websocket-gateway-stack.ts` |
| **P3** | Multiple stale docker-compose files | Developer confusion | `docker-compose.yml`, `docker-compose.local.yml` |
| **P3** | Redis/DynamoDB-Local have no resource limits in Helm | Can OOM the dev node | `k8s/helm/websocket-gateway/templates/deployment-redis.yaml` |

---

*Infrastructure analysis: 2026-04-12*
