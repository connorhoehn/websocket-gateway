# Phase 34: LocalStack Dev Environment - Research

**Researched:** 2026-03-17
**Domain:** LocalStack, Docker Compose, AWS SDK v3 endpoint override, Lambda local invocation and debugging
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LDEV-01 | Developer can run EventBridge + SQS + Lambda locally via LocalStack in Docker without AWS access | LocalStack `stable` image supports all three services; bootstrap shell scripts in `ready.d` provision resources at startup |
| LDEV-02 | Developer can run Redis via ECS container locally (no ElastiCache dependency) | `redis:7-alpine` already used in `docker-compose.local.yml`; extend to new compose file |
| LDEV-03 | Lambda handlers are invocable and debuggable locally against LocalStack with realistic payloads | `awslocal lambda invoke --payload` for invocation; `LAMBDA_DOCKER_FLAGS=-e NODE_OPTIONS=--inspect-brk=0.0.0.0:9229 -p 9229:9229` for debug attach |
</phase_requirements>

---

## Summary

Phase 34 creates the self-contained local development environment for all v3.0 work. Every AWS service required by phases 35-38 (EventBridge, SQS, Lambda, DynamoDB, Redis) must run in Docker without any real AWS account access. LocalStack is the industry-standard emulator for this purpose: it exposes a single port (4566) that responds to all AWS SDK/CLI calls and runs as a Docker container.

The project already has a `docker-compose.local.yml` that runs the websocket-gateway and a Redis container. Phase 34 extends this pattern by adding LocalStack as a service and wiring all application services to point their AWS SDK clients at `http://localstack:4566` when `LOCALSTACK_ENDPOINT` is set. A shell bootstrap script mounted into LocalStack's `/etc/localstack/init/ready.d/` will provision the EventBridge bus, SQS queues, and DynamoDB tables on every startup, making the environment fully reproducible.

Lambda debugging uses LocalStack's built-in `LAMBDA_DOCKER_FLAGS` mechanism to inject `--inspect-brk` into Lambda containers. The developer invokes a function with `awslocal lambda invoke`, VS Code attaches to port 9229, and breakpoints in the handler source fire normally.

**Primary recommendation:** Use `localstack/localstack:stable` in Docker Compose, mount a `scripts/localstack/init/ready.d/bootstrap.sh` for resource provisioning, override AWS SDK client endpoints via `LOCALSTACK_ENDPOINT` environment variable, and use `LAMBDA_DOCKER_FLAGS` for debug attach.

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `localstack/localstack` Docker image | `stable` (v4.14.0 as of 2026-02-26) | Emulates all AWS services locally | Official LocalStack image; `stable` tag tracks the latest fully-tested release |
| `redis:7-alpine` Docker image | 7.x | Redis container for local dev | Already in `docker-compose.local.yml`; alpine variant is small |
| `awslocal` CLI wrapper | bundled with `awscli-local` pip package | Wraps `aws` CLI with `--endpoint-url=http://localhost:4566` preset | Eliminates repetitive `--endpoint-url` flags in all bootstrap scripts |
| `@aws-sdk/client-eventbridge` | ^3.x (matches existing `@aws-sdk/client-dynamodb`) | EventBridge client for SDK v3 | Required for Phase 36 EventPublisher |
| `@aws-sdk/client-sqs` | ^3.x | SQS client for SDK v3 | Required for Phase 35/37 consumers |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `@aws-sdk/client-lambda` | ^3.x | Lambda invocation client | Integration tests invoking Lambdas programmatically |
| Docker Compose `volumes` — `/var/run/docker.sock` mount | n/a | Allows LocalStack to spawn Lambda execution containers | Required when LocalStack runs Lambda functions in containers |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `localstack/localstack:stable` | `localstack/localstack:latest` | `latest` = most recent commit, possibly not release-tested; `stable` is safer for a dev environment that must not break |
| `awslocal` CLI wrapper | `aws --endpoint-url=http://localhost:4566` | Both work; `awslocal` removes boilerplate in every script call |
| Init hook bootstrap shell script | Terraform init hook | Shell is simpler; no additional extension install required |

### Installation

```bash
# Install awscli-local for the awslocal wrapper (bootstrap scripts and manual testing)
pip install awscli-local

# Add SDK clients to social-api as needed by downstream phases
cd social-api && npm install @aws-sdk/client-eventbridge @aws-sdk/client-sqs
```

---

## Architecture Patterns

### Recommended Project Structure

```
docker-compose.localstack.yml          # New: LocalStack + Redis + all app services
scripts/
└── localstack/
    └── init/
        └── ready.d/
            └── bootstrap.sh           # Provisions EventBridge bus, SQS queues, DynamoDB tables
config/
└── localstack.env                     # Env vars for LocalStack-targeted services
lambdas/
└── activity-log/                      # Lambda handler for Phase 37 (placeholder dir now)
    ├── handler.ts
    └── package.json
```

### Pattern 1: LocalStack Docker Compose Service

**What:** Add a `localstack` service to Docker Compose that other services `depends_on` with a health check condition.
**When to use:** Always — LocalStack must be healthy before application services try to connect to it.

```yaml
# Source: https://docs.localstack.cloud/references/configuration/
localstack:
  image: localstack/localstack:stable
  container_name: localstack
  ports:
    - "4566:4566"
  environment:
    - DEBUG=1
    - PERSISTENCE=0
    - LAMBDA_DOCKER_NETWORK=localstack-network
    - LAMBDA_DOCKER_FLAGS=-e NODE_OPTIONS=--inspect-brk=0.0.0.0:9229 -p 9229:9229
  volumes:
    - ./scripts/localstack/init:/etc/localstack/init
    - /var/run/docker.sock:/var/run/docker.sock
  networks:
    - localstack-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 15s
```

**Note:** `LAMBDA_DOCKER_NETWORK` must match the Docker network name so Lambda containers LocalStack spawns can reach the same network.

### Pattern 2: AWS SDK v3 Client LocalStack Endpoint Override

**What:** When `LOCALSTACK_ENDPOINT` env var is set, pass it as the `endpoint` to every AWS SDK client. When unset, clients behave normally (pointing at real AWS).
**When to use:** In every file that creates an AWS SDK client.

```typescript
// Source: https://docs.localstack.cloud/aws/integrations/aws-sdks/javascript/
const localstackEndpoint = process.env.LOCALSTACK_ENDPOINT; // e.g. "http://localstack:4566"

const ddb = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(localstackEndpoint && {
    endpoint: localstackEndpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  }),
});
```

Apply the same pattern to `EventBridgeClient`, `SQSClient`, `LambdaClient`. Use a shared factory module `src/lib/aws-clients.ts` to avoid repetition.

### Pattern 3: Init Hook Bootstrap Script

**What:** Shell script in `/etc/localstack/init/ready.d/` runs automatically when LocalStack is ready.
**When to use:** Provisioning resources (EventBridge bus, SQS queues, DynamoDB tables) at container startup so the environment is ready without manual steps.

```bash
#!/bin/bash
# Source: https://docs.localstack.cloud/aws/capabilities/config/initialization-hooks/
set -e

echo "==> Bootstrapping LocalStack resources..."

# EventBridge custom bus (Phase 35 will use this)
awslocal events create-event-bus --name social-events || true

# SQS queues (Phase 35 will expand these)
awslocal sqs create-queue --queue-name social-follows || true
awslocal sqs create-queue --queue-name social-rooms   || true
awslocal sqs create-queue --queue-name social-posts   || true
awslocal sqs create-queue --queue-name social-reactions || true

# DynamoDB tables required for Phase 37 Activity Log
awslocal dynamodb create-table \
  --table-name user-activity \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

echo "==> Bootstrap complete."
```

**Note:** `|| true` on each command prevents script failure if resources already exist (idempotent).

### Pattern 4: Lambda Local Invocation Script

**What:** Shell script that deploys a handler zip to LocalStack and invokes it with a realistic payload.
**When to use:** Developer wants to manually test a Lambda handler from the terminal (LDEV-03).

```bash
#!/bin/bash
# scripts/invoke-lambda.sh
# Usage: ./scripts/invoke-lambda.sh activity-log '{"source":"social","detail-type":"social.follow","detail":{"followerId":"u1","followeeId":"u2"}}'
FUNCTION_NAME=$1
PAYLOAD=$2

# Package and (re)deploy
cd lambdas/$FUNCTION_NAME
zip -r /tmp/$FUNCTION_NAME.zip . -x "node_modules/*"

awslocal lambda create-function \
  --function-name $FUNCTION_NAME \
  --runtime nodejs22.x \
  --zip-file fileb:///tmp/$FUNCTION_NAME.zip \
  --handler handler.handler \
  --role arn:aws:iam::000000000000:role/lambda-role 2>/dev/null || \
awslocal lambda update-function-code \
  --function-name $FUNCTION_NAME \
  --zip-file fileb:///tmp/$FUNCTION_NAME.zip

# Invoke
awslocal lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out \
  /tmp/$FUNCTION_NAME-output.json

cat /tmp/$FUNCTION_NAME-output.json
```

### Anti-Patterns to Avoid

- **Hardcoding `http://localhost:4566` in application source code:** The endpoint must be injected via environment variable so production code is unaffected. Services inside Docker Compose must use the Docker service name (`http://localstack:4566`), not `localhost`.
- **Not mounting Docker socket:** Without `/var/run/docker.sock:/var/run/docker.sock`, LocalStack cannot spawn Lambda execution containers and `lambda invoke` will fail.
- **Missing `LAMBDA_DOCKER_NETWORK`:** If omitted, Lambda containers land on a different network than LocalStack and cannot call back to it.
- **Using `LAMBDA_DOCKER_FLAGS` with `--inspect-brk` for all CI invocations:** `--inspect-brk` breaks execution waiting for debugger attachment. Keep debug config in a separate compose override file.
- **`||true` omitted from bootstrap script:** Without it, a second `docker compose up` will fail with "resource already exists" and abort initialization.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AWS service emulation | Custom HTTP mock server | `localstack/localstack` | LocalStack handles service API fidelity, error codes, IAM, SQS visibility timeouts, etc. — thousands of edge cases |
| Bootstrap idempotency | Custom "exists check" logic | `|| true` pattern in shell + `awslocal` | `awslocal` returns non-zero exit on "resource exists"; `|| true` is the canonical pattern |
| Lambda debugger attach | Custom TCP proxy | LocalStack `LAMBDA_DOCKER_FLAGS=--inspect-brk` + VS Code attach config | LocalStack injects the flag into the Lambda container automatically |
| Fake AWS credentials | `.env` credential rotation scripts | Static test credentials `accessKeyId=test secretAccessKey=test` | LocalStack accepts any credential string; rotating fakes adds zero value |
| Service health polling | `sleep 30` before app starts | Docker Compose `healthcheck` + `depends_on: condition: service_healthy` | Deterministic — only proceeds when LocalStack health endpoint returns 200 |

**Key insight:** LocalStack is a mature, battle-tested emulator. The main risk is over-engineering the bootstrap layer. Keep init scripts minimal — only provision what Phase 35–38 will actually consume.

---

## Common Pitfalls

### Pitfall 1: Lambda Containers Can't Reach LocalStack

**What goes wrong:** `awslocal lambda invoke` executes successfully, but the handler's SDK calls to DynamoDB/SQS fail with connection refused.
**Why it happens:** LocalStack spawns Lambda containers on Docker's default bridge network, not on the compose project's named network. The container resolves `localstack` as an unknown hostname.
**How to avoid:** Set `LAMBDA_DOCKER_NETWORK=localstack-network` (or whatever the compose network name is) in LocalStack's environment. Verify with `docker network ls`.
**Warning signs:** Lambda invocation succeeds (exit code 0) but response body contains `{"errorType":"UnknownError","errorMessage":"connect ECONNREFUSED"}`.

### Pitfall 2: Port Conflict on 9229 with Multiple Lambda Invocations

**What goes wrong:** Second concurrent Lambda invocation fails to attach debugger or causes the first one to lose its session.
**Why it happens:** `--inspect-brk=0.0.0.0:9229` binds a fixed port. Two concurrent Lambda containers both try to bind 9229.
**How to avoid:** Only use the debug-mode compose override for deliberate debugging sessions, not for routine invocations. Alternatively, use `LAMBDA_DEBUG_MODE` + per-function debug config YAML which assigns unique ports per function.
**Warning signs:** `Error: listen EADDRINUSE: address already in use :::9229` in LocalStack logs.

### Pitfall 3: Existing DynamoDB Tables Not in LocalStack

**What goes wrong:** Routes that already work in production (profiles, posts, etc.) throw `ResourceNotFoundException` when social-api is pointed at LocalStack.
**Why it happens:** The bootstrap script only creates v3.0 tables. All v2.0 tables (social-profiles, social-relationships, etc.) are missing from LocalStack.
**How to avoid:** Either add all 9 existing social tables to the bootstrap script, or set social-api's `LOCALSTACK_ENDPOINT` only for the new v3.0 services (EventBridge/SQS) and keep DynamoDB pointing at real AWS (or a separate local DynamoDB emulator).
**Warning signs:** `social-api` 500s on profile/post endpoints when running with `LOCALSTACK_ENDPOINT` set.

**Decision required:** The bootstrap script should include all 9 existing social DynamoDB table definitions so `docker compose up` is truly self-contained for all of v3.0 development. This is preferable over a split-endpoint approach.

### Pitfall 4: `localhost` vs Docker Service Name

**What goes wrong:** `awslocal` works from the host machine but social-api container fails to reach LocalStack.
**Why it happens:** Inside Docker Compose, service names resolve via Docker's embedded DNS. `localhost:4566` inside a container refers to the container itself, not LocalStack.
**How to avoid:** Use `http://localstack:4566` as the endpoint for services inside Docker Compose, `http://localhost:4566` for tools running on the host machine (bootstrap scripts, `awslocal` from terminal).
**Warning signs:** ECONNREFUSED on port 4566 in service container logs, but `curl http://localhost:4566/_localstack/health` works from the host.

### Pitfall 5: Cognito Auth Blocks Local Lambda Testing

**What goes wrong:** Developer tries to invoke social-api endpoints from a Lambda handler but Cognito JWT validation fails (no real Cognito in LocalStack).
**Why it happens:** `auth.ts` calls the real Cognito JWKS endpoint for token validation.
**How to avoid:** Lambda handlers in v3.0 are consumers (they read from SQS/EventBridge, write to DynamoDB) — they don't call social-api. They use the DynamoDB SDK client directly. No Cognito dependency. Document this clearly so developers don't try to call social-api from Lambdas.
**Warning signs:** N/A for Lambda handlers — only relevant if someone wires a Lambda to call social-api directly.

---

## Code Examples

### Complete Docker Compose for LocalStack Environment

```yaml
# Source: https://docs.localstack.cloud/references/configuration/
version: '3.8'

services:
  localstack:
    image: localstack/localstack:stable
    container_name: localstack
    ports:
      - "4566:4566"
    environment:
      - DEBUG=1
      - PERSISTENCE=0
      - LAMBDA_DOCKER_NETWORK=localstack-network
    volumes:
      - ./scripts/localstack/init:/etc/localstack/init
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - localstack-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 15s

  redis:
    image: redis:7-alpine
    container_name: localstack-redis
    ports:
      - "6379:6379"
    networks:
      - localstack-network

  websocket-gateway:
    build:
      context: .
      dockerfile: Dockerfile
    depends_on:
      localstack:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=development
      - LOCALSTACK_ENDPOINT=http://localstack:4566
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
      - AWS_REGION=us-east-1
    networks:
      - localstack-network

  social-api:
    build:
      context: ./social-api
    depends_on:
      localstack:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      - REDIS_ENDPOINT=redis
      - REDIS_PORT=6379
      - LOCALSTACK_ENDPOINT=http://localstack:4566
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
      - AWS_REGION=us-east-1
      - COGNITO_REGION=us-east-1
      - COGNITO_USER_POOL_ID=us-east-1_localdev000
      - NODE_ENV=development
    networks:
      - localstack-network

networks:
  localstack-network:
    driver: bridge
```

### AWS SDK v3 Client Factory Module

```typescript
// Source: https://docs.localstack.cloud/aws/integrations/aws-sdks/javascript/
// social-api/src/lib/aws-clients.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';

const endpoint = process.env.LOCALSTACK_ENDPOINT;
const localstackConfig = endpoint
  ? {
      endpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }
  : {};

const region = process.env.AWS_REGION ?? 'us-east-1';

export const ddbClient = new DynamoDBClient({ region, ...localstackConfig });
export const eventBridgeClient = new EventBridgeClient({ region, ...localstackConfig });
export const sqsClient = new SQSClient({ region, ...localstackConfig });
```

### VS Code Debug Launch Config

```json
// Source: https://docs.localstack.cloud/aws/tooling/lambda-tools/remote-debugging/
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to LocalStack Lambda",
      "type": "node",
      "request": "attach",
      "address": "127.0.0.1",
      "port": 9229,
      "remoteRoot": "/var/task/",
      "localRoot": "${workspaceFolder}/lambdas",
      "sourceMaps": true,
      "timeout": 30000
    }
  ]
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `SERVICES=s3,sqs,...` env var to restrict services | Services load on-demand by default in v3+ | LocalStack v3.0 (2024) | No need to enumerate services — all load lazily |
| `__local__` S3 bucket for hot reload | `hot-reload` magic bucket name | LocalStack v2.0 | Old name still works but deprecated |
| `LAMBDA_EXECUTOR=local` (runs Lambda in same process) | Removed — Lambda always runs in containers | LocalStack v3.0 | Handlers must be zip-deployed; can't pass function references |
| `localstack/localstack-full` image | `localstack/localstack:stable` (merged) | v1.x → v2.x | Single image handles all services |

**Deprecated/outdated:**
- `SERVICES` env var for restricting which services start: No longer required in v3+; services load on first request. Still valid for startup performance optimization but not needed for correctness.
- `LAMBDA_EXECUTOR=local`: Removed entirely. Lambda always executes in a Docker container.
- `LAMBDA_REMOTE_DOCKER=0`: Also removed in v3. Lambda execution is always containerized.

---

## Open Questions

1. **Should all 9 existing social DynamoDB tables be created in the bootstrap script?**
   - What we know: Phase 34 goal is a self-contained environment for v3.0 work. If social-api's `LOCALSTACK_ENDPOINT` points at LocalStack for DynamoDB, all 9 tables must exist or social-api errors on startup.
   - What's unclear: Whether v3.0 development will run social-api in the compose stack (needed for end-to-end testing) or run it against real AWS.
   - Recommendation: Create all 9 tables in the bootstrap script. Adds ~10 lines of shell; makes the environment fully self-contained. Plan 34-01 should include this.

2. **Debug-mode Lambda compose override vs always-on debug flags**
   - What we know: `--inspect-brk` blocks Lambda invocation until a debugger attaches. If left always-on, automated invoke scripts will hang.
   - What's unclear: Whether developers prefer a separate `docker-compose.debug.yml` override or a Makefile target that sets `LAMBDA_DOCKER_FLAGS` only when requested.
   - Recommendation: Provide a `docker-compose.debug.yml` override that adds `LAMBDA_DOCKER_FLAGS` to the LocalStack service. Normal `docker compose up` doesn't set debug flags; `docker compose -f docker-compose.localstack.yml -f docker-compose.debug.yml up` enables them.

3. **`awslocal` availability in CI/developer environments**
   - What we know: `awslocal` requires `pip install awscli-local`. Developers with only Node/Docker toolchains may not have Python pip.
   - What's unclear: Project's standard developer toolchain requirements.
   - Recommendation: Document `pip install awscli-local` in a setup section of CLAUDE.md or a `scripts/localstack/README.md`. Alternatively, invoke scripts can use `aws --endpoint-url=http://localhost:4566` directly as a fallback.

---

## Sources

### Primary (HIGH confidence)
- [LocalStack JavaScript SDK Integration](https://docs.localstack.cloud/aws/integrations/aws-sdks/javascript/) — AWS SDK v3 endpoint configuration, credentials pattern
- [LocalStack Init Hooks](https://docs.localstack.cloud/aws/capabilities/config/initialization-hooks/) — `ready.d` bootstrap script mechanism, supported script types
- [LocalStack Lambda Remote Debugging](https://docs.localstack.cloud/aws/tooling/lambda-tools/remote-debugging/) — `LAMBDA_DOCKER_FLAGS`, VS Code attach config, Node.js inspector
- [LocalStack Lambda Docs](https://docs.localstack.cloud/aws/services/lambda/) — supported Node.js runtimes (nodejs22.x), invocation CLI pattern, hot reloading
- [LocalStack Configuration Reference](https://docs.localstack.cloud/references/configuration/) — `DEBUG`, `PERSISTENCE`, `LAMBDA_DOCKER_NETWORK`, `LAMBDA_DOCKER_FLAGS`, `EAGER_SERVICE_LOADING`
- [LocalStack GitHub Releases](https://github.com/localstack/localstack/releases) — v4.14.0 as current stable (2026-02-26)

### Secondary (MEDIUM confidence)
- [LocalStack EventBridge + Lambda Tutorial](https://www.naiyerasif.com/post/2024/08/11/using-localstack-for-aws-lambda-with-eventbridge-rule-trigger/) — EventBridge bus + rule + Lambda target wiring with `awslocal`
- [LocalStack Debug Mode Blog Post](https://blog.localstack.cloud/debug-aws-lambda-functions-locally-using-localstack-debug-mode/) — `LAMBDA_DEBUG_MODE` and per-function YAML config for unique debug ports
- [LocalStack Hot Reloading](https://docs.localstack.cloud/aws/tooling/lambda-tools/hot-reloading/) — `hot-reload` magic bucket, code mounting, detection delay

### Tertiary (LOW confidence)
- [LocalStack Node.js Lambda Debugging Issue #13480](https://github.com/localstack/localstack/issues/13480) — Known issue in 4.10.0: `--inspect-brk` blocks all invocations. Workaround: use debug compose override only when debugging.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — LocalStack is the unambiguous standard; versions verified against GitHub releases
- Architecture patterns: HIGH — SDK endpoint override and init hook patterns verified against official LocalStack docs
- Pitfalls: HIGH for network/credential issues (verified from docs and known issue tracker); MEDIUM for Cognito interaction (reasoning from existing codebase, not a documented LocalStack issue)

**Research date:** 2026-03-17
**Valid until:** 2026-06-17 (LocalStack releases frequently; verify image tag before implementing)
