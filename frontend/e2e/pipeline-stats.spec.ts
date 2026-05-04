import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Pipeline stats page (hub task #367)
//
// Seeds demo data via window.__pipelineDemo.seed(), navigates to the stats
// page for the first pipeline, and asserts the KPI cards, charts, and
// metrics containers render correctly.
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
    console.warn('[e2e/pipeline-stats] pageerror:', err.message);
  });
}

test.describe('Pipeline Stats E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await clearPipelineStorage(page);
  });

  test('stats page renders KPIs and charts with seeded data', async ({ page }) => {
    // Navigate to /pipelines and seed demo data.
    await page.goto('/pipelines');

    const pipelineId = await page.evaluate(async () => {
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
      return idx[0].id;
    });

    // Navigate to the stats page.
    await page.goto(`/pipelines/${pipelineId}/stats`);

    // Assert the page heading renders ("Execution stats").
    await expect(page.getByText('Execution stats')).toBeVisible();

    // Assert the range selector is visible.
    await expect(page.getByTestId('stats-range')).toBeVisible();

    // Assert the KPI row renders with key metrics.
    const kpis = page.getByTestId('stats-kpis');
    await expect(kpis).toBeVisible();

    // Assert success rate metric is visible and contains numeric content.
    const successRate = page.getByTestId('stats-success-rate');
    await expect(successRate).toBeVisible();
    const successText = await successRate.textContent();
    expect(successText).toBeTruthy();
    // Should contain a fraction like "12/15" and a percentage like "(80%)".
    expect(successText).toMatch(/\d+\/\d+/);
    expect(successText).toMatch(/\d+%/);

    // Assert KPI cards contain expected labels.
    await expect(kpis.getByText('Success rate')).toBeVisible();
    await expect(kpis.getByText('Median duration')).toBeVisible();
    await expect(kpis.getByText('Total tokens')).toBeVisible();
    await expect(kpis.getByText('Total cost')).toBeVisible();

    // Assert chart containers render.
    const costRow = page.getByTestId('stats-cost-row');
    await expect(costRow).toBeVisible();

    // Assert cost-by-node chart card is present.
    await expect(page.getByTestId('stats-cost-by-node')).toBeVisible();

    // Assert 30-day cost trend chart card is present.
    await expect(page.getByTestId('stats-cost-trend-30d')).toBeVisible();

    // Assert failure breakdown section is present.
    await expect(page.getByTestId('stats-failure-breakdown')).toBeVisible();

    // Assert chart titles render (cumulative runs, duration, token usage).
    await expect(page.getByText('Runs over time (cumulative)')).toBeVisible();
    await expect(page.getByText('Duration over time')).toBeVisible();
    await expect(page.getByText('Token usage over time')).toBeVisible();
  });

  test('stats page range selector filters displayed data', async ({ page }) => {
    // Seed and navigate.
    await page.goto('/pipelines');

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

    await page.goto(`/pipelines/${pipelineId}/stats`);
    await expect(page.getByText('Execution stats')).toBeVisible();

    // Capture the success rate text at the default range (Last 50).
    const successRate = page.getByTestId('stats-success-rate');
    await expect(successRate).toBeVisible();
    const initialText = await successRate.textContent();

    // Switch to "Last 10" range.
    const rangeSelector = page.getByTestId('stats-range');
    await rangeSelector.getByText('Last 10').click();

    // Success rate should still be visible (page re-renders with new range).
    await expect(successRate).toBeVisible();
    const filteredText = await successRate.textContent();
    expect(filteredText).toBeTruthy();
    // The total count in filtered view should be <= 10.
    const countMatch = filteredText?.match(/(\d+)\/(\d+)/);
    if (countMatch) {
      const total = parseInt(countMatch[2], 10);
      expect(total).toBeLessThanOrEqual(10);
    }

    // Switch to "All" range.
    await rangeSelector.getByText('All').click();
    await expect(successRate).toBeVisible();
    const allText = await successRate.textContent();
    expect(allText).toBeTruthy();
    // "All" should show at least as many runs as "Last 10".
    const allMatch = allText?.match(/(\d+)\/(\d+)/);
    if (allMatch && countMatch) {
      const allTotal = parseInt(allMatch[2], 10);
      const filteredTotal = parseInt(countMatch[2], 10);
      expect(allTotal).toBeGreaterThanOrEqual(filteredTotal);
    }
  });

  test('stats page shows empty state for pipeline with no runs', async ({ page }) => {
    // Create a fresh pipeline (no runs) and navigate to its stats page.
    await page.goto('/pipelines');
    await page.getByTestId('new-pipeline-btn').click();
    await page.getByTestId('new-pipeline-name').fill('E2E Empty Stats Pipeline');
    await page.getByTestId('new-pipeline-confirm').click();
    await expect(page.getByTestId('pipeline-editor')).toBeVisible();

    // Extract pipeline ID from URL.
    const url = page.url();
    const match = url.match(/\/pipelines\/([^/]+)$/);
    if (!match) throw new Error('Could not extract pipeline ID from URL');
    const pipelineId = match[1];

    // Navigate to stats page for this pipeline.
    await page.goto(`/pipelines/${pipelineId}/stats`);

    // Should show empty state since there are no runs.
    await expect(page.getByText('No runs yet')).toBeVisible();
  });
});
