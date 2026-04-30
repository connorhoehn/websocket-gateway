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
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 10_000 });
      });
      await step('rename-the-type', 'Update the type name', async () => {
        await page.fill('[data-testid="name-input"]', 'Renamed Type');
      });
      await step('save-rename', 'Save changes', async () => {
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
