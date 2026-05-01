import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /dashboard page (BigBrotherPanel)
//
// Verifies that the dashboard/admin overview page mounts and renders.
// The backend is not running so presence/activity data will be empty.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — social-api + gateway calls will fail; we test UI shell only.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/dashboard] pageerror:', err.message);
  });
}

test.describe('Dashboard page', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('page mounts at /dashboard without crashing', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('can navigate from dashboard to other sections', async ({ page }) => {
    await page.goto('/dashboard');

    const observabilityBtn = page.getByRole('button', { name: /^Observability$/ });
    await observabilityBtn.click();
    await expect(page).toHaveURL(/\/observability$/);
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });
});
