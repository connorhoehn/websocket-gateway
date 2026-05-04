import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Pipeline runs page (/pipelines/:id/runs)
//
// Hub task #360 — verify that completed runs appear on the runs list page
// with correct status, metadata, and that the count increments after
// subsequent runs.
//
// Environment:
//   - Vite dev server on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true (skips Cognito)
//   - No backend required — pipeline run uses MockExecutor.
// ----------------------------------------------------------------------------

const PIPELINE_INDEX_KEY = 'ws_pipelines_v1_index';
const PIPELINE_KEY_PREFIX = 'ws_pipelines_v1:';
const RUN_KEY_PREFIX = 'ws_pipeline_runs_v1:';

// ---------------------------------------------------------------------------
// Helpers (copied from pipelines.spec.ts — not exported there)
// ---------------------------------------------------------------------------

async function clearPipelineStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(({ idxKey, prefix, runPrefix }) => {
    try {
      const remove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === idxKey || k.startsWith(prefix) || k.startsWith(runPrefix)) {
          remove.push(k);
        }
      }
      remove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore — incognito or quota errors */
    }
  }, { idxKey: PIPELINE_INDEX_KEY, prefix: PIPELINE_KEY_PREFIX, runPrefix: RUN_KEY_PREFIX });
}

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/pipeline-runs-page] pageerror:', err.message);
  });
}

async function insertNodeViaBridge(page: Page, nodeType: string): Promise<string> {
  await page.waitForFunction(() => Boolean((window as unknown as { __pipelineEditor?: unknown }).__pipelineEditor));
  return page.evaluate((type) => {
    const bridge = (window as unknown as {
      __pipelineEditor: { insertNode: (t: string) => string };
    }).__pipelineEditor;
    return bridge.insertNode(type);
  }, nodeType);
}

async function connectViaBridge(page: Page, sourceId: string, targetId: string): Promise<string> {
  return page.evaluate(
    ({ s, t }) => {
      const bridge = (window as unknown as {
        __pipelineEditor: { connect: (s: string, t: string) => string };
      }).__pipelineEditor;
      return bridge.connect(s, t);
    },
    { s: sourceId, t: targetId },
  );
}

async function findNodeIdByType(page: Page, nodeType: string): Promise<string | undefined> {
  return page.evaluate((type) => {
    const bridge = (window as unknown as {
      __pipelineEditor: { findNodeIdByType: (t: string) => string | undefined };
    }).__pipelineEditor;
    return bridge.findNodeIdByType(type);
  }, nodeType);
}

async function updateNodeDataViaBridge(
  page: Page,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ id, p }) => {
      const bridge = (window as unknown as {
        __pipelineEditor: { updateNodeData: (id: string, patch: Record<string, unknown>) => void };
      }).__pipelineEditor;
      bridge.updateNodeData(id, p);
    },
    { id: nodeId, p: patch },
  );
}

// ---------------------------------------------------------------------------
// Shared: create pipeline, add Trigger -> LLM, configure, publish, return ID
// ---------------------------------------------------------------------------

async function createAndPublishPipeline(page: Page, name: string): Promise<string> {
  await page.goto('/pipelines');
  await page.getByTestId('new-pipeline-btn').click();
  await page.getByTestId('new-pipeline-name').fill(name);
  await page.getByTestId('new-pipeline-confirm').click();
  await expect(page.getByTestId('pipeline-editor')).toBeVisible();

  // Insert LLM node and wire to Trigger.
  const llmId = await insertNodeViaBridge(page, 'llm');
  const triggerId = await findNodeIdByType(page, 'trigger');
  if (!triggerId) throw new Error('Trigger node not present after pipeline creation');
  await connectViaBridge(page, triggerId, llmId);

  // Configure LLM node so it passes validation.
  await updateNodeDataViaBridge(page, llmId, {
    provider: 'mock',
    model: 'mock-model',
    systemPrompt: 'You are helpful.',
    userPromptTemplate: 'Say hello.',
  });

  // Publish.
  await page.getByTestId('overflow-menu-btn').click();
  const publishMenuItem = page.getByRole('button', { name: /^Publish…$/ });
  await publishMenuItem.click();
  const publishConfirm = page.getByRole('button', { name: /^Publish$/ });
  await publishConfirm.click();
  await expect(page.getByTestId('version-badge')).toContainText(/Published/i);

  // Extract pipeline ID from the URL.
  const url = page.url();
  const match = url.match(/\/pipelines\/([^/]+)$/);
  if (!match) throw new Error(`Could not extract pipeline ID from URL: ${url}`);
  return match[1];
}

/**
 * Click Run and wait for the MockExecutor to drive the pipeline to a terminal
 * state. Returns once at least one node reaches completed/failed.
 */
async function runPipelineToCompletion(page: Page): Promise<void> {
  const runBtn = page.getByTestId('run-button');
  await expect(runBtn).toBeEnabled();
  await runBtn.click();

  // Wait for at least one node to reach a terminal state.
  const completedNode = page.locator(
    '[data-state="completed"], [data-state="failed"]',
  ).first();
  await expect(completedNode).toBeVisible({ timeout: 15_000 });

  // Allow a moment for the run to fully persist to localStorage (runHistory
  // appends on the pipeline.completed / pipeline.failed event, which fires
  // asynchronously after the last node transition).
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Pipeline Runs Page E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await clearPipelineStorage(page);
  });

  test('completed run appears on /pipelines/:id/runs with status and metadata', async ({ page }) => {
    test.setTimeout(60_000);

    // 1-3. Create pipeline, add Trigger -> LLM, configure, publish.
    const pipelineId = await createAndPublishPipeline(page, 'E2E Runs Page');

    // 4. Run the pipeline and wait for completion.
    await runPipelineToCompletion(page);

    // 5. Navigate to /pipelines/{pipelineId}/runs.
    await page.goto(`/pipelines/${pipelineId}/runs`);

    // 6. Assert the runs page mounts.
    await expect(page.getByTestId('pipeline-runs-page')).toBeVisible();

    // 7. Assert at least one run appears in the list.
    const runCards = page.locator('[data-testid^="run-card-"]');
    await expect(runCards.first()).toBeVisible({ timeout: 5_000 });
    const initialCount = await runCards.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 8. Assert run status shows completed (or failed — MockExecutor may vary).
    const firstRun = runCards.first();
    await expect(firstRun).toContainText(/Completed|Failed/i);

    // 9. Assert run metadata is visible: timestamp and duration.
    const runText = await firstRun.textContent();
    if (!runText) throw new Error('Run card has no text content');

    // Timestamp — relativeTime() renders "just now", "Xm ago", "Xh ago", or a
    // locale date string (e.g. "5/4/2026").
    const hasTimestamp = /\d{4}-\d{2}-\d{2}|ago|just now|\d{1,2}\/\d{1,2}\/\d{4}/i.test(runText);
    expect(hasTimestamp).toBe(true);

    // Duration — formatDuration() renders "Xms", "X.Xs", or "Xm Xs".
    const hasDuration = /\d+ms|\d+\.\d+s|\d+m\s+\d+s/i.test(runText);
    expect(hasDuration).toBe(true);
  });

  test('second run increments the run count on the runs page', async ({ page }) => {
    test.setTimeout(90_000);

    // Create and publish a pipeline.
    const pipelineId = await createAndPublishPipeline(page, 'E2E Runs Count');

    // First run.
    await runPipelineToCompletion(page);

    // Navigate to runs page and record initial count.
    await page.goto(`/pipelines/${pipelineId}/runs`);
    await expect(page.getByTestId('pipeline-runs-page')).toBeVisible();
    const runCards = page.locator('[data-testid^="run-card-"]');
    await expect(runCards.first()).toBeVisible({ timeout: 5_000 });
    const countAfterFirstRun = await runCards.count();
    expect(countAfterFirstRun).toBeGreaterThanOrEqual(1);

    // Navigate back to the editor to run a second time.
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.getByTestId('pipeline-editor')).toBeVisible();

    // Second run.
    await runPipelineToCompletion(page);

    // Navigate back to runs page and assert count increased.
    await page.goto(`/pipelines/${pipelineId}/runs`);
    await expect(page.getByTestId('pipeline-runs-page')).toBeVisible();
    await expect(runCards.first()).toBeVisible({ timeout: 5_000 });

    // The run list should now contain one more run than before.
    const countAfterSecondRun = await runCards.count();
    expect(countAfterSecondRun).toBeGreaterThan(countAfterFirstRun);

    // Verify both runs have status chips.
    for (let i = 0; i < countAfterSecondRun; i++) {
      await expect(runCards.nth(i)).toContainText(/Completed|Failed|Running/i);
    }

    // The header summary should reflect the total persisted count.
    const headerText = await page.locator('text=/\\d+ runs? persisted/').textContent();
    if (headerText) {
      const persistedCount = parseInt(headerText.match(/(\d+)/)?.[1] ?? '0', 10);
      expect(persistedCount).toBeGreaterThanOrEqual(countAfterSecondRun);
    }
  });
});
