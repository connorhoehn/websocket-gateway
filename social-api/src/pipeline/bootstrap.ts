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
  // ApplicationModuleContext is the 6-field shape PipelineModule.initialize()
  // requires. Field 5 (configuration.pubsub) is the load-bearing one.
  type ApplicationModuleContext,
  type ClusterManager,
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
}

function resolveOptions(opts: BootstrapOptions): {
  size: number;
  transport: 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';
  basePort: number;
  walFilePath: string | undefined;
  walExplicitlyDisabled: boolean;
  identityFilePath: string | undefined;
  identityExplicitlyDisabled: boolean;
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

  return {
    size,
    transport,
    basePort,
    walFilePath,
    walExplicitlyDisabled,
    identityFilePath,
    identityExplicitlyDisabled,
  };
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
  const clusterHandle = await createCluster({
    size,
    transport,
    basePort,
    autoStart: true,
    ...(persistentNodeId ? { nodes: [{ id: persistentNodeId }] } : {}),
  });

  // Wait for the membership table to settle. With size=1 this is effectively
  // instant; we keep the call so the contract matches the multi-node case.
  await clusterHandle.waitForConvergence(5000);

  const handle = clusterHandle.getNode(0);
  const clusterMgr = handle.getCluster();
  const pubsub = handle.getPubSub();
  const nodeId = handle.id;

  // Step 2 — assemble the 6-field ApplicationModuleContext.
  //
  // distributed-core v0.3.0 closed gaps DC-4.x and made ResourceRegistry,
  // ResourceTopologyManager, and ApplicationRegistry first-class public
  // exports. NodeHandle does NOT (yet) expose accessor methods for these,
  // so we instantiate them here using the same pattern as distributed-core's
  // own production-chat-harness. PipelineModule.initialize() calls
  // resourceRegistry.registerResourceType() during onInitialize, so the
  // registry MUST be a real instance — the no-op stubs from the previous
  // single-node mode are gone.
  const resourceRegistry = new ResourceRegistry({
    nodeId,
    entityRegistryType: 'memory',
  });
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
  // this node. PipelineModule does not call any of its methods during
  // initialize(), but we hand it a real instance so that a future caller
  // (or a multi-module deploy) gets correct dependency-aware behaviour
  // for free instead of silently no-op-ing against the stub.
  const moduleRegistry = new ApplicationRegistry(
    clusterMgr,
    resourceRegistry,
    topologyManager,
  );

  const logger = {
    info:  (msg: string, meta?: unknown) => console.log(`[pipeline:${nodeId}] ${msg}`, meta ?? ''),
    warn:  (msg: string, meta?: unknown) => console.warn(`[pipeline:${nodeId}] WARN ${msg}`, meta ?? ''),
    error: (msg: string, meta?: unknown) => console.error(`[pipeline:${nodeId}] ERROR ${msg}`, meta ?? ''),
    debug: (_msg: string) => { /* suppressed at this layer */ },
  };

  // Log the identity decision now that we have a logger and a final nodeId.
  if (persistentNodeId) {
    logger.info(`Stable identity loaded from ${identityFilePath} — nodeId=${nodeId}`);
  } else if (identityExplicitlyDisabled) {
    logger.warn(
      'Stable identity explicitly disabled via PIPELINE_IDENTITY_FILE=disabled — nodeId is ephemeral and will change on every restart',
    );
  }

  const context: ApplicationModuleContext = {
    clusterManager:  clusterMgr as unknown as ClusterManager,
    resourceRegistry,
    topologyManager,
    moduleRegistry,
    configuration: {
      // CRITICAL: PipelineModule.onInitialize() reads
      // context.configuration.pubsub to construct its internal EventBus.
      pubsub,
    },
    logger,
  };

  // Step 3 — pick the LLM client. Tests pass an explicit override (typically
  // FixtureLLMClient); production reads PIPELINE_LLM_PROVIDER + the matching
  // SDK credentials.
  const llmClient = opts.llmClient ?? createLLMClient();

  // Step 4 — instantiate + initialize + start the module.
  if (walFilePath) {
    logger.info(`WAL enabled at ${walFilePath} — pipeline state will survive restart`);
  } else if (walExplicitlyDisabled) {
    logger.warn(
      'WAL explicitly disabled via PIPELINE_WAL_PATH=disabled — pipeline state is in-memory only and will be lost on restart',
    );
  } else {
    logger.warn('WAL disabled — pipeline state is in-memory only');
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

  await module.initialize(context);
  await module.start();

  // Step 5 — coordinated shutdown.
  //
  // Order matters:
  //   1. module.stop()         — cancels in-flight runs, drains EventBus.
  //   2. resourceRegistry.stop() — closes the underlying entity registry.
  //   3. clusterHandle.stop()  — stops gossip + transport.
  // Any throw is logged but does not abort the rest of the chain — operators
  // need every subsystem torn down even if one stage misbehaves.
  const shutdown = async (): Promise<void> => {
    clearInterval(keepAlive);
    try {
      await module.stop();
    } catch (err) {
      console.error('[pipeline] module.stop() failed', err);
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
