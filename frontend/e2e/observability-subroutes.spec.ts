import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /observability sub-routes (nodes, events, metrics)
//
// Verifies that observability sub-pages mount. Backend is not running,
// so WebSocket/metric data will be empty — we test the UI shell only.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — ws + http calls will fail; we test UI shell only.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/observability-subroutes] pageerror:', err.message);
  });
}

test.describe('Observability sub-routes', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('/observability main dashboard mounts', async ({ page }) => {
    await page.goto('/observability');
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });

  test('/observability/nodes mounts without crashing', async ({ page }) => {
    await page.goto('/observability/nodes');
    await expect(page).toHaveURL(/\/observability\/nodes$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('/observability/events mounts without crashing', async ({ page }) => {
    await page.goto('/observability/events');
    await expect(page).toHaveURL(/\/observability\/events$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('/observability/metrics mounts without crashing', async ({ page }) => {
    await page.goto('/observability/metrics');
    await expect(page).toHaveURL(/\/observability\/metrics$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('/observability/dashboard redirects to /observability', async ({ page }) => {
    await page.goto('/observability/dashboard');
    await expect(page).toHaveURL(/\/observability$/);
  });
});
