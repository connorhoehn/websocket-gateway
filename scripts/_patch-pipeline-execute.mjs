#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/snapshot-journeys.mjs';
let content = readFileSync(path, 'utf8');
let changes = 0;

function replace(old, nw, label) {
  if (!content.includes(old)) {
    console.error(`MISS: "${label}" — old string not found`);
    return;
  }
  content = content.replace(old, nw);
  changes++;
  console.log(`OK: ${label}`);
}

// ── 1. Replace Phase 4 (keyboard shortcut node adds) with dev-bridge inserts ──
//    Instead of shortcuts that overlap, use the dev bridge to place nodes at
//    explicit positions, connect them with edges, then auto-arrange for DAG layout.

replace(
  `      // --- Phase 4: Add nodes via keyboard shortcuts ---
      await step('add-llm-node-via-shortcut', 'Press keyboard shortcut 2 to add an LLM node', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('2');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-transform-node', 'Press 3 to add a Transform node', async () => {
        await page.keyboard.press('3');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-condition-node', 'Press 4 to add a Condition node', async () => {
        await page.keyboard.press('4');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-action-node', 'Press 7 to add an Action node', async () => {
        await page.keyboard.press('7');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });

      // --- Phase 5: Auto-arrange and config panel ---
      await step('auto-arrange-nodes', 'Click auto-arrange to organize the nodes on the canvas', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(500);
      });`,

  `      // --- Phase 4: Build a connected pipeline via dev bridge ---
      await step('build-connected-pipeline', 'Use the dev bridge to insert LLM, Transform, Condition, and Action nodes at explicit positions', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const bridge = window.__pipelineEditor;
          if (!bridge) return;
          const triggerId = bridge.findNodeIdByType('trigger');
          const llmId = bridge.insertNode('llm', { x: 360, y: 120 });
          const transformId = bridge.insertNode('transform', { x: 640, y: 120 });
          const conditionId = bridge.insertNode('condition', { x: 920, y: 120 });
          const actionOk = bridge.insertNode('action', { x: 1200, y: 40 });
          const actionFail = bridge.insertNode('action', { x: 1200, y: 220 });
          // Connect: trigger → llm → transform → condition → action (ok/fail)
          if (triggerId) bridge.connect(triggerId, llmId);
          bridge.connect(llmId, transformId);
          bridge.connect(transformId, conditionId);
          bridge.connect(conditionId, actionOk, { sourceHandle: 'true' });
          bridge.connect(conditionId, actionFail, { sourceHandle: 'false' });
          // Label the action nodes
          bridge.updateNodeData(actionOk, { label: 'Publish Results' });
          bridge.updateNodeData(actionFail, { label: 'Send Alert' });
          bridge.updateNodeData(llmId, { label: 'Analyze Content' });
          bridge.updateNodeData(transformId, { label: 'Format Output' });
          bridge.updateNodeData(conditionId, { label: 'Quality Check' });
        });
        await page.waitForTimeout(800);
      });

      await step('see-connected-nodes', 'See all five nodes with edges connecting them in a proper DAG', async () => {
        await page.waitForTimeout(400);
      });

      // --- Phase 5: Auto-arrange and config panel ---
      await step('auto-arrange-nodes', 'Click auto-arrange to lay out nodes in clean columns', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(600);
        // Fit view to show the full pipeline
        const fitBtn = await page.$('button[title="Fit view"], button[aria-label="Fit view"]');
        if (fitBtn) { await fitBtn.click(); await page.waitForTimeout(500); }
      });

      await step('see-dag-layout', 'See the auto-arranged DAG: trigger → LLM → transform → condition → actions', async () => {
        await page.waitForTimeout(500);
      });`,

  'J5: replace keyboard shortcuts with dev bridge connected pipeline'
);


// ── 2. After "close-versions" step, add: Publish → Run → See execution ──

replace(
  `      // Capture pipeline ID for runs/stats pages
      const pipelineUrl = page.url();
      const pipelineId = pipelineUrl.split('/pipelines/')[1]?.split(/[?#/]/)[0] ?? 'unknown';`,

  `      // --- Phase 8b: Publish and execute the pipeline ---
      await step('publish-pipeline', 'Publish the pipeline via the overflow menu', async () => {
        await clickIfExists(page, '[data-testid="overflow-menu-btn"]');
        await page.waitForTimeout(400);
        const publishItem = await page.$('button:has-text("Publish")');
        if (publishItem) {
          await publishItem.click();
          await page.waitForTimeout(400);
          // Confirm in the publish modal
          const confirmBtn = await page.$('button:has-text("Publish")');
          if (confirmBtn) await confirmBtn.click();
          await page.waitForTimeout(600);
        }
      });

      await step('see-published-badge', 'See the version badge update to "Published"', async () => {
        await page.waitForTimeout(400);
      });

      await step('click-run-button', 'Click the Run button to execute the pipeline', async () => {
        const runBtn = await page.$('[data-testid="run-button"]');
        if (runBtn) {
          await runBtn.click();
          await page.waitForTimeout(2_000);
        }
      });

      await step('see-execution-running', 'See the execution log updating with step events', async () => {
        await page.waitForTimeout(1_500);
      });

      await step('wait-for-execution-complete', 'Wait for the pipeline execution to finish', async () => {
        // Wait up to 10s for completion events
        for (let i = 0; i < 10; i++) {
          const logText = await page.textContent('[data-testid="execution-log"]').catch(() => '');
          if (/completed|failed/i.test(logText ?? '')) break;
          await page.waitForTimeout(1_000);
        }
        await page.waitForTimeout(500);
      });

      await step('see-execution-results', 'See the completed execution log with step results and edge highlights', async () => {
        // Expand the log if collapsed
        const toggle = await page.$('[data-testid="execution-log-toggle"], [data-testid="exec-log-chevron"]');
        if (toggle) { await toggle.click(); await page.waitForTimeout(300); }
        await page.waitForTimeout(500);
      });

      await step('see-node-success-states', 'See nodes highlighted green for success on the canvas', async () => {
        await page.waitForTimeout(400);
      });

      // Capture pipeline ID for runs/stats pages
      const pipelineUrl = page.url();
      const pipelineId = pipelineUrl.split('/pipelines/')[1]?.split(/[?#/]/)[0] ?? 'unknown';`,

  'J5: add publish + execute + verify steps'
);


// ── 3. Do the same for the second pipeline: connect, arrange, publish, run ──

replace(
  `      // --- Phase 12: Add 6 node types to second pipeline ---
      await step('add-llm-to-second', 'Add an LLM node via shortcut 2', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('2');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-transform-to-second', 'Add a Transform node via shortcut 3', async () => {
        await page.keyboard.press('3');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-fork-to-second', 'Add a Fork node via shortcut 5', async () => {
        await page.keyboard.press('5');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-join-to-second', 'Add a Join node via shortcut 6', async () => {
        await page.keyboard.press('6');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-approval-to-second', 'Add an Approval node via shortcut 8', async () => {
        await page.keyboard.press('8');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('auto-arrange-second', 'Auto-arrange the second pipeline nodes', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(500);
      });`,

  `      // --- Phase 12: Build connected second pipeline via dev bridge ---
      await step('build-second-pipeline', 'Insert and connect nodes for a data ingestion pipeline', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const bridge = window.__pipelineEditor;
          if (!bridge) return;
          const triggerId = bridge.findNodeIdByType('trigger');
          const llmId = bridge.insertNode('llm', { x: 360, y: 120 });
          const forkId = bridge.insertNode('fork', { x: 640, y: 120 });
          const transformA = bridge.insertNode('transform', { x: 920, y: 40 });
          const transformB = bridge.insertNode('transform', { x: 920, y: 220 });
          const joinId = bridge.insertNode('join', { x: 1200, y: 120 });
          const approvalId = bridge.insertNode('approval', { x: 1480, y: 120 });
          const actionId = bridge.insertNode('action', { x: 1760, y: 120 });
          // Connect: trigger → llm → fork → [transformA, transformB] → join → approval → action
          if (triggerId) bridge.connect(triggerId, llmId);
          bridge.connect(llmId, forkId);
          bridge.connect(forkId, transformA, { sourceHandle: 'branch-0' });
          bridge.connect(forkId, transformB, { sourceHandle: 'branch-1' });
          bridge.connect(transformA, joinId);
          bridge.connect(transformB, joinId);
          bridge.connect(joinId, approvalId);
          bridge.connect(approvalId, actionId, { sourceHandle: 'approved' });
          // Label nodes
          bridge.updateNodeData(llmId, { label: 'Parse Input' });
          bridge.updateNodeData(transformA, { label: 'Validate Schema' });
          bridge.updateNodeData(transformB, { label: 'Enrich Metadata' });
          bridge.updateNodeData(approvalId, { label: 'Review Gate' });
          bridge.updateNodeData(actionId, { label: 'Write to Store' });
        });
        await page.waitForTimeout(800);
      });

      await step('auto-arrange-second', 'Auto-arrange to show the fork/join DAG layout', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(600);
        const fitBtn = await page.$('button[title="Fit view"], button[aria-label="Fit view"]');
        if (fitBtn) { await fitBtn.click(); await page.waitForTimeout(500); }
      });

      await step('see-second-pipeline-dag', 'See the data ingestion pipeline with fork/join branches', async () => {
        await page.waitForTimeout(500);
      });`,

  'J5: replace second pipeline shortcuts with dev bridge connected DAG'
);

// ── 4. Update the filter steps for the new dropdown UI ──

replace(
  `      await step('click-status-chip-completed', 'Click the completed status filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-completed"]');
        await page.waitForTimeout(200);
      });
      await step('click-status-chip-failed', 'Click the failed status filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-failed"]');
        await page.waitForTimeout(200);
      });
      await step('click-trigger-chip-manual', 'Click the manual trigger type filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-trigger-chip-manual"]');
        await page.waitForTimeout(200);
      });`,

  `      await step('open-status-dropdown', 'Open the Status filter dropdown and select Completed + Failed', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-dropdown"]');
        await page.waitForTimeout(300);
        await clickIfExists(page, '[data-testid="runs-status-chip-completed"]');
        await page.waitForTimeout(150);
        await clickIfExists(page, '[data-testid="runs-status-chip-failed"]');
        await page.waitForTimeout(300);
      });
      await step('open-trigger-dropdown', 'Open the Trigger filter dropdown and select Manual', async () => {
        await clickIfExists(page, '[data-testid="runs-trigger-chip-dropdown"]');
        await page.waitForTimeout(300);
        await clickIfExists(page, '[data-testid="runs-trigger-chip-manual"]');
        await page.waitForTimeout(300);
      });`,

  'J5: update filter steps for dropdown UI'
);


writeFileSync(path, content, 'utf8');
console.log(`\nDone — ${changes} replacements applied. Lines: ${content.split('\n').length}`);
