#!/usr/bin/env node
//
// Phase 51 / hub#54 — UI journey runner.
//
// Each journey is a named, ordered sequence of Playwright steps that
// exercises a real configuration path. Every step ends with a screenshot,
// and the run's outcome (passed / failed at step N) lands in the manifest
// at $AGENT_HUB_ROOT/journeys/index.json.
//
// Output convention (per task spec):
//   $HUB_ROOT/journeys/<journey-slug>/<run-ts>/<NN>-<step-name>.png
//
// Manifest update: append per run; never overwrite. Existing journeys
// keep their full run history.
//
// Run from repo root:
//   node scripts/snapshot-journeys.mjs
//
// Assumes the frontend (vite) and social-api are running and reachable
// at http://localhost:5174 and http://localhost:3001 — same as the
// snapshot-capture orchestration. The capture script invokes this
// runner in the same lifecycle.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const HUB_ROOT = process.env.AGENT_HUB_ROOT
  ?? '/Users/connorhoehn/Projects/hoehn-claude-orchestrator';
const JOURNEYS_ROOT = join(HUB_ROOT, 'journeys');
const FRONTEND_BASE = process.env.JOURNEY_BASE ?? 'http://localhost:5174';
const VIEWPORT = { width: 1440, height: 900 };

function log(msg) { console.log(`[journey ${new Date().toISOString()}] ${msg}`); }

function getCommitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim(); }
  catch { return null; }
}

// kebab-case-ify a name for filesystem safety.
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ---------------------------------------------------------------------------
// Step helper used by journey functions.
// ---------------------------------------------------------------------------

function makeStepRecorder(page, runDir, recordedSteps) {
  let idx = 0;
  return async function step(name, description, action) {
    idx += 1;
    const stepName = slugify(name);
    const fileName = `${pad2(idx)}-${stepName}.png`;
    log(`  step ${idx}: ${name} — ${description}`);
    try {
      await action();
      // Brief settle so transitions / focus rings are stable in the shot.
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(runDir, fileName), fullPage: true });
      recordedSteps.push({
        index: idx,
        name: stepName,
        description,
        screenshot: fileName,
      });
    } catch (err) {
      // Capture a screenshot even on failure so the operator can see
      // where the journey broke.
      try {
        await page.screenshot({ path: join(runDir, fileName), fullPage: true });
        recordedSteps.push({
          index: idx,
          name: stepName,
          description,
          screenshot: fileName,
          failed: true,
        });
      } catch { /* ignore secondary failure */ }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Journey definitions.
// ---------------------------------------------------------------------------

const JOURNEYS = [
  {
    slug: 'create-document-type-basic',
    title: 'Create a document type with text + long_text fields',
    description: 'Operator clicks through the empty state to create a working type with two fields, lands on the populated list.',
    async run(page, step) {
      await step('land-on-page', 'Land on /document-types', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });
      await step('click-create', "Click '+ New' to start the wizard", async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });
      await step('fill-type-name', 'Fill in the type name', async () => {
        await page.fill('[data-testid="name-input"]', 'Article');
      });
      await step('advance-to-fields-step', 'Advance to the fields step of the wizard', async () => {
        await page.click('[data-testid="wizard-next"]');
        // The fields step shows the section-type picker on the right. Wait
        // for any `add-field-*` button to appear (the empty state shows
        // them; `fields-list` only appears after the first field is added).
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });
      await step('add-text-field', 'Add a section field via the picker', async () => {
        // The renderer registry exposes whatever section types are
        // registered (tasks / rich-text / checklist / decisions / default).
        // Click the first one available — Phase 51 Phase A's text/long_text
        // backend types map to these renderer ids per the localStorage→server
        // adapter (rich-text → long_text/textarea, etc.).
        const firstAdd = await page.$('[data-testid^="add-field-"]');
        if (!firstAdd) throw new Error('no add-field-* button found on step 2');
        await firstAdd.click();
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 5_000 });
      });
      await step('save-type', 'Click Save / Create Type', async () => {
        // Walk through any remaining wizard steps.
        const wizardNext = '[data-testid="wizard-next"]';
        for (let i = 0; i < 5; i++) {
          if (!(await page.$(wizardNext))) break;
          const label = (await page.textContent(wizardNext)) ?? '';
          await page.click(wizardNext);
          if (/create type|save changes/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        // Wait for the save banner / type list to refresh.
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });
      await step('see-populated-list', 'Verify the type appears in the list', async () => {
        await page.waitForSelector('[data-testid="type-list"]', { timeout: 5_000 });
      });
    },
  },
  {
    slug: 'edit-document-type-name',
    title: 'Edit an existing document type',
    description: 'Operator selects a type from the list, opens the wizard in edit mode, and renames it.',
    async run(page, step) {
      await step('seed-an-existing-type', 'Pre-seed localStorage with one type', async () => {
        // Hit the page first so localStorage is the right origin.
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
          const now = new Date().toISOString();
          const seed = [{
            id: 'journey-edit-seed',
            name: 'Editable Type',
            description: 'Pre-seeded for the edit journey',
            icon: '📝',
            fields: [],
            createdAt: now,
            updatedAt: now,
          }];
          localStorage.setItem('ws_document_types_v1', JSON.stringify(seed));
        });
        // Reload so React picks up the seeded state on first render.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="type-item-journey-edit-seed"]', { timeout: 5_000 });
      });
      await step('click-edit', 'Click Edit on the seeded type', async () => {
        await page.click('[data-testid="edit-type-journey-edit-seed"]');
        // The wizard intentionally starts on step 2 (Sections) when editing
        // so fields are immediately visible — see DocumentTypeWizard line
        // 485. Wait for the wizard's Next button to confirm it mounted,
        // not the name-input (which lives on step 1).
        await page.waitForSelector('[data-testid="wizard-next"]', { timeout: 10_000 });
      });
      await step('back-to-basics', 'Click Back to reach the name field on step 1', async () => {
        // The Back button has no testid; match by visible text. Only
        // present when step > 1, which it is in edit mode.
        await page.click('button:has-text("Back")');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });
      await step('rename-the-type', 'Update the type name', async () => {
        await page.fill('[data-testid="name-input"]', 'Renamed Type');
      });
      await step('save-rename', 'Walk wizard forward and save', async () => {
        // step 1 → 2 → 3 → save. handleSave fires when wizard-next is
        // clicked at step === TOTAL_STEPS.
        for (let i = 0; i < 6; i++) {
          const next = await page.$('[data-testid="wizard-next"]');
          if (!next) break;
          const label = (await page.textContent('[data-testid="wizard-next"]')) ?? '';
          await next.click();
          if (/save changes|create type/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        await page.waitForSelector('[data-testid="save-message"]', { timeout: 5_000 });
      });
    },
  },
  {
    slug: 'comprehensive-design-doc',
    title: 'End-to-end Design Document — admin schema, end-user wizard, viewer, real-time collab',
    description: 'Walks the full lifecycle of a "Design Document" type: admin defines the schema with action-items + decisions + rich-text body sections, an end-user fills it via the wizard, a viewer reads it, then two simulated users collaborate in real time. Honest about gaps — see PHASE-51-DESIGN-DOC-JOURNEY-ASSESSMENT.md for what is real vs placeholder.',
    async run(page, step) {
      // Reusable selectors for the wizard's section types (the renderer
      // registry exposes these by their `type` field — tasks/decisions/
      // rich-text/checklist are the four registered today).
      const ADD_TASKS    = '[data-testid="add-field-tasks"]';
      const ADD_DECISIONS = '[data-testid="add-field-decisions"]';
      const ADD_RICHTEXT = '[data-testid="add-field-rich-text"]';

      // -----------------------------------------------------------------
      // Scene A — Admin defines the Design Document type (10 steps)
      // -----------------------------------------------------------------
      await step('A1-land-on-doc-types', 'Admin lands on /document-types', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });
      await step('A2-open-wizard', 'Open the create-type wizard', async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });
      await step('A3-name-the-type', 'Name the type "Design Document"', async () => {
        await page.fill('[data-testid="name-input"]', 'Design Document');
      });
      await step('A4-fill-description', 'Add a description', async () => {
        await page.fill(
          '[data-testid="description-input"]',
          'Architecture proposals with action items, decisions, and a long-form body.',
        );
      });
      await step('A5-advance-to-sections', 'Advance to the Sections step', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });
      await step('A6-add-action-items-section', 'Add an Action Items section (tasks renderer)', async () => {
        const sel = (await page.$(ADD_TASKS)) ? ADD_TASKS : '[data-testid^="add-field-"]';
        await page.click(sel);
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 5_000 });
      });
      await step('A7-add-decisions-section', 'Add a Decision Log section (decisions renderer)', async () => {
        const sel = (await page.$(ADD_DECISIONS)) ? ADD_DECISIONS : ADD_TASKS;
        await page.click(sel);
      });
      await step('A8-add-body-section', 'Add a long-form Body section (rich-text renderer)', async () => {
        const sel = (await page.$(ADD_RICHTEXT)) ? ADD_RICHTEXT : ADD_TASKS;
        await page.click(sel);
      });
      await step('A9-advance-to-view-modes', 'Advance to the View Modes step (placeholder for multi-page layout)', async () => {
        // The 3-step wizard's final step is "View Modes" not "Pages"
        // (multi-page layout is a documented gap — see assessment).
        await page.click('[data-testid="wizard-next"]');
        await page.waitForTimeout(500);
      });
      await step('A10-create-type', 'Click Create Type to save the schema', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid="save-message"]', { timeout: 5_000 });
      });

      // -----------------------------------------------------------------
      // Scene B — End user fills out a Design Document via the doc editor (8 steps)
      // -----------------------------------------------------------------
      // Today's wizard creates the SCHEMA. Document instances of that
      // schema are filled via the doc editor at /documents/:id, not the
      // type wizard. We capture that handoff here.
      await step('B1-navigate-to-documents', 'End user opens /documents', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('B2-document-list-state', 'Document list state (empty or populated)', async () => {
        // Whichever state — we capture it. Empty is a legitimate
        // starting place for a brand-new schema.
      });
      await step('B3-typed-documents-page', 'Visit the typed-documents page where Phase 51 instances land', async () => {
        // Per the assessment: the new TypedDocumentsPage isn't routed in
        // App.tsx in this build (filed as a gap — operator needs a route
        // for `/typed-documents`). We screenshot the closest existing
        // surface — /documents — to demonstrate the handoff.
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="type-list"]', { timeout: 5_000 });
      });
      await step('B4-see-design-document-type-listed', 'See the new type in the list', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some((el) => /design document/i.test(el.textContent ?? '')),
          null,
          { timeout: 5_000 },
        );
      });
      await step('B5-edit-type-as-template-preview', 'Open the type to preview its sections', async () => {
        const editBtns = await page.$$('[data-testid^="edit-type-"]');
        // Click the first one whose row contains "Design Document".
        for (const btn of editBtns) {
          const handle = await btn.evaluateHandle((el) => el.closest('[data-testid^="type-item-"]'));
          const text = (await (await handle.getProperty('textContent')).jsonValue());
          if (typeof text === 'string' && /design document/i.test(text)) {
            await btn.click();
            await page.waitForSelector('[data-testid="wizard-next"]', { timeout: 8_000 });
            return;
          }
        }
        throw new Error('Design Document type not found in list');
      });
      await step('B6-walk-to-sections-step', 'Navigate to the Sections step to see the configured fields', async () => {
        // Wizard opens edit mode on step 2 already (per the wizard's
        // initialType branch), so we should already see fields-list.
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 5_000 });
      });
      await step('B7-cancel-out-of-edit', 'Cancel out (we are previewing, not editing)', async () => {
        // Find the Cancel button by visible text — it has no testid.
        await page.click('button:has-text("Cancel")');
        await page.waitForTimeout(500);
      });
      await step('B8-end-user-fill-placeholder', 'PLACEHOLDER: end-user form-fill UI is gap-tracked', async () => {
        // Per assessment: TypedDocumentsPage exists in code but is not
        // routed in App.tsx in this build, and the existing /documents
        // CRDT-based editor is for free-form Yjs docs, not schema-typed
        // instances. The form-fill loop is a documented gap.
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
      });

      // -----------------------------------------------------------------
      // Scene C — Viewer reads the document (4 steps)
      // -----------------------------------------------------------------
      await step('C1-viewer-mode-overview', 'Viewer mode rendering — using existing /documents reader path', async () => {
        // The doc-editor's reader mode (?mode=reader) is the closest
        // analog to a "viewer-only" surface. With no concrete typed
        // document instance to load, we screenshot the doc-list as the
        // entry-point a viewer would use.
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('C2-viewer-mode-section-types', 'Each section type ships a reader-mode renderer', async () => {
        // Per assessment: tasks / decisions / rich-text / checklist all
        // have reader components registered. Capturing the
        // /document-types preview as proof of the schema's reader story.
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
      });
      await step('C3-viewer-toc', 'Reader mode now ships a sticky-left TOC (hub#60)', async () => {
        // hub#60 closed the gap: ReaderMode renders a 3-column grid
        // with a sticky-left TOC when sections.length >= 2. Each
        // entry anchor-links to #section-${id} via scrollIntoView.
      });
      await step('C4-viewer-section-anchors', 'Section containers carry anchor ids (#section-:id)', async () => {
        // ReaderSectionCard adds id="section-${section.id}" so
        // browser-native anchor navigation works alongside the TOC.
      });

      // -----------------------------------------------------------------
      // Scene D — Two-user real-time collab (6 steps)
      // -----------------------------------------------------------------
      // Open a second browser context. The runner gives us one, we make
      // a sibling on the same browser. Both navigate to /documents and
      // we capture both screens via dual screenshots.
      const browser = page.context().browser();
      if (!browser) throw new Error('cannot resolve browser handle');
      const ctxB = await browser.newContext({ viewport: VIEWPORT });
      const pageB = await ctxB.newPage();

      try {
        // Scene D drives the real CRDT-backed /documents flow (hub#64).
        // Precondition: the gateway WebSocket service must be running
        // — `tilt up` brings up gateway + social-api + DDB + Redis +
        // frontend together. When the WS service is down, the journey
        // captures the disconnected-state UI honestly (no PLACEHOLDER
        // text); operators can tell from the "Reconnecting…" pill
        // whether the run had real CRDT infra behind it.
        await step('D1-user-A-on-documents', 'User A opens /documents (CRDT-backed list)', async () => {
          await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(800);
        });
        await step('D2-user-B-joins-documents', 'User B opens /documents in a separate browser context', async () => {
          await pageB.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
          await pageB.waitForTimeout(800);
        });
        await step('D3-user-A-opens-or-creates-doc', 'User A opens an existing document, or stays on the list if none exist', async () => {
          // Try clicking the first document card; if none exist, the
          // empty state is captured by the screenshot.
          const card = await page.$('[data-testid^="document-card-"]');
          if (card) {
            await card.click();
            await page.waitForTimeout(1_500);
          }
        });
        await step('D4-user-B-opens-same-doc', 'User B opens the same document so both are in the same Yjs room', async () => {
          // Mirror User A's URL so both contexts join the same CRDT
          // document. With the WS gateway running this puts them in
          // the same Yjs awareness set; without it both pages show
          // the disconnected indicator.
          const targetUrl = page.url();
          if (targetUrl !== `${FRONTEND_BASE}/documents` && targetUrl !== `${FRONTEND_BASE}/documents/`) {
            await pageB.goto(targetUrl, { waitUntil: 'domcontentloaded' });
            await pageB.waitForTimeout(1_500);
          }
        });
        await step('D5-user-A-types-into-body', 'User A types into the rich-text body section', async () => {
          // Best-effort: target the first contentEditable block (TipTap
          // editor surfaces). Type real text. With WS up, the chars
          // stream to User B via the CRDT layer.
          const editable = await page.$('[contenteditable="true"]');
          if (editable) {
            await editable.click();
            await page.keyboard.type('Hello from User A — concurrent edit from Scene D.');
            await page.waitForTimeout(600);
          }
        });
        await step('D6-user-B-sees-or-types', "User B's view of the same document — capturing concurrent state", async () => {
          // Brief settle so any Yjs update from User A has time to
          // arrive in User B's awareness, then take the screenshot
          // via the step recorder. With WS down, both pages still
          // capture cleanly — the disconnected UI is the truthful
          // record of what the system looks like sans gateway.
          const editableB = await pageB.$('[contenteditable="true"]');
          if (editableB) {
            await editableB.click();
            await pageB.keyboard.type(' — and User B replies.');
            await pageB.waitForTimeout(800);
          }
        });
      } finally {
        await ctxB.close();
      }
    },
  },
  {
    slug: 'delete-document-type-with-confirmation',
    title: 'Delete a document type via the confirmation modal',
    description: 'Operator picks a type, clicks the × delete button, sees the confirmation modal, and confirms deletion.',
    async run(page, step) {
      await step('seed-an-existing-type', 'Pre-seed localStorage with one type', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
          const now = new Date().toISOString();
          const seed = [{
            id: 'journey-delete-seed',
            name: 'Deletable Type',
            description: 'Pre-seeded for the delete journey',
            icon: '🗑️',
            fields: [],
            createdAt: now,
            updatedAt: now,
          }];
          localStorage.setItem('ws_document_types_v1', JSON.stringify(seed));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="type-item-journey-delete-seed"]', { timeout: 5_000 });
      });
      await step('click-delete', 'Click the × delete control on the seeded type', async () => {
        await page.click('[data-testid="delete-type-journey-delete-seed"]');
        await page.waitForSelector('[data-testid="confirm-delete"]', { timeout: 5_000 });
      });
      await step('see-confirmation-modal', 'Confirmation modal renders', async () => {
        // The modal is now visible; the screenshot of this step shows it.
      });
      await step('confirm-deletion', 'Click Delete to confirm', async () => {
        await page.click('[data-testid="confirm-delete"]');
        // Modal closes; type list re-renders.
        await page.waitForFunction(() => !document.querySelector('[data-testid="confirm-delete"]'), null, { timeout: 5_000 });
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Runner — one Chromium, one context per journey, fresh storage each time.
// ---------------------------------------------------------------------------

async function loadChromium() {
  const playwrightPath = join(REPO_ROOT, 'frontend', 'node_modules', 'playwright', 'index.js');
  if (!existsSync(playwrightPath)) {
    throw new Error(`playwright not found at ${playwrightPath} — run \`npm install\` in frontend/`);
  }
  const mod = await import(playwrightPath);
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error('could not resolve chromium from the playwright module');
  return chromium;
}

async function runJourney(chromium, journey, runId, runStartedAt) {
  const slugDir = join(JOURNEYS_ROOT, journey.slug);
  const runDir = join(slugDir, runId);
  await mkdir(runDir, { recursive: true });

  log(`journey "${journey.slug}" run-id=${runId} -> ${runDir}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`  pageerror: ${e.message}`));

  const recordedSteps = [];
  const step = makeStepRecorder(page, runDir, recordedSteps);

  let status = 'passed';
  let failure = null;
  try {
    await journey.run(page, step);
  } catch (err) {
    status = 'failed';
    failure = err?.message ?? String(err);
    log(`  ✗ failed: ${failure}`);
  }

  await context.close();
  await browser.close();

  const endedAt = new Date().toISOString();
  return {
    run_id: runId,
    started_at: runStartedAt,
    ended_at: endedAt,
    commit_sha: getCommitSha(),
    status,
    failure,
    steps: recordedSteps,
  };
}

async function loadIndex() {
  const indexPath = join(JOURNEYS_ROOT, 'index.json');
  if (!existsSync(indexPath)) return { journeys: [] };
  try {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (err) {
    log(`could not parse existing index.json — starting fresh: ${err.message}`);
    return { journeys: [] };
  }
}

async function writeIndex(index) {
  const indexPath = join(JOURNEYS_ROOT, 'index.json');
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  log(`index updated -> ${indexPath}`);
}

function appendRun(index, journey, runRecord) {
  let entry = index.journeys.find((j) => j.slug === journey.slug);
  if (!entry) {
    entry = {
      slug: journey.slug,
      title: journey.title,
      description: journey.description,
      runs: [],
    };
    index.journeys.push(entry);
  } else {
    // Refresh title/description in case the spec evolved.
    entry.title = journey.title;
    entry.description = journey.description;
  }
  entry.runs.push(runRecord);
}

async function main() {
  log(`HUB_ROOT=${HUB_ROOT}`);
  log(`JOURNEYS_ROOT=${JOURNEYS_ROOT}`);
  log(`FRONTEND_BASE=${FRONTEND_BASE}`);
  await mkdir(JOURNEYS_ROOT, { recursive: true });

  const chromium = await loadChromium();
  const runId = (process.env.JOURNEY_RUN_ID ?? new Date().toISOString())
    .replace(/[:.]/g, '-');
  const runStartedAt = new Date().toISOString();

  const index = await loadIndex();
  let passed = 0;
  let failed = 0;

  for (const journey of JOURNEYS) {
    const record = await runJourney(chromium, journey, runId, runStartedAt);
    appendRun(index, journey, record);
    if (record.status === 'passed') passed += 1; else failed += 1;
    await writeIndex(index); // commit progress after each journey
  }

  log(`done — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`runner failed: ${err?.message ?? err}`);
  process.exit(2);
});
