// social-api/src/pipeline/bootstrap.ts
//
// Phase-4 single-node bootstrap that stands up an in-process distributed-core
// Cluster + PipelineModule for the social-api service. Adapted from the
// reference at distributed-core/examples/pipelines/cluster-bootstrap.ts; key
// differences:
//
//   1. nodeCount=1 — social-api runs as a single Express process. Multi-node
//      cluster mode is a Phase-5+ deployment concern.
//   2. Real LLMClient (Anthropic or Bedrock per `PIPELINE_LLM_PROVIDER`) — not
//      the FixtureLLMClient used in the demo.
//   3. Returns the live PipelineModule instance so the bridge in
//      src/pipeline-bridge can subscribe to its EventBus and route the six
//      bridge surfaces (getRun, getHistory, listActiveRuns, getMetrics,
//      getPendingApprovals, pipeline.run.reassigned) into the WebSocket layer.
//
// See PIPELINES_PLAN.md §10.6 for the full Phase-4 wire-up checklist.

import {
  createCluster,
  PipelineModule,
  // ApplicationModuleContext is the 6-field shape PipelineModule.initialize()
  // requires. Field 5 (configuration.pubsub) is the load-bearing one.
  type ApplicationModuleContext,
  type ClusterManager,
  type ResourceRegistry,
  type ResourceTopologyManager,
  type ApplicationRegistry,
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
   * WAL file path for the EventBus. Phase-4 leaves this undefined (in-memory
   * only). Phase-5+ flips on durability — see PIPELINES_PLAN.md §10.6.
   */
  walFilePath?: string;
  /**
   * Optional override of the LLM client. When omitted, we read
   * `PIPELINE_LLM_PROVIDER` and construct the matching client via
   * `createLLMClient()`. Tests pass `FixtureLLMClient` here.
   */
  llmClient?: import('distributed-core').LLMClient;
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
  // Hold the Node event loop open during cluster setup. Every internal cluster
  // timer is `.unref()`'d, so without this hold a one-shot script (no HTTP
  // server) would see Node drain before createCluster() resolves. Cleared in
  // shutdown(). Harmless when an HTTP server is already holding the loop.
  const keepAlive = setInterval(() => { /* hold the event loop */ }, 1 << 30);

  // Step 1 — single-node in-memory cluster. autoStart wires gossip + transport.
  const clusterHandle = await createCluster({
    size: 1,
    transport: 'in-memory',
    autoStart: true,
  });

  // Wait for the membership table to settle. With size=1 this is effectively
  // instant; we keep the call so the contract matches the multi-node case.
  await clusterHandle.waitForConvergence(5000);

  const handle = clusterHandle.getNode(0);
  const clusterMgr = handle.getCluster();
  const pubsub = handle.getPubSub();
  const nodeId = handle.id;

  // Step 2 — assemble the 6-field ApplicationModuleContext. Stubs are fine for
  // fields 2/3/4 in single-node mode; the LIVE pieces are clusterManager (for
  // localNodeId + member-left events), pubsub (for the EventBus), and logger.

  const resourceRegistry = {
    registerResourceType: () => { /* no-op in single-node mode */ },
    getResourcesByType: () => [],
  } as unknown as ResourceRegistry;

  const topologyManager = {} as unknown as ResourceTopologyManager;

  const moduleRegistry = {
    registerModule: async () => { /* no-op */ },
    unregisterModule: async () => { /* no-op */ },
    getModule: () => undefined,
    getAllModules: () => [],
    getModulesByResourceType: () => [],
  } as unknown as ApplicationRegistry;

  const logger = {
    info:  (msg: string, meta?: unknown) => console.log(`[pipeline:${nodeId}] ${msg}`, meta ?? ''),
    warn:  (msg: string, meta?: unknown) => console.warn(`[pipeline:${nodeId}] WARN ${msg}`, meta ?? ''),
    error: (msg: string, meta?: unknown) => console.error(`[pipeline:${nodeId}] ERROR ${msg}`, meta ?? ''),
    debug: (_msg: string) => { /* suppressed at this layer */ },
  };

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
  const module = new PipelineModule({
    moduleId:       `pipeline-${nodeId}`,
    moduleName:     'Pipeline',
    version:        '1.0.0',
    resourceTypes:  ['pipeline-run'],
    configuration:  {},
    llmClient,
    ...(opts.walFilePath ? { walFilePath: opts.walFilePath } : {}),
  });

  await module.initialize(context);
  await module.start();

  // Step 5 — coordinated shutdown.
  const shutdown = async (): Promise<void> => {
    clearInterval(keepAlive);
    try {
      await module.stop();
    } catch (err) {
      console.error('[pipeline] module.stop() failed', err);
    }
    try {
      await clusterHandle.stop();
    } catch (err) {
      console.error('[pipeline] cluster.stop() failed', err);
    }
  };

  return { module, nodeId, shutdown };
}
