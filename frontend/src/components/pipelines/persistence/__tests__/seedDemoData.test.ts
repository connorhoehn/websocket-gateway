// frontend/src/components/pipelines/persistence/__tests__/seedDemoData.test.ts
//
// Unit tests for the demo data seeder. Verifies:
// - exactly 3 pipelines + 45 runs land in localStorage
// - every run carries at least one step execution with non-zero LLM cost
// - the run-status mix spans every expected bucket
// - re-seeding with the same options produces byte-identical pipeline ids
// - clearDemoData removes only `createdBy === 'demo-seeder'` rows
//
// Framework: Vitest (jest-compatible API).

import { describe, test, expect, beforeEach } from 'vitest';
import {
  DEMO_TEMPLATE_IDS,
  clearDemoData,
  seedDemoData,
} from '../seedDemoData';
import {
  createPipeline,
  listPipelines,
  loadPipeline,
} from '../pipelineStorage';
import { listRuns } from '../runHistory';
import { aggregateCost } from '../../cost/llmPricing';
import type { LLMNodeData, RunStatus } from '../../../../types/pipeline';

// ---------------------------------------------------------------------------
// Lifecycle — clear only the keys this module owns so we don't trip other
// suites that share jsdom's localStorage.
// ---------------------------------------------------------------------------

beforeEach(() => {
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
      localStorage.removeItem(k);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedDemoData', () => {
  test('seeds 3 pipelines with 15 runs each (45 total)', () => {
    const result = seedDemoData();
    expect(result.pipelines).toBe(3);
    expect(result.runs).toBe(45);

    const pipelines = listPipelines();
    expect(pipelines).toHaveLength(3);

    let totalRuns = 0;
    for (const entry of pipelines) {
      const runs = listRuns(entry.id);
      expect(runs.length).toBe(15);
      totalRuns += runs.length;
    }
    expect(totalRuns).toBe(45);
  });

  test('every run has at least one step execution with non-zero LLM cost', () => {
    seedDemoData();

    for (const entry of listPipelines()) {
      const def = loadPipeline(entry.id);
      expect(def).not.toBeNull();
      const llmModelByNode = new Map<string, string>();
      for (const node of def!.nodes) {
        if (node.data.type === 'llm') {
          llmModelByNode.set(node.id, (node.data as LLMNodeData).model);
        }
      }

      const runs = listRuns(entry.id);
      for (const run of runs) {
        const stepArr = Object.values(run.steps);
        expect(stepArr.length).toBeGreaterThan(0);

        const llmSteps = stepArr
          .filter((s) => s.llm)
          .map((s) => ({
            model: llmModelByNode.get(s.nodeId),
            tokensIn: s.llm!.tokensIn,
            tokensOut: s.llm!.tokensOut,
          }));

        // Every demo template includes at least one LLM node, so every run
        // should produce at least one priced LLM step.
        expect(llmSteps.length).toBeGreaterThan(0);
        const cost = aggregateCost(llmSteps);
        expect(cost.total.totalCostUsd).toBeGreaterThan(0);
      }
    }
  });

  test('seeded runs span every expected status bucket', () => {
    seedDemoData();

    const seen = new Set<RunStatus>();
    for (const entry of listPipelines()) {
      for (const run of listRuns(entry.id)) {
        seen.add(run.status);
      }
    }

    // Spec: completed (~70%), failed (~10%), running (~10%),
    //       cancelled (~5%), awaiting-approval (~5%).
    expect(seen.has('completed')).toBe(true);
    expect(seen.has('failed')).toBe(true);
    expect(seen.has('running')).toBe(true);
    expect(seen.has('cancelled')).toBe(true);
    expect(seen.has('awaiting_approval')).toBe(true);
  });

  test('re-seeding with the same seed produces identical pipeline + run ids', () => {
    const first = seedDemoData({ clearExisting: true, nowMs: 1_700_000_000_000 });
    const firstIds = listPipelines().map((e) => e.id).sort();
    const firstRunIds: Record<string, string[]> = {};
    for (const e of listPipelines()) {
      firstRunIds[e.id] = listRuns(e.id).map((r) => r.id).sort();
    }
    expect(first.pipelines).toBe(3);

    const second = seedDemoData({ clearExisting: true, nowMs: 1_700_000_000_000 });
    const secondIds = listPipelines().map((e) => e.id).sort();
    const secondRunIds: Record<string, string[]> = {};
    for (const e of listPipelines()) {
      secondRunIds[e.id] = listRuns(e.id).map((r) => r.id).sort();
    }

    expect(second.pipelines).toBe(3);
    expect(secondIds).toEqual(firstIds);
    expect(secondRunIds).toEqual(firstRunIds);
  });

  test('seeded pipelines reference only the three expected templates', () => {
    seedDemoData();
    const names = listPipelines().map((p) => p.name).sort();
    // Each demo pipeline name is "<template name> (Demo)". Confirm we covered
    // every template id in DEMO_TEMPLATE_IDS.
    expect(names.length).toBe(DEMO_TEMPLATE_IDS.length);
    for (const name of names) {
      expect(name.endsWith(' (Demo)')).toBe(true);
    }
  });

  test('runs use real node ids from the persisted pipeline definition', () => {
    seedDemoData();
    for (const entry of listPipelines()) {
      const def = loadPipeline(entry.id)!;
      const validNodeIds = new Set(def.nodes.map((n) => n.id));
      for (const run of listRuns(entry.id)) {
        for (const step of Object.values(run.steps)) {
          expect(validNodeIds.has(step.nodeId)).toBe(true);
        }
      }
    }
  });
});

describe('clearDemoData', () => {
  test('removes only seeded pipelines, leaves user-created pipelines intact', () => {
    // Seed plus a hand-rolled pipeline that should survive.
    seedDemoData();
    const userDef = createPipeline({
      name: 'My Real Pipeline',
      createdBy: 'real-user',
    });

    expect(listPipelines()).toHaveLength(4);

    const removed = clearDemoData();
    expect(removed.pipelines).toBe(3);
    expect(removed.runs).toBe(45);

    const remaining = listPipelines();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(userDef.id);
  });
});
