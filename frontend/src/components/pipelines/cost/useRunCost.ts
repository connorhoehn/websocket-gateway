// frontend/src/components/pipelines/cost/useRunCost.ts
//
// Hook that takes a PipelineRun and returns its aggregate cost by walking
// `run.steps`, pulling `step.llm?.tokensIn/Out` and inferring `model` from
// the corresponding node's LLM config on the persisted definition.

import { useMemo } from 'react';

import type { PipelineRun } from '../../../types/pipeline';
import { loadPipeline } from '../persistence/pipelineStorage';
import { aggregateCost, type CostBreakdown } from './llmPricing';

export function useRunCost(run: PipelineRun | null): CostBreakdown | null {
  return useMemo(() => {
    if (!run) return null;
    const def = loadPipeline(run.pipelineId);
    if (!def) return null;

    // Build nodeId -> model (from LLM node config, if any) lookup.
    const modelByNode = new Map<string, string>();
    for (const node of def.nodes) {
      if (node.data.type === 'llm') {
        modelByNode.set(node.id, node.data.model);
      }
    }

    const steps = Object.values(run.steps)
      .filter((step) => !!step.llm)
      .map((step) => ({
        model: modelByNode.get(step.nodeId),
        tokensIn: step.llm?.tokensIn ?? 0,
        tokensOut: step.llm?.tokensOut ?? 0,
      }));

    return aggregateCost(steps).total;
  }, [run]);
}
