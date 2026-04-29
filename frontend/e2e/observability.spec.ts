import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: /observability surface
//
// Walks the four sub-routes and exercises the most stable user-visible
// behaviors. The dashboard, nodes, events, and metrics pages render against
// fixture data when the backend isn't available — so all assertions here are
// pure-frontend.
//
// Stable selectors used (all `data-testid`):
//   observability-dashboard, kpi-card, cluster-health-chip, live-toggle,
//   nodes-page, chaos-panel, events-page, event-timeline, events-live-toggle,
//   metrics-page
//
// Sub-nav buttons in AppLayout are <button>s with visible text Dashboard /
// Nodes / Events / Metrics (see AppLayout.tsx ~line 893).
// ----------------------------------------------------------------------------

function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/observability] pageerror:', err.message);
  });
}

// Sub-nav: a row of <button>s rendered above the route Outlet when the user
// is on /observability/*. We click by accessible name; the matcher uses
// `^Dashboard$` etc. so we don't accidentally match the H1 inside the page.
function subnavButton(page: Page, label: 'Dashboard' | 'Nodes' | 'Events' | 'Metrics') {
  return page.getByRole('button', { name: new RegExp(`^${label}$`) });
}

test.describe('Observability E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('dashboard renders KPI row, cluster health, and active runs section', async ({ page }) => {
    await page.goto('/observability');

    // Page mounts.
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();

    // KPI row: five cards (Runs today / Active now / Pending approvals /
    // Failed (24h) / Avg first-token latency). The 5th card was added with
    // the LLM streaming work (DashboardPage.tsx:445).
    const kpis = page.getByTestId('kpi-card');
    await expect(kpis).toHaveCount(5);

    // Cluster health chip ("N/M ✓" or "N/M !").
    await expect(page.getByTestId('cluster-health-chip')).toBeVisible();

    // Active runs section header is rendered as plain text — the wrapper div
    // doesn't have a testid yet, so we match the heading text.
    // TODO(agent-2): add data-testid="active-runs-section" to the wrapper.
    await expect(page.getByText(/^Active runs \(\d+\)$/)).toBeVisible();
  });

  test('sub-nav navigates to each section without errors', async ({ page }) => {
    await page.goto('/observability');
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();

    // Nodes
    await subnavButton(page, 'Nodes').click();
    await expect(page).toHaveURL(/\/observability\/nodes$/);
    await expect(page.getByTestId('nodes-page')).toBeVisible();

    // Events
    await subnavButton(page, 'Events').click();
    await expect(page).toHaveURL(/\/observability\/events$/);
    await expect(page.getByTestId('events-page')).toBeVisible();

    // Metrics
    await subnavButton(page, 'Metrics').click();
    await expect(page).toHaveURL(/\/observability\/metrics$/);
    await expect(page.getByTestId('metrics-page')).toBeVisible();

    // Back to Dashboard
    await subnavButton(page, 'Dashboard').click();
    await expect(page).toHaveURL(/\/observability$/);
    await expect(page.getByTestId('observability-dashboard')).toBeVisible();
  });

  test('nodes page: chaos rail is present and interactive', async ({ page }) => {
    await page.goto('/observability/nodes');
    await expect(page.getByTestId('nodes-page')).toBeVisible();

    // ChaosPanel mounts in the left rail.
    const chaos = page.getByTestId('chaos-panel');
    await expect(chaos).toBeVisible();

    // Buttons can be no-ops; we just verify they exist + are clickable.
    const pauseToggle = page.getByTestId('chaos-pause-toggle');
    await expect(pauseToggle).toBeVisible();
    await expect(pauseToggle).toBeEnabled();
  });

  test('events page: live toggle visible and timeline (or empty state) renders', async ({ page }) => {
    await page.goto('/observability/events');
    await expect(page.getByTestId('events-page')).toBeVisible();

    // Live toggle.
    const liveToggle = page.getByTestId('events-live-toggle');
    await expect(liveToggle).toBeVisible();
    await expect(liveToggle).toContainText(/Live|Paused/);

    // Filter rail.
    await expect(page.getByTestId('events-filter-rail')).toBeVisible();

    // Timeline mount: either it shows the empty-state ("No events yet") or
    // a populated list with `data-testid="event-timeline"`. The empty state
    // does NOT carry the testid (EmptyState wrapper is unmarked) — so accept
    // either signal.
    // TODO(agent-2): add data-testid="event-timeline" or "events-empty" on the
    // empty-state wrapper so the assertion can be a single getByTestId.
    const timeline = page.getByTestId('event-timeline');
    const emptyState = page.getByText('No events yet');
    await expect(timeline.or(emptyState).first()).toBeVisible();
  });

  test('dashboard live toggle pauses subscriptions (visual indicator only)', async ({ page }) => {
    await page.goto('/observability');
    const toggle = page.getByTestId('live-toggle');
    await expect(toggle).toBeVisible();

    // Default state: Live.
    await expect(toggle).toContainText(/Live/);

    // Toggle off.
    await toggle.click();
    await expect(toggle).toContainText(/Paused/);

    // Toggle back on.
    await toggle.click();
    await expect(toggle).toContainText(/Live/);
  });
});
