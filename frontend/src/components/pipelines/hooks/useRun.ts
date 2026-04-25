import { useMemo } from 'react';
import { usePipelineRuns } from '../context/PipelineRunsContext';
import type { PipelineRun } from '../../../types/pipeline';

export function useRun(runId: string | null): PipelineRun | null {
  const { runs } = usePipelineRuns();
  return useMemo(() => (runId ? (runs[runId] ?? null) : null), [runId, runs]);
}
