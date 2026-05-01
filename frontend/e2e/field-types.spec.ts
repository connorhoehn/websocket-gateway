import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /field-types page (FieldTypesPage)
//
// Verifies that the field types admin page mounts and renders its
// primitive storage types catalogue. No backend needed — the built-in
// types are hardcoded in the component.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — social-api calls will fail; we test the UI shell only.
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch|UserPoolId|ClientId/i.test(err.message)) return;
    console.warn('[e2e/field-types] pageerror:', err.message);
  });
}

test.describe('Field Types page', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await page.goto('/field-types');
  });

  test('page mounts at /field-types without crashing', async ({ page }) => {
    await expect(page).toHaveURL(/\/field-types$/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('displays primitive storage types', async ({ page }) => {
    await expect(page.getByText('Boolean')).toBeVisible();
    await expect(page.getByText('Integer')).toBeVisible();
    await expect(page.getByText('Long text')).toBeVisible();
  });

  test('page renders nav and content area', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Data Types$/ })).toBeVisible();
  });

  test('can navigate away to observability', async ({ page }) => {
    const obsBtn = page.getByRole('button', { name: /^Observability$/ });
    await obsBtn.click();
    await expect(page).toHaveURL(/\/observability$/);
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });
});
