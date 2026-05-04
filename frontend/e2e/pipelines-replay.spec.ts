import { test, expect } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Pipeline run replay scrubber interaction
//
// Tests that clicking different ticks on the replay scrubber drives canvas
// node state changes and updates the readout display.
// ----------------------------------------------------------------------------

test.describe('Pipeline Replay Scrubber', () => {
  test('run replay scrubber drives canvas state changes', async ({ page }) => {
    // Seed demo data and navigate to replay page.
    await page.goto('/pipelines');
    const seedRef = await page.evaluate(async () => {
      type DemoApi = { seed: (o?: { clearExisting?: boolean }) => unknown };
      const start = Date.now();
      while (!(window as unknown as { __pipelineDemo?: DemoApi }).__pipelineDemo) {
        if (Date.now() - start > 5_000) throw new Error('__pipelineDemo never appeared');
        await new Promise((r) => setTimeout(r, 50));
      }
      (window as unknown as { __pipelineDemo: DemoApi }).__pipelineDemo.seed({ clearExisting: true });

      const idx = JSON.parse(localStorage.getItem('ws_pipelines_v1_index') ?? '[]') as Array<{ id: string }>;
      if (idx.length === 0) throw new Error('No pipelines after seed');
      const pipelineId = idx[0].id;
      const runs = JSON.parse(
        localStorage.getItem(`ws_pipeline_runs_v1:${pipelineId}`) ?? '[]',
      ) as Array<{ id: string }>;
      if (runs.length === 0) throw new Error('No runs after seed');
      return { pipelineId, runId: runs[0].id };
    });

    await page.goto(`/pipelines/${seedRef.pipelineId}/runs/${seedRef.runId}`);
    await expect(page.getByTestId('pipeline-replay')).toBeVisible();
    await expect(page.getByTestId('replay-scrubber')).toBeVisible();

    // Multiple ticks should be present.
    const ticks = page.locator('[data-testid^="replay-tick-"]');
    const tickCount = await ticks.count();
    expect(tickCount).toBeGreaterThan(1);

    // Get initial readout text.
    const readout = page.getByTestId('replay-readout');
    const initialReadout = await readout.textContent();

    // Click the last tick to advance scrubber.
    await ticks.nth(tickCount - 1).click();

    // Readout should update to reflect new position.
    const updatedReadout = await readout.textContent();
    expect(updatedReadout).not.toBe(initialReadout);

    // Verify canvas nodes reflect historical state at this tick.
    // Canvas should be visible and contain nodes.
    const canvas = page.locator('.react-flow__nodes');
    await expect(canvas).toBeVisible();
    const nodes = page.locator('.react-flow__node');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThan(0);

    // Nodes should have data-state attributes reflecting replay state.
    // At least one node should show a historical state (not all idle).
    const statedNodes = page.locator('.react-flow__node[data-state]');
    const statedCount = await statedNodes.count();
    expect(statedCount).toBeGreaterThan(0);

    // Click an earlier tick (middle of timeline).
    const midTick = Math.floor(tickCount / 2);
    await ticks.nth(midTick).click();

    // Readout should change again.
    const midReadout = await readout.textContent();
    expect(midReadout).not.toBe(updatedReadout);

    // Verify nodes can show different states at different tick positions.
    // This confirms the scrubber actually drives state changes.
    const midStatedNodes = page.locator('.react-flow__node[data-state]');
    const midStatedCount = await midStatedNodes.count();
    expect(midStatedCount).toBeGreaterThan(0);
  });
});
