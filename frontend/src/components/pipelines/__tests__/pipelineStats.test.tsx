// Tests for <PipelineStatsPage/>. Exercises empty state and the aggregate
// rollup (success rate + failure breakdown) using real localStorage-backed
// fixtures via createPipeline / appendRun.

import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import PipelineStatsPage from '../PipelineStatsPage';
import { createPipeline } from '../persistence/pipelineStorage';
import { appendRun } from '../persistence/runHistory';
import type { PipelineRun, RunStatus } from '../../../types/pipeline';

function makeRun(
  pipelineId: string,
  idx: number,
  status: RunStatus,
  overrides: Partial<PipelineRun> = {},
): PipelineRun {
  const startedAt = new Date(2026, 0, 1, 0, idx).toISOString();
  return {
    id: `run-${idx.toString().padStart(4, '0')}`,
    pipelineId,
    pipelineVersion: 1,
    status,
    triggeredBy: { triggerType: 'manual', payload: {} },
    ownerNodeId: 'test-node',
    startedAt,
    completedAt: startedAt,
    durationMs: 1000 + idx * 100,
    currentStepIds: [],
    steps: {},
    context: {},
    ...overrides,
  };
}

function renderStats(pipelineId: string) {
  return render(
    <MemoryRouter initialEntries={[`/pipelines/${pipelineId}/stats`]}>
      <Routes>
        <Route path="/pipelines/:pipelineId/stats" element={<PipelineStatsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<PipelineStatsPage/>', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
        localStorage.removeItem(k);
      }
    }
  });

  test('shows empty state when no runs are persisted', () => {
    const def = createPipeline({ name: 'Empty Pipeline', createdBy: 'u1' });
    renderStats(def.id);

    expect(
      screen.getByText(/No runs yet\. Trigger this pipeline to see stats\./i),
    ).toBeInTheDocument();
  });

  test('5 completed + 1 failed ⇒ success rate "83%" and a failure row', () => {
    const def = createPipeline({ name: 'Stats Pipeline', createdBy: 'u1' });

    for (let i = 1; i <= 5; i++) {
      appendRun(def.id, makeRun(def.id, i, 'completed'));
    }
    appendRun(
      def.id,
      makeRun(def.id, 6, 'failed', {
        error: { nodeId: 'n1', message: 'TimeoutError: upstream latency exceeded' },
      }),
    );

    renderStats(def.id);

    // Success rate cell: 5/6 ⇒ 83%
    const successRate = screen.getByTestId('stats-success-rate');
    expect(successRate.textContent).toContain('5/6');
    expect(successRate.textContent).toContain('83%');

    // Failure breakdown contains the truncated error message.
    const breakdown = screen.getByTestId('stats-failure-breakdown');
    expect(breakdown.textContent).toMatch(/TimeoutError/);
  });
});
