// social-api/src/pipeline/bootstrap.ts
//
// Bootstrap that stands up an in-process distributed-core Cluster +
// PipelineModule for the social-api service.
//
// Phase 3 (April 2026): migrated from the multi-node `createCluster()` test
// front-door to the single-process `Cluster.create()` facade (DC v0.5.x/v0.6.x
// production surface). The facade owns its own ClusterManager, PubSubManager,
// EntityRegistry, ResourceRouter, DistributedLock, and AutoReclaimPolicy —
// the bootstrap only has to wire the *application-layer* registries
// (ResourceRegistry / ResourceTopologyManager / ApplicationRegistry) on top.
//
// What the facade gives us "for free" vs. the previous wiring:
//   - `cluster.scope('pipeline')` (v0.5.7) — namespacing for locks/elections.
//   - `cluster.snapshot()`        (v0.4.0) — postmortem aggregator.
//   - `cluster.lock`              — replaces hand-wired DistributedLock.
//   - `metrics:` config field     — single-config metrics threading
//                                   (FR-6, v0.6.5 — accepts MetricsRegistry).
//
// Tunables (all read from env at call time, with safe defaults):
//   PIPELINE_CLUSTER_TRANSPORT  — 'in-memory' | 'tcp' | 'websocket' | 'http' |
//                                 'udp'. Default 'in-memory'. Single-process
//                                 deployments must use 'in-memory'; the other
//                                 transports are reserved for the multi-node
//                                 work in Phase 4.
//   PIPELINE_CLUSTER_BASE_PORT  — Local bind port for non-in-memory transports.
//                                 Default 0 (ephemeral). Ignored for
//                                 'in-memory'.
//   PIPELINE_WAL_PATH           — Filesystem path for the EventBus WAL. When
//                                 set, pipeline run state survives restart.
//                                 Default (when unset): durable on-disk WAL —
//                                   '/var/lib/social-api/pipeline-wal.log' if
//                                   NODE_ENV === 'production', otherwise
//                                   '/tmp/pipeline-wal.log'.
//                                 Set PIPELINE_WAL_PATH=disabled to explicitly
//                                 opt out and run in in-memory mode.
//                                 At startup we verify the parent directory of
//                                 the chosen path is writable; if not, we
//                                 throw before bringing the cluster up.
//   PIPELINE_REGISTRY_WAL_PATH  — Filesystem path for the ResourceRegistry
//                                 entity WAL. When set, the entity registry
//                                 swaps from `'memory'` to `'wal'`, so runs
//                                 created via `resourceRegistry.createResource`
//                                 are journaled to disk and replayed on
//                                 startup. Production default:
//                                   '/var/lib/social-api/pipeline-registry-wal.log'
//                                 Dev default:
//                                   '/tmp/pipeline-registry-wal.log'
//                                 Tests (NODE_ENV=test or JEST_WORKER_ID set)
//                                 default to undefined → in-memory registry,
//                                 keeping per-test isolation. Same parent-dir
//                                 writability check applies.
//   PIPELINE_IDENTITY_FILE      — Filesystem path holding this node's stable
//                                 identity. When set, the node id is loaded
//                                 from (or persisted to) this file via
//                                 distributed-core's loadOrCreateNodeId(),
//                                 giving the cluster a stable identity across
//                                 restarts. Default (when unset): durable
//                                 on-disk identity —
//                                   '/var/lib/social-api/node-identity' if
//                                   NODE_ENV === 'production', otherwise
//                                   '/tmp/social-api-node-identity'.
//                                 Set PIPELINE_IDENTITY_FILE=disabled to opt
//                                 out and let distributed-core mint a fresh
//                                 ephemeral id on every boot (a warning is
//                                 logged in that case).
//
// The bridge in src/pipeline-bridge subscribes to module.getEventBus() and
// routes the six bridge surfaces (getRun, getHistory, listActiveRuns,
// getMetrics, getPendingApprovals, pipeline.run.reassigned) into the
// WebSocket layer.

import * as fs from 'fs';
import * as path from 'path';

import {
  Cluster,
  loadOrCreateNodeId,
  PipelineModule,
  // Application-layer registries — these still live above the cluster
  // substrate. The Cluster facade owns ClusterManager / PubSubManager /
  // EntityRegistry / ResourceRouter / DistributedLock; ResourceRegistry +
  // ResourceTopologyManager + ApplicationRegistry remain bootstrap-owned
  // because they are sibling concepts to the cluster, not part of it.
  ResourceRegistry,
  ResourceTypeRegistry,
  ResourceTopologyManager,
  ApplicationRegistry,
  StateAggregator,
  MetricsTracker,
} from 'distributed-core';
import type { ClusterConfig, ClusterTransportConfig } from 'distributed-core';

import { createLLMClient } from './createLLMClient';
import { getRegistry as getMetricsRegistry } from '../observability/metrics';

// ---------------------------------------------------------------------------
// Test-mode helpers
// ---------------------------------------------------------------------------
//
// Phase 3 simplification: the v0.6.3 `nodeDefaults` fast-timer overrides were
// a `createCluster()`-specific hack. The Cluster facade exposes the same
// underlying knobs through `failureDetection: { heartbeatMs, deadTimeoutMs,
// activeProbing }` and is silent-by-default (NOOP_LOGGER) when no `logger`
// is provided. Test-mode only needs to:
//   1. shrink the failure-detector timers so jest doesn't sit on a 6-second
//      DEAD_TIMEOUT during `cluster.start()`/`stop()`, and
//   2. stay quiet (info-level chatter from this bootstrap and from
//      ApplicationRegistry.createModuleContext).
function isPipelineTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

function isPipelineFastTestModeEnabled(): boolean {
  if (!isPipelineTestEnv()) return false;
  const raw = process.env.PIPELINE_TEST_FAST_MODE;
  if (raw == null) return true;
  return raw.trim().toLowerCase() !== 'false';
}

/**
 * Failure-detection overrides matching the spirit of FixtureCluster's defaults.
 * Threaded into `Cluster.create({ failureDetection })` — the facade forwards
 * these into BootstrapConfig so the underlying FailureDetector uses 100ms /
 * 600ms instead of the prod 1s / 6s. Keeps jest test runs fast.
 */
function pipelineFastFailureDetection(): NonNullable<ClusterConfig['failureDetection']> {
  return {
    heartbeatMs: 100,
    deadTimeoutMs: 600,
    activeProbing: true,
  };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PipelineBootstrap {
  /** The live PipelineModule — bridge subscribes to its EventBus. */
  module: PipelineModule;
  /** Stable cluster node id (matches gossip membership). */
  nodeId: string;
  /** Coordinated tear-down: stops the module, then the cluster. */
  shutdown: () => Promise<void>;
}

export interface BootstrapOptions {
  /**
   * WAL file path for the EventBus. When set, pipeline run state survives
   * restart. When unset, defaults to PIPELINE_WAL_PATH from env, then to
   * undefined (in-memory).
   */
  walFilePath?: string;
  /**
   * Cluster transport. Default 'in-memory'.
   * Overridden by PIPELINE_CLUSTER_TRANSPORT env when not provided here.
   *
   * NOTE: as of Phase 3 (April 2026) only 'in-memory' is exercised in
   * production. The other adapters are accepted by the Cluster facade and
   * forwarded as-is, but multi-node bring-up is gated on Phase 4.
   */
  transport?: 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';
  /**
   * Local bind port for non-in-memory transports. Ignored when
   * `transport === 'in-memory'`. Overridden by PIPELINE_CLUSTER_BASE_PORT
   * env when not provided here.
   */
  basePort?: number;
  /**
   * Optional override of the LLM client. When omitted, we read
   * `PIPELINE_LLM_PROVIDER` and construct the matching client via
   * `createLLMClient()`. Tests pass `FixtureLLMClient` here.
   */
  llmClient?: import('distributed-core').LLMClient;
  /**
   * Path to the file used to persist this node's identity across restarts.
   * When set, distributed-core's `loadOrCreateNodeId()` reads (or creates)
   * the node id at this path so that the cluster's gossip identity survives
   * process restart — required for any operator that wants ResourceRouter
   * ownership and pipeline-run replay to be stable across redeploys.
   *
   * Overridden by PIPELINE_IDENTITY_FILE env when not provided here. When
   * the resolved value is the magic string `disabled`, we skip persistence
   * and let distributed-core mint a fresh ephemeral id (a warning is logged).
   */
  identityFile?: string;
  /**
   * WAL file path for the ResourceRegistry's underlying entity registry. When
   * set, the registry swaps from 'memory' to 'wal' and pipeline-run resource
   * records survive process restart by journal replay.
   *
   * Overridden by PIPELINE_REGISTRY_WAL_PATH env when not provided here.
   * When undefined (default in test mode) the registry stays in-memory.
   */
  registryWalFilePath?: string;
}

function resolveOptions(opts: BootstrapOptions): {
  transport: 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';
  basePort: number;
  walFilePath: string | undefined;
  walExplicitlyDisabled: boolean;
  identityFilePath: string | undefined;
  identityExplicitlyDisabled: boolean;
  registryWalFilePath: string | undefined;
} {
  const transport = (opts.transport
    ?? (process.env.PIPELINE_CLUSTER_TRANSPORT as BootstrapOptions['transport'])
    ?? 'in-memory') as Exclude<BootstrapOptions['transport'], undefined>;
  const basePort = opts.basePort ?? Number(process.env.PIPELINE_CLUSTER_BASE_PORT ?? '0');

  // WAL path resolution:
  //   1. Explicit opts.walFilePath wins.
  //   2. Otherwise PIPELINE_WAL_PATH env wins.
  //      - The magic value 'disabled' opts out → in-memory mode.
  //   3. Otherwise default to a durable on-disk path:
  //      - '/var/lib/social-api/pipeline-wal.log' in production
  //      - '/tmp/pipeline-wal.log'                otherwise
  let walFilePath: string | undefined;
  let walExplicitlyDisabled = false;
  const rawEnv = process.env.PIPELINE_WAL_PATH;
  if (opts.walFilePath !== undefined) {
    walFilePath = opts.walFilePath;
  } else if (rawEnv !== undefined && rawEnv !== '') {
    if (rawEnv === 'disabled') {
      walFilePath = undefined;
      walExplicitlyDisabled = true;
    } else {
      walFilePath = rawEnv;
    }
  } else {
    walFilePath = process.env.NODE_ENV === 'production'
      ? '/var/lib/social-api/pipeline-wal.log'
      : '/tmp/pipeline-wal.log';
  }

  // Identity file resolution mirrors WAL resolution:
  //   1. Explicit opts.identityFile wins.
  //   2. Otherwise PIPELINE_IDENTITY_FILE env wins.
  //      - The magic value 'disabled' opts out → ephemeral id every boot.
  //   3. Otherwise default to a durable on-disk path:
  //      - '/var/lib/social-api/node-identity' in production
  //      - '/tmp/social-api-node-identity'     otherwise
  let identityFilePath: string | undefined;
  let identityExplicitlyDisabled = false;
  const rawIdentityEnv = process.env.PIPELINE_IDENTITY_FILE;
  if (opts.identityFile !== undefined) {
    if (opts.identityFile === 'disabled') {
      identityFilePath = undefined;
      identityExplicitlyDisabled = true;
    } else {
      identityFilePath = opts.identityFile;
    }
  } else if (rawIdentityEnv !== undefined && rawIdentityEnv !== '') {
    if (rawIdentityEnv === 'disabled') {
      identityFilePath = undefined;
      identityExplicitlyDisabled = true;
    } else {
      identityFilePath = rawIdentityEnv;
    }
  } else if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    // Tests must be hermetic — sharing a stable identity across `bootstrapPipeline()`
    // calls in the same jest run produces id collisions and breaks the existing
    // "two sequential bootstraps get distinct nodeIds" suite. Test runners get
    // ephemeral identity unless they explicitly pass `identityFile` to opt in.
    // We deliberately leave `identityExplicitlyDisabled` false here so we do
    // NOT log the "ephemeral id" warning for every test — it's expected.
    identityFilePath = undefined;
  } else {
    identityFilePath = process.env.NODE_ENV === 'production'
      ? '/var/lib/social-api/node-identity'
      : '/tmp/social-api-node-identity';
  }

  if (!Number.isFinite(basePort) || basePort < 0) {
    throw new Error(`[pipeline] PIPELINE_CLUSTER_BASE_PORT must be >= 0, got: ${basePort}`);
  }

  // Registry WAL path resolution mirrors PIPELINE_WAL_PATH:
  //   1. Explicit opts.registryWalFilePath wins.
  //   2. Otherwise PIPELINE_REGISTRY_WAL_PATH env wins.
  //   3. Otherwise:
  //      - test mode (NODE_ENV=test or JEST_WORKER_ID set) → undefined,
  //        so the registry stays 'memory' and per-test isolation holds.
  //      - production → '/var/lib/social-api/pipeline-registry-wal.log'
  //      - dev        → '/tmp/pipeline-registry-wal.log'
  // We do NOT honor a 'disabled' magic value here — callers wanting
  // hermetic memory-only behaviour should run under test env or pass an
  // empty/undefined opts.registryWalFilePath.
  const registryWalFilePath = resolveRegistryWalPath(opts.registryWalFilePath);

  return {
    transport,
    basePort,
    walFilePath,
    walExplicitlyDisabled,
    identityFilePath,
    identityExplicitlyDisabled,
    registryWalFilePath,
  };
}

/**
 * Resolve the ResourceRegistry WAL path, mirroring the PIPELINE_WAL_PATH
 * resolver above. Returns `undefined` in test mode (so the registry stays
 * in-memory and tests remain isolated). Returns a path otherwise — callers
 * are responsible for the parent-dir writability check.
 */
function resolveRegistryWalPath(explicit: string | undefined): string | undefined {
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }
  const envValue = process.env.PIPELINE_REGISTRY_WAL_PATH;
  if (envValue !== undefined && envValue !== '') {
    return envValue;
  }
  // Tests must be hermetic — sharing a registry WAL across `bootstrapPipeline()`
  // calls in the same jest run would replay stale resources and cross-contaminate
  // the suite. Tests fall through to `undefined` → 'memory' registry.
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return undefined;
  }
  return process.env.NODE_ENV === 'production'
    ? '/var/lib/social-api/pipeline-registry-wal.log'
    : '/tmp/pipeline-registry-wal.log';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Stand up an in-process single-node cluster (via `Cluster.create()`) with a
 * PipelineModule registered. Returns the module + a shutdown function.
 * Idempotent only at the call site — callers are responsible for not
 * bootstrapping twice in the same process.
 */
export async function bootstrapPipeline(opts: BootstrapOptions = {}): Promise<PipelineBootstrap> {
  const {
    transport,
    basePort,
    walFilePath,
    walExplicitlyDisabled,
    identityFilePath,
    identityExplicitlyDisabled,
    registryWalFilePath,
  } = resolveOptions(opts);

  // Verify the WAL parent directory is writable BEFORE we start the cluster.
  // Failing fast here gives operators a clear, actionable error instead of an
  // opaque crash deeper inside PipelineModule.start().
  if (walFilePath) {
    const parentDir = path.dirname(walFilePath);
    try {
      fs.accessSync(parentDir, fs.constants.W_OK);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[pipeline] PIPELINE_WAL_PATH (${walFilePath}) is not writable: ${message}. `
        + `Fix the filesystem permission, set PIPELINE_WAL_PATH to a writable path, `
        + `or set PIPELINE_WAL_PATH=disabled to opt out.`,
      );
    }
  }

  // Same writability check for the registry WAL — fail fast with a clear
  // error before the cluster comes up.
  if (registryWalFilePath) {
    const parentDir = path.dirname(registryWalFilePath);
    try {
      fs.accessSync(parentDir, fs.constants.W_OK);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[pipeline] PIPELINE_REGISTRY_WAL_PATH (${registryWalFilePath}) is not writable: ${message}. `
        + `Fix the filesystem permission or set PIPELINE_REGISTRY_WAL_PATH to a writable path.`,
      );
    }
  }

  // Resolve a stable node id BEFORE we bring the cluster up. When an
  // identity file is configured we delegate to distributed-core's
  // loadOrCreateNodeId(), which atomically reads-or-creates the persisted
  // id (DC-1.3). The resolved id is then injected into Cluster.create()'s
  // required `nodeId` field.
  let persistentNodeId: string | undefined;
  if (identityFilePath) {
    try {
      persistentNodeId = await loadOrCreateNodeId(identityFilePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[pipeline] PIPELINE_IDENTITY_FILE (${identityFilePath}) could not be read or created: ${message}. `
        + `Fix the filesystem permission, set PIPELINE_IDENTITY_FILE to a writable path, `
        + `or set PIPELINE_IDENTITY_FILE=disabled to opt out.`,
      );
    }
  }

  // Cluster.create() requires `nodeId`. When no identity file is configured
  // we mint a fresh ephemeral id ourselves — same convention loadOrCreateNodeId
  // uses internally, so the visible format is consistent across paths.
  const nodeId = persistentNodeId ?? `node-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

  // Hold the Node event loop open during cluster setup. Every internal cluster
  // timer is `.unref()`'d, so without this hold a one-shot script (no HTTP
  // server) would see Node drain before Cluster.create()/start() resolves.
  // Cleared in shutdown(). Harmless when an HTTP server is already holding
  // the loop.
  const keepAlive = setInterval(() => { /* hold the event loop */ }, 1 << 30);

  // Resolve the social-api MetricsRegistry singleton so distributed-core
  // primitives that opt into `metrics?: MetricsRegistry` (Cluster.create()
  // forwards this into ResourceRouter and DistributedLock as of v0.6.5) emit
  // prometheus-style counters into the same registry that `/internal/metrics`
  // scrapes.
  const metricsRegistry = getMetricsRegistry();

  // Step 1 — bring up the Cluster facade. It owns:
  //   - InMemoryAdapter (transport) — or the configured network adapter
  //   - PubSubManager (in-memory)
  //   - EntityRegistry (memory or wal)
  //   - EntityRegistrySyncAdapter
  //   - ClusterManager + FailureDetector
  //   - ResourceRouter (with metrics threaded automatically)
  //   - DistributedLock (with metrics threaded automatically)
  //   - AutoReclaimPolicy (default-on; jitterMs: 500)
  //
  // Notes:
  //   - `topic` is per-node so two bootstraps in the same process don't
  //     cross-talk on the in-memory pubsub fabric.
  //   - `pubsub: { type: 'memory' }` is correct for the single-process
  //     pipeline. Multi-node deploys (Phase 4) will flip to 'redis'.
  //   - `transport` defaults to in-memory; the env-var override is forwarded
  //     verbatim (the facade supports the same set of names).
  const fastTimers = isPipelineFastTestModeEnabled();
  const transportConfig: ClusterTransportConfig = transport === 'in-memory'
    ? { type: 'in-memory' }
    : { type: transport, port: basePort };
  const clusterConfig: ClusterConfig = {
    nodeId,
    topic: `pipeline-${nodeId}`,
    pubsub: { type: 'memory' },
    transport: transportConfig,
    registry: registryWalFilePath
      ? { type: 'wal', walPath: registryWalFilePath }
      : { type: 'memory' },
    metrics: metricsRegistry,
    ...(fastTimers ? { failureDetection: pipelineFastFailureDetection() } : {}),
    // No `logger` — the facade defaults to a NOOP logger, which is exactly
    // what we want. Test-mode noise reduction is handled by the per-bootstrap
    // logger we construct below for the application-layer module.
  };

  const cluster = await Cluster.create(clusterConfig);
  await cluster.start();

  const clusterMgr = cluster.clusterManager;
  const pubsub = cluster.pubsub;

  // Step 2 — assemble the application-layer registries that ApplicationRegistry
  // will auto-wire into the module context.
  //
  // ResourceRegistry / ResourceTopologyManager / ApplicationRegistry are NOT
  // owned by the Cluster facade — they're sibling concepts (the facade sits
  // beneath them). PipelineModule.initialize() calls
  // `context.resourceRegistry.registerResourceType()`, so the registry MUST
  // be a real ResourceRegistry instance backed by an EntityRegistry of the
  // matching mode (wal vs memory). ResourceRegistry constructs its own
  // EntityRegistry internally via EntityRegistryFactory — we cannot plug in
  // `cluster.registry` directly. This is intentional: the cluster's
  // EntityRegistry is for ownership/router/lock state; the
  // ResourceRegistry's EntityRegistry is for resource-typed metadata.
  //
  // Registry mode mirrors the cluster's registry config so the WAL-on/off
  // decision is consistent across the substrate and the resource layer:
  //   - `registryWalFilePath` set → entityRegistryType: 'wal'
  //   - undefined (test mode)    → entityRegistryType: 'memory'
  const resourceRegistry = new ResourceRegistry(
    registryWalFilePath
      ? {
          nodeId,
          entityRegistryType: 'wal',
          entityRegistryConfig: { walConfig: { filePath: registryWalFilePath } },
        }
      : {
          nodeId,
          entityRegistryType: 'memory',
        },
  );
  // Start the resource registry so getResourcesByType() / createResource()
  // work as soon as the module's lifecycle reaches RUNNING. Stop is wired
  // into shutdown() below.
  await resourceRegistry.start();

  // ResourceTypeRegistry is a sibling registry consumed by the topology
  // manager. PipelineModule does not interact with it directly — it
  // registers its resource types via the ResourceRegistry above — but we
  // construct it so the topology manager has a real collaborator instead
  // of a stub.
  const resourceTypeRegistry = new ResourceTypeRegistry();

  // StateAggregator + MetricsTracker are constructor-only collaborators
  // for the topology manager in single-node mode (no timers, no gossip
  // broadcasts until .start() is called — which we deliberately do NOT
  // call here, since size=1 has nothing to aggregate). The
  // setupMessageHandling() call in StateAggregator's constructor only
  // installs a transport listener, which is harmless.
  const stateAggregator = new StateAggregator(clusterMgr);
  const metricsTracker = new MetricsTracker({});

  const topologyManager = new ResourceTopologyManager(
    clusterMgr,
    resourceRegistry,
    resourceTypeRegistry,
    stateAggregator,
    metricsTracker,
  );

  // ApplicationRegistry tracks lifecycle of all modules registered against
  // this node. As of distributed-core v0.5.7 it offers a `register()` helper
  // that auto-wires the 6-field ApplicationModuleContext from its own
  // internal state (clusterManager, resourceRegistry, topologyManager,
  // moduleRegistry, configuration, logger).
  const moduleRegistry = new ApplicationRegistry(
    clusterMgr,
    resourceRegistry,
    topologyManager,
  );
  await moduleRegistry.start();

  // Under jest (with fast mode active — same env-var guard as the timer
  // overrides), suppress info-level chatter from this bootstrap. warn/error
  // still flow through so real failures surface. Set
  // PIPELINE_TEST_FAST_MODE=false to restore full chatter when debugging.
  const quietInfo = fastTimers;
  const logger = {
    info:  quietInfo
      ? (_msg: string, _meta?: unknown) => { /* suppressed in test mode */ }
      : (msg: string, meta?: unknown) => console.log(`[pipeline:${nodeId}] ${msg}`, meta ?? ''),
    warn:  (msg: string, meta?: unknown) => console.warn(`[pipeline:${nodeId}] WARN ${msg}`, meta ?? ''),
    error: (msg: string, meta?: unknown) => console.error(`[pipeline:${nodeId}] ERROR ${msg}`, meta ?? ''),
  };

  // Log the identity decision now that we have a logger and a final nodeId.
  if (persistentNodeId) {
    logger.info(`Stable identity loaded from ${identityFilePath} — nodeId=${nodeId}`);
  } else if (identityExplicitlyDisabled) {
    logger.warn(
      'Stable identity explicitly disabled via PIPELINE_IDENTITY_FILE=disabled — nodeId is ephemeral and will change on every restart',
    );
  }

  // Step 3 — pick the LLM client. Tests pass an explicit override (typically
  // FixtureLLMClient); production reads PIPELINE_LLM_PROVIDER + the matching
  // SDK credentials.
  const llmClient = opts.llmClient ?? createLLMClient();

  // Step 4 — construct the module and let ApplicationRegistry.register()
  // auto-wire the context, then call module.initialize() + module.start()
  // for us. We pass `pubsub` and `metrics` as `configuration` overrides —
  // PipelineModule.onInitialize() reads `context.configuration.pubsub` to
  // construct its EventBus (load-bearing) and `context.configuration.metrics`
  // for the v0.4.4+ metrics threading.
  if (walFilePath) {
    logger.info(`WAL enabled at ${walFilePath} — pipeline state will survive restart`);
  } else if (walExplicitlyDisabled) {
    logger.warn(
      'WAL explicitly disabled via PIPELINE_WAL_PATH=disabled — pipeline state is in-memory only and will be lost on restart',
    );
  } else {
    logger.warn('WAL disabled — pipeline state is in-memory only');
  }
  if (registryWalFilePath) {
    logger.info(
      `ResourceRegistry WAL enabled at ${registryWalFilePath} — registry state will survive restart`,
    );
  } else {
    logger.info('ResourceRegistry running in-memory (test mode or no PIPELINE_REGISTRY_WAL_PATH)');
  }

  const module = new PipelineModule({
    moduleId:       `pipeline-${nodeId}`,
    moduleName:     'Pipeline',
    version:        '1.0.0',
    resourceTypes:  ['pipeline-run'],
    configuration:  {},
    llmClient,
    ...(walFilePath ? { walFilePath } : {}),
  });

  // Wiring choice depends on whether we're in fast/test mode:
  //
  // Production path → `moduleRegistry.register(module, …)`. The registry
  // auto-wires the 6-field ApplicationModuleContext from its own internal
  // state (clusterManager, resourceRegistry, topologyManager, moduleRegistry,
  // configuration, logger). It also tracks module state in its dependency
  // graph and emits `registry:module-registered` for any observers.
  //
  // Test path → bypass the registry and call `module.initialize(context)` +
  // `module.start()` directly with a quiet context. This is the only way to
  // suppress DC's hardcoded `console.log('[INFO] [moduleId] …')` chatter
  // from `ApplicationRegistry.createModuleContext` (v0.6.3 added IS_TEST_ENV
  // for FrameworkLogger / transport adapters but did NOT thread it into
  // that inline logger). We give up registry-side state tracking, but no
  // bootstrap consumer depends on it — `shutdown()` knows to stop the module
  // directly when it's not registry-managed.
  if (fastTimers) {
    const quietModuleLogger = {
      info:  (_message: string, _meta?: unknown) => { /* suppressed */ },
      warn:  (message: string, meta?: unknown) =>
        console.warn(`[WARN] [${module.moduleId}] ${message}`, meta || ''),
      error: (message: string, meta?: unknown) =>
        console.error(`[ERROR] [${module.moduleId}] ${message}`, meta || ''),
      debug: (_message: string, _meta?: unknown) => { /* suppressed */ },
    };
    const quietContext = {
      clusterManager: clusterMgr,
      resourceRegistry,
      topologyManager,
      moduleRegistry,
      configuration: {
        // CRITICAL: PipelineModule.onInitialize() reads
        // context.configuration.pubsub to construct its internal EventBus.
        pubsub,
        metrics: metricsRegistry,
      },
      logger: quietModuleLogger,
    };
    await module.initialize(quietContext as Parameters<typeof module.initialize>[0]);
    await module.start();
  } else {
    await moduleRegistry.register(module, {
      configuration: {
        // CRITICAL: PipelineModule.onInitialize() reads
        // context.configuration.pubsub to construct its internal EventBus.
        pubsub,
        // Optional MetricsRegistry — `configuration` is `Record<string, any>`
        // so this is always shape-compatible. PipelineModule reads it lazily
        // in versions of distributed-core that opted into the v0.4.4+ metrics
        // threading; older versions ignore the field harmlessly.
        metrics: metricsRegistry,
      },
    });
  }

  // Step 5 — coordinated shutdown.
  //
  // Order matters and matches the pre-Phase-3 shape:
  //   1a. (prod) moduleRegistry.stop()   — stops every registered module in
  //                                        reverse dependency order.
  //   1b. (test) module.stop()           — registry isn't tracking us when
  //                                        fastTimers is on, so we stop the
  //                                        module directly.
  //   2. resourceRegistry.stop() — closes the underlying entity registry.
  //   3. cluster.stop()          — facade tears down router → lock →
  //                                clusterManager → registry → pubsub →
  //                                transport in the correct reverse order.
  // Any throw is logged but does not abort the rest of the chain — operators
  // need every subsystem torn down even if one stage misbehaves.
  const shutdown = async (): Promise<void> => {
    clearInterval(keepAlive);
    try {
      if (fastTimers) {
        await module.stop();
      } else {
        await moduleRegistry.stop();
      }
    } catch (err) {
      console.error('[pipeline] module/registry stop() failed', err);
    }
    try {
      await resourceRegistry.stop();
    } catch (err) {
      console.error('[pipeline] resourceRegistry.stop() failed', err);
    }
    try {
      await cluster.stop();
    } catch (err) {
      console.error('[pipeline] cluster.stop() failed', err);
    }
  };

  return { module, nodeId, shutdown };
}
