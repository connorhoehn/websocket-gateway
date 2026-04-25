// frontend/src/components/pipelines/persistence/seedDemoData.ts
//
// Dev-only demo data seeder. Populates a fresh localStorage with three sample
// pipelines (drawn from the templates registry) plus a believable run history
// per pipeline so the stats / cost / runs views light up out of the box.
//
// The PRNG is seeded so a re-seed produces byte-identical run/pipeline ids,
// timestamps, token counts, and status mixes — handy for diffing UI snapshots
// during development. See PIPELINES_GETTING_STARTED.md §"Demo data" for usage.
//
// All persistence flows through the existing helpers (savePipeline /
// publishPipeline / appendRun / clearRuns) — never localStorage directly — so
// we automatically pick up index/version invariants those modules enforce.
//
// Pure module — no side effects at import time.

import { MODEL_PRICING } from '../cost/llmPricing';
import { pipelineTemplates } from '../templates';
import type {
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  PipelineRun,
  RunStatus,
  StepExecution,
  StepStatus,
} from '../../../types/pipeline';
import {
  deletePipeline,
  listPipelines,
  loadPipeline,
  publishPipeline,
  savePipeline,
} from './pipelineStorage';
import { appendRun, clearRuns, listRuns } from './runHistory';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The three template ids we showcase in seed data — chosen to cover a webhook
 * trigger, a fork/join fan-out, and an approval-gated branch so most chart
 * tabs (cost-by-node, cost-by-day, awaiting-approval list, run timeline) have
 * something interesting to render.
 */
export const DEMO_TEMPLATE_IDS = [
  'incident-response',
  'code-review',
  'support-triage',
] as const;

/** Default number of runs per pipeline. */
const DEFAULT_RUNS_PER_PIPELINE = 15;

/** Window over which to spread synthetic runs. */
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * Stable 32-bit seed used by the deterministic PRNG. Bumped intentionally if
 * the data shape changes — testing snapshots key off this value, so it's part
 * of the contract.
 */
export const DEMO_SEED = 0xC0FFEE42;

/** "Created by" attribution stamped on every demo pipeline. */
const DEMO_CREATED_BY = 'demo-seeder';

// Run status distribution (sums to 15 → matches DEFAULT_RUNS_PER_PIPELINE).
// Spec: ~70% completed, ~10% failed, ~10% running, ~5% cancelled,
//       ~5% awaiting-approval. We round to whole runs that span every status.
const STATUS_PLAN: Array<{ status: RunStatus; count: number }> = [
  { status: 'completed',         count: 10 }, // 66.7%
  { status: 'failed',            count: 2 },  // 13.3%
  { status: 'running',           count: 1 },  // 6.7%
  { status: 'cancelled',         count: 1 },  // 6.7%
  { status: 'awaiting_approval', count: 1 },  // 6.7%
];

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — inline so we don't pull a dep.
// Returns a function yielding floats in [0, 1).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

/**
 * Deterministic 32-hex-char id derived from the PRNG. We don't rely on
 * crypto.randomUUID here so re-seeds produce stable strings.
 */
function deterministicId(rand: () => number, prefix: string): string {
  let hex = '';
  while (hex.length < 24) {
    hex += Math.floor(rand() * 0x100000000).toString(16).padStart(8, '0');
  }
  return `${prefix}-${hex.slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Pipeline definition cloning with deterministic ids
// ---------------------------------------------------------------------------

/**
 * Walk a freshly-built template definition and rewrite every node/edge id (and
 * the def id itself) using the seeded PRNG, so re-seeding yields the same ids.
 */
function withDeterministicIds(
  def: PipelineDefinition,
  rand: () => number,
): PipelineDefinition {
  const idMap = new Map<string, string>();
  const nodes: PipelineNode[] = def.nodes.map((n) => {
    const fresh = deterministicId(rand, 'node');
    idMap.set(n.id, fresh);
    return { ...n, id: fresh, data: { ...n.data } };
  });
  const edges: PipelineEdge[] = def.edges.map((e) => ({
    ...e,
    id: deterministicId(rand, 'edge'),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));
  return {
    ...def,
    id: deterministicId(rand, 'pipe'),
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Run + step generation
// ---------------------------------------------------------------------------

/**
 * Skewed-recent timestamp picker. `rand()^2` biases toward 0, which we then
 * subtract from `now` so most points cluster within the last ~10 days but a
 * long tail still reaches back to the 30-day boundary.
 */
function pickSkewedRecentTimestamp(rand: () => number, nowMs: number): number {
  const r = rand();
  const skewed = r * r; // ∈ [0, 1), heavier near 0
  const ageMs = skewed * WINDOW_DAYS * DAY_MS;
  return nowMs - ageMs;
}

/**
 * Map the run status onto a per-step status for nodes downstream of the
 * "current" frontier. We don't actually walk the graph — for synthetic data,
 * picking a believable mix per node is enough to populate the charts.
 */
function stepStatusForRun(runStatus: RunStatus, rand: () => number): StepStatus {
  switch (runStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
      // ~80% of steps in a failed run actually completed; the failing one is
      // randomly one of the steps. Caller upgrades exactly one step to
      // 'failed'.
      return 'completed';
    case 'cancelled':
      // Some prefix completed before the cancel landed.
      return rand() < 0.6 ? 'completed' : 'cancelled';
    case 'running':
      return rand() < 0.7 ? 'completed' : 'running';
    case 'awaiting_approval':
      return 'completed';
    case 'pending':
      return 'pending';
  }
}

interface BuildRunArgs {
  def: PipelineDefinition;
  status: RunStatus;
  startedAtMs: number;
  rand: () => number;
}

function buildRun(args: BuildRunArgs): PipelineRun {
  const { def, status, startedAtMs, rand } = args;
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = deterministicId(rand, 'run');

  // Build a step execution per node. LLM nodes get token usage that hits the
  // pricing table so cost-by-node renders something for every demo pipeline.
  const steps: Record<string, StepExecution> = {};
  let cursorMs = startedAtMs;
  const node_durations: number[] = [];

  for (const node of def.nodes) {
    const stepStatus = stepStatusForRun(status, rand);
    const durationMs = node.data.type === 'llm'
      ? randInt(rand, 600, 4500)   // LLM calls are slower
      : randInt(rand, 50, 800);    // everything else is cheap

    const step: StepExecution = {
      nodeId: node.id,
      status: stepStatus,
    };

    if (stepStatus === 'completed' || stepStatus === 'failed') {
      step.startedAt = new Date(cursorMs).toISOString();
      step.completedAt = new Date(cursorMs + durationMs).toISOString();
      step.durationMs = durationMs;
      cursorMs += durationMs;
      node_durations.push(durationMs);
    } else if (stepStatus === 'running' || stepStatus === 'awaiting') {
      step.startedAt = new Date(cursorMs).toISOString();
      // no completedAt → in-flight
    } else if (stepStatus === 'cancelled') {
      step.startedAt = new Date(cursorMs).toISOString();
      step.completedAt = new Date(cursorMs + durationMs).toISOString();
      step.durationMs = durationMs;
      cursorMs += durationMs;
    }

    if (node.data.type === 'llm') {
      // Choose token counts that are non-trivial and hit pricing. Use the
      // model already configured on the node — required by the constraint
      // "don't invent new model names".
      const model = node.data.model;
      const known = MODEL_PRICING[model];
      const tokensIn = known
        ? randInt(rand, 400, 4000)
        : randInt(rand, 400, 4000); // counts still meaningful even if pricing unknown
      const tokensOut = known
        ? randInt(rand, 100, 1200)
        : randInt(rand, 100, 1200);
      step.llm = {
        prompt: '(seeded demo prompt)',
        response: '(seeded demo response)',
        tokensIn,
        tokensOut,
      };
    }

    steps[node.id] = step;
  }

  // For failed runs, mark exactly one step (the last completed one) as failed
  // so cost-by-node still attributes earlier work but the run is recognisably
  // a failure for the runs filter / stats view.
  if (status === 'failed') {
    const completed = Object.values(steps).filter((s) => s.status === 'completed');
    if (completed.length > 0) {
      const target = completed[completed.length - 1];
      target.status = 'failed';
      target.error = 'Synthetic failure (seeded demo)';
    }
  }

  // Run-level timing: sum of completed step durations, with terminal runs also
  // setting a completedAt.
  const totalDurationMs = node_durations.reduce((a, b) => a + b, 0);
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const completedAt = isTerminal
    ? new Date(startedAtMs + totalDurationMs + randInt(rand, 100, 600)).toISOString()
    : undefined;

  // Active frontier: only meaningful for non-terminal runs. For 'running' /
  // 'awaiting_approval' surface a current step so the runs filter chip
  // (#in-flight) lights up.
  const inflight: string[] = [];
  if (!isTerminal) {
    for (const node of def.nodes) {
      const s = steps[node.id];
      if (s.status === 'running' || s.status === 'awaiting') {
        inflight.push(node.id);
      }
    }
    // If we somehow didn't tag any step as in-flight (small chance for
    // 'running' status), pick the trigger node so the filter chip still works.
    if (inflight.length === 0 && def.nodes[0]) inflight.push(def.nodes[0].id);
  }

  const run: PipelineRun = {
    id: runId,
    pipelineId: def.id,
    pipelineVersion: def.publishedVersion ?? def.version,
    status,
    triggeredBy: {
      triggerType: def.triggerBinding?.event ?? 'manual',
      payload: { source: 'demo-seeder' },
    },
    ownerNodeId: 'demo-seeder',
    startedAt,
    completedAt,
    durationMs: completedAt ? totalDurationMs : undefined,
    currentStepIds: inflight,
    steps,
    context: {},
  };

  return run;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SeedOptions {
  /** Override the run count per pipeline. Defaults to 15. */
  runsPerPipeline?: number;
  /**
   * If true, wipe all existing pipelines and runs that share our `ws_*`
   * namespace before seeding. Default false — seeded pipelines are added
   * alongside whatever is already there.
   */
  clearExisting?: boolean;
  /**
   * Override the seed (mostly for tests). Production callers should leave
   * this undefined and rely on {@link DEMO_SEED}.
   */
  seed?: number;
  /**
   * Override the wall-clock anchor — handy for snapshot-stable tests. The
   * 30-day window is computed backwards from this value. Defaults to
   * `Date.now()`.
   */
  nowMs?: number;
}

export interface SeedResult {
  pipelines: number;
  runs: number;
}

/**
 * Seed three demo pipelines with synthetic run history.
 *
 * Idempotency: re-running with the same seed AFTER a `clearDemoData()`
 * (or `clearExisting: true`) yields byte-identical pipeline ids, run ids,
 * timestamps relative to the supplied `nowMs`, and token counts.
 */
export function seedDemoData(opts: SeedOptions = {}): SeedResult {
  if (opts.clearExisting) {
    clearDemoData();
  }

  const runsPerPipeline = opts.runsPerPipeline ?? DEFAULT_RUNS_PER_PIPELINE;
  const seed = opts.seed ?? DEMO_SEED;
  const nowMs = opts.nowMs ?? Date.now();
  const rand = mulberry32(seed);

  // Build the status plan for the requested count by scaling proportionally.
  // For the default of 15 runs we use STATUS_PLAN as-is; for arbitrary counts
  // we approximate using the same percentages.
  const plan = scaleStatusPlan(runsPerPipeline);

  let totalRuns = 0;
  let pipelineCount = 0;

  for (const id of DEMO_TEMPLATE_IDS) {
    const tmpl = pipelineTemplates.find((t) => t.id === id);
    if (!tmpl) continue;
    const built = tmpl.build(DEMO_CREATED_BY);
    // Rewrite ids deterministically so re-seeds match.
    const def = withDeterministicIds(built, rand);
    // Stamp a friendlier name so the demo pipelines are distinguishable in
    // the sidebar.
    def.name = `${tmpl.name} (Demo)`;
    def.tags = Array.from(new Set([...(tmpl.tags ?? []), 'demo']));
    def.createdBy = DEMO_CREATED_BY;

    // Save → publish so the runs reference a published version. publishPipeline
    // bumps version; we re-load to get the canonical persisted shape.
    savePipeline(def);
    const published = publishPipeline(def.id);
    const final = published ?? loadPipeline(def.id) ?? def;

    pipelineCount += 1;

    // Generate runs.
    for (const planEntry of plan) {
      for (let i = 0; i < planEntry.count; i++) {
        const startedAtMs = pickSkewedRecentTimestamp(rand, nowMs);
        const run = buildRun({
          def: final,
          status: planEntry.status,
          startedAtMs,
          rand,
        });
        appendRun(final.id, run);
        totalRuns += 1;
      }
    }
  }

  return { pipelines: pipelineCount, runs: totalRuns };
}

/**
 * Wipe every demo-seeded pipeline (and its run history). We identify demo
 * rows by checking the pipeline definition's `createdBy === 'demo-seeder'`,
 * so a hand-built pipeline named e.g. "Code Review (Demo)" won't be
 * accidentally deleted.
 */
export function clearDemoData(): { pipelines: number; runs: number } {
  let pipelines = 0;
  let runs = 0;
  for (const entry of listPipelines()) {
    const def = loadPipeline(entry.id);
    if (!def || def.createdBy !== DEMO_CREATED_BY) continue;
    runs += listRuns(entry.id).length;
    clearRuns(entry.id);
    deletePipeline(entry.id);
    pipelines += 1;
  }
  return { pipelines, runs };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scale STATUS_PLAN to an arbitrary total run count while preserving the
 * relative proportions and ensuring every status appears at least once when
 * total ≥ STATUS_PLAN.length.
 */
function scaleStatusPlan(total: number): Array<{ status: RunStatus; count: number }> {
  if (total === DEFAULT_RUNS_PER_PIPELINE) return STATUS_PLAN.map((p) => ({ ...p }));
  const baseTotal = STATUS_PLAN.reduce((a, p) => a + p.count, 0);
  const scaled = STATUS_PLAN.map((p) => ({
    status: p.status,
    count: Math.max(p.count > 0 ? 1 : 0, Math.round((p.count / baseTotal) * total)),
  }));
  // Adjust the largest bucket (completed) so the rounded counts sum exactly to
  // `total`.
  let sum = scaled.reduce((a, p) => a + p.count, 0);
  const biggest = scaled.reduce(
    (best, cur, idx) => (cur.count > scaled[best].count ? idx : best),
    0,
  );
  scaled[biggest].count = Math.max(0, scaled[biggest].count + (total - sum));
  sum = scaled.reduce((a, p) => a + p.count, 0);
  // Defensive: if rounding still missed (shouldn't), drop or pad cancelled.
  if (sum !== total) {
    scaled[biggest].count += total - sum;
  }
  return scaled;
}
