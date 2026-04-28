// social-api/src/pipeline/createBridge.ts
//
// Wraps a live distributed-core `PipelineModule` instance behind the
// `PipelineBridge` shape that social-api routes consume. This is the boundary
// where Phase-4 wiring meets the existing route stub paths — when a bridge is
// installed, every route's `if (bridge?.X)` branch hits this implementation;
// otherwise the in-memory stubRunStore stays in charge.
//
// Exposes the six surfaces locked with the distributed-core sibling:
//   1. getRun        → PipelineModule.getRun
//   2. getHistory    → PipelineModule.getHistory
//   3. listActiveRuns→ PipelineModule.listActiveRuns (mapped to PipelineRunSnapshot)
//   4. getMetrics    → PipelineModule.getMetrics() — full pass-through of the
//                       dashboard fields the module exposes (runsStarted/-
//                       Completed/-Failed/-Active, runsAwaitingApproval,
//                       avgDurationMs, llmTokensIn/Out, avgFirstTokenLatencyMs
//                       on v0.3.7+, asOf). Missing fields stay missing so the
//                       route can map them to `null`.
//   5. getPendingApprovals → PipelineModule.getPendingApprovals
//   6. cancelRun     → PipelineModule.cancelRun
// + trigger          → PipelineModule.createResource (for pipelineTriggers POST)
// + resolveApproval  → PipelineModule.resolveApproval
//
// `pipeline.run.reassigned` (the 6th locked surface, an event not a method)
// is consumed via `module.getEventBus().subscribe(...)` from the gateway-side
// bridge in src/pipeline-bridge/pipeline-bridge.js — not here.

import type { PipelineModule } from 'distributed-core';
import type {
  BusEvent,
  PipelineBridge,
  PipelineBridgeMetrics,
  PipelineRunSnapshot,
  PendingApprovalRow,
} from '../routes/pipelineTriggers';

/** Coerce a value to a finite number, or return `undefined` (so the route
 *  surfaces it as `null`). Strings/NaN/Infinity are NOT silently parsed — the
 *  bridge's job is pass-through, not numeric salvage. */
function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// PipelineModule.getRun returns a `PipelineRun` shape from distributed-core's
// types. The fields we care about for `PipelineRunSnapshot` (runId, pipelineId,
// status, startedAt, finishedAt, error) line up; the unknown shape elsewhere
// passes through `[k: string]: unknown`.
function toRunSnapshot(run: unknown): PipelineRunSnapshot | null {
  if (!run || typeof run !== 'object') return null;
  const r = run as Record<string, unknown>;
  if (typeof r['runId'] !== 'string' || typeof r['pipelineId'] !== 'string') return null;
  return r as unknown as PipelineRunSnapshot;
}

export function createBridge(module: PipelineModule): PipelineBridge {
  return {
    async trigger({ pipelineId, definition, triggerPayload, triggeredBy }) {
      const resource = await module.createResource({
        applicationData: {
          definition,
          triggerPayload,
          triggeredBy,
          pipelineId,
        },
      });
      const data = (resource.applicationData ?? {}) as Record<string, unknown>;
      const runId = data['runId'];
      if (typeof runId !== 'string') {
        throw new Error('PipelineModule.createResource did not return a runId');
      }
      return { runId };
    },

    getRun(runId: string): PipelineRunSnapshot | null {
      return toRunSnapshot(module.getRun(runId));
    },

    async getHistory(runId: string, fromVersion: number): Promise<BusEvent[]> {
      // Per the cross-repo contract: `getHistory` returns [] (no throw) when
      // the underlying EventBus has no walFilePath configured. PipelineModule
      // honors that already; pass-through. Cast widens distributed-core's
      // typed `BusEvent<T>` shape to social-api's index-signature shape.
      const events = await module.getHistory(runId, fromVersion);
      return events as unknown as BusEvent[];
    },

    async resolveApproval(runId, stepId, userId, decision, comment) {
      module.resolveApproval(runId, stepId, userId, decision, comment);
    },

    listActiveRuns(): PipelineRunSnapshot[] {
      // PipelineModule returns `PipelineRunResource[]`; flatten each to a snapshot.
      const resources = module.listActiveRuns();
      const snapshots: PipelineRunSnapshot[] = [];
      for (const r of resources) {
        // The applicationData on each resource holds the live run object.
        const ad = (r as { applicationData?: unknown }).applicationData;
        const snap = toRunSnapshot(ad);
        if (snap) snapshots.push(snap);
      }
      return snapshots;
    },

    cancelRun(runId: string): void {
      module.cancelRun(runId);
    },

    getPendingApprovals(): PendingApprovalRow[] {
      return module.getPendingApprovals() as unknown as PendingApprovalRow[];
    },

    async getMetrics(): Promise<PipelineBridgeMetrics> {
      const m = (await module.getMetrics()) as unknown as Record<string, unknown>;
      // Forward every dashboard-relevant field the module emits. Each numeric
      // field is coerced to a finite number; if the module doesn't track it,
      // the field is omitted (route maps absent → `null`). `runsAwaitingApproval`
      // keeps its legacy "default to 0" behavior so callers (pipelineHealth)
      // that read it as a plain count don't regress.
      const runsAwaitingApprovalRaw = asFiniteNumber(m['runsAwaitingApproval']);
      const out: PipelineBridgeMetrics = {
        runsAwaitingApproval: runsAwaitingApprovalRaw ?? 0,
      };
      const runsStarted = asFiniteNumber(m['runsStarted']);
      if (runsStarted !== undefined) out.runsStarted = runsStarted;
      const runsCompleted = asFiniteNumber(m['runsCompleted']);
      if (runsCompleted !== undefined) out.runsCompleted = runsCompleted;
      const runsFailed = asFiniteNumber(m['runsFailed']);
      if (runsFailed !== undefined) out.runsFailed = runsFailed;
      const runsActive = asFiniteNumber(m['runsActive']);
      if (runsActive !== undefined) out.runsActive = runsActive;
      const avgDurationMs = asFiniteNumber(m['avgDurationMs']);
      if (avgDurationMs !== undefined) out.avgDurationMs = avgDurationMs;
      const llmTokensIn = asFiniteNumber(m['llmTokensIn']);
      if (llmTokensIn !== undefined) out.llmTokensIn = llmTokensIn;
      const llmTokensOut = asFiniteNumber(m['llmTokensOut']);
      if (llmTokensOut !== undefined) out.llmTokensOut = llmTokensOut;
      // distributed-core v0.3.7+: average first-token latency across LLM steps.
      const avgFirstTokenLatencyMs = asFiniteNumber(m['avgFirstTokenLatencyMs']);
      if (avgFirstTokenLatencyMs !== undefined) {
        out.avgFirstTokenLatencyMs = avgFirstTokenLatencyMs;
      }
      const asOf = m['asOf'];
      if (typeof asOf === 'string') out.asOf = asOf;
      return out;
    },
  };
}
