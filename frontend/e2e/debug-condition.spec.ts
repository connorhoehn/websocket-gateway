import { test, expect, type Page } from '@playwright/test';
const PIPELINE_INDEX_KEY = 'ws_pipelines_v1_index';
const PIPELINE_KEY_PREFIX = 'ws_pipelines_v1:';
async function clearPipelineStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(({ idxKey, prefix }) => {
    try {
      const remove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k) continue; if (k === idxKey || k.startsWith(prefix)) remove.push(k); }
      remove.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }, { idxKey: PIPELINE_INDEX_KEY, prefix: PIPELINE_KEY_PREFIX });
}
async function insertNodeViaBridge(page: Page, nodeType: string): Promise<string> {
  await page.waitForFunction(() => Boolean((window as any).__pipelineEditor));
  return page.evaluate((type) => (window as any).__pipelineEditor.insertNode(type), nodeType);
}
async function connectViaBridge(page: Page, s: string, t: string, opts?: Record<string,string>): Promise<string> {
  return page.evaluate(({ s, t, o }) => (window as any).__pipelineEditor.connect(s, t, o), { s, t, o: opts });
}
async function findNodeIdByType(page: Page, nodeType: string): Promise<string | undefined> {
  return page.evaluate((type) => (window as any).__pipelineEditor.findNodeIdByType(type), nodeType);
}
async function updateNodeDataViaBridge(page: Page, nodeId: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ id, p }) => (window as any).__pipelineEditor.updateNodeData(id, p), { id: nodeId, p: patch });
}
test('debug condition validation with correct handles', async ({ page }) => {
  page.on('pageerror', (err) => { if (/WebSocket|fetch|NetworkError/i.test(err.message)) return; });
  await clearPipelineStorage(page);
  await page.goto('/pipelines');
  await page.getByTestId('new-pipeline-btn').click();
  await page.getByTestId('new-pipeline-name').fill('Debug Condition 2');
  await page.getByTestId('new-pipeline-confirm').click();
  await expect(page.getByTestId('pipeline-editor')).toBeVisible();
  const triggerId = await findNodeIdByType(page, 'trigger');
  const conditionId = await insertNodeViaBridge(page, 'condition');
  const llmId = await insertNodeViaBridge(page, 'llm');
  await connectViaBridge(page, triggerId!, conditionId);
  // Use 'true' handle for condition -> llm
  await connectViaBridge(page, conditionId, llmId, { sourceHandle: 'true' });
  await updateNodeDataViaBridge(page, conditionId, { type: 'condition', expression: 'true' });
  await updateNodeDataViaBridge(page, llmId, { type: 'llm', provider: 'anthropic', model: 'claude-sonnet-4-6', systemPrompt: 'Test', userPromptTemplate: 'Test: {{ context.input }}', streaming: true });
  await page.waitForTimeout(1000);
  const indicatorText = await page.getByTestId('validation-indicator').textContent().catch(() => 'not found');
  console.log('INDICATOR:', indicatorText);
  // Try publish
  await page.getByTestId('overflow-menu-btn').click();
  await page.getByRole('button', { name: /^Publish…$/ }).click();
  const btn = page.getByRole('button', { name: /^Publish$/ });
  const disabled = await btn.isDisabled();
  console.log('PUBLISH DISABLED:', disabled);
});
