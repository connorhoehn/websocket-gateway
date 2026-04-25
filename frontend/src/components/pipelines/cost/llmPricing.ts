// frontend/src/components/pipelines/cost/llmPricing.ts
//
// LLM cost estimation tables and helpers.
//
// USD per million tokens, by model. Numbers reflect public list prices as of
// April 2026. Keep in sync with vendor pricing pages; update quarterly.
// Used for client-side cost estimation only — no billing decisions rely on
// these figures.

import type {
  PipelineDefinition,
  PipelineNode,
  PipelineRun,
  StepExecution,
} from '../../../types/pipeline';

export interface ModelPricing {
  inputPerMillion: number; // USD per 1M input tokens
  outputPerMillion: number; // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':                  { inputPerMillion: 15,  outputPerMillion: 75 },
  'claude-sonnet-4-6':                { inputPerMillion: 3,   outputPerMillion: 15 },
  'claude-haiku-4-5-20251001':        { inputPerMillion: 0.8, outputPerMillion: 4 },
  // Bedrock model IDs
  'anthropic.claude-opus-4-7-v1:0':   { inputPerMillion: 15,  outputPerMillion: 75 },
  'anthropic.claude-sonnet-4-6-v1:0': { inputPerMillion: 3,   outputPerMillion: 15 },
};

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  model: string;
  modelFound: boolean;
}

/**
 * Convert a (model, tokensIn, tokensOut) triple into a dollar estimate.
 * When the model isn't in the pricing table, returns zero costs with
 * `modelFound: false` so the UI can show "—" rather than a misleading "$0.00".
 */
export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): CostBreakdown {
  const pricing = MODEL_PRICING[model];
  const inputTokens = Math.max(0, tokensIn | 0);
  const outputTokens = Math.max(0, tokensOut | 0);

  if (!pricing) {
    return {
      inputTokens,
      outputTokens,
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      model,
      modelFound: false,
    };
  }

  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return {
    inputTokens,
    outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    model,
    modelFound: true,
  };
}

/**
 * Sum costs across multiple step executions. Returns aggregate + per-model breakdown.
 * Steps missing `model` or tokens are treated as zero contributors but still counted
 * into the aggregate so callers can show a stable total.
 */
export function aggregateCost(
  steps: Array<{ model?: string; tokensIn?: number; tokensOut?: number }>,
): { total: CostBreakdown; perModel: Record<string, CostBreakdown> } {
  const perModel: Record<string, CostBreakdown> = {};
  let totalIn = 0;
  let totalOut = 0;
  let totalInCost = 0;
  let totalOutCost = 0;
  let anyFound = false;

  for (const step of steps) {
    if (!step.model) continue;
    const tokensIn = step.tokensIn ?? 0;
    const tokensOut = step.tokensOut ?? 0;
    const breakdown = estimateCost(step.model, tokensIn, tokensOut);

    const existing = perModel[step.model];
    if (existing) {
      perModel[step.model] = {
        inputTokens: existing.inputTokens + breakdown.inputTokens,
        outputTokens: existing.outputTokens + breakdown.outputTokens,
        inputCostUsd: existing.inputCostUsd + breakdown.inputCostUsd,
        outputCostUsd: existing.outputCostUsd + breakdown.outputCostUsd,
        totalCostUsd: existing.totalCostUsd + breakdown.totalCostUsd,
        model: step.model,
        modelFound: existing.modelFound || breakdown.modelFound,
      };
    } else {
      perModel[step.model] = breakdown;
    }

    totalIn += breakdown.inputTokens;
    totalOut += breakdown.outputTokens;
    totalInCost += breakdown.inputCostUsd;
    totalOutCost += breakdown.outputCostUsd;
    if (breakdown.modelFound) anyFound = true;
  }

  const total: CostBreakdown = {
    inputTokens: totalIn,
    outputTokens: totalOut,
    inputCostUsd: totalInCost,
    outputCostUsd: totalOutCost,
    totalCostUsd: totalInCost + totalOutCost,
    model: 'aggregate',
    modelFound: anyFound,
  };

  return { total, perModel };
}

/**
 * Display helper — formats USD with 4 decimals under $0.01, 2 decimals above.
 * Returns "—" when the breakdown has no pricing match and zero cost, so the UI
 * can avoid rendering a misleading "$0.00".
 */
export function formatUsd(cost: CostBreakdown | null): string {
  if (!cost) return '—';
  if (!cost.modelFound && cost.totalCostUsd === 0) return '—';
  if (cost.totalCostUsd >= 0.01) return `$${cost.totalCostUsd.toFixed(2)}`;
  if (cost.totalCostUsd === 0) return '$0.00';
  return `$${cost.totalCostUsd.toFixed(4)}`;
}

/**
 * Display label for a pipeline node — same conventions as the validator's
 * private `nodeLabel`: prefer an explicit `label` field on the node data,
 * fall back to the type-specific descriptor (model / triggerType / actionType /
 * etc.), then to the bare node `type`.
 */
export function nodeDisplayLabel(node: PipelineNode): string {
  const labelField = (node.data as { label?: unknown }).label;
  if (typeof labelField === 'string' && labelField.trim()) return labelField.trim();
  switch (node.data.type) {
    case 'llm':
      return node.data.model || 'llm';
    case 'trigger':
      return node.data.triggerType || 'trigger';
    case 'action':
      return node.data.actionType || 'action';
    case 'transform':
      return node.data.transformType || 'transform';
    case 'join':
      return node.data.mode ? `join:${node.data.mode}` : 'join';
    default:
      return node.type;
  }
}

/** One entry in the per-node cost breakdown. */
export interface NodeCostRow {
  nodeId: string;
  /** Display label (resolved via {@link nodeDisplayLabel}). */
  label: string;
  /** Node type — useful for tooltips / coloring. */
  type: string;
  /** Total USD across every step execution that ran this node. */
  totalCostUsd: number;
  /** How many step executions contributed to this row. */
  stepCount: number;
}

/**
 * Per-step USD cost: LLM token cost via {@link estimateCost} when the step
 * carries `llm` data, plus any other typed costs that may exist on a step.
 * Currently only LLM contributes a non-zero value; the function is structured
 * so future per-step typed costs (e.g. action billing) can plug in here without
 * touching every call site.
 */
export function stepCostUsd(
  step: StepExecution,
  models: Map<string, string>,
): number {
  let total = 0;
  if (step.llm) {
    const model = models.get(step.nodeId);
    if (model) {
      total += estimateCost(model, step.llm.tokensIn, step.llm.tokensOut).totalCostUsd;
    }
  }
  // Future typed costs on StepExecution would be summed here. The cast keeps
  // forward compatibility without forcing every caller to update at once.
  const extra = (step as unknown as { costUsd?: number }).costUsd;
  if (typeof extra === 'number' && Number.isFinite(extra) && extra > 0) {
    total += extra;
  }
  return total;
}

/**
 * Sum each pipeline node's USD cost across the supplied runs. Returns one row
 * per node defined in `def`, sorted by total cost descending. Nodes that the
 * runs never touched yield a zero-cost row so the chart still shows the full
 * pipeline shape; callers can filter those out before rendering if desired.
 */
export function costByNode(
  runs: PipelineRun[],
  def: PipelineDefinition | null,
): NodeCostRow[] {
  if (!def) return [];

  const models = new Map<string, string>();
  const labelById = new Map<string, string>();
  const typeById = new Map<string, string>();
  for (const node of def.nodes) {
    if (node.data.type === 'llm') models.set(node.id, node.data.model);
    labelById.set(node.id, nodeDisplayLabel(node));
    typeById.set(node.id, node.data.type);
  }

  const totalsById = new Map<string, number>();
  const countsById = new Map<string, number>();
  for (const node of def.nodes) {
    totalsById.set(node.id, 0);
    countsById.set(node.id, 0);
  }

  for (const run of runs) {
    for (const step of Object.values(run.steps ?? {}) as StepExecution[]) {
      // Skip steps for nodes that no longer exist on the published definition.
      if (!labelById.has(step.nodeId)) continue;
      const cost = stepCostUsd(step, models);
      totalsById.set(step.nodeId, (totalsById.get(step.nodeId) ?? 0) + cost);
      countsById.set(step.nodeId, (countsById.get(step.nodeId) ?? 0) + 1);
    }
  }

  const rows: NodeCostRow[] = def.nodes.map((node) => ({
    nodeId: node.id,
    label: labelById.get(node.id) ?? node.id,
    type: typeById.get(node.id) ?? node.type,
    totalCostUsd: totalsById.get(node.id) ?? 0,
    stepCount: countsById.get(node.id) ?? 0,
  }));

  rows.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return rows;
}

/** One day's total spend in the trend series. */
export interface DailyCostPoint {
  /** Local-day key in YYYY-MM-DD form (the bucket key used for grouping). */
  date: string;
  /** Bucket boundary as epoch ms (start of day in UTC). */
  ts: number;
  /** Total USD across every run that started on this day. */
  totalCostUsd: number;
  /** How many runs landed in this day. */
  runCount: number;
}

/** UTC-midnight bucket key for an ISO timestamp ('YYYY-MM-DD'). */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayStartMs(key: string): number {
  return Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  );
}

/**
 * Build a per-day total-spend series for the last `days` days (inclusive of
 * today, default 30). Days with no runs are emitted as zero-value points so
 * the line chart renders a continuous x-axis. `now` is injectable for tests.
 */
export function dailyCostTrend(
  runs: PipelineRun[],
  def: PipelineDefinition | null,
  days = 30,
  now: Date = new Date(),
): DailyCostPoint[] {
  const models = new Map<string, string>();
  if (def) {
    for (const node of def.nodes) {
      if (node.data.type === 'llm') models.set(node.id, node.data.model);
    }
  }

  // Build the rolling window keys: [today-days+1 ... today], UTC.
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const windowStart = todayUtc - (days - 1) * 86_400_000;

  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (let t = windowStart; t <= todayUtc; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    totals.set(key, 0);
    counts.set(key, 0);
  }

  for (const run of runs) {
    const key = dayKey(run.startedAt);
    if (!totals.has(key)) continue; // outside window
    let runTotal = 0;
    for (const step of Object.values(run.steps ?? {}) as StepExecution[]) {
      runTotal += stepCostUsd(step, models);
    }
    totals.set(key, (totals.get(key) ?? 0) + runTotal);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: DailyCostPoint[] = [];
  for (let t = windowStart; t <= todayUtc; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    points.push({
      date: key,
      ts: dayStartMs(key),
      totalCostUsd: totals.get(key) ?? 0,
      runCount: counts.get(key) ?? 0,
    });
  }
  return points;
}
