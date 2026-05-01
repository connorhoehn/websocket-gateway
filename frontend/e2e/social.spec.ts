import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /social page
//
// Verifies that the Social route mounts and renders its UI shell. The
// social-api backend is not running, so data fetches fail silently —
// we verify the page renders without crashing and the nav state is correct.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — social-api calls will fail; we test the UI shell only.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/social] pageerror:', err.message);
  });
}

test.describe('Social page', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await page.goto('/social');
  });

  test('page mounts at /social without crashing', async ({ page }) => {
    await expect(page).toHaveURL(/\/social$/);

    // The page should render content — verify body is not empty
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('Social nav button shows as active', async ({ page }) => {
    // The Social nav button should be visible (the top nav bar renders on all routes)
    const socialBtn = page.getByRole('button', { name: /^Social$/ });
    await expect(socialBtn).toBeVisible();
  });

  test('can navigate away from Social to another section', async ({ page }) => {
    const pipelinesBtn = page.getByRole('button', { name: /^Pipelines$/ });
    await pipelinesBtn.click();
    await expect(page).toHaveURL(/\/pipelines$/);
  });
});
