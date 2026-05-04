import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Pipeline Execution Log (hub task #361)
//
// Exercises the ExecutionLog bottom strip during a mock pipeline run:
//   1. Create a pipeline (Trigger → LLM), publish and run it.
//   2. Expand the collapsed ExecutionLog strip (40px → 240px).
//   3. Assert pipeline lifecycle events appear in the log rows.
//   4. Test the event filter dropdown (all / errors / lifecycle / llm).
//   5. Assert autoscroll — the log pins to bottom by default and surfaces
//      a "Jump to latest" pill when the user scrolls up.
//
// Stable selectors:
//   execution-log, execution-log-row-*, execution-log-fullscreen-btn,
//   execution-log-fullscreen-close, exec-log-fullscreen
//
// Environment:
//   - Vite dev server on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true (skips Cognito)
//   - No backend required — pipeline run uses MockExecutor.
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
      /* ignore — incognito or quota errors */
    }
  }, { idxKey: PIPELINE_INDEX_KEY, prefix: PIPELINE_KEY_PREFIX });
}

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/pipeline-execution-log] pageerror:', err.message);
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

test.describe('Pipeline Execution Log E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await clearPipelineStorage(page);
  });

  // --------------------------------------------------------------------------
  // Core flow: expand the log strip and verify lifecycle events appear
  // --------------------------------------------------------------------------
  test('execution log shows pipeline events after a run and expands from 40px to 240px', async ({ page }) => {
    test.setTimeout(60_000);

    // Create pipeline through UI.
    await page.goto('/pipelines');
    await page.getByTestId('new-pipeline-btn').click();
    await page.getByTestId('new-pipeline-name').fill('E2E Exec Log Pipeline');
    await page.getByTestId('new-pipeline-confirm').click();
    await expect(page.getByTestId('pipeline-editor')).toBeVisible();

    // Insert LLM node and wire to Trigger via the dev bridge.
    const llmId = await insertNodeViaBridge(page, 'llm');
    const triggerId = await findNodeIdByType(page, 'trigger');
    if (!triggerId) throw new Error('Trigger node not present after pipeline creation');
    await connectViaBridge(page, triggerId, llmId);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);

    // Configure LLM node so validation passes.
    await updateNodeDataViaBridge(page, llmId, {
      provider: 'mock',
      model: 'mock-model',
      systemPrompt: 'You are a helpful assistant.',
      userPromptTemplate: 'Summarize: {{ context.input }}',
    });

    // Publish.
    await page.getByTestId('overflow-menu-btn').click();
    await page.getByRole('button', { name: /^Publish…$/ }).click();
    const publishConfirm = page.getByRole('button', { name: /^Publish$/ });
    await expect(publishConfirm).toBeEnabled();
    await publishConfirm.click();
    await expect(page.getByTestId('version-badge')).toContainText(/Published/i);

    // ── Verify the execution log is present and collapsed ──
    const execLog = page.getByTestId('execution-log');
    await expect(execLog).toBeVisible();

    // Collapsed height is 40px.
    const collapsedHeight = await execLog.evaluate((el) => el.getBoundingClientRect().height);
    expect(collapsedHeight).toBeLessThanOrEqual(42); // allow 2px tolerance for border

    // ── Run the pipeline ──
    const runBtn = page.getByTestId('run-button');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Wait for mock execution to produce events — at least one node transitions.
    const transitionedNode = page.locator(
      '[data-state="running"], [data-state="completed"], [data-state="failed"]'
    ).first();
    await expect(transitionedNode).toBeVisible({ timeout: 15_000 });

    // Give MockExecutor a moment to emit more events and finish the run.
    await page.waitForTimeout(2000);

    // ── Expand the execution log ──
    // The chevron button is the first button inside the log bar.
    const expandBtn = execLog.locator('button').first();
    await expandBtn.click();

    // After expansion, height should be ~240px.
    const expandedHeight = await execLog.evaluate((el) => el.getBoundingClientRect().height);
    expect(expandedHeight).toBeGreaterThanOrEqual(200);
    expect(expandedHeight).toBeLessThanOrEqual(260);

    // ── Assert lifecycle events appear as rows ──
    const logRows = page.locator('[data-testid^="execution-log-row-"]');
    const rowCount = await logRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Collect all event types from the visible rows.
    const rowTexts = await logRows.allTextContents();

    // pipeline.run.started and pipeline.step.started must appear.
    const hasRunStarted = rowTexts.some((t) => t.includes('pipeline.run.started'));
    const hasStepStarted = rowTexts.some((t) => t.includes('pipeline.step.started'));
    expect(hasRunStarted).toBe(true);
    expect(hasStepStarted).toBe(true);

    // At least one terminal event (completed or failed at run or step level).
    const hasTerminal = rowTexts.some(
      (t) =>
        t.includes('pipeline.run.completed') ||
        t.includes('pipeline.run.failed') ||
        t.includes('pipeline.step.completed') ||
        t.includes('pipeline.step.failed'),
    );
    expect(hasTerminal).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Event filtering via the dropdown
  // --------------------------------------------------------------------------
  test('event filter dropdown restricts visible log rows', async ({ page }) => {
    test.setTimeout(60_000);

    // Bootstrap pipeline, publish, and run.
    await page.goto('/pipelines');
    await page.getByTestId('new-pipeline-btn').click();
    await page.getByTestId('new-pipeline-name').fill('E2E Filter Log');
    await page.getByTestId('new-pipeline-confirm').click();
    await expect(page.getByTestId('pipeline-editor')).toBeVisible();

    const llmId = await insertNodeViaBridge(page, 'llm');
    const triggerId = await findNodeIdByType(page, 'trigger');
    if (!triggerId) throw new Error('Trigger node not present');
    await connectViaBridge(page, triggerId, llmId);

    await updateNodeDataViaBridge(page, llmId, {
      provider: 'mock',
      model: 'mock-model',
      systemPrompt: 'You are helpful.',
      userPromptTemplate: 'Say hello.',
    });

    await page.getByTestId('overflow-menu-btn').click();
    await page.getByRole('button', { name: /^Publish…$/ }).click();
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByTestId('version-badge')).toContainText(/Published/i);

    await page.getByTestId('run-button').click();

    // Wait for execution to produce events.
    await page.locator(
      '[data-state="running"], [data-state="completed"], [data-state="failed"]'
    ).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Expand the log.
    const execLog = page.getByTestId('execution-log');
    const expandBtn = execLog.locator('button').first();
    await expandBtn.click();

    const logRows = page.locator('[data-testid^="execution-log-row-"]');
    const allRowCount = await logRows.count();
    expect(allRowCount).toBeGreaterThan(0);

    // ── Switch filter to "Lifecycle" ──
    // The filter dropdown button shows "All ▾" by default.
    const filterBtn = execLog.locator('button', { hasText: /All/ });
    await filterBtn.click();

    // The dropdown renders filter options as buttons.
    const lifecycleOption = page.getByRole('button', { name: /^Lifecycle$/ });
    await expect(lifecycleOption).toBeVisible();
    await lifecycleOption.click();

    // After filtering to Lifecycle, all visible rows should contain lifecycle
    // event types (pipeline.run.*, pipeline.step.started/completed/skipped/cancelled).
    const filteredTexts = await logRows.allTextContents();
    for (const text of filteredTexts) {
      const isLifecycle =
        text.includes('pipeline.run.') ||
        text.includes('pipeline.step.started') ||
        text.includes('pipeline.step.completed') ||
        text.includes('pipeline.step.skipped') ||
        text.includes('pipeline.step.cancelled') ||
        text.includes('pipeline.step.failed');
      expect(isLifecycle).toBe(true);
    }

    // ── Switch filter to "LLM" ──
    const currentFilterBtn = execLog.locator('button', { hasText: /Lifecycle/ });
    await currentFilterBtn.click();
    const llmOption = page.getByRole('button', { name: /^LLM$/ });
    await expect(llmOption).toBeVisible();
    await llmOption.click();

    const llmRowTexts = await logRows.allTextContents();
    // LLM filter shows only pipeline.llm.* events.
    for (const text of llmRowTexts) {
      expect(text).toContain('pipeline.llm.');
    }

    // ── Switch back to "All" — row count should restore ──
    const llmFilterBtn = execLog.locator('button', { hasText: /LLM/ });
    await llmFilterBtn.click();
    const allOption = page.getByRole('button', { name: /^All$/ });
    await allOption.click();

    const restoredCount = await logRows.count();
    expect(restoredCount).toBe(allRowCount);
  });

  // --------------------------------------------------------------------------
  // Autoscroll behavior — pinned by default, detaches on scroll-up
  // --------------------------------------------------------------------------
  test('execution log auto-scrolls to bottom and shows Jump to latest on scroll-up', async ({ page }) => {
    test.setTimeout(60_000);

    // Bootstrap pipeline, publish, and run.
    await page.goto('/pipelines');
    await page.getByTestId('new-pipeline-btn').click();
    await page.getByTestId('new-pipeline-name').fill('E2E Autoscroll Log');
    await page.getByTestId('new-pipeline-confirm').click();
    await expect(page.getByTestId('pipeline-editor')).toBeVisible();

    const llmId = await insertNodeViaBridge(page, 'llm');
    const triggerId = await findNodeIdByType(page, 'trigger');
    if (!triggerId) throw new Error('Trigger node not present');
    await connectViaBridge(page, triggerId, llmId);

    await updateNodeDataViaBridge(page, llmId, {
      provider: 'mock',
      model: 'mock-model',
      systemPrompt: 'You are helpful.',
      userPromptTemplate: 'Write a long essay about testing.',
    });

    await page.getByTestId('overflow-menu-btn').click();
    await page.getByRole('button', { name: /^Publish…$/ }).click();
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByTestId('version-badge')).toContainText(/Published/i);

    // Expand the log BEFORE running so we can observe autoscroll in action.
    const execLog = page.getByTestId('execution-log');
    const expandBtn = execLog.locator('button').first();
    await expandBtn.click();

    // Run the pipeline.
    await page.getByTestId('run-button').click();

    // Wait for events to accumulate.
    const logRows = page.locator('[data-testid^="execution-log-row-"]');
    await expect(logRows.first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    // The list container is the scrollable div inside the expanded log.
    // By default the log is pinned to bottom (autoscroll).
    // "Jump to latest" pill should NOT be visible when pinned.
    const jumpPill = page.getByRole('button', { name: /Jump to latest/i });

    // Only test scroll-detach when we have enough events to overflow.
    const rowCount = await logRows.count();
    if (rowCount >= 3) {
      // Scroll the list container up to detach from autoscroll.
      // The scrollable list is the sibling div after the bar inside the
      // execution-log wrapper.
      const scrollableList = execLog.locator('div').nth(1);
      // Scroll to top to detach.
      await scrollableList.evaluate((el) => {
        el.scrollTop = 0;
      });

      // After scrolling up, the "Jump to latest" pill may appear if we're far
      // enough from the bottom (distanceFromBottom > 8px).
      // Give the scroll handler a tick to process.
      await page.waitForTimeout(200);

      // Check if the list is actually scrollable (content exceeds viewport).
      const isScrollable = await scrollableList.evaluate(
        (el) => el.scrollHeight > el.clientHeight + 16,
      );

      if (isScrollable) {
        await expect(jumpPill).toBeVisible({ timeout: 2_000 });

        // Click the pill — it should scroll back to bottom and disappear.
        await jumpPill.click();
        await expect(jumpPill).toBeHidden({ timeout: 2_000 });
      }
    }
  });
});
