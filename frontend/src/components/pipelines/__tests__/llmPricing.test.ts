// frontend/src/components/pipelines/__tests__/llmPricing.test.ts

import { describe, test, expect } from 'vitest';
import {
  MODEL_PRICING,
  aggregateCost,
  estimateCost,
  formatUsd,
} from '../cost/llmPricing';

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
