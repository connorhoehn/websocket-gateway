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
//
// Bridge probe (Phase 4 partial): we additionally surface live bridge state
// (`bridgeWired`, `runsActive`, `runsAwaitingApproval`, `pendingApprovals`) so
// monitoring/debugging can confirm the bridge is wired without tailing logs.
// All bridge calls are wrapped in try/catch and a tight 1s timeout so a flaky
// bridge can't hang or 500 the health endpoint.
//
// TODO(phase 4): expose `lastEventAt` (ISO 8601 of the most recent pipeline
// event observed). The bridge doesn't track it yet; wiring this requires
// subscribing to `module.getEventBus()` from the bridge factory and stamping
// a timestamp on each delivery.

import { Router } from 'express';
import { getPipelineBridge, type PipelineBridge } from './pipelineTriggers';

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
  // ---- Bridge live-state probe (additive — pre-existing fields above are unchanged) ----
  /** True iff `getPipelineBridge() !== null` at request time. */
  bridgeWired: boolean;
  /** Length of `bridge.listActiveRuns()` (0 when bridge is null or surface missing). */
  runsActive: number;
  /** `bridge.getMetrics().runsAwaitingApproval` (0 when bridge is null, surface missing, or call fails). */
  runsAwaitingApproval: number;
  /** Length of `bridge.getPendingApprovals()` (0 when bridge is null or surface missing). */
  pendingApprovals: number;
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
 * Per-call timeout for any bridge surface invoked from the health probe.
 * 1s keeps the health endpoint responsive even if the bridge is wedged on
 * a slow downstream (e.g. Redis, Bedrock). On timeout we degrade to the
 * default value for that field rather than 500-ing.
 */
const BRIDGE_PROBE_TIMEOUT_MS = 1000;

/**
 * Race a possibly-async value against a timeout. Returns the resolved value,
 * or `fallback` if either the original promise rejects OR the timer wins.
 * Synchronous values (non-thenables) are returned immediately.
 */
async function safeRace<T>(
  value: T | Promise<T>,
  fallback: T,
  timeoutMs: number = BRIDGE_PROBE_TIMEOUT_MS,
): Promise<T> {
  // Fast-path: not a thenable — return as-is, no timer.
  if (value === null || value === undefined || typeof (value as { then?: unknown }).then !== 'function') {
    return value as T;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      (value as Promise<T>).catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
        // Don't keep the event loop alive solely for this timer.
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
          (timer as { unref: () => void }).unref();
        }
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe the live PipelineBridge (when wired) for the four counts surfaced
 * on the health endpoint. Each surface is independent: a throw / missing
 * method on one does not affect the others. Never throws.
 */
export async function probeBridge(
  bridge: PipelineBridge | null,
): Promise<{
  bridgeWired: boolean;
  runsActive: number;
  runsAwaitingApproval: number;
  pendingApprovals: number;
}> {
  if (!bridge) {
    return {
      bridgeWired: false,
      runsActive: 0,
      runsAwaitingApproval: 0,
      pendingApprovals: 0,
    };
  }

  let runsActive = 0;
  if (typeof bridge.listActiveRuns === 'function') {
    try {
      const arr = await safeRace(bridge.listActiveRuns(), [] as unknown[]);
      runsActive = Array.isArray(arr) ? arr.length : 0;
    } catch {
      runsActive = 0;
    }
  }

  let runsAwaitingApproval = 0;
  if (typeof bridge.getMetrics === 'function') {
    try {
      const m = await safeRace(
        bridge.getMetrics(),
        { runsAwaitingApproval: 0 } as { runsAwaitingApproval: number },
      );
      const n = (m as { runsAwaitingApproval?: unknown }).runsAwaitingApproval;
      runsAwaitingApproval = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    } catch {
      runsAwaitingApproval = 0;
    }
  }

  let pendingApprovals = 0;
  if (typeof bridge.getPendingApprovals === 'function') {
    try {
      const arr = await safeRace(bridge.getPendingApprovals(), [] as unknown[]);
      pendingApprovals = Array.isArray(arr) ? arr.length : 0;
    } catch {
      pendingApprovals = 0;
    }
  }

  return { bridgeWired: true, runsActive, runsAwaitingApproval, pendingApprovals };
}

/**
 * Build the Phase 1 stub payload. Phase 4 swaps the body for live reads from
 * the embedded cluster + pipelineModule + bridge instrumentation.
 *
 * The four `bridge*` fields default to the "no bridge wired" values. The HTTP
 * route layers a live probe on top via {@link probeBridge}.
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
    bridgeWired: false,
    runsActive: 0,
    runsAwaitingApproval: 0,
    pendingApprovals: 0,
  };
}

export const pipelineHealthRouter = Router();

pipelineHealthRouter.get('/', async (_req, res) => {
  const base = getPipelineHealthStub();
  // Probe is best-effort — any failure inside is caught and falls back to
  // the stub defaults already on `base`.
  let probe: {
    bridgeWired: boolean;
    runsActive: number;
    runsAwaitingApproval: number;
    pendingApprovals: number;
  } = {
    bridgeWired: false,
    runsActive: 0,
    runsAwaitingApproval: 0,
    pendingApprovals: 0,
  };
  try {
    probe = await probeBridge(getPipelineBridge());
  } catch {
    // Defensive: probeBridge never throws, but if anything goes sideways
    // (e.g. a bridge constructor that throws on access) we still respond.
  }
  const body: PipelineHealth = { ...base, ...probe };
  res.json(body satisfies PipelineHealth);
});
