// social-api/src/routes/pipelineHealth.ts
//
// GET /api/pipelines/health — runtime introspection for the pipeline subsystem.
//
// Phase 1: all introspection points are stubbed but the endpoint exists so the
// frontend diagnostic banner has a stable URL to poll. Phase 4 fills these in
// by reading from the embedded distributed-core cluster + the pipelineModule
// (cancel / approval handler installation) + bridge instrumentation
// (lastEventAt + tokenRate sliding-window counters).
//
// Status semantics:
//   ok        — cluster booted, LLM client configured, pipelineModule connected,
//               and at least one event observed within the last 60s
//   degraded  — cluster booted but one of the other signals is unhealthy
//   unwired   — Phase 1 baseline; nothing is connected yet
//
// Routing: mount at `/pipelines/health` in routes/index.ts. As with
// `/pipelines/metrics` and `/pipelines/defs`, this static segment must be
// registered BEFORE any `/pipelines/:pipelineId` mount or it will be swallowed.

import { Router } from 'express';

export interface PipelineHealthTokenRate {
  perSec1s: number;
  perSec10s: number;
  perSec60s: number;
}

export interface PipelineHealth {
  status: 'ok' | 'degraded' | 'unwired';
  embeddedClusterReady: boolean;       // true once distributed-core cluster has booted (Phase 4)
  llmClientConfigured: boolean;        // ANTHROPIC_API_KEY present OR PIPELINE_LLM_PROVIDER=bedrock
  pipelineModuleConnected: boolean;    // setCancelHandler / setResolveApprovalHandler installed
  lastEventAt: string | null;          // ISO of last pipeline event observed by the bridge
  tokenRate: PipelineHealthTokenRate | null;
  asOf: string;
}

/**
 * Read the LLM provider env vars and decide whether the LLM client is
 * configured. Exported for tests.
 *
 *  - `anthropic` (default): requires `ANTHROPIC_API_KEY`.
 *  - `bedrock`: requires `AWS_REGION` (or relies on the AWS SDK default chain).
 *  - anything else: not configured.
 */
export function hasLLMConfig(): boolean {
  const provider = process.env.PIPELINE_LLM_PROVIDER ?? 'anthropic';
  if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  if (provider === 'bedrock')   return !!(process.env.AWS_REGION ?? true);
  return false;
}

/**
 * Build the Phase 1 stub payload. Phase 4 swaps the body for live reads from
 * the embedded cluster + pipelineModule + bridge instrumentation.
 */
export function getPipelineHealthStub(): PipelineHealth {
  return {
    status: 'unwired',
    embeddedClusterReady: false,
    llmClientConfigured: hasLLMConfig(),
    pipelineModuleConnected: false,
    lastEventAt: null,
    tokenRate: null,
    asOf: new Date().toISOString(),
  };
}

export const pipelineHealthRouter = Router();

pipelineHealthRouter.get('/', (_req, res) => {
  res.json(getPipelineHealthStub() satisfies PipelineHealth);
});
