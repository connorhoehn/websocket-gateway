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
//   - registryWalFilePath set       → entityRegistryType: 'wal'
//   - undefined (test mode default) → entityRegistryType: 'memory'

import {
  ApplicationRegistry,
  MetricsTracker,
  ResourceRegistry,
  ResourceTopologyManager,
  ResourceTypeRegistry,
  StateAggregator,
} from 'distributed-core';
import type { ClusterManager } from 'distributed-core';

export interface BuildAppLayerRegistriesArgs {
  nodeId: string;
  clusterMgr: ClusterManager;
  registryWalFilePath: string | undefined;
}

export interface AppLayerRegistries {
  resourceRegistry: ResourceRegistry;
  resourceTypeRegistry: ResourceTypeRegistry;
  topologyManager: ResourceTopologyManager;
  moduleRegistry: ApplicationRegistry;
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
  const { nodeId, clusterMgr, registryWalFilePath } = args;

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
  };
}
