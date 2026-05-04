import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Pipeline run comparison page (hub task #366)
//
// Seeds demo data via window.__pipelineDemo.seed(), grabs a pipelineId and
// two runIds from localStorage, navigates to the compare route, and asserts
// the comparison page renders with the expected testids (run-compare,
// run-compare-table, run-compare-row-*, run-compare-cost-delta).
// ----------------------------------------------------------------------------

const PIPELINE_INDEX_KEY = 'ws_pipelines_v1_index';
const PIPELINE_KEY_PREFIX = 'ws_pipelines_v1:';

async function clearPipelineStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(({ idxKey, prefix }) => {
    try {
      const remove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === idxKey || k.startsWith(prefix)) remove.push(k);
      }
      remove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }, { idxKey: PIPELINE_INDEX_KEY, prefix: PIPELINE_KEY_PREFIX });
}

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/pipeline-compare] pageerror:', err.message);
  });
}

test.describe('Pipeline Run Compare E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await clearPipelineStorage(page);
  });

  test('compare page renders with seeded run data', async ({ page }) => {
    // Navigate to /pipelines to ensure origin context and seed demo data.
    await page.goto('/pipelines');

    const seedRef = await page.evaluate(async () => {
      type DemoApi = { seed: (o?: { clearExisting?: boolean }) => unknown };
      const start = Date.now();
      while (!(window as unknown as { __pipelineDemo?: DemoApi }).__pipelineDemo) {
        if (Date.now() - start > 5_000) throw new Error('__pipelineDemo never appeared');
        await new Promise((r) => setTimeout(r, 50));
      }
      (window as unknown as { __pipelineDemo: DemoApi }).__pipelineDemo.seed({ clearExisting: true });

      // Read first pipeline from localStorage.
      const idx = JSON.parse(localStorage.getItem('ws_pipelines_v1_index') ?? '[]') as Array<{ id: string }>;
      if (idx.length === 0) throw new Error('No pipelines after seed');
      const pipelineId = idx[0].id;

      // Read runs for this pipeline.
      const runs = JSON.parse(
        localStorage.getItem(`ws_pipeline_runs_v1:${pipelineId}`) ?? '[]',
      ) as Array<{ id: string }>;
      if (runs.length < 2) throw new Error(`Need at least 2 runs for compare, got ${runs.length}`);

      return {
        pipelineId,
        runIdA: runs[0].id,
        runIdB: runs[1].id,
      };
    });

    // Navigate to the compare page.
    await page.goto(
      `/pipelines/${seedRef.pipelineId}/runs/compare/${seedRef.runIdA}/${seedRef.runIdB}`,
    );

    // Assert the comparison page mounts.
    const comparePage = page.getByTestId('run-compare');
    await expect(comparePage).toBeVisible();

    // Assert the comparison table renders.
    const compareTable = page.getByTestId('run-compare-table');
    await expect(compareTable).toBeVisible();

    // Assert at least one comparison row exists.
    const compareRows = page.locator('[data-testid^="run-compare-row-"]');
    await expect(compareRows.first()).toBeVisible();
    const rowCount = await compareRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Assert the cost delta element is visible.
    const costDelta = page.getByTestId('run-compare-cost-delta');
    await expect(costDelta).toBeVisible();
    // Cost delta should contain dollar sign or dash (non-empty content).
    const costText = await costDelta.textContent();
    expect(costText).toBeTruthy();

    // Assert run summary cards for both runs.
    await expect(page.getByTestId('run-a-summary')).toBeVisible();
    await expect(page.getByTestId('run-b-summary')).toBeVisible();

    // Assert the delta summary strip is present.
    await expect(page.getByTestId('run-compare-delta')).toBeVisible();
  });

  test('compare page shows empty state for missing runs', async ({ page }) => {
    // Navigate directly to a compare URL with nonexistent IDs.
    await page.goto('/pipelines');

    // Seed to get a valid pipelineId.
    const pipelineId = await page.evaluate(async () => {
      type DemoApi = { seed: (o?: { clearExisting?: boolean }) => unknown };
      const start = Date.now();
      while (!(window as unknown as { __pipelineDemo?: DemoApi }).__pipelineDemo) {
        if (Date.now() - start > 5_000) throw new Error('__pipelineDemo never appeared');
        await new Promise((r) => setTimeout(r, 50));
      }
      (window as unknown as { __pipelineDemo: DemoApi }).__pipelineDemo.seed({ clearExisting: true });
      const idx = JSON.parse(localStorage.getItem('ws_pipelines_v1_index') ?? '[]') as Array<{ id: string }>;
      if (idx.length === 0) throw new Error('No pipelines after seed');
      return idx[0].id;
    });

    // Navigate with fabricated run IDs that do not exist.
    await page.goto(
      `/pipelines/${pipelineId}/runs/compare/nonexistent-run-aaa/nonexistent-run-bbb`,
    );

    // Should show the "missing runs" empty state.
    const missingState = page.getByTestId('run-compare-missing');
    await expect(missingState).toBeVisible();
  });
});
