// social-api/src/pipeline/config/pipelineModule.ts
//
// Pure builder for `PipelineModuleConfig`. Streams 3, 4, and 5 (BusDLQ,
// BusCompact, BusMetrics) want to extend this with eventBus-level config —
// BUT distributed-core's `PipelineModule.onInitialize()` currently only reads
// `eventBusTopic` and `walFilePath` from `pipelineConfig` when constructing
// its internal EventBus. The other LocalEventBusConfig fields
// (deadLetterHandler, metrics, autoCompactIntervalMs, autoCompactOptions)
// are not threaded through.
//
// Until that upstream gap is closed (see .claude-field-notes.md), Streams
// 3/4/5 cannot wire bus-level behavior from the gateway — the only metrics
// surface that already works is run-level (`PipelineModuleConfig.metrics`),
// which produces pipeline.run.{started,completed,failed,cancelled} counters.

import type { LLMClient, MetricsRegistry } from 'distributed-core';

// PipelineModule's config interface lives in the applications/pipeline
// barrel; the gateway reaches it through the top-level `distributed-core`
// re-export. We intentionally re-derive the relevant subset here rather than
// importing the type so this file fails-fast if the upstream surface drifts.
export interface PipelineModuleConstructorConfig {
  moduleId: string;
  moduleName: string;
  version: string;
  resourceTypes: string[];
  configuration: Record<string, unknown>;
  llmClient: LLMClient;
  /** When set, enables WAL-backed pipeline EventBus durability. */
  walFilePath?: string;
  /** Run-level metrics: pipeline.run.{started,completed,failed,cancelled}. */
  metrics?: MetricsRegistry;
}

export interface BuildPipelineModuleConfigArgs {
  nodeId: string;
  walFilePath: string | undefined;
  llmClient: LLMClient;
  metricsRegistry: MetricsRegistry;
}

/**
 * Build the constructor argument for `new PipelineModule(...)`. Pure; no env
 * reads. Tests pass a `FixtureLLMClient` via `llmClient`.
 *
 * The `moduleId` is suffixed with `nodeId` so two bootstraps in the same
 * process get distinct identities (matches the same convention used for the
 * cluster topic in `config/cluster.ts`).
 */
export function buildPipelineModuleConfig(
  args: BuildPipelineModuleConfigArgs,
): PipelineModuleConstructorConfig {
  const config: PipelineModuleConstructorConfig = {
    moduleId:      `pipeline-${args.nodeId}`,
    moduleName:    'Pipeline',
    version:       '1.0.0',
    resourceTypes: ['pipeline-run'],
    configuration: {},
    llmClient:     args.llmClient,
    metrics:       args.metricsRegistry,
  };
  if (args.walFilePath) {
    config.walFilePath = args.walFilePath;
  }
  return config;
}
