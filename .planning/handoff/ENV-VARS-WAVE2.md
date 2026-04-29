# Cluster & Pipeline Environment Variables — Wave 2

**Date:** 2026-04-28
**Scope:** Operator-facing env vars introduced or stabilised by Wave 4
distributed-core integration. Two surfaces:

1. **Gateway cluster substrate** — `websocket-gateway/src/cluster/cluster-bootstrap.js`,
   gates and configures the in-process distributed-core cluster that backs
   ownership-aware message routing.
2. **Pipeline / social-api** — `websocket-gateway/social-api/src/pipeline/bootstrap.ts`,
   stands up the `PipelineModule` plus its EventBus, ResourceRegistry, and
   topology manager.

Each entry below documents:
- the env var name and accepted type/values,
- the resolved default per environment (`production` / `dev` / `test`),
- behaviour when unset / when set to an explicit opt-out value,
- a working example of how to pin it.

When a sibling code-level `opts.*` field is also accepted (constructor
override), it is noted; opts always win over env.

---

## 1. Gateway cluster (`src/cluster/cluster-bootstrap.js`)

Bootstrap entry point: `bootstrapGatewayCluster(opts?)`. Returns `null` when
the feature flag is off so callers can wire it unconditionally.

### `WSG_ENABLE_OWNERSHIP_ROUTING`

| Field | Value |
|---|---|
| Type | string (parsed as boolean — case-insensitive `'true'`) |
| `opts` override | `enableOwnershipRouting` |
| Default (all envs) | unset → **disabled** |
| Behaviour when unset | `bootstrapGatewayCluster()` returns `null`; no DC cluster, no peer-addressed routing, no extra metrics. |

**Example** — opt in (production gateway with peer-routing):
```bash
WSG_ENABLE_OWNERSHIP_ROUTING=true
```

Anything other than the literal string `true` (case-insensitive, after trim)
disables — including `1`, `yes`, `enabled`, `'TRUE '` (trailing space is
trimmed and matched, that one would actually pass; only `true|TRUE|True`
etc. work).

### `WSG_CLUSTER_IDENTITY_FILE`

| Field | Value |
|---|---|
| Type | filesystem path \| unset \| `null` (via opts only) |
| `opts` override | `identityFile` (pass `null` to force ephemeral) |
| Default — production | `/var/lib/wsg-gateway/node-identity` |
| Default — dev (anything not test/production) | `/tmp/wsg-gateway-node-identity` |
| Default — test (`NODE_ENV=test` \| `JEST_WORKER_ID` set) | `null` (ephemeral) |
| Behaviour when unset | falls through to env-default above; if file does not yet exist, distributed-core's `loadOrCreateNodeId()` creates it; if read fails the bootstrap warns and falls back to ephemeral. |

**Example** — pin a production identity outside the default location:
```bash
WSG_CLUSTER_IDENTITY_FILE=/etc/wsg/node-id
```

> Operational note (from cardinality audit): leaving this unset in production
> means every restart mints a fresh `node_id`, which leaks one Prometheus
> series per metric per restart. Always set it in long-lived deployments.

### `WSG_CLUSTER_TRANSPORT`

| Field | Value |
|---|---|
| Type | enum: `in-memory` \| `tcp` \| `websocket` \| `http` |
| `opts` override | `transport` |
| Default (all envs) | `in-memory` |
| Behaviour when unset | uses `in-memory`, suitable for single-node and tests but not for cross-process gossip. |

**Example** — TCP transport for a multi-node deploy:
```bash
WSG_CLUSTER_TRANSPORT=tcp
```

### `WSG_CLUSTER_SIZE`

| Field | Value |
|---|---|
| Type | integer ≥ 1 |
| `opts` override | `size` |
| Default (all envs) | `1` |
| Behaviour when unset | bootstraps a single-node cluster. Values > 1 are mostly useful in integration tests since each "node" runs in this process; real multi-process production is the gateway's runtime mode. |
| Validation | non-finite or `< 1` is silently coerced to `1` (resolveSize floor); operators should not depend on that. |

**Example** — a 3-node integration test:
```bash
WSG_CLUSTER_SIZE=3
```

### `WSG_TEARDOWN_DELAY_MS`

| Field | Value |
|---|---|
| Type | integer ≥ 0 (milliseconds) |
| `opts` override | `teardownDelayMs` |
| Default (all envs) | `50` |
| Behaviour when unset | shutdown sequence pauses 50 ms between `node.stop()` (LEAVING gossip) and the local registry/router teardown so peers can observe the LEAVING state and emit `ownership:lost`. |
| Validation | non-finite or `< 0` is silently coerced to `50`. |

**Example** — slower link, give peers more headroom:
```bash
WSG_TEARDOWN_DELAY_MS=250
```

### `WSG_TOMBSTONE_TTL_MS`

| Field | Value |
|---|---|
| Type | integer > 0 (milliseconds) |
| `opts` override | `tombstoneTTLMs` |
| Default (all envs) | `604_800_000` (7 days) |
| Behaviour when unset | CRDT entity-registry tombstones (delete markers) are retained for one week so a partitioned-and-resumed peer can converge on deletes rather than resurrecting them. |
| Validation | non-finite or `≤ 0` is silently coerced to the default. |

**Example** — shorter retention for a churn-heavy dev cluster:
```bash
WSG_TOMBSTONE_TTL_MS=3600000   # 1 hour
```

### Plus: shadow-metrics labels (not cluster-bootstrap, but adjacent)

`src/observability/metrics.js` reads two env vars to label every metric it
emits — these set `BASE_LABELS = { service, node_id }`. Documenting them
here so operators understand the cardinality contract.

| Var | Default | Purpose |
|---|---|---|
| `WSG_SERVICE_NAME` | `'gateway'` | Used as the `service` label on every gateway-side metric. |
| `WSG_NODE_ID` | `os.hostname()` | Used as the `node_id` label on every gateway-side metric. **Distinct** from the cluster's gossip node id — this one is for Prometheus only. Set it explicitly if `os.hostname()` is unstable or shared across replicas. |

---

## 2. Pipeline / social-api (`social-api/src/pipeline/bootstrap.ts`)

Bootstrap entry point: `bootstrapPipeline(opts?)`. Always runs; there is no
on/off flag. Defaults are tuned for hermetic test runs and durable
production deploys.

### `PIPELINE_WAL_PATH`

| Field | Value |
|---|---|
| Type | filesystem path \| `'disabled'` \| unset |
| `opts` override | `walFilePath` |
| Default — production | `/var/lib/social-api/pipeline-wal.log` |
| Default — dev (anything not production) | `/tmp/pipeline-wal.log` |
| Default — test | same as dev (test does not get a special default; tests typically pass `walFilePath` explicitly or use the dev default). |
| Behaviour when unset | resolves to the env-default above. The bootstrap **fails fast** if the parent directory is not writable — clearer than crashing inside `PipelineModule.start()`. |
| Behaviour when `'disabled'` | skips WAL entirely; pipeline state is in-memory and lost on restart. A warning is logged. |

**Example** — explicitly opt out:
```bash
PIPELINE_WAL_PATH=disabled
```

**Example** — pin to a non-default path:
```bash
PIPELINE_WAL_PATH=/data/social-api/pipeline.wal
```

### `PIPELINE_REGISTRY_WAL_PATH`  *(new in Wave 2)*

| Field | Value |
|---|---|
| Type | filesystem path \| unset |
| `opts` override | `registryWalFilePath` |
| Default — production | `/var/lib/social-api/pipeline-registry-wal.log` |
| Default — dev (not test, not production) | `/tmp/pipeline-registry-wal.log` |
| Default — test (`NODE_ENV=test` \| `JEST_WORKER_ID` set) | unset → in-memory registry (preserves per-test isolation). |
| Behaviour when unset (non-test) | resolves to the env-default. The bootstrap fails fast if the parent directory is not writable. |
| Behaviour when set | `ResourceRegistry` swaps from `entityRegistryType: 'memory'` to `'wal'`. Pipeline-run resource records (created via `resourceRegistry.createResource`) are journaled and replayed at startup, surviving restart. |
| No `'disabled'` magic value | hermetic memory-only behaviour is achieved by running under `NODE_ENV=test` or by passing an empty / undefined `opts.registryWalFilePath`. |

**Example** — production override:
```bash
PIPELINE_REGISTRY_WAL_PATH=/data/social-api/registry.wal
```

> Why two WALs? `PIPELINE_WAL_PATH` is the EventBus WAL (run state, events,
> approvals). `PIPELINE_REGISTRY_WAL_PATH` is the entity-registry WAL
> (resource records — what runs exist and which node owns them). They live
> at different layers of distributed-core; both must persist for full
> restart recovery, but they can be configured independently (e.g. send the
> EventBus WAL to fast SSD, the registry WAL to durable network storage).

### `PIPELINE_IDENTITY_FILE`

| Field | Value |
|---|---|
| Type | filesystem path \| `'disabled'` \| unset |
| `opts` override | `identityFile` (pass `'disabled'` to opt out) |
| Default — production | `/var/lib/social-api/node-identity` |
| Default — dev (not test, not production) | `/tmp/social-api-node-identity` |
| Default — test | unset → ephemeral (each `bootstrapPipeline()` call gets a fresh node id; required for hermetic two-bootstrap suites). |
| Behaviour when set | `loadOrCreateNodeId()` reads-or-creates the persisted id; gossip identity is stable across restarts. The bootstrap **fails fast** with a wrapped error if the file cannot be read or created. |
| Behaviour when `'disabled'` | distributed-core mints a fresh ephemeral id on every boot. A warning is logged (in non-test envs). |

**Example** — production:
```bash
PIPELINE_IDENTITY_FILE=/etc/social-api/node-id
```

### `PIPELINE_CLUSTER_SIZE`

| Field | Value |
|---|---|
| Type | integer ≥ 1 |
| `opts` override | `size` |
| Default (all envs) | `1` |
| Behaviour when unset | single-node, in-process cluster. `size > 1` is integration-test scope; real multi-process production is gated on `DC-1.1`. |
| Validation | non-finite or `< 1` throws `[pipeline] PIPELINE_CLUSTER_SIZE must be >= 1, got: …`. |

**Example**:
```bash
PIPELINE_CLUSTER_SIZE=3
```

### `PIPELINE_CLUSTER_TRANSPORT`

| Field | Value |
|---|---|
| Type | enum: `in-memory` \| `tcp` \| `udp` \| `websocket` \| `http` |
| `opts` override | `transport` |
| Default (all envs) | `in-memory` |
| Behaviour when unset | in-memory transport — sufficient for single-node and most test multi-node setups. |

**Example**:
```bash
PIPELINE_CLUSTER_TRANSPORT=websocket
```

### `PIPELINE_CLUSTER_BASE_PORT`

| Field | Value |
|---|---|
| Type | integer ≥ 0 |
| `opts` override | `basePort` |
| Default (all envs) | `0` (ephemeral / OS-assigned) |
| Behaviour when unset | only meaningful for non-`in-memory` transports; `0` means each node binds to an OS-assigned port. |
| Validation | non-finite or `< 0` throws. |

**Example** — pin a sequential port range:
```bash
PIPELINE_CLUSTER_TRANSPORT=tcp
PIPELINE_CLUSTER_BASE_PORT=9100
```

### `PIPELINE_LLM_PROVIDER` *(used indirectly — see createLLMClient)*

| Field | Value |
|---|---|
| Type | string (provider key) |
| `opts` override | `llmClient` (pre-built client; tests typically pass `FixtureLLMClient`) |
| Default | provider-default in `createLLMClient()`. |
| Behaviour when unset | `createLLMClient()` falls back to its built-in default provider; in tests, the explicit `llmClient` opts override is preferred. |

Documented for completeness — `bootstrap.ts` only reads it via `createLLMClient()`; the
specific provider keys / required SDK credentials are owned by that module.

---

## Internal HTTP endpoints

Operator-facing surfaces exposed by the gateway HTTP server. All `/internal/*`
routes are intended for the internal/admin scope only — keep them off the
public ingress at the network layer (today they share a single open auth gate
at the application layer; if that ever changes, all `/internal/*` routes
move behind the same gate together).

### `GET /internal/metrics`

Prometheus 0.0.4 text-format scrape of distributed-core's `MetricsRegistry`.
Coexists with the legacy CloudWatch-push path. No body required.

### `GET /internal/postmortem` *(new in Wave 2)*

| Field | Value |
|---|---|
| Auth gate | same as `/internal/metrics` (open at app layer; internal/admin-only at network layer) |
| Backed by | `cluster.snapshot()` from distributed-core v0.4.0+, resolved via the `RoomOwnershipService` singleton |
| Content-Type | `application/json` |

Surfaces a one-shot view of cluster state for incident response: membership,
ownership, locks, inflight rebalances, WAL position, and a metrics snapshot.
Reading is non-mutating.

| Status | Body | Meaning |
|---|---|---|
| `200` | `cluster.snapshot()` result (object with `nodeId`, `timestamp`, `membership`, `ownership`, `locks`, `inflightRebalances`, `walPosition`, `metrics`) | Cluster wired and snapshot succeeded. Sub-fields degrade gracefully — empty arrays / `null` rather than throwing — when an underlying primitive isn't wired (see distributed-core/src/cluster/Cluster.ts:728 docstring). |
| `200` | `{ "error": "cluster not wired", "wired": false }` | `WSG_ENABLE_OWNERSHIP_ROUTING` is off, or the bootstrap returned null (NullRoomOwnershipService path). Not an error condition — the gateway is operating in single-process mode. |
| `500` | `{ "error": "<message>", "wired": true }` | `cluster.snapshot()` threw. Genuinely unexpected — file an incident. |

**Example** — capture a snapshot during a stuck-cluster incident:
```bash
curl -s http://localhost:8080/internal/postmortem | jq
```

---

## Cross-cutting notes

- **Test hermeticity.** `NODE_ENV=test` and `JEST_WORKER_ID` are both treated
  as test signals. Under either, the pipeline bootstrap defaults the
  registry WAL and identity file to ephemeral so suites do not cross-contaminate.
  The gateway-side `WSG_CLUSTER_IDENTITY_FILE` follows the same convention
  (test → `null`).
- **Prod paths assume `/var/lib/...` is writable by the service user.** If
  it is not, the bootstrap fails fast at start. Operators should either
  pre-create the directory with appropriate ownership or override the env
  var to a writable location.
- **Naming convention.** Gateway-side env vars use the `WSG_` prefix;
  social-api / pipeline env vars use the `PIPELINE_` prefix. Cross-prefix
  vars (`WSG_*` set on social-api, or vice versa) are ignored.
