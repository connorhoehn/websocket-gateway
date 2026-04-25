// frontend/src/components/pipelines/__tests__/llmPricing.test.ts

import { describe, test, expect } from 'vitest';
import {
  MODEL_PRICING,
  aggregateCost,
  costByNode,
  dailyCostTrend,
  estimateCost,
  formatUsd,
  nodeDisplayLabel,
  stepCostUsd,
} from '../cost/llmPricing';
import type {
  PipelineDefinition,
  PipelineNode,
  PipelineRun,
  StepExecution,
} from '../../../types/pipeline';

describe('estimateCost', () => {
  test('known model computes expected cost for 1M/500k tokens', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1_000_000, 500_000);
    expect(cost.modelFound).toBe(true);
    expect(cost.inputCostUsd).toBeCloseTo(3, 6);
    expect(cost.outputCostUsd).toBeCloseTo(7.5, 6);
    expect(cost.totalCostUsd).toBeCloseTo(10.5, 6);
    expect(cost.inputTokens).toBe(1_000_000);
    expect(cost.outputTokens).toBe(500_000);
  });

  test('opus pricing at 1M/1M', () => {
    const cost = estimateCost('claude-opus-4-7', 1_000_000, 1_000_000);
    expect(cost.inputCostUsd).toBeCloseTo(15, 6);
    expect(cost.outputCostUsd).toBeCloseTo(75, 6);
    expect(cost.totalCostUsd).toBeCloseTo(90, 6);
  });

  test('haiku fractional pricing at 1M in / 100k out', () => {
    const cost = estimateCost('claude-haiku-4-5-20251001', 1_000_000, 100_000);
    expect(cost.inputCostUsd).toBeCloseTo(0.8, 6);
    expect(cost.outputCostUsd).toBeCloseTo(0.4, 6);
    expect(cost.totalCostUsd).toBeCloseTo(1.2, 6);
  });

  test('bedrock model id resolves to same pricing as plain id', () => {
    const plain = estimateCost('claude-sonnet-4-6', 2_000_000, 1_000_000);
    const bedrock = estimateCost(
      'anthropic.claude-sonnet-4-6-v1:0',
      2_000_000,
      1_000_000,
    );
    expect(bedrock.totalCostUsd).toBeCloseTo(plain.totalCostUsd, 6);
  });

  test('unknown model returns modelFound: false and zero costs', () => {
    const cost = estimateCost('not-a-real-model', 1_000_000, 500_000);
    expect(cost.modelFound).toBe(false);
    expect(cost.inputCostUsd).toBe(0);
    expect(cost.outputCostUsd).toBe(0);
    expect(cost.totalCostUsd).toBe(0);
    // Tokens are still preserved.
    expect(cost.inputTokens).toBe(1_000_000);
    expect(cost.outputTokens).toBe(500_000);
  });

  test('negative tokens clamp to zero', () => {
    const cost = estimateCost('claude-sonnet-4-6', -100, -200);
    expect(cost.inputTokens).toBe(0);
    expect(cost.outputTokens).toBe(0);
    expect(cost.totalCostUsd).toBe(0);
  });
});

describe('aggregateCost', () => {
  test('sums multiple steps across mixed models', () => {
    const { total, perModel } = aggregateCost([
      { model: 'claude-sonnet-4-6', tokensIn: 1_000_000, tokensOut: 500_000 },
      { model: 'claude-opus-4-7', tokensIn: 200_000, tokensOut: 100_000 },
      { model: 'claude-sonnet-4-6', tokensIn: 500_000, tokensOut: 200_000 },
    ]);

    // Sonnet: (1.5M in @ $3 = $4.5) + (0.7M out @ $15 = $10.5) = $15
    expect(perModel['claude-sonnet-4-6'].inputTokens).toBe(1_500_000);
    expect(perModel['claude-sonnet-4-6'].outputTokens).toBe(700_000);
    expect(perModel['claude-sonnet-4-6'].totalCostUsd).toBeCloseTo(15, 6);

    // Opus: (0.2M in @ $15 = $3) + (0.1M out @ $75 = $7.5) = $10.5
    expect(perModel['claude-opus-4-7'].totalCostUsd).toBeCloseTo(10.5, 6);

    // Aggregate total
    expect(total.totalCostUsd).toBeCloseTo(25.5, 6);
    expect(total.inputTokens).toBe(1_700_000);
    expect(total.outputTokens).toBe(800_000);
    expect(total.modelFound).toBe(true);
  });

  test('steps without model are skipped', () => {
    const { total, perModel } = aggregateCost([
      { tokensIn: 500_000, tokensOut: 100_000 },
      { model: 'claude-sonnet-4-6', tokensIn: 1_000_000, tokensOut: 500_000 },
    ]);
    expect(Object.keys(perModel)).toEqual(['claude-sonnet-4-6']);
    expect(total.totalCostUsd).toBeCloseTo(10.5, 6);
  });

  test('empty step list yields zero total', () => {
    const { total, perModel } = aggregateCost([]);
    expect(total.totalCostUsd).toBe(0);
    expect(total.modelFound).toBe(false);
    expect(Object.keys(perModel)).toHaveLength(0);
  });

  test('unknown-model steps contribute tokens but zero cost', () => {
    const { total, perModel } = aggregateCost([
      { model: 'made-up', tokensIn: 1_000_000, tokensOut: 500_000 },
    ]);
    expect(perModel['made-up'].modelFound).toBe(false);
    expect(total.totalCostUsd).toBe(0);
    expect(total.inputTokens).toBe(1_000_000);
    expect(total.modelFound).toBe(false);
  });
});

describe('formatUsd', () => {
  test('null -> dash', () => {
    expect(formatUsd(null)).toBe('—');
  });

  test('unknown model with zero cost -> dash', () => {
    expect(formatUsd(estimateCost('unknown', 1000, 1000))).toBe('—');
  });

  test('cost >= $0.01 uses 2 decimals', () => {
    const c = estimateCost('claude-sonnet-4-6', 1_000_000, 500_000);
    expect(formatUsd(c)).toBe('$10.50');
  });

  test('cost < $0.01 uses 4 decimals', () => {
    // 1000 in @ $3/M = $0.003
    const c = estimateCost('claude-sonnet-4-6', 1000, 0);
    expect(formatUsd(c)).toBe('$0.0030');
  });

  test('exact zero with known model renders as $0.00', () => {
    const c = estimateCost('claude-sonnet-4-6', 0, 0);
    expect(formatUsd(c)).toBe('$0.00');
  });
});

describe('MODEL_PRICING table', () => {
  test('all expected entries exist', () => {
    expect(MODEL_PRICING['claude-opus-4-7']).toBeDefined();
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICING['claude-haiku-4-5-20251001']).toBeDefined();
    expect(MODEL_PRICING['anthropic.claude-opus-4-7-v1:0']).toBeDefined();
    expect(MODEL_PRICING['anthropic.claude-sonnet-4-6-v1:0']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test fixtures for the per-node / 30-day-trend helpers below
// ---------------------------------------------------------------------------

function llmNode(id: string, model: string, label?: string): PipelineNode {
  return {
    id,
    type: 'llm',
    position: { x: 0, y: 0 },
    data: {
      type: 'llm',
      provider: 'anthropic',
      model,
      systemPrompt: '',
      userPromptTemplate: '',
      streaming: false,
      // `label` is read by nodeDisplayLabel even though it's not part of the
      // canonical LLMNodeData shape — exercises the explicit-label branch.
      ...(label ? { label } : {}),
    } as PipelineNode['data'],
  };
}

function actionNode(id: string, actionType: string): PipelineNode {
  return {
    id,
    type: 'action',
    position: { x: 0, y: 0 },
    data: {
      type: 'action',
      actionType: actionType as never,
      config: {},
    },
  };
}

function makeDef(nodes: PipelineNode[]): PipelineDefinition {
  return {
    id: 'p1',
    name: 'P',
    version: 1,
    status: 'published',
    nodes,
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u1',
  };
}

function llmStep(nodeId: string, tokensIn: number, tokensOut: number): StepExecution {
  return {
    nodeId,
    status: 'completed',
    durationMs: 100,
    llm: {
      prompt: '',
      response: '',
      tokensIn,
      tokensOut,
    },
  };
}

function makeRun(
  id: string,
  startedAt: string,
  steps: StepExecution[],
): PipelineRun {
  const stepMap: Record<string, StepExecution> = {};
  for (const s of steps) stepMap[s.nodeId] = s;
  return {
    id,
    pipelineId: 'p1',
    pipelineVersion: 1,
    status: 'completed',
    triggeredBy: { triggerType: 'manual', payload: {} },
    ownerNodeId: 'n',
    startedAt,
    completedAt: startedAt,
    durationMs: 100,
    currentStepIds: [],
    steps: stepMap,
    context: {},
  };
}

// ---------------------------------------------------------------------------
// nodeDisplayLabel
// ---------------------------------------------------------------------------

describe('nodeDisplayLabel', () => {
  test('explicit label wins over type-specific descriptor', () => {
    expect(nodeDisplayLabel(llmNode('a', 'claude-sonnet-4-6', 'Summarizer'))).toBe(
      'Summarizer',
    );
  });

  test('llm falls back to model when no label set', () => {
    expect(nodeDisplayLabel(llmNode('a', 'claude-opus-4-7'))).toBe(
      'claude-opus-4-7',
    );
  });

  test('action node uses actionType', () => {
    expect(nodeDisplayLabel(actionNode('b', 'post-comment'))).toBe('post-comment');
  });

  test('whitespace-only label is ignored', () => {
    expect(nodeDisplayLabel(llmNode('a', 'claude-sonnet-4-6', '   '))).toBe(
      'claude-sonnet-4-6',
    );
  });
});

// ---------------------------------------------------------------------------
// stepCostUsd
// ---------------------------------------------------------------------------

describe('stepCostUsd', () => {
  test('returns LLM cost when models map carries the model id', () => {
    const models = new Map([['n1', 'claude-sonnet-4-6']]);
    // 1M in @ $3 + 0.5M out @ $15 = $10.50
    expect(stepCostUsd(llmStep('n1', 1_000_000, 500_000), models)).toBeCloseTo(
      10.5,
      6,
    );
  });

  test('returns 0 when the model is not registered for the node', () => {
    const models = new Map<string, string>();
    expect(stepCostUsd(llmStep('n1', 1_000_000, 500_000), models)).toBe(0);
  });

  test('non-LLM step contributes 0', () => {
    const step: StepExecution = { nodeId: 'n1', status: 'completed' };
    expect(stepCostUsd(step, new Map())).toBe(0);
  });

  test('forward-compatible costUsd field is summed in', () => {
    const models = new Map([['n1', 'claude-sonnet-4-6']]);
    const step = {
      ...llmStep('n1', 1_000_000, 0),
      costUsd: 0.25,
    } as StepExecution;
    // 1M in @ $3 = $3 + 0.25 = $3.25
    expect(stepCostUsd(step, models)).toBeCloseTo(3.25, 6);
  });
});

// ---------------------------------------------------------------------------
// costByNode
// ---------------------------------------------------------------------------

describe('costByNode', () => {
  test('returns [] when def is null', () => {
    expect(costByNode([], null)).toEqual([]);
  });

  test('aggregates per-node costs across multiple runs, sorted desc', () => {
    const def = makeDef([
      llmNode('opus', 'claude-opus-4-7', 'Opus drafter'),
      llmNode('sonnet', 'claude-sonnet-4-6'),
      actionNode('act', 'post-comment'),
    ]);

    // Run A: opus 0.2M/0.1M  -> $3 + $7.5 = $10.5
    //        sonnet 1M/0.5M  -> $3 + $7.5 = $10.5
    // Run B: opus 0.2M/0.1M  -> $10.5
    const runs: PipelineRun[] = [
      makeRun('r1', '2026-04-25T10:00:00.000Z', [
        llmStep('opus', 200_000, 100_000),
        llmStep('sonnet', 1_000_000, 500_000),
      ]),
      makeRun('r2', '2026-04-25T11:00:00.000Z', [
        llmStep('opus', 200_000, 100_000),
      ]),
    ];

    const rows = costByNode(runs, def);
    expect(rows).toHaveLength(3);

    // Sorted by cost desc: opus ($21) > sonnet ($10.50) > act ($0).
    expect(rows[0].nodeId).toBe('opus');
    expect(rows[0].label).toBe('Opus drafter');
    expect(rows[0].totalCostUsd).toBeCloseTo(21, 6);
    expect(rows[0].stepCount).toBe(2);

    expect(rows[1].nodeId).toBe('sonnet');
    expect(rows[1].totalCostUsd).toBeCloseTo(10.5, 6);
    expect(rows[1].stepCount).toBe(1);

    expect(rows[2].nodeId).toBe('act');
    expect(rows[2].totalCostUsd).toBe(0);
    expect(rows[2].stepCount).toBe(0);
  });

  test('steps for nodes not in def are silently skipped', () => {
    const def = makeDef([llmNode('keep', 'claude-sonnet-4-6')]);
    const run = makeRun('r1', '2026-04-25T10:00:00.000Z', [
      llmStep('keep', 1_000_000, 500_000), // $10.50
      llmStep('removed', 500_000, 250_000), // dropped
    ]);

    const rows = costByNode([run], def);
    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe('keep');
    expect(rows[0].totalCostUsd).toBeCloseTo(10.5, 6);
  });
});

// ---------------------------------------------------------------------------
// dailyCostTrend
// ---------------------------------------------------------------------------

describe('dailyCostTrend', () => {
  const NOW = new Date('2026-04-25T12:00:00.000Z');

  test('returns N consecutive day buckets ending at `now`', () => {
    const def = makeDef([llmNode('a', 'claude-sonnet-4-6')]);
    const points = dailyCostTrend([], def, 30, NOW);
    expect(points).toHaveLength(30);
    expect(points[points.length - 1].date).toBe('2026-04-25');
    expect(points[0].date).toBe('2026-03-27');
    // All zero when no runs.
    expect(points.every((p) => p.totalCostUsd === 0 && p.runCount === 0)).toBe(true);
  });

  test('buckets runs by their startedAt UTC day', () => {
    const def = makeDef([llmNode('a', 'claude-sonnet-4-6')]);
    const runs: PipelineRun[] = [
      // 2026-04-25: $10.50
      makeRun('r1', '2026-04-25T01:00:00.000Z', [
        llmStep('a', 1_000_000, 500_000),
      ]),
      // 2026-04-25: another $10.50
      makeRun('r2', '2026-04-25T23:30:00.000Z', [
        llmStep('a', 1_000_000, 500_000),
      ]),
      // 2026-04-24: $3.00 (1M in only)
      makeRun('r3', '2026-04-24T08:00:00.000Z', [llmStep('a', 1_000_000, 0)]),
    ];

    const points = dailyCostTrend(runs, def, 30, NOW);
    const byDate = Object.fromEntries(points.map((p) => [p.date, p]));

    expect(byDate['2026-04-25'].totalCostUsd).toBeCloseTo(21, 6);
    expect(byDate['2026-04-25'].runCount).toBe(2);
    expect(byDate['2026-04-24'].totalCostUsd).toBeCloseTo(3, 6);
    expect(byDate['2026-04-24'].runCount).toBe(1);
  });

  test('runs outside the window are dropped', () => {
    const def = makeDef([llmNode('a', 'claude-sonnet-4-6')]);
    const runs: PipelineRun[] = [
      // 60 days before NOW — out of a 30-day window.
      makeRun('old', '2026-02-20T08:00:00.000Z', [
        llmStep('a', 1_000_000, 500_000),
      ]),
    ];
    const points = dailyCostTrend(runs, def, 30, NOW);
    expect(points.reduce((s, p) => s + p.totalCostUsd, 0)).toBe(0);
  });

  test('returns the requested number of days exactly', () => {
    expect(dailyCostTrend([], null, 7, NOW)).toHaveLength(7);
    expect(dailyCostTrend([], null, 1, NOW)).toHaveLength(1);
  });
});
