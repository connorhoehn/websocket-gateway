import { test, expect, type Page, type Route } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Per-section review approval flow (ReviewMode.tsx)
//
// Exercises the per-section review state machine in `ReviewMode.tsx`:
//   1. Open a doc in review mode → 4 sections render (loaded from the
//      Demo Document — see DEMO_MARKDOWN in src/utils/demoDocument.ts)
//   2. Mark sections as approved / changes_requested / reviewed
//   3. Verify status badges, progress %, and the per-document review summary
//
// SEEDING APPROACH (chosen: option (a)-bis — pure client-side):
// ---------------------------------------------------------------------------
// Documents are normally created via WebSocket (`crdt:createDocument`), and
// section data is normally hydrated via Y.js snapshots delivered by the
// gateway. **Without a running WS gateway, the Y.Doc is empty and ReviewMode
// never renders** (DocumentEditorPage.tsx:651 — `isEmpty = sections.length
// === 0 && !demoLoaded` gates ReviewMode at line 901).
//
// The escape hatch already shipped in the codebase: when a doc has no
// sections, an empty-state CTA "Load Demo Document" appears
// (DocumentEditorPage.tsx:770). Clicking it calls `handleLoadDemo` from
// `useDocumentActions.ts:89`, which parses `DEMO_MARKDOWN` and calls
// `addSection()` directly on the local Y.Doc — **no gateway round-trip
// required**. The same pattern is used by `sidebar-panels.spec.ts` to bring
// a doc to a non-empty state.
//
// We then switch to Review mode (URL param `?mode=ack`) and exercise the
// per-section testids from commit c32d19c (review-mode, review-progress,
// review-progress-pct, review-section-{id}, section-{id}-review-{status},
// section-{id}-status, section-{id}-change-review, review-summary).
//
// REVIEW POST ENDPOINT
// ---------------------------------------------------------------------------
// `useDocumentReviews.reviewSection()` POSTs to social-api at
// /api/documents/{docId}/sections/{sectionId}/reviews. The optimistic state
// update only fires on a 200 response (useDocumentReviews.ts:155-161). We
// stub the POST with `page.route()` so the spec doesn't depend on
// social-api being healthy (during audit it returned 503). The initial
// GET /api/documents/{docId}/reviews is also stubbed to an empty list so
// the "review-summary" assertion only sees reviews from this test run.
//
// Stable testids used:
//   review-mode, review-progress, review-progress-text, review-progress-pct,
//   review-section-{id}, section-{id}-review-reviewed,
//   section-{id}-review-approved, section-{id}-review-changes-requested,
//   section-{id}-status, section-{id}-change-review, review-summary
//
// Environment:
//   - Vite dev server on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true (skips Cognito; userId comes from a dev
//     identity persisted in sessionStorage — see useAuth.ts:91)
//   - WS gateway need NOT be running. WebSocket pageerrors tolerated.
//   - social-api need NOT be running. POST/GET /api/documents/.../reviews
//     are stubbed via page.route().
// ----------------------------------------------------------------------------

const DOC_ID = 'e2e-section-reviews-doc';
const DOC_ROUTE = `/documents/${DOC_ID}?mode=ack`;
const SOCIAL_API_BASE = 'http://localhost:3001';

// Tolerate the noisy backend errors that fire when WS / social-api aren't
// running. These are expected in this E2E environment and would otherwise
// fail the test via 'pageerror' propagation.
function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/section-reviews] pageerror:', err.message);
  });
}

// Stub the social-api review endpoints so the spec is independent of the
// live service. The GET returns an empty list; the POST echoes back a fake
// review whose `userId` matches what ReviewMode reads from props (see the
// inline comment in the POST handler for why that's `'anonymous'`).
async function stubReviewsApi(page: Page) {
  // 1. GET /api/documents/{docId}/reviews → empty list
  await page.route(
    new RegExp(`^${SOCIAL_API_BASE}/api/documents/[^/]+/reviews(?:\\?.*)?$`),
    async (route: Route) => {
      const req = route.request();
      if (req.method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reviews: [] }),
      });
    },
  );

  // 2. POST /api/documents/{docId}/sections/{sectionId}/reviews → echo
  await page.route(
    new RegExp(`^${SOCIAL_API_BASE}/api/documents/([^/]+)/sections/([^/]+)/reviews$`),
    async (route: Route) => {
      const req = route.request();
      if (req.method() !== 'POST') {
        await route.fallback();
        return;
      }

      // Parse body for status / comment
      let body: { status: string; comment?: string } = { status: 'reviewed' };
      try {
        body = JSON.parse(req.postData() ?? '{}');
      } catch {
        /* fall through to defaults */
      }

      // CRITICAL: ReviewMode compares each review's `userId` against the
      // `userId` prop passed by App.tsx, which is `clientId ?? 'anonymous'`
      // (App.tsx:410). The clientId is only set after a successful WS
      // session handshake — without a running gateway, sessionStorage has no
      // `ws_client_id` (we clear it in beforeEach), so userId falls back to
      // `'anonymous'`. The mock must echo that exact value or the
      // `myReview = reviews.find(r => r.userId === userId)` lookup in
      // ReviewMode.tsx:126 returns undefined and the status badge never
      // renders. The reviewer's *display name* is purely cosmetic — pulled
      // from the JWT for the per-document summary in ReviewMode.tsx:447.
      const auth = req.headers()['authorization'] ?? '';
      let displayName = 'E2E Tester';
      const match = auth.match(/^Bearer eyJhbGciOiJub25lIn0\.([^.]+)\.dev$/);
      if (match) {
        try {
          const padded = match[1] + '='.repeat((4 - (match[1].length % 4)) % 4);
          const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
          const first = (decoded.given_name as string | undefined) ?? '';
          const last = (decoded.family_name as string | undefined) ?? '';
          if (first || last) displayName = `${first} ${last}`.trim();
        } catch {
          /* leave default — assertion-side doesn't read displayName */
        }
      }

      const review = {
        userId: 'anonymous',
        displayName,
        status: body.status,
        timestamp: new Date().toISOString(),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ review }),
      });
    },
  );
}

// Walk through the empty-state CTA → demo-loaded sections in Review mode.
// Returns the ordered list of section IDs surfaced as `review-section-{id}`.
async function loadDemoIntoReviewMode(page: Page): Promise<string[]> {
  await page.goto(DOC_ROUTE);

  // The empty-state CTA appears regardless of mode (DocumentEditorPage.tsx:761).
  // Clicking it populates Y.js locally via addSection (no WS round-trip).
  const loadDemo = page.getByRole('button', { name: /Load Demo Document/i });
  await expect(loadDemo).toBeVisible({ timeout: 15_000 });
  await loadDemo.click();

  // Once demoLoaded flips, ReviewMode renders (mode === 'ack' from URL).
  await expect(page.getByTestId('review-mode')).toBeVisible({ timeout: 10_000 });

  // Enumerate section IDs from the rendered DOM. DEMO_MARKDOWN produces
  // 4 sections (Executive Summary / Action Items / Decisions / Technical Notes)
  // but we don't hardcode the count — we let the assertions adapt.
  const ids = await page
    .locator('[data-testid^="review-section-"]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n as HTMLElement).dataset.testid ?? '')
        .map((tid) => tid.replace(/^review-section-/, ''))
        .filter((id) => id.length > 0),
    );
  return ids;
}

test.describe('Per-section reviews (ReviewMode)', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await stubReviewsApi(page);

    // Clear any cached dev identity / session token from prior runs so each
    // test gets a clean userId-vs-review-summary readback.
    await page.goto('/');
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
        // Also drop any stale review-related localStorage if some future
        // version starts caching reviews offline.
        const keep = ['ws_document_types_v1'];
        const remove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith('reviews:') && !keep.includes(k)) remove.push(k);
        }
        remove.forEach((k) => localStorage.removeItem(k));
      } catch {
        /* ignore quota/incognito errors */
      }
    });
  });

  test('open doc in review mode — 4 sections render with 0% progress', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);

    // DEMO_MARKDOWN has 4 ## headings → 4 sections. Assert at least 3 to
    // guard against minor demo-doc edits without blocking the spec.
    expect(ids.length).toBeGreaterThanOrEqual(3);

    // Progress copy: "X of N sections reviewed by you" — starts at 0/N.
    await expect(page.getByTestId('review-progress')).toBeVisible();
    await expect(page.getByTestId('review-progress-text')).toContainText(
      new RegExp(`^0 of ${ids.length} sections reviewed`),
    );
    await expect(page.getByTestId('review-progress-pct')).toHaveText('0%');

    // Action bar should show 3 buttons per section (reviewed / approved /
    // changes_requested) since no review exists yet.
    await expect(
      page.locator(`[data-testid="section-${ids[0]}-review-reviewed"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="section-${ids[0]}-review-approved"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="section-${ids[0]}-review-changes-requested"]`),
    ).toBeVisible();
  });

  test('mark a section approved → status badge + progress increments', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);
    const target = ids[0];

    await page.getByTestId(`section-${target}-review-approved`).click();

    const status = page.getByTestId(`section-${target}-status`);
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-status', 'approved');
    await expect(status).toContainText(/Approved/);

    // Progress text increments by 1.
    await expect(page.getByTestId('review-progress-text')).toContainText(
      new RegExp(`^1 of ${ids.length} sections reviewed`),
    );

    // Action-bar buttons for this section disappear (replaced by status + Change).
    await expect(
      page.locator(`[data-testid="section-${target}-review-approved"]`),
    ).toHaveCount(0);
    await expect(page.getByTestId(`section-${target}-change-review`)).toBeVisible();
  });

  test('request changes on a section → data-status=changes_requested', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);
    // Use the second section so this test is independent from the previous one.
    const target = ids[1];

    await page.getByTestId(`section-${target}-review-changes-requested`).click();

    const status = page.getByTestId(`section-${target}-status`);
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-status', 'changes_requested');
    await expect(status).toContainText(/Changes Requested/);
  });

  test('mark every section reviewed → progress hits 100%', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);

    for (const id of ids) {
      await page.getByTestId(`section-${id}-review-reviewed`).click();
      // Wait for the status badge to appear before advancing — guards against
      // racing the optimistic state update on the next click.
      await expect(page.getByTestId(`section-${id}-status`)).toBeVisible();
    }

    await expect(page.getByTestId('review-progress-pct')).toHaveText('100%');
    await expect(page.getByTestId('review-progress-text')).toContainText(
      new RegExp(`^${ids.length} of ${ids.length} sections reviewed`),
    );
  });

  test('change a previous review → action bar reappears + new status sticks', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);
    const target = ids[0];

    // First decision: approve.
    await page.getByTestId(`section-${target}-review-approved`).click();
    const status = page.getByTestId(`section-${target}-status`);
    await expect(status).toHaveAttribute('data-status', 'approved');

    // Click "Change" to re-open the action bar.
    await page.getByTestId(`section-${target}-change-review`).click();
    await expect(
      page.locator(`[data-testid="section-${target}-review-reviewed"]`),
    ).toBeVisible();

    // Switch to plain "reviewed".
    await page.getByTestId(`section-${target}-review-reviewed`).click();
    await expect(status).toHaveAttribute('data-status', 'reviewed');
    await expect(status).toContainText(/Reviewed/);
  });

  test('document review summary aggregates approved / reviewed / changes counts', async ({ page }) => {
    const ids = await loadDemoIntoReviewMode(page);

    // 1 approved + 1 changes_requested + 1 reviewed (the rest stay unreviewed).
    await page.getByTestId(`section-${ids[0]}-review-approved`).click();
    await expect(page.getByTestId(`section-${ids[0]}-status`)).toBeVisible();

    await page.getByTestId(`section-${ids[1]}-review-changes-requested`).click();
    await expect(page.getByTestId(`section-${ids[1]}-status`)).toBeVisible();

    await page.getByTestId(`section-${ids[2]}-review-reviewed`).click();
    await expect(page.getByTestId(`section-${ids[2]}-status`)).toBeVisible();

    // The summary panel only renders when at least one reviewer exists in the
    // doc (ReviewMode.tsx:426 — `allReviewers.size > 0`).
    const summary = page.getByTestId('review-summary');
    await expect(summary).toBeVisible();

    // Layout: each reviewer row contains their displayName, an "X of N
    // sections" line, and a colored chip per status that has a non-zero
    // count. We assert the chip texts directly — exact wording comes from
    // ReviewMode.tsx:454-466.
    await expect(summary).toContainText(/1 approved/);
    await expect(summary).toContainText(/1 reviewed/);
    await expect(summary).toContainText(/1 changes requested/);

    // Sanity: total reviewed shown in the per-reviewer subline is "3 of N".
    await expect(summary).toContainText(new RegExp(`3 of ${ids.length} sections`));
  });
});
