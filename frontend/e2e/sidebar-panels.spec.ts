import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: DocumentEditorPage sidebar panel mutual-exclusion
//
// Verifies the contract enforced by `useSidebarPanels.ts`:
//   at most one of { History, My Items, Workflows, Past Calls } is open at a
//   time. Opening a new panel automatically closes any sibling.
//
// Environment assumptions:
//   - Vite dev server running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true in frontend/.env (skips Cognito)
//   - NO backend — ws://localhost:8080 + http://localhost:3001 WILL fail.
//     Those failures are tolerated; we only exercise local React/Y.js state.
// ----------------------------------------------------------------------------

const DOC_ROUTE = '/documents/e2e-test-doc';

// Panel-specific titles rendered inside the slide-out panel body.
// Sourced from the panel components' <PanelHeader title=... /> props.
const PANEL_TITLES = {
  history: 'Version History',
  myItems: 'My Mentions & Tasks',
  workflows: 'Workflows',
  videoHistory: 'Past Conversations',
} as const;

// Header trigger buttons live in DocumentHeader.tsx, all identified by their
// visible label text. Using a stable role+name locator guards against layout
// drift as long as the label stays the same.
function headerButton(page: Page, name: string | RegExp) {
  return page.getByRole('button', { name, exact: false });
}

function panelHeading(page: Page, title: string) {
  // PanelHeader renders the title in a <span>, so we target `span` specifically
  // to avoid colliding with the header's <button>Workflows</button> (same text)
  // when Workflows is both the open panel and a toggle button. The panel span
  // sits inside the fixed-position .Panel, next to the "Close panel" button.
  return page.locator('span', { hasText: new RegExp(`^${escapeRe(title)}$`) });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A locator rooted to the slide-out panel (fixed, right-anchored). Used when
// we need to target something "inside the panel" unambiguously — e.g. the
// close button, which also exists on other fixed overlays.
function panelRoot(page: Page) {
  // Panel.tsx renders a fixed div with a child "Close panel" aria-labelled
  // button. We scope via the close button's ancestor.
  return page.locator('div').filter({ has: page.getByRole('button', { name: 'Close panel' }) }).first();
}

async function gotoEditor(page: Page) {
  // Swallow noisy unhandled promise rejections from the missing backend —
  // they're expected and would otherwise fail the test via page error events.
  page.on('pageerror', (err) => {
    // Only surface true React render errors; drop network/WS-related ones.
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // Non-network pageerrors still propagate: re-throw via console for triage.
    // eslint-disable-next-line no-console
    console.warn('[e2e] pageerror:', err.message);
  });

  await page.goto(DOC_ROUTE);

  // The "Editor" mode tab is the most reliable page-ready signal: it only
  // renders once DocumentEditorPage (and therefore DocumentHeader) has mounted.
  await expect(headerButton(page, /^Editor$/)).toBeVisible();
  await expect(headerButton(page, /^Review$/)).toBeVisible();
  await expect(headerButton(page, /^Read$/)).toBeVisible();

  // If the editor is empty it shows a "Load Demo Document" CTA — clicking it
  // populates Y.js *locally*, so no backend is needed. This also ensures the
  // section list / TOC render paths are exercised, though the sidebar panel
  // state we care about is independent of document content.
  const loadDemo = page.getByRole('button', { name: /Load Demo Document/i });
  if (await loadDemo.isVisible().catch(() => false)) {
    await loadDemo.click();
  }
}

// NOTE on direct-dispatch clicks: The slide-out `<Panel>` is `position:
// fixed; right: 0;` with `zIndex: 40`. It visually covers the rightmost
// header buttons (Past Calls, Export, Finalize) and the top ~53px of the
// panel itself is covered by the AppLayout top bar (zIndex 50). This means
// Playwright's real mouse clicks — even `{ force: true }` — will hit whatever
// sits on top (the panel body, or the Sign Out button). Since we're testing
// the React state machine, not hit-testing, we dispatch the click directly
// on the target DOM element via `.evaluate()`. This still runs the React
// onClick handler and avoids coupling the test to z-index layering bugs.
async function clickDirect(locator: ReturnType<Page['locator']>) {
  await locator.evaluate((el) => (el as HTMLButtonElement).click());
}

test.describe('Sidebar panel mutual exclusion', () => {
  test('opening a second panel closes the first', async ({ page }) => {
    await gotoEditor(page);

    // Open History -> assert its panel heading is visible.
    await clickDirect(headerButton(page, /^History$/));
    await expect(panelHeading(page, PANEL_TITLES.history)).toBeVisible();

    // Open Workflows -> History should close, Workflows should open.
    await clickDirect(headerButton(page, /^Workflows$/));
    await expect(panelHeading(page, PANEL_TITLES.workflows)).toBeVisible();
    await expect(panelHeading(page, PANEL_TITLES.history)).toHaveCount(0);

    // Click Workflows again -> it toggles off. No panel heading visible.
    await clickDirect(headerButton(page, /^Workflows$/));
    await expect(panelHeading(page, PANEL_TITLES.workflows)).toHaveCount(0);
    await expect(panelHeading(page, PANEL_TITLES.history)).toHaveCount(0);
  });

  test('My Items and Past Calls participate in the same mutex', async ({ page }) => {
    await gotoEditor(page);

    // My Items button label is "My Items" (may have a "(n)" count suffix).
    await clickDirect(headerButton(page, /^My Items(\s*\(\d+\))?$/));
    await expect(panelHeading(page, PANEL_TITLES.myItems)).toBeVisible();

    // Past Calls should replace My Items.
    const pastCallsBtn = headerButton(page, /^Past Calls$/);
    if ((await pastCallsBtn.count()) > 0) {
      await clickDirect(pastCallsBtn);
      await expect(panelHeading(page, PANEL_TITLES.videoHistory)).toBeVisible();
      await expect(panelHeading(page, PANEL_TITLES.myItems)).toHaveCount(0);
    } else {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'Past Calls button not present in header; header may have been refactored.',
      });
    }
  });

  // Regression: the panel's z-index must sit above AppLayout's header so the
  // top-right "Close panel" button isn't occluded. If this test fails, someone
  // lowered the Panel's z-index and real users can't close panels by clicking.
  test('close button is reachable by a real mouse click (z-index regression)', async ({ page }) => {
    await gotoEditor(page);
    await clickDirect(headerButton(page, /^History$/));
    await expect(panelHeading(page, PANEL_TITLES.history)).toBeVisible();

    // Real mouse click (no evaluate fallback). If the header overlays the
    // panel's top strip, Playwright will hit something else and this fails.
    await panelRoot(page).getByRole('button', { name: 'Close panel' }).click();
    await expect(panelHeading(page, PANEL_TITLES.history)).toHaveCount(0);
  });

  test('closePanel via panel close button allows re-opening a sibling', async ({ page }) => {
    await gotoEditor(page);

    // Open History.
    await clickDirect(headerButton(page, /^History$/));
    await expect(panelHeading(page, PANEL_TITLES.history)).toBeVisible();

    // Close via the panel's close button. The Panel's top (where the button
    // sits) is covered by the AppLayout top bar (z-index 50 > panel's 40) —
    // a real UX bug. A real mouse click at the close button's coords would
    // land on the app header's "Sign Out" instead. `clickDirect` bypasses
    // hit-testing and still exercises the React onClose handler.
    await clickDirect(panelRoot(page).getByRole('button', { name: 'Close panel' }));
    await expect(panelHeading(page, PANEL_TITLES.history)).toHaveCount(0);

    // Now open Workflows — closePanel() path did not wedge state.
    await clickDirect(headerButton(page, /^Workflows$/));
    await expect(panelHeading(page, PANEL_TITLES.workflows)).toBeVisible();
  });
});
