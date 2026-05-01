import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /pipelines sub-routes
//
// Verifies that pipeline sub-pages mount without crashing. Backend is
// not running, so data fetches fail — we test the UI shell only.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — social-api calls will fail; we test UI shell only.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/pipelines-detail] pageerror:', err.message);
  });
}

test.describe('Pipelines sub-routes', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('/pipelines page mounts and shows content', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page).toHaveURL(/\/pipelines$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('/pipelines/approvals page mounts without crashing', async ({ page }) => {
    await page.goto('/pipelines/approvals');
    await expect(page).toHaveURL(/\/pipelines\/approvals$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('can navigate from pipelines to observability', async ({ page }) => {
    await page.goto('/pipelines');
    const obsBtn = page.getByRole('button', { name: /^Observability$/ });
    await obsBtn.click();
    await expect(page).toHaveURL(/\/observability$/);
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });
});
