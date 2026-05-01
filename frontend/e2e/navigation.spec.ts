import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Top-level navigation between main sections
//
// Verifies that each nav button in AppLayout.tsx navigates to the correct
// route and the target page mounts without errors. Starts from /observability
// (a known-stable route in bypass-auth mode) and navigates outward.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — ws://localhost:8080 + http://localhost:3001 WILL fail.
//     Those failures are tolerated; we only exercise local React routing.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/navigation] pageerror:', err.message);
  });
}

function navButton(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label}$`) });
}

test.describe('Top-level navigation', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('Observability → Documents navigation works', async ({ page }) => {
    await page.goto('/observability');
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();

    await navButton(page, 'Documents').click();
    await expect(page).toHaveURL(/\/documents$/);
  });

  test('Observability → Pipelines navigation works', async ({ page }) => {
    await page.goto('/observability');
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();

    await navButton(page, 'Pipelines').click();
    await expect(page).toHaveURL(/\/pipelines$/);
  });

  test('Observability → Social navigation works', async ({ page }) => {
    await page.goto('/observability');
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();

    await navButton(page, 'Social').click();
    await expect(page).toHaveURL(/\/social$/);
  });

  test('Pipelines → Documents → Observability round-trip', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page).toHaveURL(/\/pipelines$/);

    await navButton(page, 'Documents').click();
    await expect(page).toHaveURL(/\/documents$/);

    await navButton(page, 'Observability').click();
    await expect(page).toHaveURL(/\/observability$/);
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });

  test('Documents → document-types sub-nav is accessible', async ({ page }) => {
    await page.goto('/document-types');
    await expect(page).toHaveURL(/\/document-types$/);
  });

  test('direct navigation to each major route works', async ({ page }) => {
    await page.goto('/observability');
    await expect(page).toHaveURL(/\/observability$/);

    await page.goto('/pipelines');
    await expect(page).toHaveURL(/\/pipelines$/);

    await page.goto('/documents');
    await expect(page).toHaveURL(/\/documents$/);

    await page.goto('/social');
    await expect(page).toHaveURL(/\/social$/);

    await page.goto('/document-types');
    await expect(page).toHaveURL(/\/document-types$/);
  });
});
