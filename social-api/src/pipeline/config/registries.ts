// social-api/src/pipeline/config/registries.ts
//
// Construct the application-layer registries that ApplicationRegistry passes
// into PipelineModule's context. These are sibling concepts to the Cluster
// facade — the facade owns ClusterManager / PubSubManager / EntityRegistry /
// ResourceRouter / DistributedLock; ResourceRegistry / ResourceTypeRegistry /
// ResourceTopologyManager / ApplicationRegistry sit ABOVE the cluster
// substrate.
//
// Mode mirrors the cluster's registry config so the WAL-on/off decision is
// consistent across substrate and resource layers:
//   - 'memory' → entityRegistryType: 'memory'
//   - 'wal'    → entityRegistryType: 'wal' (requires registryWalFilePath)
//   - 'raft'   → DOWNGRADED. See note below.
//
// === ResourceRegistry × Raft: known upstream gap ===
//
// `EntityRegistryFactory.create({ type: 'raft' })` THROWS:
//
//     "Raft registries must be created via EntityRegistryFactory.createRaft()
//      with injected dependencies"
//
// `ResourceRegistry`'s constructor calls `EntityRegistryFactory.create()` with
// the requested `entityRegistryType`. There is no constructor surface to inject
// the pre-built `RaftEntityRegistry` from `cluster.registry`, so
// `entityRegistryType: 'raft'` is unreachable from a consumer.
//
// Practical fallback: when callers ask for 'raft', this builder downgrades
// the resource-side entity registry to 'wal' (when a wal path is available)
// or 'memory' (when none) and surfaces the downgrade via a returned warning
// so bootstrap can log it. The cluster-side registry IS fully Raft when
// PIPELINE_REGISTRY_MODE=raft is set — only the resource-side is downgraded.

import {
  ApplicationRegistry,
  MetricsTracker,
  ResourceRegistry,
  ResourceTopologyManager,
  ResourceTypeRegistry,
  StateAggregator,
} from 'distributed-core';
import type { ClusterManager } from 'distributed-core';
import type { PipelineRegistryMode } from './cluster';

export interface BuildAppLayerRegistriesArgs {
  nodeId: string;
  clusterMgr: ClusterManager;
  /**
   * Resolved registry mode (same value passed into `buildClusterConfig`).
   * Drives the `entityRegistryType` used by the resource-side
   * `ResourceRegistry`, with the 'raft' → wal-or-memory downgrade described
   * above.
   */
  mode: PipelineRegistryMode;
  /**
   * WAL file path. Required when `mode === 'wal'`. When `mode === 'raft'`
   * and a WAL path is available, the resource-side registry is downgraded
   * to 'wal' (rather than 'memory') so resource records still survive
   * restart even though the resource-side can't run full Raft.
   */
  registryWalFilePath: string | undefined;
}

export interface AppLayerRegistries {
  resourceRegistry: ResourceRegistry;
  resourceTypeRegistry: ResourceTypeRegistry;
  topologyManager: ResourceTopologyManager;
  moduleRegistry: ApplicationRegistry;
  /**
   * Non-fatal warnings produced while resolving the config. Bootstrap
   * surfaces these through its logger so operators see WHY their requested
   * mode landed where it did (e.g. the raft → wal downgrade above).
   */
  warnings: string[];
}

/**
 * Construct + start the application-layer registries. Caller is responsible
 * for stopping them in the correct order during shutdown:
 *   1. moduleRegistry.stop()    (or module.stop() in test/fast-timers mode)
 *   2. resourceRegistry.stop()
 *
 * (The cluster's substrate registries — `cluster.registry`, etc. — are torn
 * down by `cluster.stop()`.)
 *
 * Note: `resourceTypeRegistry`, `stateAggregator`, and `metricsTracker` are
 * constructor-only collaborators here. We deliberately do NOT call
 * `stateAggregator.start()` — single-node mode has nothing to aggregate, and
 * StateAggregator's setupMessageHandling() in the constructor only installs
 * a transport listener which is harmless.
 */
export async function buildAppLayerRegistries(
  args: BuildAppLayerRegistriesArgs,
): Promise<AppLayerRegistries> {
  const { nodeId, clusterMgr, mode, registryWalFilePath } = args;

  const warnings: string[] = [];

  // Resolve the entity registry mode for the resource-side registry. Mirrors
  // the cluster-side mode for 'memory' and 'wal'; 'raft' is downgraded.
  let entityMode: 'memory' | 'wal';
  let walPathForRegistry: string | undefined;

  switch (mode) {
    case 'memory':
      entityMode = 'memory';
      break;
    case 'wal':
      if (!registryWalFilePath) {
        throw new Error(
          `[pipeline:config] buildAppLayerRegistries: 'wal' mode requires registryWalFilePath. `
          + `Either set PIPELINE_REGISTRY_WAL_PATH or switch PIPELINE_REGISTRY_MODE to 'memory'.`,
        );
      }
      entityMode = 'wal';
      walPathForRegistry = registryWalFilePath;
      break;
    case 'raft': {
      // Downgrade — see file-level note. Pick wal-or-memory based on what's
      // available, surface a warning so operators see the downgrade.
      if (registryWalFilePath) {
        warnings.push(
          `[pipeline:config] PIPELINE_REGISTRY_MODE='raft' was requested but `
          + `ResourceRegistry does not yet support 'raft' as of distributed-core HEAD. `
          + `The CLUSTER's entity registry IS using Raft (writes are linearizable through consensus); `
          + `the RESOURCE-side entity registry has been downgraded to 'wal' at ${registryWalFilePath}. `
          + `Track upstream: ResourceRegistryConfig needs an entityRegistry-injection slot or a raft-aware factory.`,
        );
        entityMode = 'wal';
        walPathForRegistry = registryWalFilePath;
      } else {
        warnings.push(
          `[pipeline:config] PIPELINE_REGISTRY_MODE='raft' was requested but `
          + `ResourceRegistry does not yet support 'raft' as of distributed-core HEAD. `
          + `The CLUSTER's entity registry IS using Raft; the RESOURCE-side entity registry `
          + `has been downgraded to 'memory' (no PIPELINE_REGISTRY_WAL_PATH was set). `
          + `Pipeline-run resource records will NOT survive process restart on this node — `
          + `set PIPELINE_REGISTRY_WAL_PATH to upgrade to 'wal' until upstream lands raft support.`,
        );
        entityMode = 'memory';
      }
      break;
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`[pipeline:config] buildAppLayerRegistries: unhandled mode: ${String(_exhaustive)}`);
    }
  }

  const resourceRegistry = new ResourceRegistry(
    entityMode === 'wal' && walPathForRegistry
      ? {
          nodeId,
          entityRegistryType: 'wal',
          entityRegistryConfig: { walConfig: { filePath: walPathForRegistry } },
        }
      : {
          nodeId,
          entityRegistryType: 'memory',
        },
  );
  await resourceRegistry.start();

  const resourceTypeRegistry = new ResourceTypeRegistry();

  const stateAggregator = new StateAggregator(clusterMgr);
  const metricsTracker = new MetricsTracker({});

  const topologyManager = new ResourceTopologyManager(
    clusterMgr,
    resourceRegistry,
    resourceTypeRegistry,
    stateAggregator,
    metricsTracker,
  );

  const moduleRegistry = new ApplicationRegistry(
    clusterMgr,
    resourceRegistry,
    topologyManager,
  );
  await moduleRegistry.start();

  return {
    resourceRegistry,
    resourceTypeRegistry,
    topologyManager,
    moduleRegistry,
    warnings,
  };
}
