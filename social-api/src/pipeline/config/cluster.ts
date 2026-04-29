// social-api/src/pipeline/config/cluster.ts
//
// Pure builder for the distributed-core `ClusterConfig` literal that is fed
// into `Cluster.create()`. Splits each concern (transport, pubsub, registry,
// failureDetection) into its own helper so individual streams can extend them
// without touching bootstrap.ts. Streams in flight that extend pieces of this
// builder:
//
//   - Stream 7 (RaftFactory) → adds `'raft'` branch to `buildRegistryConfig`.
//   - Stream 9 (FDBridge)    → may extend `buildFailureDetectionConfig` if
//                              the bridge needs heartbeat-rate alignment.
//   - Stream 8 (RpcSigning)  → wires `RaftConfig.signer` inside the 'raft'
//                              branch (depends on Stream 7).
//
// The builder takes already-resolved values (no env reads) so it stays unit-
// testable. Env resolution stays in bootstrap.ts's `resolveOptions()`.

import type {
  ClusterConfig,
  ClusterTransportConfig,
  MetricsRegistry,
  RegistryConfig,
  ClusterFailureDetectionConfig,
} from 'distributed-core';

// `PubSubConfig` is exported from two places in distributed-core
// (gateway/pubsub/types and cluster/Cluster) with different shapes — the
// top-level `distributed-core` barrel re-exports the gateway one. We need
// the cluster-facade variant here, so we read it off `ClusterConfig['pubsub']`
// to bypass the name collision. Tracked in field notes.
type ClusterPubSubConfig = ClusterConfig['pubsub'];

export type PipelineTransportKind = 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';

export interface BuildClusterConfigArgs {
  /** Stable node id resolved up-front by `resolveStableNodeId`. */
  nodeId: string;
  /** Cluster gossip transport. Single-process deploys use 'in-memory'. */
  transport: PipelineTransportKind;
  /** Local bind port for non-in-memory transports. Ignored for in-memory. */
  basePort: number;
  /**
   * When set, the cluster's internal EntityRegistry runs in 'wal' mode
   * (durable). When undefined, runs in 'memory' mode (test isolation).
   */
  registryWalFilePath: string | undefined;
  /**
   * Whether to apply jest-fast failure-detection timers (100ms / 600ms vs
   * the prod 1s / 6s). Detected from NODE_ENV / JEST_WORKER_ID at the
   * bootstrap entry; passed through here so the builder stays env-agnostic.
   */
  fastTimers: boolean;
  /** social-api's MetricsRegistry singleton. Threaded into ResourceRouter / DistributedLock. */
  metricsRegistry: MetricsRegistry;
}

// ---------------------------------------------------------------------------
// Sub-builders — each owns ONE concern in `ClusterConfig`. Streams that
// modify a single concern only edit one of these.
// ---------------------------------------------------------------------------

export function buildTransportConfig(
  transport: PipelineTransportKind,
  basePort: number,
): ClusterTransportConfig {
  return transport === 'in-memory'
    ? { type: 'in-memory' }
    : { type: transport, port: basePort };
}

export function buildPubSubConfig(): ClusterPubSubConfig {
  // Single-process pipelines run on the in-memory pubsub fabric. Multi-node
  // deploys (Phase 4) flip this to `{ type: 'redis', url: ... }` here.
  return { type: 'memory' };
}

export function buildRegistryConfig(
  registryWalFilePath: string | undefined,
): RegistryConfig {
  // Stream 7 (RaftFactory) extends this with a `'raft'` branch when
  // PIPELINE_REGISTRY_MODE=raft is set.
  return registryWalFilePath
    ? { type: 'wal', walPath: registryWalFilePath }
    : { type: 'memory' };
}

/**
 * Build the failure-detection config. Returns `undefined` outside test mode
 * so distributed-core falls back to its production defaults (1s / 6s).
 *
 * `Cluster.create()` accepts `failureDetection: undefined` — it does NOT need
 * a literal `{}` for the defaulted path, so dropping the key entirely is
 * preferable to passing an empty object.
 */
export function buildFailureDetectionConfig(
  fastTimers: boolean,
): ClusterFailureDetectionConfig | undefined {
  if (!fastTimers) return undefined;
  return {
    heartbeatMs: 100,
    deadTimeoutMs: 600,
    activeProbing: true,
  };
}

// ---------------------------------------------------------------------------
// Top-level builder
// ---------------------------------------------------------------------------

/**
 * Compose a full `ClusterConfig` from already-resolved bootstrap arguments.
 * Pure function — no env reads, no fs I/O. Intentionally side-effect-free
 * so future tests can pin the literal shape.
 */
export function buildClusterConfig(args: BuildClusterConfigArgs): ClusterConfig {
  const fdConfig = buildFailureDetectionConfig(args.fastTimers);

  const config: ClusterConfig = {
    nodeId: args.nodeId,
    topic: `pipeline-${args.nodeId}`,
    pubsub: buildPubSubConfig(),
    transport: buildTransportConfig(args.transport, args.basePort),
    registry: buildRegistryConfig(args.registryWalFilePath),
    metrics: args.metricsRegistry,
    // No `logger` — the facade defaults to a NOOP logger, which is exactly
    // what we want. Test-mode noise reduction is handled by the per-bootstrap
    // logger constructed in bootstrap.ts.
  };

  if (fdConfig !== undefined) {
    config.failureDetection = fdConfig;
  }

  return config;
}
