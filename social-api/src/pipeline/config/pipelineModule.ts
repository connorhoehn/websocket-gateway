// social-api/src/pipeline/config/pipelineModule.ts
//
// Pure builder for `PipelineModuleConfig`. distributed-core v0.7.2's
// `PipelineModule.onInitialize()` now threads the EventBus passthrough fields
// (deadLetterHandler, metrics, walSyncIntervalMs, autoCompactIntervalMs,
// autoCompactOptions) from `PipelineModuleConfig` into the constructed
// EventBus, so Streams 3/4/5 can wire bus-level behavior from the gateway.
//
// This file is the seam where each stream extends the constructor config:
//   - Stream 3 (BusDLQ)     → eventBusDeadLetterHandler
//   - Stream 4 (BusCompact) → eventBusAutoCompactIntervalMs / Options
//   - Stream 5 (BusMetrics) → eventBusMetrics
// All three are additive `?:` fields; merge-back conflicts are trivial.

import type { LLMClient, MetricsRegistry, BusEvent } from 'distributed-core';

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
  /**
   * EventBus dead-letter handler — invoked when a subscriber throws or a
   * publish path fails. Threaded into `EventBusConfig.deadLetterHandler` by
   * `PipelineModule.onInitialize()` (v0.7.2+). Default: errors are swallowed
   * silently inside the bus.
   */
  eventBusDeadLetterHandler?: (event: BusEvent, error: Error) => void;
}

export interface BuildPipelineModuleConfigArgs {
  nodeId: string;
  walFilePath: string | undefined;
  llmClient: LLMClient;
  metricsRegistry: MetricsRegistry;
  /**
   * Optional dead-letter handler. When defined, threaded through to the
   * underlying EventBus so subscriber-throws and publish-failures are
   * recorded instead of swallowed. Wired by `bootstrap.ts` from the
   * `PIPELINE_EVENT_BUS_DLQ_ENABLED` env var (default on).
   */
  eventBusDeadLetterHandler?: (event: BusEvent, error: Error) => void;
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
  if (args.eventBusDeadLetterHandler) {
    config.eventBusDeadLetterHandler = args.eventBusDeadLetterHandler;
  }
  return config;
}
