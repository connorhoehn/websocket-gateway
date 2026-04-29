// social-api/src/pipeline/config/cluster.ts
//
// Pure builder for the distributed-core `ClusterConfig` literal that is fed
// into `Cluster.create()`. Splits each concern (transport, pubsub, registry,
// failureDetection) into its own helper so individual streams can extend them
// without touching bootstrap.ts.
//
// The builder takes already-resolved values (no env reads) so it stays unit-
// testable. Env resolution stays in bootstrap.ts's `resolveOptions()`.
//
// One env-reading helper does live here — `resolveRegistryMode()` — because
// it produces a value that several places in `BuildClusterConfigArgs` and
// `BuildAppLayerRegistriesArgs` need to read consistently. Keeping it next
// to `buildRegistryConfig` co-locates the contract.

import type {
  ClusterConfig,
  ClusterTransportConfig,
  MetricsRegistry,
  RegistryConfig,
  ClusterFailureDetectionConfig,
  RaftConfig,
} from 'distributed-core';

// `DEFAULT_RAFT_CONFIG` is defined in `cluster/raft/types` but NOT re-exported
// from the top-level barrel as of distributed-core HEAD — only the *types*
// (RaftConfig, RaftLogEntry, etc.) are. We pull the value via the subpath.
// Tracked in the upstream tech-debt doc; ideal fix is to add the value to
// the barrel.
import { DEFAULT_RAFT_CONFIG } from 'distributed-core/dist/cluster/raft/types';

// Subpath import for the duck-typed signer interface — RaftRpcSigner lives
// in the rpc subdirectory and isn't barrel-exported either. KeyManager (from
// the main barrel) satisfies this interface; see config/signer.ts.
import type { RaftRpcSigner } from 'distributed-core/dist/cluster/raft/rpc/RaftRpcRouter';

// `PubSubConfig` is exported from two places in distributed-core
// (gateway/pubsub/types and cluster/Cluster) with different shapes — the
// top-level barrel re-exports the gateway one. We need the cluster-facade
// variant here, so we read it off `ClusterConfig['pubsub']` to bypass the
// name collision. Tracked in the upstream tech-debt doc.
type ClusterPubSubConfig = ClusterConfig['pubsub'];

export type PipelineTransportKind = 'in-memory' | 'websocket' | 'tcp' | 'udp' | 'http';

/**
 * Modes the pipeline registry can run in. Mirrors the env var
 * `PIPELINE_REGISTRY_MODE` ('memory' | 'wal' | 'raft').
 *
 *  - 'memory' — no durability, hermetic per-process. Default in tests.
 *  - 'wal'    — on-disk WAL-backed entity registry. Default when a wal
 *               path is configured.
 *  - 'raft'   — cluster's entity registry is `RaftEntityRegistry`; writes
 *               are linearizable through consensus. Requires `raftDataDir`.
 *               Note: ResourceRegistry's *resource-side* registry is
 *               downgraded to wal-or-memory because the consumer-facing
 *               ResourceRegistry constructor in distributed-core HEAD does
 *               not yet expose a slot to inject the cluster's
 *               RaftEntityRegistry. See config/registries.ts.
 */
export type PipelineRegistryMode = 'memory' | 'wal' | 'raft';

export interface BuildClusterConfigArgs {
  /** Stable node id resolved up-front by `resolveStableNodeId`. */
  nodeId: string;
  /** Cluster gossip transport. Single-process deploys use 'in-memory'. */
  transport: PipelineTransportKind;
  /** Local bind port for non-in-memory transports. Ignored for in-memory. */
  basePort: number;
  /**
   * Resolved registry mode. Drives the `'memory' | 'wal' | 'raft'` branch
   * of `buildRegistryConfig`. Bootstrap resolves this from env / opts via
   * `resolveRegistryMode()` and passes the result through.
   */
  registryMode: PipelineRegistryMode;
  /**
   * WAL file path. Required when `registryMode === 'wal'`; ignored otherwise.
   */
  registryWalFilePath: string | undefined;
  /**
   * On-disk dataDir for the Raft log + persistent state + snapshots.
   * Required when `registryMode === 'raft'`; ignored otherwise.
   */
  raftDataDir: string | undefined;
  /**
   * Optional Raft RPC signer (produced by `config/signer.ts:buildRaftSigner`).
   * When set, RaftRpcRouter signs every outbound RPC and verifies every
   * inbound RPC. When `undefined`, RPCs are unsigned (back-compat).
   * Only consulted when `registryMode === 'raft'`.
   */
  raftSigner: RaftRpcSigner | undefined;
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

export interface BuildRegistryConfigArgs {
  mode: PipelineRegistryMode;
  walFilePath?: string;
  raftDataDir?: string;
  metrics?: MetricsRegistry;
  signer?: RaftRpcSigner;
}

/**
 * Build the cluster-side `RegistryConfig` for `Cluster.create()`. Each mode
 * branch validates its own preconditions (walFilePath when 'wal', raftDataDir
 * when 'raft') so misconfiguration surfaces with a clear, actionable error
 * before the cluster comes up.
 *
 * 'raft' threads `metrics` and `signer` into `RaftConfig` so RaftNode emits
 * proposal / election / replication / snapshot counters into the same registry
 * the rest of social-api uses, and signs every RPC when a per-node KeyManager
 * is provisioned.
 */
export function buildRegistryConfig(args: BuildRegistryConfigArgs): RegistryConfig {
  switch (args.mode) {
    case 'memory':
      return { type: 'memory' };
    case 'wal':
      if (!args.walFilePath) {
        throw new Error(
          `[pipeline:config] buildRegistryConfig: 'wal' mode requires a walFilePath. `
          + `Either provide PIPELINE_REGISTRY_WAL_PATH or switch PIPELINE_REGISTRY_MODE to 'memory'.`,
        );
      }
      return { type: 'wal', walPath: args.walFilePath };
    case 'raft': {
      if (!args.raftDataDir || args.raftDataDir.trim() === '') {
        throw new Error(
          `[pipeline:config] buildRegistryConfig: 'raft' mode requires a raftDataDir. `
          + `Set PIPELINE_RAFT_DATA_DIR to a writable path (e.g. /var/lib/social-api/raft).`,
        );
      }
      const raftConfig: RaftConfig = {
        // Spread distributed-core defaults first so future timer/batch/preVote
        // knobs land for free as the upstream defaults evolve.
        // DEFAULT_RAFT_CONFIG is typed as Omit<RaftConfig, 'dataDir'> by design,
        // so we add `dataDir` explicitly below.
        ...DEFAULT_RAFT_CONFIG,
        dataDir: args.raftDataDir,
        ...(args.metrics ? { metrics: args.metrics } : {}),
        ...(args.signer ? { signer: args.signer } : {}),
      };
      return { type: 'raft', raftConfig };
    }
    default: {
      const _exhaustive: never = args.mode;
      throw new Error(`[pipeline:config] buildRegistryConfig: unhandled mode: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Resolve the effective registry mode from env + a fallback hint. Single
 * source of truth so bootstrap and downstream consumers (e.g. the resource-
 * side registry builder) all see the same mode.
 *
 * Priority:
 *   1. Explicit `PIPELINE_REGISTRY_MODE` env var ('memory' | 'wal' | 'raft').
 *   2. `walFilePath` provided → 'wal'.
 *   3. Fallback → 'memory'.
 */
export function resolveRegistryMode(
  walFilePath: string | undefined,
): PipelineRegistryMode {
  const raw = process.env.PIPELINE_REGISTRY_MODE;
  if (raw === 'memory' || raw === 'wal' || raw === 'raft') {
    return raw;
  }
  if (raw !== undefined && raw !== '') {
    throw new Error(
      `[pipeline:config] PIPELINE_REGISTRY_MODE must be one of 'memory' | 'wal' | 'raft', got: ${raw}`,
    );
  }
  return walFilePath ? 'wal' : 'memory';
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
    registry: buildRegistryConfig({
      mode: args.registryMode,
      walFilePath: args.registryWalFilePath,
      raftDataDir: args.raftDataDir,
      metrics: args.metricsRegistry,
      signer: args.raftSigner,
    }),
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
