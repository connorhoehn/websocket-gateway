// Tests for <PipelineRunComparePage/>. Exercises the missing-run empty state,
// duration delta rendering, status-mismatch highlight, LLM word-diff inline,
// and run-level cost display. Uses real localStorage-backed fixtures via
// createPipeline + appendRun, mirroring the pattern in pipelineStats.test.tsx.

import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

import PipelineRunComparePage, { wordDiff } from '../PipelineRunComparePage';
import { createPipeline, savePipeline, loadPipeline } from '../persistence/pipelineStorage';
import { appendRun } from '../persistence/runHistory';
import type {
  PipelineDefinition,
  PipelineRun,
  StepExecution,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(
  pipelineId: string,
  id: string,
  steps: Record<string, StepExecution>,
  overrides: Partial<PipelineRun> = {},
): PipelineRun {
  const startedAt = new Date(2026, 0, 1).toISOString();
  return {
    id,
    pipelineId,
    pipelineVersion: 1,
    status: 'completed',
    triggeredBy: { triggerType: 'manual', payload: {} },
    ownerNodeId: 'test-node',
    startedAt,
    completedAt: startedAt,
    durationMs: 1000,
    currentStepIds: [],
    steps,
    context: {},
    ...overrides,
  };
}

function makeStep(
  nodeId: string,
  overrides: Partial<StepExecution> = {},
): StepExecution {
  return {
    nodeId,
    status: 'completed',
    durationMs: 100,
    ...overrides,
  };
}

/** Add an LLM node to the definition so cost lookup finds a model. */
function withLlmNode(def: PipelineDefinition, nodeId: string, model = 'claude-sonnet-4-6'): PipelineDefinition {
  const next: PipelineDefinition = {
    ...def,
    nodes: [
      ...def.nodes,
      {
        id: nodeId,
        type: 'llm',
        position: { x: 0, y: 0 },
        data: {
          type: 'llm',
          provider: 'anthropic',
          model,
          systemPrompt: '',
          userPromptTemplate: '',
          streaming: false,
        },
      },
    ],
    edges: def.edges,
  };
  savePipeline(next);
  return loadPipeline(next.id) as PipelineDefinition;
}

function renderCompare(pipelineId: string, runIdA: string, runIdB: string) {
  return render(
    <MemoryRouter
      initialEntries={[`/pipelines/${pipelineId}/runs/compare/${runIdA}/${runIdB}`]}
    >
      <Routes>
        <Route
          path="/pipelines/:pipelineId/runs/compare/:runIdA/:runIdB"
          element={<PipelineRunComparePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wordDiff helper', () => {
  test('emits eq/add/del parts for token diffs', () => {
    const parts = wordDiff('hello world', 'hello brave world');
    const types = parts.map((p) => p.type);
    expect(types).toContain('eq');
    expect(types).toContain('add');
    // Reconstruct equal+added to recover the second string
    const reconstructed = parts
      .filter((p) => p.type !== 'del')
      .map((p) => p.text)
      .join('');
    expect(reconstructed).toBe('hello brave world');
  });

  test('all-removed when target string is empty', () => {
    const parts = wordDiff('gone forever', '');
    expect(parts.every((p) => p.type === 'del')).toBe(true);
  });
});

describe('<PipelineRunComparePage/>', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
        localStorage.removeItem(k);
      }
    }
  });

  test('renders "Run not found" empty state when both runs are missing', () => {
    const def = createPipeline({ name: 'Cmp', createdBy: 'u1' });
    renderCompare(def.id, 'no-such-a', 'no-such-b');
    expect(screen.getByText(/Run not found/i)).toBeInTheDocument();
    expect(screen.getByTestId('run-compare-missing')).toBeInTheDocument();
  });

  test('two runs with different durations show a delta', () => {
    const def = createPipeline({ name: 'Cmp', createdBy: 'u1' });
    const stepA = makeStep('n1', { durationMs: 100 });
    const stepB = makeStep('n1', { durationMs: 250 });
    appendRun(def.id, makeRun(def.id, 'run-a', { n1: stepA }, { durationMs: 100 }));
    appendRun(def.id, makeRun(def.id, 'run-b', { n1: stepB }, { durationMs: 250 }));

    renderCompare(def.id, 'run-a', 'run-b');

    // Delta cell for the row should mention +150ms.
    const deltaCell = screen.getByTestId('run-compare-delta-n1');
    expect(deltaCell.textContent).toMatch(/\+150ms/);
  });

  test('different statuses highlight the row and show "status differs"', () => {
    const def = createPipeline({ name: 'Cmp', createdBy: 'u1' });
    const stepA = makeStep('n1', { status: 'completed' });
    const stepB = makeStep('n1', { status: 'failed', error: 'boom' });
    appendRun(def.id, makeRun(def.id, 'run-a', { n1: stepA }));
    appendRun(def.id, makeRun(def.id, 'run-b', { n1: stepB }));

    renderCompare(def.id, 'run-a', 'run-b');

    const row = screen.getByTestId('run-compare-row-n1');
    // Row gets the status-mismatch background. JSDOM normalizes #fef2f2
    // (red-50) to its rgb() equivalent — match that instead of the hex.
    expect(row.getAttribute('style')).toMatch(/rgb\(254,\s*242,\s*242\)/);
    // Delta column flags the mismatch.
    expect(screen.getByTestId('run-compare-delta-n1').textContent).toMatch(/status differs/i);
  });

  test('LLM step renders both responses with a word-diff section', () => {
    const def = createPipeline({ name: 'Cmp', createdBy: 'u1' });
    withLlmNode(def, 'llm-1');

    const stepA = makeStep('llm-1', {
      durationMs: 1000,
      llm: {
        prompt: 'p',
        response: 'The cat sat on the mat',
        tokensIn: 100,
        tokensOut: 200,
      },
    });
    const stepB = makeStep('llm-1', {
      durationMs: 1500,
      llm: {
        prompt: 'p',
        response: 'The cat sat on the rug',
        tokensIn: 100,
        tokensOut: 250,
      },
    });
    appendRun(def.id, makeRun(def.id, 'run-a', { 'llm-1': stepA }));
    appendRun(def.id, makeRun(def.id, 'run-b', { 'llm-1': stepB }));

    renderCompare(def.id, 'run-a', 'run-b');

    // Both responses present.
    expect(screen.getByTestId('run-compare-llm-a-llm-1').textContent).toContain('mat');
    expect(screen.getByTestId('run-compare-llm-b-llm-1').textContent).toContain('rug');

    // Word-diff present and contains both an addition and a removal span.
    const diff = screen.getByTestId('llm-word-diff');
    expect(within(diff).getAllByText((_t, el) => el?.getAttribute('data-diff') === 'add').length).toBeGreaterThan(0);
    expect(within(diff).getAllByText((_t, el) => el?.getAttribute('data-diff') === 'del').length).toBeGreaterThan(0);
  });

  test('cost difference renders in the breadcrumb cost-delta indicator', () => {
    const def = createPipeline({ name: 'Cmp', createdBy: 'u1' });
    withLlmNode(def, 'llm-1');

    // Both runs use the same priced model so the formatter resolves to a real
    // dollar figure rather than "—". Run B uses ~10x the tokens.
    const stepA = makeStep('llm-1', {
      llm: { prompt: '', response: '', tokensIn: 1000, tokensOut: 1000 },
    });
    const stepB = makeStep('llm-1', {
      llm: { prompt: '', response: '', tokensIn: 10000, tokensOut: 10000 },
    });
    appendRun(def.id, makeRun(def.id, 'run-a', { 'llm-1': stepA }));
    appendRun(def.id, makeRun(def.id, 'run-b', { 'llm-1': stepB }));

    renderCompare(def.id, 'run-a', 'run-b');

    const costDelta = screen.getByTestId('run-compare-cost-delta');
    // Both sides should show a $-prefixed cost (or a 4-decimal small value),
    // and they must differ.
    const text = costDelta.textContent ?? '';
    expect(text).toMatch(/\$/);
    const parts = text.split('→').map((s) => s.trim());
    expect(parts).toHaveLength(2);
    expect(parts[0]).not.toBe(parts[1]);

    // Per-side cost cells also rendered.
    expect(screen.getByTestId('run-a-cost').textContent).toMatch(/\$/);
    expect(screen.getByTestId('run-b-cost').textContent).toMatch(/\$/);
  });
});
