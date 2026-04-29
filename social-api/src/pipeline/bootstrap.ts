// social-api/src/pipeline/bootstrap.ts
//
// Bootstrap that stands up an in-process distributed-core Cluster +
// PipelineModule for the social-api service.
//
// Tunables (all read from env at call time, with safe defaults):
//   PIPELINE_CLUSTER_SIZE       — number of nodes in this process. Default 1.
//                                 size > 1 is for integration tests; real
//                                 multi-process production deploys are gated
//                                 on distributed-core gap DC-1.1 (see
//                                 .planning/DISTRIBUTED-CORE-INTEGRATION-SPEC.md).
//   PIPELINE_CLUSTER_TRANSPORT  — 'in-memory' | 'websocket' | 'tcp' | 'udp' |
//                                 'http'. Default 'in-memory'.
//   PIPELINE_CLUSTER_BASE_PORT  — Starting port for sequential allocation
//                                 (only meaningful for non-in-memory
//                                 transports). Default 0 (ephemeral).
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
  createCluster,
  loadOrCreateNodeId,
  PipelineModule,
  // Real registries — replace the previous no-op stubs (gaps DC-4.x closed
  // in distributed-core v0.3.0 made these classes / their accessors part of
  // the public surface). NodeHandle does not yet expose accessor methods for
  // these, so we instantiate them directly from the exported classes — the
  // same pattern used by distributed-core's own production-chat-harness.
  ResourceRegistry,
  ResourceTypeRegistry,
  ResourceTopologyManager,
  ApplicationRegistry,
  StateAggregator,
  MetricsTracker,
} from 'distributed-core';

import { createLLMClient } from './createLLMClient';
import { getRegistry as getMetricsRegistry } from '../observability/metrics';

// ---------------------------------------------------------------------------
// Test-mode helpers (DC v0.6.3 fast-timer + log-suppression API)
// ---------------------------------------------------------------------------
//
// distributed-core v0.6.3 (commit 82f4782) introduced two helpers explicitly
// for cutting jest noise + cluster-startup latency in tests:
//   - `IS_TEST_ENV` (auto-detected from NODE_ENV=test or JEST_WORKER_ID) makes
//     the FrameworkLogger and transport adapters silent by default.
//   - `nodeDefaults: { gossipInterval, joinTimeout, failureDetector, lifecycle,
//     logging }` on createCluster() forwards through to Node ctor, swapping
//     the prod 1s/5s/6s timers for FixtureCluster-style 50ms/500ms/600ms.
//
// We mirror DC's detection here and only activate when:
//   - We're running under jest (NODE_ENV=test or JEST_WORKER_ID set), AND
//   - The operator has not opted out via PIPELINE_TEST_FAST_MODE=false.
//
// Production paths are unaffected: `isPipelineTestEnv()` returns false outside
// of jest, so `pipelineFastTimerNodeDefaults()` is never threaded into
// createCluster() in real deploys.
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
 * Fast-timer overrides matching `FixtureCluster`'s defaults from DC v0.6.3.
 * Threaded into `createCluster({ nodeDefaults })` — Node ctor reads the
 * fields directly, and `logging: false` propagates suppression to per-node
 * FrameworkLogger and Transport adapters.
 */
function pipelineFastTimerNodeDefaults(): Record<string, unknown> {
  return {
    logging: false,
    gossipInterval: 50,
    joinTimeout: 500,
    failureDetector: {
      heartbeatInterval: 100,
      failureTimeout: 300,
      deadTimeout: 600,
      pingTimeout: 200,
    },
    lifecycle: {
      enableGracefulShutdown: true,
      maxShutdownWait: 50,
    },
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
   * Number of cluster nodes spawned in this process. Default 1.
   * Overridden by PIPELINE_CLUSTER_SIZE env when not provided here.
   * size > 1 is for integration tests — real multi-process production
   * is blocked on distributed-core gap DC-1.1.
   */
  size?: number;
  /**
   * Cluster transport. Default 'in-memory'.
   * Overridden by PIPELINE_CLUSTER_TRANSPORT env when not provided here.
   */
  transport?: 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';
  /**
   * Starting port for sequential allocation (non-in-memory transports only).
   * Overridden by PIPELINE_CLUSTER_BASE_PORT env when not provided here.
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
  size: number;
  transport: 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';
  basePort: number;
  walFilePath: string | undefined;
  walExplicitlyDisabled: boolean;
  identityFilePath: string | undefined;
  identityExplicitlyDisabled: boolean;
  registryWalFilePath: string | undefined;
} {
  const size = opts.size ?? Number(process.env.PIPELINE_CLUSTER_SIZE ?? '1');
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

  if (!Number.isFinite(size) || size < 1) {
    throw new Error(`[pipeline] PIPELINE_CLUSTER_SIZE must be >= 1, got: ${size}`);
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
    size,
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
 * Stand up an in-process single-node cluster with a PipelineModule registered.
 * Returns the module + a shutdown function. Idempotent only at the call site —
 * callers are responsible for not bootstrapping twice in the same process.
 */
export async function bootstrapPipeline(opts: BootstrapOptions = {}): Promise<PipelineBootstrap> {
  const {
    size,
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
  // id (DC-1.3). The resolved id is then injected into createCluster() via
  // the per-node `nodes: [{ id }]` override so size=1 cluster's lone node
  // adopts the persistent identity.
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

  // Hold the Node event loop open during cluster setup. Every internal cluster
  // timer is `.unref()`'d, so without this hold a one-shot script (no HTTP
  // server) would see Node drain before createCluster() resolves. Cleared in
  // shutdown(). Harmless when an HTTP server is already holding the loop.
  const keepAlive = setInterval(() => { /* hold the event loop */ }, 1 << 30);

  // Step 1 — bring up the cluster. autoStart wires gossip + transport.
  // size=1 in-memory is the default. size>1 spawns multiple nodes in this
  // process (integration-test scope). Multi-process production multi-node
  // is gated on distributed-core gap DC-1.1.
  //
  // When a persistent node id is available, pass it as the per-node id so
  // gossip membership is stable across restarts. When size > 1 only node 0
  // gets the persistent id; the rest fall back to ephemeral ids since the
  // identity file is per-process, not per-node.
  // Fast-timer overrides — only when running under jest (and the operator
  // hasn't disabled them via PIPELINE_TEST_FAST_MODE=false). Threading via
  // `nodeDefaults` is the v0.6.3 API; Node ctor reads gossipInterval /
  // joinTimeout / failureDetector / lifecycle directly, and `logging: false`
  // propagates suppression to per-node FrameworkLogger + transport adapters.
  // Production paths get DC's own 1s/5s/6s defaults — `isPipelineTestEnv()`
  // is false outside of jest.
  const fastTimers = isPipelineFastTestModeEnabled();
  const nodeDefaults = fastTimers ? pipelineFastTimerNodeDefaults() : undefined;

  const clusterHandle = await createCluster({
    size,
    transport,
    basePort,
    autoStart: true,
    ...(persistentNodeId ? { nodes: [{ id: persistentNodeId }] } : {}),
    ...(nodeDefaults ? { nodeDefaults } : {}),
  } as Parameters<typeof createCluster>[0]);

  // Wait for the membership table to settle. With size=1 this is effectively
  // instant; we keep the call so the contract matches the multi-node case.
  // In fast mode, joinTimeout is 500ms so a 1s convergence ceiling is plenty.
  await clusterHandle.waitForConvergence(fastTimers ? 1000 : 5000);

  const handle = clusterHandle.getNode(0);
  const clusterMgr = handle.getCluster();
  const pubsub = handle.getPubSub();
  const nodeId = handle.id;

  // Step 2 — assemble the registries that ApplicationRegistry will auto-wire
  // into the module context.
  //
  // distributed-core v0.3.0 closed gaps DC-4.x and made ResourceRegistry,
  // ResourceTopologyManager, and ApplicationRegistry first-class public
  // exports. NodeHandle does NOT (yet) expose accessor methods for these,
  // so we instantiate them here using the same pattern as distributed-core's
  // own production-chat-harness. PipelineModule.initialize() calls
  // resourceRegistry.registerResourceType() during onInitialize, so the
  // registry MUST be a real instance — the no-op stubs from the previous
  // single-node mode are gone.
  //
  // Registry mode:
  //   - When `registryWalFilePath` is set, switch to entityRegistryType='wal'
  //     and pass `entityRegistryConfig: { walConfig: { filePath } }`. The
  //     option key is `walConfig` — distributed-core's
  //     EntityRegistryFactory destructures that exact key and silently
  //     ignores anything else (same gotcha as `crdtOptions`). On startup
  //     `WriteAheadLogEntityRegistry` reads the file, replays each entry,
  //     and hydrates the registry BEFORE PipelineModule.start() runs.
  //   - When undefined (test mode), we keep `'memory'` so each test gets
  //     a fresh, empty registry.
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
  // this node. As of distributed-core v0.5.7 it also offers a `register()`
  // helper that auto-wires the 6-field ApplicationModuleContext from its
  // own internal state (clusterManager, resourceRegistry, topologyManager,
  // moduleRegistry, configuration, logger) — replacing what used to be
  // ~40 lines of manual context construction in this bootstrap.
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

  // Resolve the social-api MetricsRegistry singleton so distributed-core
  // primitives that opt into `metrics?: MetricsRegistry` (e.g. EventBus,
  // routing, lock managers) emit prometheus-style counters into the same
  // registry that `/internal/metrics` scrapes. ResourceRegistryConfig does
  // not currently surface a `metrics` field directly — distributed-core
  // would silently drop it (same gotcha as `crdtOptions` / `walConfig`),
  // so we deliberately do NOT pass it on the registry config and instead
  // thread it via context.configuration where PipelineModule can pick it
  // up if/when its config grows that field.
  const metricsRegistry = getMetricsRegistry();

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
  // Order matters:
  //   1a. (prod) moduleRegistry.stop()   — stops every registered module in
  //                                        reverse dependency order.
  //   1b. (test) module.stop()           — registry isn't tracking us when
  //                                        fastTimers is on, so we stop the
  //                                        module directly.
  //   2. resourceRegistry.stop() — closes the underlying entity registry.
  //   3. clusterHandle.stop()    — stops gossip + transport.
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
      await clusterHandle.stop();
    } catch (err) {
      console.error('[pipeline] cluster.stop() failed', err);
    }
  };

  return { module, nodeId, shutdown };
}
