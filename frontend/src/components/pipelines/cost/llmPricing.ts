// frontend/src/components/pipelines/cost/llmPricing.ts
//
// LLM cost estimation tables and helpers.
//
// USD per million tokens, by model. Numbers reflect public list prices as of
// April 2026. Keep in sync with vendor pricing pages; update quarterly.
// Used for client-side cost estimation only — no billing decisions rely on
// these figures.

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
