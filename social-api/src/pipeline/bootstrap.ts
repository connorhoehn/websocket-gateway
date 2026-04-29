// social-api/src/pipeline/bootstrap.ts
//
// Bootstrap that stands up an in-process distributed-core Cluster +
// PipelineModule for the social-api service. This file is the *composition
// layer* — it resolves env-derived options, calls each `config/*` builder,
// then stitches the cluster lifecycle (Cluster.create / start, registry
// start, module register/initialize, shutdown) together.
//
// Per-concern config builders live in `./config/`:
//
//   - config/cluster.ts          — buildClusterConfig() (transport / pubsub /
//                                  registry / failureDetection)
//   - config/pipelineModule.ts   — buildPipelineModuleConfig()
//   - config/registries.ts       — buildAppLayerRegistries()
//   - config/identity.ts         — resolveStableNodeId()
//   - config/walPreflight.ts     — verifyWalParentWritable()
//
// In-flight streams that extend these builders (without touching this file):
//   - Stream 7 (RaftFactory)  → config/cluster.ts buildRegistryConfig()
//   - Stream 8 (RpcSigning)   → config/cluster.ts (RaftConfig.signer slot)
//   - Stream 9 (FDBridge)     → new file config/failureDetectorBridge.ts
//                                wired AFTER cluster.start() in bootstrap.
//   - Stream 10 (HHQueue)     → new file config/hintedHandoffQueue.ts
//                                wired AFTER cluster.start() in bootstrap.
//
// What the Cluster facade gives us "for free":
//   - cluster.scope('pipeline')   namespacing for locks/elections (NOT YET USED — see field notes).
//   - cluster.snapshot()          postmortem aggregator.
//   - cluster.lock                replaces hand-wired DistributedLock.
//   - metrics: config field       single-config metrics threading (FR-6).
//
// Tunables (env at call time, safe defaults):
//   PIPELINE_CLUSTER_TRANSPORT  'in-memory' | 'tcp' | 'websocket' | 'http' |
//                                'udp'. Default 'in-memory'. Single-process
//                                deploys must use 'in-memory'; the other
//                                transports are reserved for Phase 4 multi-node.
//   PIPELINE_CLUSTER_BASE_PORT  Local bind port for non-in-memory transports.
//                                Default 0 (ephemeral).
//   PIPELINE_WAL_PATH           EventBus WAL path. When set, pipeline run
//                                state survives restart. Default:
//                                  '/var/lib/social-api/pipeline-wal.log' (prod)
//                                  '/tmp/pipeline-wal.log'                 (dev)
//                                Set =disabled to opt out and run in-memory.
//   PIPELINE_REGISTRY_WAL_PATH  ResourceRegistry entity WAL path. When set,
//                                the entity registry uses 'wal' mode. Defaults
//                                to undefined in test mode (per-test isolation),
//                                and to durable on-disk paths otherwise.
//   PIPELINE_IDENTITY_FILE      Stable node identity file. Loaded via
//                                distributed-core's loadOrCreateNodeId(). Set
//                                =disabled to mint a fresh ephemeral id every
//                                boot (warning logged).
//   PIPELINE_TEST_FAST_MODE     'false' to disable test fast-timers; default
//                                enabled when NODE_ENV=test or JEST_WORKER_ID
//                                is set.
//
// The bridge in src/pipeline-bridge subscribes to module.getEventBus() and
// routes the six bridge surfaces (getRun, getHistory, listActiveRuns,
// getMetrics, getPendingApprovals, pipeline.run.reassigned) into WebSockets.

import { Cluster, PipelineModule } from 'distributed-core';
import type { LLMClient } from 'distributed-core';

import { createLLMClient } from './createLLMClient';
import { getRegistry as getMetricsRegistry } from '../observability/metrics';
import { buildClusterConfig, type PipelineTransportKind } from './config/cluster';
import { buildPipelineModuleConfig } from './config/pipelineModule';
import { buildAppLayerRegistries } from './config/registries';
import { resolveStableNodeId } from './config/identity';
import { verifyWalParentWritable } from './config/walPreflight';

// ---------------------------------------------------------------------------
// Test-mode helpers
// ---------------------------------------------------------------------------

function isPipelineTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

function isPipelineFastTestModeEnabled(): boolean {
  if (!isPipelineTestEnv()) return false;
  const raw = process.env.PIPELINE_TEST_FAST_MODE;
  if (raw == null) return true;
  return raw.trim().toLowerCase() !== 'false';
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
  walFilePath?: string;
  transport?: PipelineTransportKind;
  basePort?: number;
  llmClient?: LLMClient;
  identityFile?: string;
  registryWalFilePath?: string;
}

interface ResolvedBootstrapOptions {
  transport: PipelineTransportKind;
  basePort: number;
  walFilePath: string | undefined;
  walExplicitlyDisabled: boolean;
  identityFilePath: string | undefined;
  identityExplicitlyDisabled: boolean;
  registryWalFilePath: string | undefined;
}

// ---------------------------------------------------------------------------
// Env / option resolution
// ---------------------------------------------------------------------------

function resolveOptions(opts: BootstrapOptions): ResolvedBootstrapOptions {
  const transport = (opts.transport
    ?? (process.env.PIPELINE_CLUSTER_TRANSPORT as BootstrapOptions['transport'])
    ?? 'in-memory') as PipelineTransportKind;
  const basePort = opts.basePort ?? Number(process.env.PIPELINE_CLUSTER_BASE_PORT ?? '0');
  if (!Number.isFinite(basePort) || basePort < 0) {
    throw new Error(`[pipeline] PIPELINE_CLUSTER_BASE_PORT must be >= 0, got: ${basePort}`);
  }

  // WAL path resolution: opts > env > default. The magic value 'disabled'
  // (env only) opts out → in-memory mode.
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

  // Identity path resolution mirrors WAL — both opts and env honor 'disabled'.
  // Tests get ephemeral identity (sharing IDs across sequential bootstrap
  // calls in one jest run breaks the existing "distinct nodeIds" suite).
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
  } else if (isPipelineTestEnv()) {
    identityFilePath = undefined;
  } else {
    identityFilePath = process.env.NODE_ENV === 'production'
      ? '/var/lib/social-api/node-identity'
      : '/tmp/social-api-node-identity';
  }

  // Registry WAL: tests fall through to undefined → 'memory' for hermetic
  // isolation. No 'disabled' magic value here — callers wanting in-memory
  // behavior should run under test env or pass an empty value.
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

function resolveRegistryWalPath(explicit: string | undefined): string | undefined {
  if (explicit !== undefined && explicit !== '') return explicit;
  const envValue = process.env.PIPELINE_REGISTRY_WAL_PATH;
  if (envValue !== undefined && envValue !== '') return envValue;
  if (isPipelineTestEnv()) return undefined;
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

  // --- Pre-flight: writability + identity ---
  if (walFilePath) {
    verifyWalParentWritable(walFilePath, 'PIPELINE_WAL_PATH', /* disableHint */ true);
  }
  if (registryWalFilePath) {
    verifyWalParentWritable(registryWalFilePath, 'PIPELINE_REGISTRY_WAL_PATH', /* disableHint */ false);
  }
  const { nodeId, persistentNodeId } = await resolveStableNodeId(identityFilePath);

  // Hold the Node event loop open during cluster setup. Every internal cluster
  // timer is `.unref()`'d, so without this hold a one-shot script (no HTTP
  // server) would see Node drain before Cluster.create()/start() resolves.
  const keepAlive = setInterval(() => { /* hold the event loop */ }, 1 << 30);

  const fastTimers = isPipelineFastTestModeEnabled();
  const metricsRegistry = getMetricsRegistry();

  // --- Cluster: build config → create → start ---
  const clusterConfig = buildClusterConfig({
    nodeId,
    transport,
    basePort,
    registryWalFilePath,
    fastTimers,
    metricsRegistry,
  });
  const cluster = await Cluster.create(clusterConfig);
  await cluster.start();

  const clusterMgr = cluster.clusterManager;
  const pubsub = cluster.pubsub;

  // --- App-layer registries (sit ABOVE the cluster substrate) ---
  const {
    resourceRegistry,
    topologyManager,
    moduleRegistry,
  } = await buildAppLayerRegistries({
    nodeId,
    clusterMgr,
    registryWalFilePath,
  });

  // --- Bootstrap-level logger (separate from the per-module logger below) ---
  const quietInfo = fastTimers;
  const logger = {
    info:  quietInfo
      ? (_msg: string, _meta?: unknown) => { /* suppressed in test mode */ }
      : (msg: string, meta?: unknown) => console.log(`[pipeline:${nodeId}] ${msg}`, meta ?? ''),
    warn:  (msg: string, meta?: unknown) => console.warn(`[pipeline:${nodeId}] WARN ${msg}`, meta ?? ''),
    error: (msg: string, meta?: unknown) => console.error(`[pipeline:${nodeId}] ERROR ${msg}`, meta ?? ''),
  };

  // Identity decision logging.
  if (persistentNodeId) {
    logger.info(`Stable identity loaded from ${identityFilePath} — nodeId=${nodeId}`);
  } else if (identityExplicitlyDisabled) {
    logger.warn(
      'Stable identity explicitly disabled via PIPELINE_IDENTITY_FILE=disabled — nodeId is ephemeral and will change on every restart',
    );
  }

  // WAL decision logging.
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

  // --- PipelineModule construction ---
  const llmClient = opts.llmClient ?? createLLMClient();
  const module = new PipelineModule(
    buildPipelineModuleConfig({
      nodeId,
      walFilePath,
      llmClient,
      metricsRegistry,
    }),
  );

  // Wiring choice depends on whether we're in fast/test mode:
  //
  // Production path → moduleRegistry.register(module, …). The registry auto-
  // wires the 6-field ApplicationModuleContext from its own internal state
  // (clusterManager, resourceRegistry, topologyManager, moduleRegistry,
  // configuration, logger). It also tracks module state in its dependency
  // graph and emits 'registry:module-registered' for any observers.
  //
  // Test path → bypass the registry and call module.initialize(context) +
  // module.start() directly with a quiet context. Suppresses the hardcoded
  // '[INFO] [moduleId] …' chatter from ApplicationRegistry.createModuleContext
  // (v0.6.3 added IS_TEST_ENV for FrameworkLogger / transport adapters but did
  // NOT thread it into that inline logger). We give up registry-side state
  // tracking, but no consumer depends on it — shutdown() knows to stop the
  // module directly when it's not registry-managed.
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
        // so this is always shape-compatible.
        metrics: metricsRegistry,
      },
    });
  }

  // --- Coordinated shutdown ---
  //
  // Order matters and matches the pre-Phase-3 shape:
  //   1a. (prod) moduleRegistry.stop()  — stops every registered module in
  //                                       reverse dependency order.
  //   1b. (test) module.stop()          — registry isn't tracking us when
  //                                       fastTimers is on, so we stop the
  //                                       module directly.
  //   2. resourceRegistry.stop()  — closes the underlying entity registry.
  //   3. cluster.stop()           — facade tears down router → lock →
  //                                 clusterManager → registry → pubsub →
  //                                 transport in the correct reverse order.
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
