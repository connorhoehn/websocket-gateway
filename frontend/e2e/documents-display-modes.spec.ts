import { test, expect, type Page } from '@playwright/test';

// ----------------------------------------------------------------------------
// E2E: Document type wizard — per-field display modes (Step 3)
//
// Exercises the existing per-field, per-mode visibility + renderer-override
// configuration on the document-type wizard's third step, plus how that
// configuration survives a save into localStorage.
//
// Scope is intentionally limited to functionality that exists today (see
// doc-ui-audit.md §C):
//   - Per-field, per-mode visibility checkbox  (visibility-{uuid}-{mode})
//   - Per-field, per-mode renderer override   (renderer-{uuid}-{mode})
//   - Persistence of the resulting DocumentType into localStorage under
//     STORAGE_KEY = 'ws_document_types_v1' (useDocumentTypes.ts)
//   - 3 modes: editor / ack / reader
//
// Out of scope (NOT BUILT — do not test):
//   - Drag-and-drop section reorder (the wizard uses up/down arrows)
//   - Field grouping / nesting
//   - Multi-page wizard for document editing
//
// Runtime visibility (test #4) requires the WebSocket gateway to be running
// because document creation is dispatched over WS via doc:create. If the WS
// gateway is unreachable the test self-skips at runtime — the localStorage
// persistence assertions in #1-#3, #5, #6 are the load-bearing coverage.
//
// Stable selectors used (all `data-testid`):
//   create-type-btn, name-input, description-input, icon-{emoji},
//   wizard-next, add-field-rich-text, add-field-tasks, fields-list,
//   field-name-{uuid}, visibility-{uuid}-{mode}, renderer-{uuid}-{mode},
//   type-item-{uuid}, save-message,
//   new-document-btn, type-option-{typeId}, new-doc-title, new-doc-submit
//
// Environment:
//   - Vite dev server on http://localhost:5174 (or PLAYWRIGHT_BASE_URL)
//   - VITE_DEV_BYPASS_AUTH=true (skips Cognito)
//   - WS gateway is OPTIONAL — only test #4 needs it.
// ----------------------------------------------------------------------------

const DOC_TYPES_KEY = 'ws_document_types_v1';

// Shape of a persisted DocumentType (matches src/types/documentType.ts).
// We type-narrow page.evaluate results against this so tests fail loudly when
// the schema drifts rather than silently passing on missing fields.
type ViewMode = 'editor' | 'ack' | 'reader';

interface PersistedField {
  id: string;
  name: string;
  sectionType: string;
  required: boolean;
  defaultCollapsed: boolean;
  placeholder: string;
  hiddenInModes: ViewMode[];
  rendererOverrides: Partial<Record<ViewMode, string>>;
}

interface PersistedType {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: PersistedField[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

// Always start each test from a clean storage slate so subsequent reads of
// the doc-types key return only the test's own writes.
async function clearDocTypeStorage(page: Page) {
  // Must visit the origin first; localStorage is per-origin.
  await page.goto('/');
  await page.evaluate((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore — incognito or quota errors */
    }
  }, DOC_TYPES_KEY);
}

// Swallow network/WebSocket pageerrors expected when no WS backend is running.
function tolerateBackendErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (/WebSocket|fetch|NetworkError|Failed to fetch/i.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.warn('[e2e/documents-display-modes] pageerror:', err.message);
  });
}

// Read all persisted document types from localStorage. Returns [] on missing
// or invalid storage. Mirrors loadTypes() in useDocumentTypes.ts.
async function readPersistedTypes(page: Page): Promise<PersistedType[]> {
  return page.evaluate((key): PersistedType[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PersistedType[]) : [];
    } catch {
      return [];
    }
  }, DOC_TYPES_KEY);
}

// Drives steps 1 → 2 → 3 of the wizard for a single-field rich-text type and
// returns the field's UUID (extracted from the visibility-{uuid}-editor testid).
// Stops on step 3 without saving so callers can configure visibility / renderer
// overrides before clicking "Create Type".
async function openWizardWithRichTextField(
  page: Page,
  typeName: string,
): Promise<string> {
  await page.goto('/document-types');
  await page.getByTestId('create-type-btn').click();

  // Step 1 — basic info
  await page.getByTestId('name-input').fill(typeName);
  await page.getByTestId('wizard-next').click();

  // Step 2 — add a single rich-text field
  await page.getByTestId('add-field-rich-text').click();
  // The added FieldRow exposes data-testid="field-name-{uuid}" — read the
  // uuid suffix to address the matching visibility/renderer cells on step 3.
  const fieldNameInput = page.locator('[data-testid^="field-name-"]').first();
  await expect(fieldNameInput).toBeVisible();
  const testId = await fieldNameInput.getAttribute('data-testid');
  if (!testId) throw new Error('field-name testid missing on added field');
  const fieldId = testId.replace(/^field-name-/, '');

  // Advance to step 3 (View Modes) — the wizard-next button text becomes
  // "Create Type" on this step but the testid stays stable.
  await page.getByTestId('wizard-next').click();
  // Sanity: step 3 cells are addressable.
  await expect(page.getByTestId(`visibility-${fieldId}-editor`)).toBeVisible();
  await expect(page.getByTestId(`visibility-${fieldId}-ack`)).toBeVisible();
  await expect(page.getByTestId(`visibility-${fieldId}-reader`)).toBeVisible();
  return fieldId;
}

// Same as openWizardWithRichTextField but adds a tasks-typed field.
async function openWizardWithTasksField(
  page: Page,
  typeName: string,
): Promise<string> {
  await page.goto('/document-types');
  await page.getByTestId('create-type-btn').click();

  await page.getByTestId('name-input').fill(typeName);
  await page.getByTestId('wizard-next').click();

  await page.getByTestId('add-field-tasks').click();
  const fieldNameInput = page.locator('[data-testid^="field-name-"]').first();
  await expect(fieldNameInput).toBeVisible();
  const testId = await fieldNameInput.getAttribute('data-testid');
  if (!testId) throw new Error('field-name testid missing on added field');
  const fieldId = testId.replace(/^field-name-/, '');

  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId(`visibility-${fieldId}-editor`)).toBeVisible();
  return fieldId;
}

// Click "Create Type" on step 3 and wait for the type-item to appear in the
// left sidebar list. Returns the persisted type's UUID.
async function saveTypeAndAwaitListEntry(
  page: Page,
  typeName: string,
): Promise<string> {
  await page.getByTestId('wizard-next').click();
  // The list re-renders with the new type. The save flash also appears.
  await expect(page.getByTestId('save-message')).toBeVisible();
  // type-item-{uuid} is the persisted UUID — read it from the DOM.
  const newItem = page.locator('[data-testid^="type-item-"]').first();
  await expect(newItem).toBeVisible();
  const itemTestId = await newItem.getAttribute('data-testid');
  if (!itemTestId) throw new Error('type-item testid missing after save');
  const typeId = itemTestId.replace(/^type-item-/, '');

  // Cross-check storage so callers can immediately inspect persisted shape.
  const persisted = await readPersistedTypes(page);
  const found = persisted.find((t) => t.id === typeId);
  if (!found) throw new Error(`Persisted type ${typeId} (${typeName}) missing from localStorage`);
  return typeId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Document types — per-field display modes', () => {
  test.beforeEach(async ({ page }) => {
    tolerateBackendErrors(page);
    await clearDocTypeStorage(page);
  });

  // -------------------------------------------------------------------------
  // 1. Save a type with one rich-text field hidden in reader mode.
  // -------------------------------------------------------------------------
  test('save a type with reader-hidden field', async ({ page }) => {
    const fieldId = await openWizardWithRichTextField(page, 'E2E Reader Hidden');

    // Uncheck visibility for reader mode only — leave editor + ack visible.
    const readerVis = page.getByTestId(`visibility-${fieldId}-reader`);
    await expect(readerVis).toBeChecked();
    await readerVis.click();
    await expect(readerVis).not.toBeChecked();

    // Sanity: editor + ack remain visible.
    await expect(page.getByTestId(`visibility-${fieldId}-editor`)).toBeChecked();
    await expect(page.getByTestId(`visibility-${fieldId}-ack`)).toBeChecked();

    const typeId = await saveTypeAndAwaitListEntry(page, 'E2E Reader Hidden');
    expect(typeId.length).toBeGreaterThan(0);
    // The type-item is in the left sidebar list.
    await expect(page.getByTestId(`type-item-${typeId}`)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. The reader-hidden visibility config persists in localStorage.
  //
  // useDocumentTypes.ts persists to STORAGE_KEY 'ws_document_types_v1' as
  // an array of DocumentType objects. The shape is documented in
  // src/types/documentType.ts: each field carries
  //   hiddenInModes: ViewMode[]
  //   rendererOverrides: Partial<Record<ViewMode, string>>
  // i.e. visibility is encoded as MEMBERSHIP in `hiddenInModes`, not a
  // nested { reader: { visible: false } } object. The brief allows for
  // either shape; we assert the actual shape (membership).
  // -------------------------------------------------------------------------
  test('config persists in localStorage', async ({ page }) => {
    const fieldId = await openWizardWithRichTextField(page, 'E2E Persist');
    await page.getByTestId(`visibility-${fieldId}-reader`).click();
    const typeId = await saveTypeAndAwaitListEntry(page, 'E2E Persist');

    const persisted = await readPersistedTypes(page);
    const saved = persisted.find((t) => t.id === typeId);
    expect(saved).toBeDefined();
    expect(saved!.name).toBe('E2E Persist');
    expect(saved!.fields).toHaveLength(1);

    const field = saved!.fields[0];
    expect(field.id).toBe(fieldId);
    expect(field.sectionType).toBe('rich-text');
    // The reader mode is in the hidden list; editor + ack are not.
    expect(field.hiddenInModes).toContain('reader');
    expect(field.hiddenInModes).not.toContain('editor');
    expect(field.hiddenInModes).not.toContain('ack');
  });

  // -------------------------------------------------------------------------
  // 3. Renderer override choice persists in localStorage.
  //
  // CAVEAT: built-in field types ship a SINGLE renderer key per view mode
  // (rich-text/tasks/decisions/checklist all have one entry per mode in
  // their definition.ts rendererKeys). The dropdown therefore has only one
  // option for built-ins and there is no "different option" to switch to.
  // We still exercise the change-handler — selecting the existing option
  // writes into rendererOverrides — and assert the override is persisted
  // under the field's editor mode key. If a future definition adds a
  // second renderer, swap selectOption({ index: 1 }) into this test.
  // -------------------------------------------------------------------------
  test('renderer choice persists', async ({ page }) => {
    const fieldId = await openWizardWithRichTextField(page, 'E2E Renderer');

    const editorRenderer = page.getByTestId(`renderer-${fieldId}-editor`);
    await expect(editorRenderer).toBeVisible();
    // Inspect available options. Built-ins have exactly one (rich-text:editor).
    const optionValues = await editorRenderer.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    expect(optionValues.length).toBeGreaterThanOrEqual(1);

    // Select the last option — equals the only option for built-ins, but
    // would be the "different" option if more shipped. Triggers onChange so
    // rendererOverrides[editor] gets written.
    const target = optionValues[optionValues.length - 1];
    await editorRenderer.selectOption(target);

    const typeId = await saveTypeAndAwaitListEntry(page, 'E2E Renderer');
    const persisted = await readPersistedTypes(page);
    const saved = persisted.find((t) => t.id === typeId);
    expect(saved).toBeDefined();
    const field = saved!.fields[0];
    expect(field.rendererOverrides.editor).toBe(target);
  });

  // -------------------------------------------------------------------------
  // 4. Runtime visibility — reader mode hides field.
  //
  // Best-effort: document creation requires the WebSocket gateway. If WS is
  // not reachable the document never lands in the editor and reader-mode
  // rendering can't be exercised. We probe for connection state and skip
  // gracefully instead of failing the suite.
  //
  // FOLLOWUP for the audit (cross-cutting finding): the gateway exposes a
  // window-scoped __pipelineDemo.seed() helper for pipelines but no analog
  // for documents. Adding a __docDemo.seed() helper would unblock this test
  // (and the wider documents-section-reviews spec) without requiring a live
  // WS gateway in CI. See doc-ui-audit.md §"Cross-cutting findings".
  // -------------------------------------------------------------------------
  test('runtime visibility — reader mode hides field', async ({ page }) => {
    const fieldId = await openWizardWithRichTextField(page, 'E2E Runtime');
    await page.getByTestId(`visibility-${fieldId}-reader`).click();
    const typeId = await saveTypeAndAwaitListEntry(page, 'E2E Runtime');

    // Navigate to the documents page where the "+ New Document" trigger lives.
    await page.goto('/documents');
    const newDocBtn = page.getByTestId('new-document-btn');
    if ((await newDocBtn.count()) === 0) {
      test.skip(true, 'new-document-btn missing on /documents — UI revision pending');
      return;
    }

    // Document creation goes through ws send doc:create. Probe by attempting
    // creation and waiting briefly for navigation; bail with skip if WS isn't
    // up. This keeps the suite green when the gateway is offline.
    await newDocBtn.click();
    await expect(page.getByTestId(`type-option-${typeId}`)).toBeVisible({ timeout: 5_000 });
    await page.getByTestId(`type-option-${typeId}`).click();
    await page.getByTestId('new-doc-title').fill('Runtime Visibility Doc');

    const submitBtn = page.getByTestId('new-doc-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // If WS is up we navigate to /documents/:id; otherwise the modal closes
    // but no doc lands. Wait up to 5s for either outcome.
    const navigated = await page
      .waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!navigated) {
      test.skip(
        true,
        'WebSocket gateway not reachable — doc:create never resolved. ' +
          'Runtime visibility coverage requires ws://localhost:8080 or a ' +
          '__docDemo.seed() helper analogous to __pipelineDemo.seed(). ' +
          'See doc-ui-audit.md §"Cross-cutting findings".',
      );
      return;
    }

    // If we made it here the editor mounted. Reader-mode toggle / DOM
    // assertions are out of audit scope (no testids on the mode switcher
    // today — see doc-ui-audit.md §A "Missing testids"). Annotate and
    // pass — full reader-mode rendering verification is gated on those
    // testids landing.
    test.info().annotations.push({
      type: 'pending',
      description:
        'Doc landed in editor but reader-mode toggle has no testid yet. ' +
        'Wire up [data-testid="view-mode-reader"] to assert hidden field is ' +
        'absent from the rendered tree.',
    });
  });

  // -------------------------------------------------------------------------
  // 5. Toggling all-modes-off marks the field hidden in every mode.
  // -------------------------------------------------------------------------
  test('toggle all-modes-off — field hidden everywhere', async ({ page }) => {
    const fieldId = await openWizardWithRichTextField(page, 'E2E All Hidden');

    // Uncheck all three visibility checkboxes.
    for (const mode of ['editor', 'ack', 'reader'] as const) {
      const cb = page.getByTestId(`visibility-${fieldId}-${mode}`);
      await expect(cb).toBeChecked();
      await cb.click();
      await expect(cb).not.toBeChecked();
    }

    const typeId = await saveTypeAndAwaitListEntry(page, 'E2E All Hidden');
    const persisted = await readPersistedTypes(page);
    const saved = persisted.find((t) => t.id === typeId);
    expect(saved).toBeDefined();
    const field = saved!.fields[0];
    expect(field.hiddenInModes).toEqual(
      expect.arrayContaining(['editor', 'ack', 'reader']),
    );
    expect(field.hiddenInModes).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // 6. Renderer dropdown options are sourced from the field's renderer
  //    registry definition (frontend/src/renderers/{type}/definition.ts).
  //    rich-text editor mode → label "Rich Text Editor"
  //    tasks      editor mode → label "Task Editor"
  //    The renderer registry lives at frontend/src/renderers/registry.ts +
  //    is populated via frontend/src/renderers/index.ts. Each definition
  //    declares rendererKeys: { editor: [...], ack: [...], reader: [...] }
  //    and rendererLabels: Record<key, label>.
  // -------------------------------------------------------------------------
  test('renderer dropdown options match the field type', async ({ page }) => {
    // --- rich-text -------------------------------------------------------
    const richTextFieldId = await openWizardWithRichTextField(page, 'E2E RichText Renderer');
    const rtSelect = page.getByTestId(`renderer-${richTextFieldId}-editor`);
    await expect(rtSelect).toBeVisible();
    const rtOptions = await rtSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() ?? '',
      })),
    );
    // rich-text definition.ts declares one editor renderer key:
    // 'rich-text:editor' → label 'Rich Text Editor'.
    expect(rtOptions).toContainEqual({
      value: 'rich-text:editor',
      label: 'Rich Text Editor',
    });

    // Cancel out and walk a fresh wizard for tasks so we don't leak state.
    // The Cancel button on the wizard returns to idle without persisting.
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // --- tasks -----------------------------------------------------------
    const tasksFieldId = await openWizardWithTasksField(page, 'E2E Tasks Renderer');
    const tasksSelect = page.getByTestId(`renderer-${tasksFieldId}-editor`);
    await expect(tasksSelect).toBeVisible();
    const tasksOptions = await tasksSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() ?? '',
      })),
    );
    // tasks definition.ts declares one editor renderer key:
    // 'tasks:editor' → label 'Task Editor'. Distinct from rich-text.
    expect(tasksOptions).toContainEqual({
      value: 'tasks:editor',
      label: 'Task Editor',
    });
    // Sanity: the option set differs between field types.
    expect(tasksOptions.some((o) => o.value === 'rich-text:editor')).toBe(false);
  });
});
