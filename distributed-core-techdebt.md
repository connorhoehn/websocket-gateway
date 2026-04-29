# distributed-core — tech debt report

**Compiled from:** the `websocket-gateway` integration work, late April 2026.

**Scope:** the gateway adopted `distributed-core` `main` HEAD (`93f57a7`) across multiple parallel streams (PrometheusFix, FailureDetectorBridge, HintedHandoffQueue, RaftEntityRegistry track, plus EventBus dead-letter / metrics / auto-compaction). Findings below are issues encountered **by the consumer** that warrant upstream fixes.

**How to read this:** each item lists symptom (what the consumer sees), root cause (where in the source it lives), fix sketch, and effort estimate. Severity ordering is "fix first" — items at the top yield the most consumer-time savings per upstream-engineer-hour spent.

---

## 0. Already fixed locally — needs push + tag

### U1: `PipelineModule` did not thread EventBus configuration

**Status:** ✅ Fixed in local commit `c89e370` on `main` (not yet pushed).

**Symptom:** `EventBus` accepts `deadLetterHandler`, `metrics`, `walSyncIntervalMs`, `autoCompactIntervalMs`, `autoCompactOptions` via `EventBusConfig`. `EventBusFactory.createLocal()` accepts the same via `LocalEventBusConfig`. But **`PipelineModule.onInitialize()` constructs its own internal EventBus and only reads `topic` + `walFilePath` from `PipelineModuleConfig`**, ignoring the rest. Consumers who construct `PipelineModule` (rather than the EventBus directly) had no way to opt into bus-level dead-lettering, metrics, or auto-compaction.

**Root cause:** `src/applications/pipeline/PipelineModule.ts:271` — the inline `new EventBus<PipelineEventMap>(pubsub, localNodeId, { topic, walFilePath })` skipped every other field.

**Fix shipped (locally):** Added five passthrough fields to `PipelineModuleConfig` and threaded them into the EventBus construction call. Each new field is `undefined` by default, so the change is fully backward-compatible.

```ts
// PipelineModuleConfig now has:
eventBusDeadLetterHandler?: (event: BusEvent, error: Error) => void;
eventBusMetrics?: MetricsRegistry;
eventBusWalSyncIntervalMs?: number;
eventBusAutoCompactIntervalMs?: number;
eventBusAutoCompactOptions?: EventBusCompactionOptions;
```

**Tests:** 15/15 integration + 24/24 unit pass post-change. **Push commit `c89e370` to `origin/main` and cut a release tag** (e.g., `v0.7.1` or whatever the next bump is).

---

## 1. Critical — fix before next release

### 1.1. `formatPrometheus` is missing from the top-level barrel

**Symptom:** Consumers can't `import { formatPrometheus } from 'distributed-core'`. They have to use the deep path `import { formatPrometheus } from 'distributed-core/dist/monitoring/metrics/PrometheusExporter'`, which is uglier and breaks if the dist layout changes.

**Root cause:** `src/index.ts` does:

```ts
export * from './monitoring/metrics/MetricsTracker';
export * from './monitoring/metrics/MetricsExporter';
// ...but NOT:
// export * from './monitoring/metrics/PrometheusExporter';
// nor `export * from './monitoring/metrics';` (the directory barrel)
```

The directory barrel `src/monitoring/metrics/index.ts` does export `formatPrometheus` (and `PrometheusHttpExporter`, and re-exports `MetricsRegistry`). The top-level barrel never picks it up.

`PrometheusHttpExporter` itself **is** exported from the top barrel (via a separate explicit line). So `formatPrometheus` is the only one missing. Looks like an oversight when the formatter helper was extracted from `MetricsExporter`.

**Fix:** add to `src/index.ts`:

```ts
export { PrometheusHttpExporter, formatPrometheus } from './monitoring/metrics/PrometheusExporter';
```

(One of those is already exported in some form — verify and dedupe.)

**Effort:** 5 minutes + one CHANGELOG line.

**Found by:** Stream 2 (PrometheusFix) in the gateway. Forced a deep import + a 6-line apologetic code comment in `social-api/src/observability/metrics.ts`.

---

### 1.2. `PubSubConfig` name collision in the public surface

**Symptom:** `import type { PubSubConfig } from 'distributed-core'` returns the **wrong** shape. The top-level barrel re-exports `PubSubConfig` from `src/gateway/pubsub/types.ts` (the runtime config interface — fields like `enableCrossNodeDelivery`, `messageDeduplicationTTL`). But `ClusterConfig.pubsub` is typed against a **different** `PubSubConfig` declared in `src/cluster/Cluster.ts` (the discriminated union — `{ type: 'memory' } | { type: 'redis'; url; createClient? }`).

Consumers writing config builders for `ClusterConfig` get a confusing type error:

```
Type 'PubSubConfig' is not assignable to type 'PubSubConfig'.
  Object literal may only specify known properties, and 'type' does not exist in type 'PubSubConfig'.
```

(Two different `PubSubConfig`s, same name, both exported.)

**Root cause:** Two declarations in two files, both surfaced through the public API:
- `src/cluster/Cluster.ts` — `export type PubSubConfig = { type: 'memory' } | { type: 'redis'; ... };` (cluster-facade variant)
- `src/gateway/pubsub/types.ts` — `export interface PubSubConfig { enableCrossNodeDelivery?: ...; ... }` (runtime tunables)

The wildcard `export * from './gateway'` in `src/index.ts` pulls the runtime variant in; the cluster variant is also exported but the runtime one shadows it depending on import order / TS's sometimes-finicky type union behavior.

**Workaround the consumer used:** `type ClusterPubSubConfig = ClusterConfig['pubsub'];` — derive via indexed access to bypass the name collision.

**Fix:** rename one of them. Recommended: rename the cluster-facade variant to `ClusterPubSubConfig` (since it's already wrapped as `ClusterConfig['pubsub']`). The runtime tunables type is more general-use and deserves to keep the bare `PubSubConfig` name.

**Effort:** ~30 min (rename + update internal usages + CHANGELOG note + breaking-change advisory if any external consumer was relying on the cluster variant by name).

**Found by:** Stream 1 (Foundation) in the gateway, building `social-api/src/pipeline/config/cluster.ts`.

---

### 1.3. `HintedHandoffQueue` is not integrated with `Cluster` / `Cluster.create()`

**Symptom:** `HintedHandoffQueue` exists, is exported from the barrel, accepts a `dataDir` and provides durable per-target queues. But constructing one and starting it has **no effect on `Cluster.peer` send paths** — the queue runs in isolation. Failed cross-node sends are not redirected through it; recovered nodes do not drain anything from it.

**Root cause:** `src/cluster/Cluster.ts` constructs a private `_peer: PeerMessaging | null` internally. There is no setter on the facade (no `attachHintedHandoff(queue)` analog of the existing `attachRebalanceManager`), and no field on `ClusterConfig` (no `hintedHandoff?: HintedHandoffOptions`) that the facade forwards into its internal `PeerMessaging` constructor. `PeerMessagingConfig.hintedHandoff` exists but is unreachable from anyone using `Cluster.create()`.

**Result:** the feature is "shipped" but operationally inert when used through the facade — you have to bypass `Cluster.create()` and bring up `PeerMessaging` yourself to make HHQ actually do anything.

**Fix:** pick one:
- **(a)** Add `Cluster.attachHintedHandoff(queue: HintedHandoffQueue): void` (mirrors `attachRebalanceManager`). Stores the queue and threads it into the next reconnect / send-failure path inside `_peer`.
- **(b)** Add `ClusterConfig.hintedHandoff?: HintedHandoffOptions` (or `?: HintedHandoffQueue`) and forward into the facade's internal `new PeerMessaging({ hintedHandoff, ... })` call.

(b) is simpler if `HintedHandoffQueue` is purely passive (just-a-store). (a) is better if HHQ has lifecycle methods the facade should orchestrate (start/stop alongside Cluster.start/stop).

**Effort:** ~half day for (b), ~1 day for (a) including drain-on-recovered-node wiring.

**Found by:** Stream 10 (HHQueue) in the gateway. The agent successfully constructed the queue, ran the lifecycle, and added a passing integration test — but had to flag in their report that the queue was not actually intercepting anything.

---

### 1.4. `ApplicationRegistry.createModuleContext` hardcodes `[INFO] [moduleId]` console.log

**Symptom:** Tests using `ApplicationRegistry.register(module, ...)` get unsuppressable info-level logging on stdout. The gateway's `bootstrap.ts` had to **bypass `moduleRegistry.register()` entirely in test mode** and call `module.initialize() + module.start()` directly with a quiet logger context — losing registry-side state tracking — purely to silence this chatter.

**Root cause:** Per the workaround comment in the gateway bootstrap:
> "v0.6.3 added IS_TEST_ENV for FrameworkLogger / transport adapters but did NOT thread it into that inline logger" (referring to the inline logger inside `ApplicationRegistry.createModuleContext`).

So the IS_TEST_ENV silencing pattern was applied to other components but missed this one.

**Fix:** thread IS_TEST_ENV (or — better — accept a logger override on the `register()` options) into the context-building path. Two-line change inside `createModuleContext`:

```ts
const logger = options?.logger
  ?? (IS_TEST_ENV ? NOOP_LOGGER : DEFAULT_REGISTRY_LOGGER);
```

**Effort:** ~30 min including a unit test that pins "register() with `logger: noop` produces zero stdout output."

**Found by:** Foundation work in the gateway. The workaround code path is in `social-api/src/pipeline/bootstrap.ts` (the `if (fastTimers) { ... } else { moduleRegistry.register(...) }` split). Removing this split would shrink the gateway bootstrap by ~40 lines.

---

## 2. High — usability / API ambiguity

### 2.1. `Cluster._peer` is private with no read-only accessor

**Symptom:** consumers cannot use `cluster.peer.send(...)` or attach a `HintedHandoffQueue` (see 1.3) because the facade owns the `PeerMessaging` instance privately. The only other public primitives — `cluster.router`, `cluster.lock`, `cluster.pubsub`, `cluster.clusterManager`, `cluster.failureDetector`, `cluster.registry` — all expose their underlying instance. `_peer` is the inconsistent one.

**Fix:** expose as `readonly peer: PeerMessaging | null` on the facade (matching the existing pattern). null when `_peer === null`; otherwise the live instance.

**Effort:** 5 minutes.

**Found by:** Stream 10's investigation.

---

### 2.2. Three Prometheus rendering paths with unclear canonical

**Symptom:** consumers find three exports for "render metrics as Prometheus text":
- `MetricsExporter` (legacy class)
- `PrometheusHttpExporter` (HTTP server-shape)
- `formatPrometheus` (pure function)

The original gateway code had a `cast-through-any` workaround with this comment:

> "MetricsExporter's TS surface advertises a config-shaped constructor and a private `formatPrometheusMetrics()`; the underlying JS doesn't enforce either. Cast through `any` to keep strict-mode TS happy."

This suggests `MetricsExporter`'s `.d.ts` and `.js` diverged — the `.d.ts` was wrong about the constructor shape and method visibility.

**Fix:**
- Document `formatPrometheus(registry.getSnapshot())` as **the canonical formatter** in README and JSDoc on the symbol.
- Either fix `MetricsExporter`'s `.d.ts` to match the runtime, or — if it's superseded by the formatter + HttpExporter pair — soft-deprecate it (`@deprecated use formatPrometheus`).
- Add a one-paragraph "metrics rendering" section to the README so consumers don't have to discover the trio by archaeology.

**Effort:** ~2 hours (docs + tag whichever is deprecated + CHANGELOG).

**Found by:** Stream 2 in the gateway.

---

### 2.3. `PipelineModule.eventBusTopic` default invites cross-talk in same-process tests

**Symptom:** when two `PipelineModule` instances are constructed in the same process (e.g., two sequential bootstraps in one Jest run), both default to `eventBusTopic = 'pipeline.events'`. Both subscribe to the same in-memory pubsub topic. Events emitted by run A on instance 1 are observed by subscribers on instance 2.

The gateway works around this by giving every cluster a unique `topic` derived from `nodeId` (`topic: 'pipeline-${nodeId}'`), but the EventBus topic inside `PipelineModule` is not similarly node-scoped — it's a per-instance config knob with a process-global default.

**Fix:** change the default to `pipeline.events.${context.clusterManager.localNodeId}` (or accept this as an option that the constructor builds when unset). Existing consumers passing an explicit `eventBusTopic` are unaffected.

**Effort:** ~30 min including a regression test.

**Found by:** indirect — gateway's bootstrap.test.ts has a "two sequential bootstraps get distinct nodeIds" test that exists *because* of this hazard. The test passes only because the gateway scopes the *cluster* topic per nodeId; the EventBus topic isn't part of that test.

---

### 2.4. `PipelineModule` constructs EventBus internally with no injection point

**Symptom:** even after U1 (item 0), consumers can only configure the EventBus through `PipelineModuleConfig` fields. They cannot:
- Inject a pre-built `EventBus` instance (e.g., a shared bus across multiple modules)
- Subclass the EventBus
- Use `EventBusFactory` directly and pass the result in

For test setups that want to seed the bus with synthetic events, or for advanced topologies (multiple modules sharing one bus), the consumer has to either touch internals or work around.

**Fix:** add an optional `eventBus?: EventBus<PipelineEventMap>` to `PipelineModuleConfig`. When provided, `onInitialize()` skips the inline construction and uses the supplied bus. When absent, behavior is unchanged.

**Effort:** ~1 hour including a "construct your own bus" example test.

**Found by:** scoping discussion during the gateway's Wave 2 planning (BusDLQ / BusMetrics streams). Came up as a "wouldn't it be simpler to just inject?" alternative to U1; we shipped U1 because it's lower-friction for the common case, but the injection point would close out advanced cases.

---

## 3. Medium — backlog

### 3.1. Subpath export consistency

**Symptom:** several symbols are present in subdirectory barrels but missing from the top-level barrel. Consumers don't know whether to import from `'distributed-core'` or `'distributed-core/<subpath>'` or `'distributed-core/dist/<deep-path>'`. Examples surfaced by the gateway integration:

- `formatPrometheus` (item 1.1) — only via deep path until fixed
- `PubSubConfig` (item 1.2) — same name in two paths, conflicting types
- `EventBusCompactionOptions` — surfaced via `messaging` re-export but easy to miss
- (Likely others — those are just the ones we hit)

**Fix:** establish and document **one** of:
- **(a)** "Everything that's stable is in `'distributed-core'`. Subpaths exist for tree-shaking only and re-export the same symbols." Then ensure parity between subpath and top barrel.
- **(b)** "Top barrel = high-level types only (`Cluster`, `PipelineModule`, etc.). Subpaths = domain APIs (`distributed-core/messaging`, `distributed-core/cluster`, etc.). Consumers always use subpaths." Then strip the top barrel down.

(a) is less disruptive and matches what the barrel mostly does today. (b) is cleaner long-term.

**Effort:** for (a) — half day to audit + add missing re-exports + one ADR. For (b) — multi-day breaking change.

**Found by:** Streams 1, 2, and 4 in the gateway.

---

### 3.2. `package.json#version` field stale relative to tags

**Observation:** the gateway pinned `git+https://github.com/connorhoehn/distributed-core.git#v0.6.7`. The resulting `node_modules/distributed-core/package.json` reports `"version": "0.6.0"` while the actual git tag is `v0.6.7`. The `npm install`-time integrity warning notes "skipping integrity check for git dependency."

This is a minor footgun for diagnostic purposes: `npm ls` or any version-introspection tool will report 0.6.0, masking which tag is actually in use.

**Fix:** either
- Bump `package.json#version` whenever a tag is cut (manual or via `npm version`), or
- Adopt a release tool (semantic-release, release-please) that keeps them in lockstep.

**Effort:** ~1 hour to pick a tool and wire it.

---

### 3.3. `cluster.scope('topic')` discoverability

**Observation:** `cluster.scope('rooms')` is a load-bearing API in the gateway's room-ownership service, but the gateway **pipeline** never calls `cluster.scope('pipeline')` despite documenting it as a feature in a 12-line bootstrap comment block. The gateway team didn't realize the capability was easy to use until investigation.

**Fix:** add a "Common patterns" section to `README.md` showing:
```ts
const pipelineScope = cluster.scope('pipeline');
const lock = await pipelineScope.lock('migration', { ttlMs: 5000 });
const election = pipelineScope.electLeader();
```

Three lines of code, ten lines of prose, captures one of the most useful primitives the facade offers.

**Effort:** ~1 hour.

---

### 3.4. `MetricsExporter` `.d.ts` / `.js` divergence

**Symptom:** as quoted in 2.2, the `MetricsExporter` class's TS surface differs from the JS runtime — config-shaped constructor in TS, looser shape in JS; `formatPrometheusMetrics()` declared `private` in TS but accessible at runtime.

**Fix:** either align them (probably the simpler win) or — if `MetricsExporter` is being phased out — soft-deprecate with `@deprecated` and a JSDoc pointer to `formatPrometheus`.

**Effort:** ~30 minutes if just aligning the .d.ts. If retiring, ~half day of deprecation flow.

---

## 4. Low / hygiene

### 4.1. Abandoned tags clutter `git ls-remote`

**Symptom:** `git ls-remote --tags origin` returns:
```
v0.7.0-rc1, v0.8.0-rc1, v0.8.0-rc2, v0.8.0-rc3,
v0.9.0-rc1, v1.0.0-rc1, v1.0.0-rc2, v1.0.0
```
None of these are reachable from `main`. They are abandoned experimental branches whose tags were left behind.

In the gateway integration session, these tags consumed roughly **30 minutes of investigation time** before correction — the consumer had to be told "ignore the tags, use main HEAD, the tags are abandoned." A future consumer hitting this repo cold would waste the same time.

**Fix:**
```bash
git push origin --delete v0.7.0-rc1 v0.8.0-rc1 v0.8.0-rc2 v0.8.0-rc3 v0.9.0-rc1 v1.0.0-rc1 v1.0.0-rc2 v1.0.0
```

(After confirming each is genuinely abandoned and not someone's release reference.)

If they need to be preserved for archaeology, prefix with `archive/` so tools sort them out of the way:

```bash
git tag archive/v1.0.0 v1.0.0
git tag -d v1.0.0
git push origin :v1.0.0 archive/v1.0.0
```

**Effort:** 5 minutes once the team agrees they're abandoned.

---

### 4.2. README mentions `DistributedNodeFactory` as a quick-start path that doesn't exist on `main`

**Symptom:** README quick-start reads:
```ts
import { DistributedNodeFactory } from 'distributed-core';
const components = await DistributedNodeFactory.builder()
  .id('node-1').network('127.0.0.1', 8001).transport('websocket')
  .seedNodes(['127.0.0.1:8000']).enableResources().build();
```

`DistributedNodeFactory` is exported from somewhere on the abandoned v1.0.0 tag, but **does not exist** on current `main` HEAD. A consumer copy-pasting the README hits "Cannot find name 'DistributedNodeFactory'."

**Fix:** rewrite the README quick-start to use what's actually on main — `Cluster.create()` from the cluster facade, or `createCluster()` from `frontdoor`.

**Effort:** ~1 hour including a re-tested code snippet.

---

### 4.3. The pinned `LICENSE` / `CONTRIBUTING.md` references and the README `Project Goals` section

**Observation:** README declares "production-ready primitives" and "experimental / in progress" sections. `HealthServer` is listed as "wired in, but not yet exercised end-to-end in CI." During the gateway's investigation, the line between these sections wasn't always obvious from the source — e.g., `MultiRaftCoordinator` is heavily exercised in `examples/room-ownership-raft` but isn't called out in the README at all. Consumers don't know what's safe to depend on.

**Fix:** generate the production-ready list mechanically (e.g., from a `// @stable` JSDoc tag or a `STATUS.md` checked into each top-level module). One source of truth for stability claims.

**Effort:** ~half day once a convention is picked.

---

## 5. Raft Track findings — landed

The "Raft Track" (combined `IRaftStateMachine` impl + `RaftEntityRegistry` mode + `RaftRpcSigner` wiring) completed in the gateway integration. It surfaced four meaningful upstream items beyond what the earlier streams found.

### 5.1. Critical — `Cluster.create({ registry: { type: 'raft' } })` hardwires its own internal RaftStateMachine

**Symptom:** when a consumer constructs an `IRaftStateMachine` for their domain (e.g., `PipelineRaftStateMachine` for pipeline runs), there is **no public slot on `Cluster.create()` to inject it**. The facade's `'raft'` registry branch builds an internal `EntityStateMachine` and runs it inside the underlying `RaftNode`. The consumer's state machine is a parallel construct that isn't invoked by the facade's raft path.

**Impact:** the gateway built `PipelineRaftStateMachine` (457 LOC, 12 unit tests) but it can only be exercised by a future `MultiRaftCoordinator` setup or by directly constructing a `RaftNode` outside the facade. Inside `Cluster.create()` it's unreachable. This blocks the canonical use case ("I want my domain commands to flow through Raft consensus").

**Root cause:** `src/cluster/Cluster.ts` — the raft branch of `Cluster.create()` calls something like `EntityRegistryFactory.createRaft({ stateMachine: <internal EntityStateMachine>, ... })`. The `RaftConfig` shape passed in via `ClusterConfig.registry.raftConfig` doesn't include a `stateMachine?: IRaftStateMachine` slot.

**Fix:**
- Add `RaftConfig.stateMachine?: IRaftStateMachine<TCommand, TResult>` (or equivalent on the `RegistryConfig`'s raft branch). When provided, the facade uses the supplied SM instead of constructing its default `EntityStateMachine`.
- Document the type parameters and the snapshot/restore contract in JSDoc.
- An example in `examples/` showing "consumer-defined state machine through `Cluster.create()`" would close the discoverability gap.

**Effort:** ~half day for the slot + plumbing through to `RaftNode`. ~1 day with example + integration test.

**Found by:** Raft Track stream in the gateway. The 12 unit tests for `PipelineRaftStateMachine` pass against the SM directly; the `raft-bootstrap.test.ts` smoke test confirms the cluster comes up in raft mode but does **not** prove the consumer's SM is reached — because it isn't.

---

### 5.2. Critical — `ResourceRegistry` cannot host raft mode

**Symptom:** `EntityRegistryFactory.create({ type: 'raft' })` throws:

> "Raft registries must be created via `EntityRegistryFactory.createRaft()` with injected dependencies"

`ResourceRegistry`'s constructor calls `EntityRegistryFactory.create()` directly with the requested `entityRegistryType`. There is **no constructor surface** to either:
- Inject a pre-built `RaftEntityRegistry` (e.g. the one `Cluster.create()` already constructed)
- Pass the dependencies the raft factory needs (`raftNode`, `rpcRouter`)

So `entityRegistryType: 'raft'` is **unreachable** from a `ResourceRegistry` consumer. The gateway's workaround:

- Cluster-side registry runs full Raft (writes are linearizable through consensus).
- Resource-side `ResourceRegistry` is **downgraded** to wal-or-memory and a warning is surfaced to the operator.

This means resource-typed records (pipeline runs created via `module.createResource()`) don't share Raft's durability guarantees with the rest of the cluster's entity state — they fall through to whichever weaker mode is available.

**Fix:** add to `ResourceRegistryConfig`, one of:
- **(a)** `entityRegistry?: EntityRegistry` — when provided, ResourceRegistry adopts the supplied instance. Lets consumers thread `cluster.registry` (already a `RaftEntityRegistry`) directly through.
- **(b)** A raft-aware `entityRegistryType: 'raft' & { raftNode, rpcRouter }` discriminator. Same outcome, different shape.

(a) is more flexible (any future EntityRegistry implementation works without ResourceRegistry knowing about it).

**Effort:** ~1 day including a "share raft entity registry between cluster and resource" integration test.

**Found by:** Raft Track stream in the gateway. The downgrade-with-warning code lives in `social-api/src/pipeline/config/registries.ts`; its file-level comment block is a good summary of the problem if you want to pull it verbatim into upstream docs.

---

### 5.3. Several Raft-related symbols are missing from the top-level barrel

This is the same class of issue as 1.1 (`formatPrometheus`) and 3.1 (subpath consistency), but specifically for the Raft surface area. The Raft Track had to use deep imports for **all three**:

| Symbol | Kind | Currently reachable via | Should be in main barrel? |
|---|---|---|---|
| `IRaftStateMachine` | type | `'distributed-core/dist/cluster/raft/state/IRaftStateMachine'` | Yes |
| `RaftStateMachineBase` | class | `'distributed-core/dist/cluster/raft/state/RaftStateMachineBase'` | Yes — consumers building SMs use this base class |
| `DEFAULT_RAFT_CONFIG` | const | `'distributed-core/dist/cluster/raft/types'` | Yes — `RaftConfig` type IS exported, but the default value is not |
| `RaftRpcSigner` | interface | `'distributed-core/dist/cluster/raft/rpc/RaftRpcRouter'` | Yes — public duck-type interface |

**Fix:** add to `src/index.ts`:

```ts
export type { IRaftStateMachine } from './cluster/raft/state/IRaftStateMachine';
export { RaftStateMachineBase } from './cluster/raft/state/RaftStateMachineBase';
export { DEFAULT_RAFT_CONFIG } from './cluster/raft/types';
export type { RaftRpcSigner } from './cluster/raft/rpc/RaftRpcRouter';
```

(Or equivalent — verify exact names against the source.)

**Effort:** 10 minutes.

**Found by:** Raft Track stream — every `import` in their new files has a deep-path comment explaining the gap.

---

### 5.4. Positive finding — `KeyManager` satisfies the duck-typed `RaftRpcSigner` interface

**Observation:** the gateway successfully used `KeyManager` (from the main barrel) directly as a `RaftRpcSigner` — no adapter, no shim. `KeyManager` exposes `signClusterPayload<T>` + `verifyClusterPayload`, which is exactly the duck-typed shape `RaftRpcSigner` expects.

**This is a quiet win** — the duck-typed interface design avoided a class of "I have to write yet another wrapper class to bridge two types that mean the same thing." Recommend documenting this explicitly in the Raft RPC signing runbook (`docs/observability/raft-rpc-signing.md`) so future operators know `KeyManager` is the canonical signer implementation, not a separate class.

**No fix needed.** Just a callout that `RaftRpcSigner`'s duck-typing was a good design choice.

---

## Quick reference (updated) — fix priority for the next release

| # | Item | Effort | Severity |
|---|---|---|---|
| 0 | Push U1 commit `c89e370` + tag | 10 min | already done locally |
| 1.1 / 5.3 | Add `formatPrometheus` + raft symbols to top-level barrel | 15 min | critical |
| 1.4 | Fix `createModuleContext` IS_TEST_ENV plumbing | 30 min | critical (saves consumers ~40 LOC) |
| 2.1 | Expose `cluster.peer` accessor | 5 min | high |
| 4.1 | Delete abandoned tags | 5 min | hygiene |
| 1.2 | Rename `PubSubConfig` collision | 30 min | critical (breaking) |
| 5.1 | Add `RaftConfig.stateMachine?` slot | half day | critical |
| 5.2 | Add `ResourceRegistryConfig.entityRegistry?` slot | 1 day | critical |
| 1.3 | Wire `HintedHandoffQueue` into `Cluster` facade | half day | critical |
| 4.2 | Rewrite README quick-start | 1 hour | hygiene |
| 2.2 | Document Prometheus rendering canonical | 2 hours | high |
| 2.3 | Scope `eventBusTopic` default per-node | 30 min | high |

**The barrel-export pattern (items 1.1, 3.1, 5.3) is the single biggest source of consumer friction across this integration** — five separate deep-import workarounds in the gateway, each with a 3-line apologetic comment, all because symbols that exist in subdirectory barrels weren't lifted to the top-level barrel. Pick a strategy (top-barrel parity vs subpath-only) and apply it consistently. ~30 minutes total to fix all three at once.

---

## Quick reference — fix priority for the next release

| # | Item | Effort | Severity |
|---|---|---|---|
| 0 | Push U1 commit `c89e370` + tag | 10 min | already done locally |
| 1.1 | Add `formatPrometheus` to top-level barrel | 5 min | critical |
| 1.4 | Fix `createModuleContext` IS_TEST_ENV plumbing | 30 min | critical (saves consumers ~40 LOC) |
| 2.1 | Expose `cluster.peer` accessor | 5 min | high |
| 4.1 | Delete abandoned tags | 5 min | hygiene |
| 1.2 | Rename `PubSubConfig` collision | 30 min | critical (breaking) |
| 1.3 | Wire `HintedHandoffQueue` into `Cluster` facade | half day | critical |
| 4.2 | Rewrite README quick-start | 1 hour | hygiene |
| 2.2 | Document Prometheus rendering canonical | 2 hours | high |
| 2.3 | Scope `eventBusTopic` default per-node | 30 min | high |

**Total time for items ≤ 30 min: ~2 hours of upstream work** — saves consumers many hours each, repeatedly.

---

## Appendix — context the gateway integration provided

The integration was driven by the `websocket-gateway` adopting `distributed-core` HEAD across these streams (some still in progress at the time of this report):

1. **PrometheusFix** — replaced `MetricsExporter` cast-through-`any` with `formatPrometheus`. ✅ merged. **Surfaced 1.1, 2.2, 3.4.**
2. **EventBus DLQ / Compact / Metrics (Wave 2)** — pending. **Surfaced U1 (item 0).**
3. **RaftEntityRegistry track** (combined RaftSM + factory + signer) — ✅ merged. **Surfaced 5.1, 5.2, 5.3, 5.4.**
4. **FailureDetectorBridge** — wired `cluster.router` + `cluster.lock` as targets. ✅ merged.
5. **HintedHandoffQueue** — wired the queue lifecycle. ✅ merged. **Surfaced 1.3, 2.1.**
6. **Foundation refactor** — modularized the gateway bootstrap into per-concern config builders. **Surfaced 1.2, 1.4.**

Each stream's full report (file allowlist, what was added, what was discovered) is captured in the gateway repo's `.claude-field-notes.md`.
