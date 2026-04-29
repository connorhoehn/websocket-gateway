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
import { setupFailureDetectorBridge } from './config/failureDetectorBridge';
import { getRegistry as getMetricsRegistry } from '../observability/metrics';
import {
  buildClusterConfig,
  resolveRegistryMode,
  type PipelineRegistryMode,
  type PipelineTransportKind,
} from './config/cluster';
import { buildPipelineModuleConfig } from './config/pipelineModule';
import { buildAppLayerRegistries } from './config/registries';
import { resolveStableNodeId } from './config/identity';
import { verifyWalParentWritable } from './config/walPreflight';
import { setupHintedHandoffQueue } from './config/hintedHandoffQueue';
import { buildRaftSigner } from './config/signer';

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
  /**
   * Registry mode override. When set, takes precedence over the env-var
   * resolver in `resolveRegistryMode()`. Tests use this to opt into the
   * 'raft' branch without monkey-patching `process.env`.
   *
   *  - 'memory' → in-process EntityRegistry, no durability.
   *  - 'wal'    → on-disk WAL-backed EntityRegistry. Requires
   *               `registryWalFilePath` (or PIPELINE_REGISTRY_WAL_PATH).
   *  - 'raft'   → cluster's EntityRegistry is RaftEntityRegistry — writes
   *               are linearizable through consensus. Requires
   *               `raftDataDir` (or PIPELINE_RAFT_DATA_DIR). The
   *               ResourceRegistry's *resource-side* entity registry is
   *               downgraded to wal-or-memory because distributed-core
   *               HEAD's ResourceRegistry constructor can't host a Raft
   *               entity registry (see `config/registries.ts` for the
   *               full gap analysis).
   */
  registryMode?: PipelineRegistryMode;
  /**
   * On-disk dataDir for the Raft log + persistent state + snapshots. Only
   * consulted when `registryMode === 'raft'`. Overridden by
   * PIPELINE_RAFT_DATA_DIR when not provided here.
   */
  raftDataDir?: string;
  /**
   * Directory holding per-node signer keys. When set, each Raft RPC is
   * signed with the node's private key + verified on receipt. Overridden
   * by PIPELINE_RAFT_SIGNER_DIR when not provided here. When unset on
   * both, RPCs are unsigned (back-compat).
   */
  raftSignerDir?: string;
}

interface ResolvedBootstrapOptions {
  transport: PipelineTransportKind;
  basePort: number;
  walFilePath: string | undefined;
  walExplicitlyDisabled: boolean;
  identityFilePath: string | undefined;
  identityExplicitlyDisabled: boolean;
  registryWalFilePath: string | undefined;
  registryMode: PipelineRegistryMode;
  raftDataDir: string | undefined;
  raftSignerDir: string | undefined;
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

  // Registry mode: opts wins over env. resolveRegistryMode() reads
  // PIPELINE_REGISTRY_MODE; when absent, falls back to 'wal' if walPath is
  // set, else 'memory'.
  const registryMode: PipelineRegistryMode =
    opts.registryMode ?? resolveRegistryMode(registryWalFilePath);

  // Raft dataDir: explicit opt > env > sensible default for raft mode.
  const raftDataDir = opts.raftDataDir
    ?? process.env.PIPELINE_RAFT_DATA_DIR
    ?? (registryMode === 'raft'
      ? (process.env.NODE_ENV === 'production'
          ? '/var/lib/social-api/raft'
          : `/tmp/social-api-raft-${process.pid}`)
      : undefined);

  // Raft signer dir: per-node KeyManager secrets directory. Off by default
  // (unsigned RPCs); set to enable signing.
  const raftSignerDir = opts.raftSignerDir ?? process.env.PIPELINE_RAFT_SIGNER_DIR;

  return {
    transport,
    basePort,
    walFilePath,
    walExplicitlyDisabled,
    identityFilePath,
    identityExplicitlyDisabled,
    registryWalFilePath,
    registryMode,
    raftDataDir,
    raftSignerDir,
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
    registryMode,
    raftDataDir,
    raftSignerDir,
  } = resolveOptions(opts);

  // --- Pre-flight: writability + identity ---
  if (walFilePath) {
    verifyWalParentWritable(walFilePath, 'PIPELINE_WAL_PATH', /* disableHint */ true);
  }
  if (registryWalFilePath) {
    verifyWalParentWritable(registryWalFilePath, 'PIPELINE_REGISTRY_WAL_PATH', /* disableHint */ false);
  }
  // Raft mode requires a writable dataDir. Create it if missing (Raft itself
  // expects it to exist) and fail fast on permission issues so the operator
  // sees a clear error before the cluster comes up.
  if (registryMode === 'raft' && raftDataDir) {
    const fs = await import('fs');
    try {
      fs.mkdirSync(raftDataDir, { recursive: true });
      fs.accessSync(raftDataDir, fs.constants.W_OK);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[pipeline] PIPELINE_RAFT_DATA_DIR (${raftDataDir}) is not writable: ${message}. `
        + `Fix the filesystem permission or set PIPELINE_RAFT_DATA_DIR to a writable path.`,
      );
    }
  }
  const { nodeId, persistentNodeId } = await resolveStableNodeId(identityFilePath);

  // Hold the Node event loop open during cluster setup. Every internal cluster
  // timer is `.unref()`'d, so without this hold a one-shot script (no HTTP
  // server) would see Node drain before Cluster.create()/start() resolves.
  const keepAlive = setInterval(() => { /* hold the event loop */ }, 1 << 30);

  const fastTimers = isPipelineFastTestModeEnabled();
  const metricsRegistry = getMetricsRegistry();

  // Build the per-node Raft signer (returns undefined unless
  // PIPELINE_RAFT_SIGNER_DIR / opts.raftSignerDir is set). When set, every
  // outbound Raft RPC is signed and every inbound RPC is verified using the
  // node's KeyManager-backed key pair.
  const raftSigner = buildRaftSigner({
    nodeId,
    keyManagerSecretsDir: raftSignerDir,
  });

  // --- Cluster: build config → create → start ---
  const clusterConfig = buildClusterConfig({
    nodeId,
    transport,
    basePort,
    registryMode,
    registryWalFilePath,
    raftDataDir,
    raftSigner,
    fastTimers,
    metricsRegistry,
  });
  const cluster = await Cluster.create(clusterConfig);
  await cluster.start();

  // Optional cluster sidecars wired AFTER cluster.start(). Each setup helper
  // is feature-flagged via env (see config/*.ts) and returns null when its
  // feature is disabled — making both opt-in and zero-cost when off.
  const fdBridge = await setupFailureDetectorBridge(cluster);
  const hintedHandoff = await setupHintedHandoffQueue(cluster);

  const clusterMgr = cluster.clusterManager;
  const pubsub = cluster.pubsub;

  // --- App-layer registries (sit ABOVE the cluster substrate) ---
  const {
    resourceRegistry,
    topologyManager,
    moduleRegistry,
    warnings: registryWarnings,
  } = await buildAppLayerRegistries({
    nodeId,
    clusterMgr,
    mode: registryMode,
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
  // Registry-mode decision logging + downgrade warnings produced by
  // buildAppLayerRegistries (notably the ResourceRegistry-can't-host-Raft
  // downgrade documented in config/registries.ts).
  if (registryMode === 'raft') {
    if (raftSigner) {
      logger.info(
        `Raft mode active (dataDir=${raftDataDir}); RPC payload signing ENABLED via per-node KeyManager`,
      );
    } else {
      logger.warn(
        `Raft mode active (dataDir=${raftDataDir}); RPC payload signing DISABLED — `
        + `set PIPELINE_RAFT_SIGNER_DIR to a writable directory to enable signed RPCs`,
      );
    }
  } else {
    logger.info(`Registry mode: ${registryMode}`);
  }
  for (const w of registryWarnings) {
    logger.warn(w);
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
    // Sidecars torn down in reverse construction order (LIFO).
    try { if (hintedHandoff) await hintedHandoff.stop(); } catch (err) { console.error('[pipeline] hintedHandoff.stop() failed', err); }
    try { if (fdBridge) await fdBridge.stop(); } catch (err) { console.error('[pipeline] fdBridge.stop() failed', err); }
    try {
      await cluster.stop();
    } catch (err) {
      console.error('[pipeline] cluster.stop() failed', err);
    }
  };

  return { module, nodeId, shutdown };
}
