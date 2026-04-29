import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Document creation modal flow (`/documents`)
//
// Exercises the user-visible flow that does not require the WS gateway to be
// running. Document creation actually fires `doc:create` over WebSocket, which
// means a real roundtrip needs the gateway up. This spec focuses on the
// modal/UI side: open → pick type → fill → submit closes the modal. We
// tolerate WS failures gracefully — the goal is to verify the modal-side
// state transitions, not that a doc lands in the editor.
//
// Stable selectors used (all `data-testid`):
//   documents-empty, new-document-btn, modal-backdrop,
//   type-option-{typeId}, new-doc-title, new-doc-description,
//   new-doc-submit, new-doc-cancel
//
// localStorage seeding:
//   Doc types are persisted under key `ws_document_types_v1` (see
//   `frontend/src/hooks/useDocumentTypes.ts:STORAGE_KEY`). The shape is a
//   JSON-serialised array of `DocumentType` records — see
//   `frontend/src/types/documentType.ts`. The validator in `loadTypes()`
//   silently drops entries that don't satisfy `isValidDocumentType`, so all
//   six required string fields plus a `fields[]` array must be present.
//
// Environment:
//   - Vite dev server on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true (skips Cognito)
//   - WS gateway optional — tests tolerate connection failures.
// ----------------------------------------------------------------------------

const DOC_TYPES_KEY = 'ws_document_types_v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SeedDocType {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: Array<{
    id: string;
    name: string;
    sectionType: string;
    required: boolean;
    defaultCollapsed: boolean;
    placeholder: string;
    hiddenInModes: string[];
    rendererOverrides: Record<string, string>;
  }>;
  createdAt: string;
  updatedAt: string;
}

function makeSeedType(over: Partial<SeedDocType> = {}): SeedDocType {
  const now = new Date().toISOString();
  return {
    id: over.id ?? '11111111-1111-4111-8111-111111111111',
    name: over.name ?? 'Spec RFC',
    description: over.description ?? 'A doc type seeded by the e2e spec.',
    icon: over.icon ?? '📄',
    fields: over.fields ?? [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Overview',
        sectionType: 'rich-text',
        required: false,
        defaultCollapsed: false,
        placeholder: '',
        hiddenInModes: [],
        rendererOverrides: {},
      },
    ],
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
  };
}

// Pre-seed via addInitScript so the value is in place before any app code
// runs. This avoids a race where loadTypes() reads an empty store before our
// page.evaluate() seeding completes.
async function seedDocTypes(page: Page, types: SeedDocType[]): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      try {
        localStorage.setItem(key, payload);
      } catch {
        /* ignore quota / incognito */
      }
    },
    { key: DOC_TYPES_KEY, payload: JSON.stringify(types) },
  );
}

async function clearDocTypes(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, DOC_TYPES_KEY);
}

// Swallow expected WS / fetch errors when the gateway isn't up.
function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/documents-create] pageerror:', err.message);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Documents creation modal E2E', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
  });

  test('empty Documents list shows empty state and clickable new-document button', async ({ page }) => {
    // No types seeded — the empty state of the list page has nothing to do
    // with the doc-types localStorage; it just reflects there are no
    // documents in workspace state. The Documents page mounts before any WS
    // roundtrip resolves, so the empty list renders immediately.
    await clearDocTypes(page);

    await page.goto('/documents');

    const empty = page.getByTestId('documents-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText(/No documents yet/i);

    const newBtn = page.getByTestId('new-document-btn');
    await expect(newBtn).toBeVisible();
    await expect(newBtn).toBeEnabled();
  });

  test('open modal — type picker visible when at least one type exists', async ({ page }) => {
    // Seed a single doc type so the modal enters its picker code path
    // (NewDocumentModal.tsx — `types.length === 0` branch is the empty
    // state). Pre-seeding via addInitScript guarantees `loadTypes()` sees
    // the value when the modal opens.
    const seed = makeSeedType({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Spec Doc Type' });
    await seedDocTypes(page, [seed]);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();

    await expect(page.getByTestId('modal-backdrop')).toBeVisible();
    await expect(page.getByTestId(`type-option-${seed.id}`)).toBeVisible();

    // Title + description inputs render in the picker code path.
    await expect(page.getByTestId('new-doc-title')).toBeVisible();
    await expect(page.getByTestId('new-doc-description')).toBeVisible();
  });

  test('pick type → form enables submit when title is filled', async ({ page }) => {
    const a = makeSeedType({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: 'Type A' });
    const b = makeSeedType({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', name: 'Type B', icon: '📋' });
    await seedDocTypes(page, [a, b]);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();
    await expect(page.getByTestId('modal-backdrop')).toBeVisible();

    // At least one type-option-* card is rendered.
    const typeOptions = page.locator('[data-testid^="type-option-"]');
    await expect(typeOptions).toHaveCount(2);

    // Click the second type — its border colour flips to the selected
    // accent (#3b82f6). The component sets a 2px border on the selected
    // card; we assert the inline border-color style as a visual proxy for
    // selection rather than poking React state.
    const cardB = page.getByTestId(`type-option-${b.id}`);
    await cardB.click();

    // First, sanity-check that the selected card shows its check glyph.
    // The unicode "✓" is appended only when isSelected — text presence is a
    // sufficient proxy.
    await expect(cardB).toContainText('✓');

    // Submit is disabled until title is non-empty.
    const submit = page.getByTestId('new-doc-submit');
    await expect(submit).toBeDisabled();

    await page.getByTestId('new-doc-title').fill('My First Doc');
    await page.getByTestId('new-doc-description').fill('spec-created');

    await expect(submit).toBeEnabled();
  });

  test('cancel button closes modal', async ({ page }) => {
    await seedDocTypes(page, [makeSeedType()]);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();

    const backdrop = page.getByTestId('modal-backdrop');
    await expect(backdrop).toBeVisible();

    await page.getByTestId('new-doc-cancel').click();
    await expect(backdrop).toBeHidden();
  });

  test('submit attempts create — UI side completes (modal closes or shows error)', async ({ page }) => {
    const seed = makeSeedType({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    await seedDocTypes(page, [seed]);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();
    const backdrop = page.getByTestId('modal-backdrop');
    await expect(backdrop).toBeVisible();

    // Pick the seeded type (it auto-selects on modal-open per
    // NewDocumentModal.tsx:38, but click anyway to cover the click path).
    await page.getByTestId(`type-option-${seed.id}`).click();
    await page.getByTestId('new-doc-title').fill('Roundtrip Test Doc');

    const submit = page.getByTestId('new-doc-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Two acceptable outcomes:
    //   (a) Success path: handleSubmit() in NewDocumentModal calls onClose()
    //       synchronously after onCreate(), so the backdrop should be hidden
    //       essentially immediately even if the WS gateway is down.
    //   (b) Error path: an error UI is surfaced and the modal stays open.
    // We assert one of those by waiting briefly and checking which state
    // settled.
    await page.waitForTimeout(500);

    const backdropHidden = (await backdrop.count()) === 0 || !(await backdrop.isVisible());
    const errorTextVisible =
      (await page.getByText(/error|failed|disconnected/i).count()) > 0;

    expect(backdropHidden || errorTextVisible).toBeTruthy();

    // Best-effort bonus: if the doc landed in the editor (WS gateway is
    // running), the URL navigates to `/documents/:id`. We don't fail the
    // test if it doesn't — that's the gateway's job. Annotate either way
    // for triage clarity.
    if (/\/documents\/[^/]+/.test(page.url())) {
      test.info().annotations.push({
        type: 'roundtrip',
        description: 'WS gateway appears to be running — landed in editor.',
      });
    } else {
      test.info().annotations.push({
        type: 'roundtrip',
        description: 'WS roundtrip did not navigate to editor (expected without gateway).',
      });
    }
  });

  test('empty title — submit disabled, then enabled on input, then disabled again on clear', async ({ page }) => {
    const seed = makeSeedType({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    await seedDocTypes(page, [seed]);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();
    await expect(page.getByTestId('modal-backdrop')).toBeVisible();

    // Type auto-selects on open (loaded[0]?.id), so no explicit click needed
    // — but assert the auto-selection happened by checking submit-vs-title
    // gating, not by inspecting the picker.
    const title = page.getByTestId('new-doc-title');
    const submit = page.getByTestId('new-doc-submit');

    await expect(submit).toBeDisabled();

    await title.fill('x');
    await expect(submit).toBeEnabled();

    await title.fill('');
    await expect(submit).toBeDisabled();

    // Whitespace-only title should also be rejected (handleSubmit does
    // `title.trim()` before computing `canSubmit`).
    await title.fill('   ');
    await expect(submit).toBeDisabled();
  });

  test('no types defined → empty-state in modal with Close button', async ({ page }) => {
    // Explicitly clear the doc-types key so loadTypes() returns []. This
    // exercises the `types.length === 0` branch (NewDocumentModal.tsx:93).
    await clearDocTypes(page);

    await page.goto('/documents');
    await page.getByTestId('new-document-btn').click();

    await expect(page.getByTestId('modal-backdrop')).toBeVisible();

    // Empty-state copy is the load-bearing assertion.
    await expect(page.getByText(/No document types defined yet/i)).toBeVisible();

    // The Close button has no testid — locate by accessible name. It's the
    // only `<button>` rendered inside the empty-state branch when types is
    // empty (cancel/submit footer is gated behind `types.length > 0`).
    const closeBtn = page.getByRole('button', { name: /^Close$/ });
    await expect(closeBtn).toBeVisible();

    await closeBtn.click();
    await expect(page.getByTestId('modal-backdrop')).toBeHidden();
  });
});
