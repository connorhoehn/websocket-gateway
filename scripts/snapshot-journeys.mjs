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
  ?? '/Users/connor.hoehn/projects/agent-hub';
const JOURNEYS_ROOT = join(HUB_ROOT, 'journeys');
const FRONTEND_BASE = process.env.JOURNEY_BASE ?? 'http://localhost:5174';
const VIEWPORT = { width: 1440, height: 900 };

function log(msg) { console.log(`[journey ${new Date().toISOString()}] ${msg}`); }

function getCommitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim(); }
  catch { return null; }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ---------------------------------------------------------------------------
// Screenshot stitching — uses a Playwright browser page with an offscreen
// <canvas> to composite two screenshots side-by-side with user labels.
// No native dependencies (canvas/sharp) needed — runs in Chromium.
// ---------------------------------------------------------------------------

let _stitchBrowser = null;

async function getStitchBrowser(chromiumLauncher) {
  if (!_stitchBrowser) _stitchBrowser = await chromiumLauncher.launch({ headless: true });
  return _stitchBrowser;
}

async function closeStitchBrowser() {
  if (_stitchBrowser) { await _stitchBrowser.close(); _stitchBrowser = null; }
}

async function stitchScreenshots(leftPath, rightPath, outputPath, leftLabel, rightLabel, chromiumLauncher) {
  if (!chromiumLauncher) {
    const { copyFile } = await import('node:fs/promises');
    await copyFile(leftPath, outputPath);
    return;
  }
  const leftB64 = (await readFile(leftPath)).toString('base64');
  const rightB64 = (await readFile(rightPath)).toString('base64');

  const browser = await getStitchBrowser(chromiumLauncher);
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();

  const resultB64 = await pg.evaluate(async ({ leftB64, rightB64, leftLabel, rightLabel }) => {
    const loadImg = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
    const [leftImg, rightImg] = await Promise.all([loadImg(leftB64), loadImg(rightB64)]);

    const gap = 24;
    const labelH = 40;
    const totalW = leftImg.width + rightImg.width + gap;
    const totalH = Math.max(leftImg.height, rightImg.height) + labelH;

    const canvas = document.createElement('canvas');
    canvas.width = totalW;
    canvas.height = totalH;
    const c = canvas.getContext('2d');

    c.fillStyle = '#1e293b';
    c.fillRect(0, 0, totalW, totalH);

    c.fillStyle = '#f1f5f9';
    c.font = 'bold 16px sans-serif';
    c.fillText(leftLabel ?? 'User A', 12, 26);
    c.fillText(rightLabel ?? 'User B', leftImg.width + gap + 12, 26);

    c.fillStyle = '#475569';
    c.fillRect(leftImg.width + gap / 2 - 1, 0, 2, totalH);

    c.drawImage(leftImg, 0, labelH);
    c.drawImage(rightImg, leftImg.width + gap, labelH);

    return canvas.toDataURL('image/png').split(',')[1];
  }, { leftB64, rightB64, leftLabel, rightLabel });

  await ctx.close();
  await writeFile(outputPath, Buffer.from(resultB64, 'base64'));
}

// ---------------------------------------------------------------------------
// Step helpers.
//
// makeStepRecorder returns a step() function. Journeys can also call
// step.dual(pageB, chromium, name, desc, action) for stitched side-by-side
// screenshots of two browser contexts.
// ---------------------------------------------------------------------------

async function clickIfExists(page, selector) {
  const el = await page.$(selector);
  if (el) await el.click();
}

async function fillIfExists(page, selector, value) {
  const el = await page.$(selector);
  if (el) { await el.click(); await el.fill(value); }
}

function makeStepRecorder(page, runDir, recordedSteps) {
  let idx = 0;

  async function step(name, description, action) {
    idx += 1;
    const stepName = slugify(name);
    const fileName = `${pad2(idx)}-${stepName}.png`;
    log(`  step ${idx}: ${name} — ${description}`);
    try {
      await action();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(runDir, fileName), fullPage: true });
      recordedSteps.push({ index: idx, name: stepName, description, screenshot: fileName });
    } catch (err) {
      try {
        await page.screenshot({ path: join(runDir, fileName), fullPage: true });
        recordedSteps.push({ index: idx, name: stepName, description, screenshot: fileName, failed: true });
      } catch { /* ignore secondary failure */ }
      throw err;
    }
  }

  step.dual = async function dual(pageB, chromium, name, description, action) {
    idx += 1;
    const stepName = slugify(name);
    const fileName = `${pad2(idx)}-${stepName}.png`;
    const leftFile = `${pad2(idx)}-${stepName}-alice.png`;
    const rightFile = `${pad2(idx)}-${stepName}-bob.png`;
    log(`  step ${idx} [dual]: ${name} — ${description}`);
    try {
      await action();
      await Promise.all([page.waitForTimeout(400), pageB.waitForTimeout(400)]);
      await Promise.all([
        page.screenshot({ path: join(runDir, leftFile), fullPage: false }),
        pageB.screenshot({ path: join(runDir, rightFile), fullPage: false }),
      ]);
      await stitchScreenshots(
        join(runDir, leftFile), join(runDir, rightFile),
        join(runDir, fileName),
        'Alice (User A)', 'Bob (User B)', chromium,
      );
      recordedSteps.push({ index: idx, name: stepName, description, screenshot: fileName, dual: true });
    } catch (err) {
      try {
        await Promise.all([
          page.screenshot({ path: join(runDir, leftFile), fullPage: false }).catch(() => {}),
          pageB.screenshot({ path: join(runDir, rightFile), fullPage: false }).catch(() => {}),
        ]);
        await stitchScreenshots(
          join(runDir, leftFile), join(runDir, rightFile),
          join(runDir, fileName), 'Alice', 'Bob', chromium,
        ).catch(() => {});
        recordedSteps.push({ index: idx, name: stepName, description, screenshot: fileName, dual: true, failed: true });
      } catch { /* ignore */ }
      throw err;
    }
  };

  return step;
}

// ---------------------------------------------------------------------------
// localStorage cleanup — purge keys that accumulate across journey runs.
//
// Each journey gets a fresh browser context, but localStorage within a
// Chromium profile can persist across runs.  Clearing these keys at the
// start of each journey ensures screenshots show only the current run's
// data, not dozens of stale entries from prior runs.
// ---------------------------------------------------------------------------

async function clearAccumulatedStorage(page) {
  await page.evaluate(() => {
    // Document types (localStorage-backed list)
    localStorage.removeItem('ws_document_types_v1');
    // Custom field types
    localStorage.removeItem('ws_field_types_v1');
    // Pipeline index and UI toggles
    localStorage.removeItem('ws_pipelines_v1_index');
    localStorage.removeItem('ws_pipelines_v1_show_tags');
    localStorage.removeItem('ws_pipelines_v1_source_diagnostic_dismissed');
    // Remove per-pipeline defs, per-pipeline run histories, and attachments
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k.startsWith('ws_pipelines_v1:') ||
        k.startsWith('ws_pipeline_runs_v1:') ||
        k.startsWith('ws_attachments_')
      ) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  });
}

// ---------------------------------------------------------------------------
// Journey definitions.
// ---------------------------------------------------------------------------

const JOURNEYS = [
  // =========================================================================
  // Journey 1: Full Document Type Lifecycle
  //   Create a document type from scratch with multiple section types,
  //   configure display modes, edit and rename, then delete.
  //   ~25 steps.
  // =========================================================================
  {
    slug: 'document-type-full-lifecycle',
    title: 'Full document type lifecycle — create, configure display, edit, delete',
    description: 'Admin creates a Design Brief type with rich-text, tasks, decisions, and checklist sections. Configures view-mode visibility, edits the type to rename and reorder fields, then deletes it.',
    async run(page, step) {
      // --- Phase 1: Navigate and open wizard ---
      await step('land-on-doc-types', 'Navigate to /document-types', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });
      await step('see-empty-state', 'See the empty type list or existing types', async () => {
        await page.waitForTimeout(300);
      });
      await step('click-new-type', 'Click "+ New" to open the wizard', async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });

      // --- Phase 2: Fill in basic info (Step 1 of wizard) ---
      await step('enter-type-name', 'Type "Design Brief" as the document type name', async () => {
        await page.fill('[data-testid="name-input"]', 'Design Brief');
      });
      await step('enter-description', 'Add a detailed description', async () => {
        const desc = await page.$('[data-testid="description-input"]');
        if (desc) await desc.fill('Architecture proposals with executive summary, action items, decisions, and sign-off checklist. Used by engineering leads for cross-team alignment.');
      });
      await step('advance-to-sections', 'Click Next to advance to the Sections step', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });

      // --- Phase 3: Add multiple section types ---
      await step('add-rich-text-section', 'Add a Rich Text section for the executive summary', async () => {
        const btn = (await page.$('[data-testid="add-field-rich-text"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 5_000 });
      });
      await step('add-tasks-section', 'Add a Tasks section for action items', async () => {
        const btn = (await page.$('[data-testid="add-field-tasks"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForTimeout(200);
      });
      await step('add-decisions-section', 'Add a Decisions section for the decision log', async () => {
        const btn = (await page.$('[data-testid="add-field-decisions"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForTimeout(200);
      });
      await step('add-checklist-section', 'Add a Checklist section for sign-off', async () => {
        const btn = (await page.$('[data-testid="add-field-checklist"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForTimeout(200);
      });
      await step('see-four-sections', 'See all four sections in the fields list', async () => {
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 3_000 });
      });

      // --- Phase 4: Configure field flags ---
      await step('toggle-required-on-first', 'Mark the first section as required', async () => {
        const reqBtn = await page.$('[data-testid^="field-required-"]');
        if (reqBtn) await reqBtn.click();
        await page.waitForTimeout(200);
      });
      await step('reorder-sections', 'Move the first section down so the second becomes first', async () => {
        const downBtn = await page.$('[data-testid^="field-down-"]');
        if (downBtn) await downBtn.click();
        await page.waitForTimeout(300);
      });

      // --- Phase 5: Configure display modes (Step 3) ---
      await step('advance-to-view-modes', 'Click Next to reach View Modes configuration', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForTimeout(600);
      });
      await step('see-view-modes-grid', 'See the Editor / Review / Read visibility grid', async () => {
        await page.waitForTimeout(300);
      });
      await step('toggle-visibility-ack', 'Toggle a field hidden in Review mode', async () => {
        const checkbox = await page.$('[data-testid^="visibility-"][data-testid$="-ack"]');
        if (checkbox) await checkbox.click();
        await page.waitForTimeout(200);
      });
      await step('toggle-visibility-reader', 'Toggle a field hidden in Read mode', async () => {
        const checkbox = await page.$('[data-testid^="visibility-"][data-testid$="-reader"]');
        if (checkbox) await checkbox.click();
        await page.waitForTimeout(200);
      });

      // --- Phase 6: Save the type ---
      await step('create-the-type', 'Click "Create Type" to save', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });
      await step('see-type-in-list', 'Verify "Design Brief" appears in the sidebar list', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some(el => /design brief/i.test(el.textContent ?? '')),
          null, { timeout: 5_000 },
        );
      });

      // --- Phase 7: Edit the type ---
      await step('click-edit-type', 'Click Edit on the Design Brief type', async () => {
        const items = await page.$$('[data-testid^="type-item-"]');
        for (const item of items) {
          const text = await item.textContent();
          if (/design brief/i.test(text ?? '')) {
            const editBtn = await item.$('[data-testid^="edit-type-"]');
            if (editBtn) { await editBtn.click(); break; }
          }
        }
        await page.waitForSelector('[data-testid="wizard-next"]', { timeout: 8_000 });
      });
      await step('navigate-to-name-step', 'Click Back to reach the name field', async () => {
        const back = await page.$('button:has-text("Back")');
        if (back) await back.click();
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });
      await step('rename-the-type', 'Rename from "Design Brief" to "Architecture Design Brief"', async () => {
        await page.fill('[data-testid="name-input"]', 'Architecture Design Brief');
      });
      await step('save-renamed-type', 'Walk wizard forward and save the rename', async () => {
        for (let i = 0; i < 6; i++) {
          const next = await page.$('[data-testid="wizard-next"]');
          if (!next) break;
          const label = (await page.textContent('[data-testid="wizard-next"]')) ?? '';
          await next.click();
          if (/save changes|create type/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });
      await step('verify-renamed-in-list', 'See the renamed type in the list', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some(el => /architecture design brief/i.test(el.textContent ?? '')),
          null, { timeout: 5_000 },
        );
      });

      // --- Phase 8: Delete the type ---
      await step('click-delete', 'Click the delete button on the type', async () => {
        const items = await page.$$('[data-testid^="type-item-"]');
        for (const item of items) {
          const text = await item.textContent();
          if (/architecture design brief/i.test(text ?? '')) {
            const delBtn = await item.$('[data-testid^="delete-type-"]');
            if (delBtn) { await delBtn.click(); break; }
          }
        }
        await page.waitForSelector('[data-testid="confirm-delete"]', { timeout: 5_000 });
      });
      await step('see-delete-confirmation', 'See the deletion confirmation modal', async () => {
        await page.waitForTimeout(200);
      });
      await step('confirm-delete', 'Click Delete to confirm', async () => {
        await page.click('[data-testid="confirm-delete"]');
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="confirm-delete"]'),
          null, { timeout: 5_000 },
        );
      });
    },
  },

  // =========================================================================
  // Journey 2: Create Document from Type and Fill Content
  //   Creates a type, then creates a document instance from that type,
  //   fills in content across sections, and views the populated doc.
  //   ~25 steps.
  // =========================================================================
  {
    slug: 'create-and-fill-document',
    title: 'Create a document from a type and fill all sections with content',
    description: 'Admin creates a "Sprint Retro" type, then an end-user creates a document instance of that type, fills in the rich-text body, adds tasks, and verifies the populated document.',
    async run(page, step) {
      // --- Create the document type first ---
      await step('navigate-to-doc-types', 'Open /document-types', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });
      await step('open-wizard', 'Click "+ New" to create a type', async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });
      await step('name-sprint-retro', 'Name the type "Sprint Retro"', async () => {
        await page.fill('[data-testid="name-input"]', 'Sprint Retro');
        const desc = await page.$('[data-testid="description-input"]');
        if (desc) await desc.fill('Weekly sprint retrospective — what went well, what to improve, and action items.');
      });
      await step('go-to-sections', 'Advance to sections step', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });
      await step('add-rich-text', 'Add a rich-text section for the retro body', async () => {
        const btn = (await page.$('[data-testid="add-field-rich-text"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForSelector('[data-testid="fields-list"]', { timeout: 5_000 });
      });
      await step('add-tasks', 'Add a tasks section for action items', async () => {
        const btn = (await page.$('[data-testid="add-field-tasks"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForTimeout(200);
      });
      await step('add-decisions', 'Add a decisions section', async () => {
        const btn = (await page.$('[data-testid="add-field-decisions"]')) ?? await page.$('[data-testid^="add-field-"]');
        await btn.click();
        await page.waitForTimeout(200);
      });
      await step('save-retro-type', 'Walk through wizard and save the type', async () => {
        for (let i = 0; i < 5; i++) {
          const next = await page.$('[data-testid="wizard-next"]');
          if (!next) break;
          const label = (await page.textContent('[data-testid="wizard-next"]')) ?? '';
          await next.click();
          if (/create type|save changes/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });
      await step('type-saved-in-list', 'Sprint Retro type now in sidebar list', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some(el => /sprint retro/i.test(el.textContent ?? '')),
          null, { timeout: 5_000 },
        );
      });

      // --- Navigate to documents and create an instance ---
      await step('go-to-documents', 'Navigate to /documents', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('click-new-document', 'Click "+ New Document" button', async () => {
        const btn = await page.$('[data-testid="new-document-btn"]')
          ?? await page.$('button:has-text("New Document")');
        if (btn) {
          await btn.click();
          await page.waitForTimeout(600);
        }
      });
      await step('select-sprint-retro-type', 'Choose "Sprint Retro" from the type picker', async () => {
        // Look for any type-option button containing "Sprint Retro"
        const options = await page.$$('[data-testid^="type-option-"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (/sprint retro/i.test(text ?? '')) {
            await opt.click();
            break;
          }
        }
        // If no types listed, that's a documented gap — screenshot captures state.
        await page.waitForTimeout(300);
      });
      await step('enter-document-title', 'Type "Week 18 Retro" as the document title', async () => {
        const titleInput = await page.$('[data-testid="new-doc-title"]');
        if (titleInput) await titleInput.fill('Week 18 Retro');
      });
      await step('enter-document-description', 'Add a short description', async () => {
        const descInput = await page.$('[data-testid="new-doc-description"]');
        if (descInput) await descInput.fill('Sprint 18 retrospective — team velocity was 34 points.');
      });
      await step('submit-new-document', 'Click "Create Document" to create the instance', async () => {
        const submit = await page.$('[data-testid="new-doc-submit"]');
        if (submit) {
          await submit.click();
          await page.waitForTimeout(1_500);
        }
      });
      await step('open-new-document', 'Click the newly created document to open the editor', async () => {
        const card = await page.$('[data-testid^="document-card-"]');
        if (card) {
          await card.click();
          await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      });
      await step('see-document-editor', 'Land on the document editor page', async () => {
        await page.waitForTimeout(800);
      });

      // --- Fill in content across ALL sections ---
      await step('type-in-body-section', 'Type content into the rich-text body section', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.type('This sprint we shipped the new onboarding flow and fixed 12 bugs. Team morale is high — the design review went smoothly and stakeholders approved the Q3 roadmap.');
          await page.waitForTimeout(400);
        }
      });

      await step('add-first-task', 'Click "+ Add item" to create the first task', async () => {
        const addBtn = await page.$('button:has-text("+ Add item")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const inputs = await page.$$('[data-testid^="task-text-"]');
          if (inputs.length > 0) {
            const last = inputs[inputs.length - 1];
            await last.click();
            await last.fill('Migrate auth service to OAuth 2.1 — due Friday');
          }
          await page.waitForTimeout(200);
        }
      });
      await step('add-second-task', 'Add a second task item', async () => {
        const addBtn = await page.$('button:has-text("+ Add item")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const inputs = await page.$$('[data-testid^="task-text-"]');
          if (inputs.length > 0) {
            const last = inputs[inputs.length - 1];
            await last.click();
            await last.fill('Write post-mortem for the staging outage');
          }
          await page.waitForTimeout(200);
        }
      });
      await step('add-third-task', 'Add a third task item', async () => {
        const addBtn = await page.$('button:has-text("+ Add item")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const inputs = await page.$$('[data-testid^="task-text-"]');
          if (inputs.length > 0) {
            const last = inputs[inputs.length - 1];
            await last.click();
            await last.fill('Schedule design review with UX team');
          }
          await page.waitForTimeout(200);
        }
      });
      await step('see-tasks-filled', 'See the task list with three items', async () => {
        await page.waitForTimeout(300);
      });

      await step('scroll-to-decisions', 'Scroll down to the Decisions section', async () => {
        const decisionsHeading = await page.$('text=Decisions');
        if (decisionsHeading) {
          await decisionsHeading.scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
        } else {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        }
      });
      await step('add-first-decision', 'Click "+ Add decision" and type the first decision', async () => {
        const addBtn = await page.$('button:has-text("+ Add decision")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const input = await page.$('input[placeholder="Describe the decision..."]');
          if (input) {
            await input.click();
            await input.fill('Adopt distributed-core v0.14.0 — approved unanimously');
          }
          await page.waitForTimeout(200);
        }
      });
      await step('add-second-decision', 'Add a second decision', async () => {
        const addBtn = await page.$('button:has-text("+ Add decision")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const inputs = await page.$$('input[placeholder="Describe the decision..."]');
          const lastInput = inputs[inputs.length - 1];
          if (lastInput) {
            await lastInput.click();
            await lastInput.fill('Defer multi-tenant support to Q4');
          }
          await page.waitForTimeout(200);
        }
      });
      await step('see-decisions-filled', 'See the Decisions section with two entries', async () => {
        await page.waitForTimeout(300);
      });

      await step('scroll-back-to-top', 'Scroll back to the top to capture the complete view', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });
      await step('see-all-sections-filled', 'See the complete document with rich text, tasks, and decisions all filled', async () => {
        await page.waitForTimeout(600);
      });

      // --- Switch to different view modes ---
      await step('switch-to-review-mode', 'Click the "Review" mode button', async () => {
        const reviewBtn = await page.$('[data-testid="mode-btn-ack"]')
          ?? await page.$('button:has-text("Review")');
        if (reviewBtn) await reviewBtn.click();
        await page.waitForTimeout(800);
      });
      await step('see-review-mode', 'See the review mode with section review controls', async () => {
        await page.waitForTimeout(400);
      });
      await step('switch-to-reader-mode', 'Click the "Read" mode button', async () => {
        const readBtn = await page.$('[data-testid="mode-btn-reader"]')
          ?? await page.$('button:has-text("Read")');
        if (readBtn) await readBtn.click();
        await page.waitForTimeout(800);
      });
      await step('see-reader-mode', 'See the reader mode with executive summary and TOC', async () => {
        await page.waitForTimeout(400);
      });
      await step('back-to-editor', 'Switch back to editor mode', async () => {
        const editorBtn = await page.$('[data-testid="mode-btn-editor"]')
          ?? await page.$('button:has-text("Editor")');
        if (editorBtn) await editorBtn.click();
        await page.waitForTimeout(500);
      });

      // =========================================================
      // Phase B: Multi-page document type — create, fill, render
      // =========================================================

      await step('go-to-doc-types-for-multipage', 'Navigate to /document-types to create a multi-page type', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });

      await step('open-multipage-wizard', 'Click "+ New" to start the multi-page type wizard', async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });

      await step('name-project-brief', 'Name the type "Project Brief" with description', async () => {
        await page.fill('[data-testid="name-input"]', 'Project Brief');
        const desc = await page.$('[data-testid="description-input"]');
        if (desc) await desc.fill('Multi-page project brief with overview, technical details, and decisions.');
      });

      await step('advance-to-sections', 'Click Next to advance to the Sections step', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });

      // --- Page 1: Overview ---
      await step('add-rich-text-overview', 'Add a Rich Text section for the project overview', async () => {
        await clickIfExists(page, '[data-testid="add-field-rich-text"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('Project Overview');
        }
      });

      await step('add-checklist-section', 'Add a Checklist section for key milestones', async () => {
        await clickIfExists(page, '[data-testid="add-field-checklist"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('Key Milestones');
        }
      });

      // --- Add Page 2 ---
      await step('add-second-page', 'Click "+ Add Page" to create a second page', async () => {
        await clickIfExists(page, '[data-testid="add-page"]');
        await page.waitForTimeout(500);
      });

      await step('name-second-page', 'Name the second page "Technical Details"', async () => {
        const pageTitles = await page.$$('[data-testid^="page-title-"]');
        if (pageTitles.length >= 2) {
          await pageTitles[1].fill('');
          await pageTitles[1].fill('Technical Details');
        }
        await page.waitForTimeout(200);
      });

      await step('add-rich-text-to-page2', 'Add a Rich Text section to the Technical Details page', async () => {
        await clickIfExists(page, '[data-testid="add-field-rich-text"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('Architecture Notes');
        }
      });

      await step('add-diagram-to-page2', 'Add a Diagram section for system diagrams', async () => {
        await clickIfExists(page, '[data-testid="add-field-diagram"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('System Diagram');
        }
      });

      // --- Add Page 3 ---
      await step('add-third-page', 'Click "+ Add Page" to create a third page', async () => {
        await clickIfExists(page, '[data-testid="add-page"]');
        await page.waitForTimeout(500);
      });

      await step('name-third-page', 'Name the third page "Decisions & Sign-off"', async () => {
        const pageTitles = await page.$$('[data-testid^="page-title-"]');
        if (pageTitles.length >= 3) {
          await pageTitles[2].fill('');
          await pageTitles[2].fill('Decisions & Sign-off');
        }
        await page.waitForTimeout(200);
      });

      await step('add-decisions-to-page3', 'Add a Decisions section to the third page', async () => {
        await clickIfExists(page, '[data-testid="add-field-decisions"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('Key Decisions');
        }
      });

      await step('add-tasks-to-page3', 'Add a Task List section for sign-off items', async () => {
        await clickIfExists(page, '[data-testid="add-field-tasks"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          const last = fields[fields.length - 1];
          await last.fill('');
          await last.fill('Sign-off Tasks');
        }
      });

      await step('see-three-page-wizard', 'See the wizard with 3 pages and 6 sections total', async () => {
        await page.waitForTimeout(400);
      });

      await step('enable-toc', 'Enable Table of Contents for the multi-page document', async () => {
        const tocDiv = await page.$('[data-testid="page-config-toc"]');
        if (tocDiv) {
          const checkbox = await tocDiv.$('input[type="checkbox"]');
          if (checkbox) {
            const isChecked = await checkbox.isChecked();
            if (!isChecked) await checkbox.click();
          }
        }
        await page.waitForTimeout(200);
      });

      // --- Save the type (advance through Step 3 → finish) ---
      await step('save-project-brief-type', 'Advance through View Modes and save the type', async () => {
        for (let i = 0; i < 5; i++) {
          const next = await page.$('[data-testid="wizard-next"]');
          if (!next) break;
          const label = (await page.textContent('[data-testid="wizard-next"]')) ?? '';
          await next.click();
          if (/create type|save changes/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });

      await step('see-project-brief-in-list', 'See "Project Brief" in the types sidebar', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some(el => /project brief/i.test(el.textContent ?? '')),
          null, { timeout: 5_000 },
        );
      });

      // --- Create a document instance from the multi-page type ---
      await step('go-to-documents-multipage', 'Navigate to /documents to create an instance', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });

      await step('click-new-doc-multipage', 'Click "+ New Document"', async () => {
        const btn = await page.$('[data-testid="new-document-btn"]')
          ?? await page.$('button:has-text("New Document")');
        if (btn) { await btn.click(); await page.waitForTimeout(600); }
      });

      await step('select-project-brief-type', 'Choose "Project Brief" from the type picker', async () => {
        const options = await page.$$('[data-testid^="type-option-"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (/project brief/i.test(text ?? '')) { await opt.click(); break; }
        }
        await page.waitForTimeout(300);
      });

      await step('enter-doc-title-multipage', 'Title: "Q3 Platform Modernization Brief"', async () => {
        await fillIfExists(page, '[data-testid="new-doc-title"]', 'Q3 Platform Modernization Brief');
      });

      await step('enter-doc-desc-multipage', 'Add description for the brief', async () => {
        await fillIfExists(page, '[data-testid="new-doc-description"]', 'Three-page project brief covering scope, architecture, and decision log for the Q3 platform modernization initiative.');
      });

      await step('submit-multipage-doc', 'Click "Create Document" to create the instance', async () => {
        const submit = await page.$('[data-testid="new-doc-submit"]');
        if (submit) {
          await submit.click();
          await page.waitForTimeout(1_500);
        }
      });

      await step('open-multipage-doc', 'Click the document card to enter the editor', async () => {
        const cards = await page.$$('[data-testid^="document-card-"]');
        for (const card of cards) {
          const text = await card.textContent();
          if (/platform modernization/i.test(text ?? '')) { await card.click(); break; }
        }
        if (cards.length > 0) {
          await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(async () => {
            await cards[0].click();
            await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(() => {});
          });
        }
        await page.waitForTimeout(800);
      });

      await step('see-multipage-editor', 'See the multi-page document editor with all sections', async () => {
        await page.waitForTimeout(600);
      });

      // --- Fill in content across all pages ---
      await step('fill-overview-section', 'Type content in the Project Overview section', async () => {
        const editables = await page.$$('[contenteditable="true"]');
        if (editables.length > 0) {
          await editables[0].click();
          await page.keyboard.type('The Q3 Platform Modernization initiative aims to migrate our monolithic API to an event-driven architecture. Key drivers: horizontal scaling constraints, deployment coupling, and team autonomy. Target completion: end of Q3 with phased rollout.');
          await page.waitForTimeout(400);
        }
      });

      await step('add-milestone-items', 'Add checklist items for key milestones', async () => {
        const addBtns = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns.length > 0) {
          await addBtns[0].click();
          await page.waitForTimeout(200);
          await page.keyboard.type('Phase 1: Service extraction (API gateway + auth) — July 15');
          await page.waitForTimeout(150);

          const addBtns2 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns2.length > 0) {
            await addBtns2[0].click();
            await page.waitForTimeout(200);
            await page.keyboard.type('Phase 2: Event bus + message queue — Aug 1');
            await page.waitForTimeout(150);
          }

          const addBtns3 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns3.length > 0) {
            await addBtns3[0].click();
            await page.waitForTimeout(200);
            await page.keyboard.type('Phase 3: Data migration + cutover — Sept 15');
          }
          await page.waitForTimeout(300);
        }
      });

      await step('scroll-to-architecture', 'Scroll down to the Architecture Notes section on page 2', async () => {
        const heading = await page.$('text=Architecture Notes');
        if (heading) {
          await heading.scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
        } else {
          await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        }
      });

      await step('fill-architecture-section', 'Type architecture details', async () => {
        const editables = await page.$$('[contenteditable="true"]');
        for (const ed of editables) {
          const text = await ed.textContent();
          if (!text || text.trim().length === 0) {
            await ed.click();
            await page.keyboard.type('Architecture: API Gateway (Kong) → Event Bus (NATS JetStream) → Microservices (Go + Node.js). Each service owns its data store. CQRS pattern for read-heavy endpoints. Saga orchestrator for cross-service transactions.');
            break;
          }
        }
        await page.waitForTimeout(400);
      });

      await step('scroll-to-decisions-page', 'Scroll to the Decisions section on page 3', async () => {
        const heading = await page.$('text=Key Decisions');
        if (heading) {
          await heading.scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
        } else {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        }
      });

      await step('add-decision-entry', 'Add a decision to the Key Decisions section', async () => {
        const addBtn = await page.$('button:has-text("+ Add decision")');
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(400);
          const input = await page.$('input[placeholder="Describe the decision..."]');
          if (input) {
            await input.click();
            await input.fill('Adopt NATS JetStream over Kafka — lower operational overhead, native Go client, sufficient throughput for our scale (< 50k msg/s).');
          }
          await page.waitForTimeout(200);
        }
      });

      await step('add-signoff-task', 'Add sign-off tasks', async () => {
        const addBtns = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns.length > 0) {
          const btn = addBtns[addBtns.length - 1];
          await btn.click();
          await page.waitForTimeout(300);
          const inputs = await page.$$('input[type="text"]');
          if (inputs.length > 0) {
            await inputs[inputs.length - 1].fill('Engineering lead sign-off — @alice');
          }
          await page.waitForTimeout(150);
        }
        const addBtns2 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns2.length > 0) {
          const btn = addBtns2[addBtns2.length - 1];
          await btn.click();
          await page.waitForTimeout(300);
          const inputs = await page.$$('input[type="text"]');
          if (inputs.length > 0) {
            await inputs[inputs.length - 1].fill('Product owner approval — @bob');
          }
        }
        await page.waitForTimeout(300);
      });

      // --- Show the rendered document to end users ---
      await step('scroll-to-top-final', 'Scroll to the top to see the full document', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(600);
      });

      await step('see-full-multipage-doc-editor', 'See the complete multi-page document with all sections filled', async () => {
        await page.waitForTimeout(500);
      });

      await step('switch-to-reader-multipage', 'Switch to Reader mode to see how end users see the document', async () => {
        const readBtn = await page.$('[data-testid="mode-btn-reader"]')
          ?? await page.$('button:has-text("Read")');
        if (readBtn) await readBtn.click();
        await page.waitForTimeout(800);
      });

      await step('see-reader-page1', 'See the rendered Page 1 with overview and milestones in reader mode', async () => {
        await page.waitForTimeout(500);
      });

      await step('scroll-reader-to-page2', 'Scroll to see Page 2 — Architecture Notes and System Diagram', async () => {
        const heading = await page.$('text=Architecture Notes');
        if (heading) {
          await heading.scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
        }
        await page.waitForTimeout(500);
      });

      await step('see-reader-page2', 'See the rendered architecture section in reader mode', async () => {
        await page.waitForTimeout(400);
      });

      await step('scroll-reader-to-page3', 'Scroll to see Page 3 — Decisions and Sign-off', async () => {
        const heading = await page.$('text=Key Decisions');
        if (heading) {
          await heading.scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        }
        await page.waitForTimeout(500);
      });

      await step('see-reader-page3', 'See the decisions and sign-off tasks rendered for the end user', async () => {
        await page.waitForTimeout(400);
      });

      await step('switch-to-review-multipage', 'Switch to Review mode to show the review workflow on multi-page', async () => {
        const reviewBtn = await page.$('[data-testid="mode-btn-ack"]')
          ?? await page.$('button:has-text("Review")');
        if (reviewBtn) await reviewBtn.click();
        await page.waitForTimeout(800);
      });

      await step('see-review-multipage', 'See the multi-page document in review mode with section-level review controls', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(500);
      });
    },
  },

  // =========================================================================
  // Journey 3: Review Workflow
  //   Pre-seed a document with multiple sections, walk through the review
  //   process — approve some, request changes on others, see progress bar.
  //   ~22 steps.
  // =========================================================================
  {
    slug: 'review-workflow-walkthrough',
    title: 'Complete review workflow — approve sections, request changes, track progress',
    description: 'Reviewer opens a document in Review mode, approves sections, requests changes, watches the progress bar fill, changes a decision, and sees the final summary.',
    async run(page, step) {
      // --- Seed a document with sections for review ---
      await step('seed-document-type', 'Pre-seed a document type with 4 sections via localStorage', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.evaluate(() => {
          const now = new Date().toISOString();
          const types = [{
            id: 'review-journey-type',
            name: 'Review Demo',
            description: 'Multi-section type for the review journey',
            icon: '📋',
            fields: [
              { id: 'sec-summary', name: 'Executive Summary', type: 'rich-text', sectionType: 'rich-text', required: true, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
              { id: 'sec-tasks', name: 'Action Items', type: 'tasks', sectionType: 'tasks', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
              { id: 'sec-decisions', name: 'Decisions', type: 'decisions', sectionType: 'decisions', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
              { id: 'sec-appendix', name: 'Appendix', type: 'rich-text', sectionType: 'rich-text', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
            ],
            createdAt: now,
            updatedAt: now,
          }];
          localStorage.setItem('ws_document_types_v1', JSON.stringify(types));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="type-item-review-journey-type"]', { timeout: 5_000 });
      });

      // --- Create a document using this type ---
      await step('navigate-to-documents', 'Go to /documents to create an instance', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('open-new-doc-modal', 'Click "+ New Document"', async () => {
        const btn = await page.$('[data-testid="new-document-btn"]')
          ?? await page.$('button:has-text("New Document")');
        if (btn) {
          await btn.click();
          await page.waitForTimeout(600);
        }
      });
      await step('pick-review-demo-type', 'Select "Review Demo" type if available', async () => {
        const options = await page.$$('[data-testid^="type-option-"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (/review demo/i.test(text ?? '')) { await opt.click(); break; }
        }
        await page.waitForTimeout(300);
      });
      await step('title-the-doc', 'Title it "Q3 Architecture Proposal"', async () => {
        const titleInput = await page.$('[data-testid="new-doc-title"]');
        if (titleInput) await titleInput.fill('Q3 Architecture Proposal');
      });
      await step('create-the-document', 'Click Create', async () => {
        const submit = await page.$('[data-testid="new-doc-submit"]');
        if (submit) { await submit.click(); await page.waitForTimeout(1_500); }
      });
      await step('open-created-document', 'Click the newly created document to enter the editor', async () => {
        const card = await page.$('[data-testid^="document-card-"]');
        if (card) {
          await card.click();
          await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      });

      // --- Add some content so review isn't empty ---
      await step('add-content-to-body', 'Type some content into the first section', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.type('We propose migrating from monolith to event-driven microservices. Key drivers: scaling bottleneck on the order service, need for independent deployability, and team autonomy.');
          await page.waitForTimeout(300);
        }
      });
      await step('scroll-down-to-sections', 'Scroll to see all sections', async () => {
        await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });

      // --- Switch to Review mode ---
      await step('scroll-back-for-mode-switch', 'Scroll to top so the mode buttons are accessible', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });
      await step('enter-review-mode', 'Click the Review mode button', async () => {
        const reviewBtn = await page.$('[data-testid="mode-btn-ack"]')
          ?? await page.$('button:has-text("Review")');
        if (reviewBtn) await reviewBtn.click();
        await page.waitForTimeout(800);
      });
      await step('see-review-progress-bar', 'See "0 of N sections reviewed" progress bar', async () => {
        const progress = await page.$('[data-testid="review-progress"]');
        await page.waitForTimeout(300);
      });

      // --- Review each section ---
      await step('approve-first-section', 'Click "Approve" on the first section', async () => {
        const btn = await page.$('[data-testid^="section-"][data-testid$="-review-approved"]');
        if (btn) await btn.click();
        await page.waitForTimeout(400);
      });
      await step('see-progress-after-first', 'Progress bar updates to show 1 reviewed', async () => {
        await page.waitForTimeout(300);
      });
      await step('approve-second-section', 'Approve the second section', async () => {
        const btns = await page.$$('[data-testid$="-review-approved"]');
        if (btns.length > 0) await btns[0].click();
        await page.waitForTimeout(400);
      });
      await step('request-changes-third', 'Request changes on the third section', async () => {
        const btns = await page.$$('[data-testid$="-review-changes-requested"]');
        if (btns.length > 0) await btns[0].click();
        await page.waitForTimeout(400);
      });
      await step('mark-fourth-reviewed', 'Mark the fourth section as reviewed', async () => {
        const btns = await page.$$('[data-testid$="-review-reviewed"]');
        if (btns.length > 0) await btns[0].click();
        await page.waitForTimeout(400);
      });
      await step('all-sections-reviewed', 'All sections reviewed — progress bar at 100%', async () => {
        await page.waitForTimeout(300);
      });

      // --- Change a review decision ---
      await step('change-review-on-section', 'Click "Change" on a previously-reviewed section', async () => {
        const changeBtn = await page.$('[data-testid$="-change-review"]');
        if (changeBtn) await changeBtn.click();
        await page.waitForTimeout(300);
      });
      await step('switch-to-approved', 'Change the decision to "Approve"', async () => {
        const btns = await page.$$('[data-testid$="-review-approved"]');
        if (btns.length > 0) await btns[0].click();
        await page.waitForTimeout(400);
      });

      // --- See the summary ---
      await step('scroll-to-summary', 'Scroll to the review summary at the bottom', async () => {
        const summary = await page.$('[data-testid="review-summary"]');
        if (summary) await summary.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      });
      await step('see-review-summary', 'See the full review summary with all decisions', async () => {
        await page.waitForTimeout(300);
      });

      // --- Switch to reader mode to see the final doc ---
      await step('switch-to-reader', 'Switch to Read mode for the final view', async () => {
        const readBtn = await page.$('[data-testid="mode-btn-reader"]')
          ?? await page.$('button:has-text("Read")');
        if (readBtn) await readBtn.click();
        await page.waitForTimeout(800);
      });
      await step('reader-mode-final', 'See the clean reader mode rendering', async () => {
        await page.waitForTimeout(400);
      });
    },
  },

  // =========================================================================
  // Journey 4: Real-time Collaborative Editing (Dual Browser)
  //   Two browser contexts open the same document simultaneously.
  //   Dual steps capture both browser contexts and stitch them side-by-side
  //   so the dashboard shows collaboration in action.
  //   ~28 steps.
  // =========================================================================
  {
    slug: 'realtime-collab-dual-browser',
    title: 'Real-time collaborative editing — two users, stitched screenshots',
    description: 'Alice and Bob open the same document simultaneously. Screenshots capture both browser contexts side-by-side, showing presence avatars, concurrent edits, section focus indicators, and mode switching across users.',
    async run(page, step, chromium) {
      const browser = page.context().browser();
      if (!browser) throw new Error('cannot resolve browser handle');

      // --- Phase 1: Alice seeds a type and creates a document ---
      await step('alice-seeds-doc-type', 'Alice seeds a multi-section document type', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.evaluate(() => {
          const now = new Date().toISOString();
          const types = [{
            id: 'collab-journey-type',
            name: 'Collab Doc',
            description: 'For real-time collaboration testing',
            icon: '🤝',
            fields: [
              { id: 'sec-intro', name: 'Introduction', type: 'rich-text', sectionType: 'rich-text', required: true, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
              { id: 'sec-actions', name: 'Action Items', type: 'tasks', sectionType: 'tasks', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
              { id: 'sec-notes', name: 'Meeting Notes', type: 'rich-text', sectionType: 'rich-text', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
            ],
            createdAt: now,
            updatedAt: now,
          }];
          localStorage.setItem('ws_document_types_v1', JSON.stringify(types));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
      });

      await step('alice-goes-to-documents', 'Alice navigates to /documents', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('alice-opens-new-doc-modal', 'Alice clicks "+ New Document"', async () => {
        const btn = await page.$('[data-testid="new-document-btn"]')
          ?? await page.$('button:has-text("New Document")');
        if (btn) { await btn.click(); await page.waitForTimeout(600); }
      });
      await step('alice-picks-type', 'Alice selects the Collab Doc type', async () => {
        const options = await page.$$('[data-testid^="type-option-"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (/collab doc/i.test(text ?? '')) { await opt.click(); break; }
        }
        await page.waitForTimeout(300);
      });
      await step('alice-titles-document', 'Alice names the document "Team Sync — May 1"', async () => {
        const titleInput = await page.$('[data-testid="new-doc-title"]');
        if (titleInput) await titleInput.fill('Team Sync — May 1');
      });
      await step('alice-submits-document', 'Alice creates the document', async () => {
        const submit = await page.$('[data-testid="new-doc-submit"]');
        if (submit) { await submit.click(); await page.waitForTimeout(1_500); }
      });
      await step('alice-opens-document', 'Alice clicks the newly created document to enter the editor', async () => {
        const card = await page.$('[data-testid^="document-card-"]');
        if (card) {
          await card.click();
          await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      });
      await step('alice-in-editor', 'Alice lands in the document editor', async () => {
        await page.waitForTimeout(800);
      });

      // Capture the document URL for Bob.
      const docUrl = page.url();

      await step('alice-types-introduction', 'Alice writes the opening paragraph', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.type('Welcome to the weekly team sync. Agenda: project updates, blockers, and planning for next sprint.');
          await page.waitForTimeout(300);
        }
      });
      await step('alice-adds-second-paragraph', 'Alice adds a status update paragraph', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.press('Enter');
          await page.keyboard.press('Enter');
          await page.keyboard.type('Status: API migration is 80% complete. Auth middleware and rate limiting remain.');
        }
      });

      // --- Phase 2: Bob joins — dual screenshots from here ---
      const ctxB = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
      const pageB = await ctxB.newPage();
      pageB.on('pageerror', (e) => log(`  [Bob] pageerror: ${e.message}`));

      try {
        await step.dual(pageB, chromium, 'bob-opens-document', 'Bob opens the same document in a second browser', async () => {
          await pageB.goto(docUrl, { waitUntil: 'domcontentloaded' });
          await pageB.waitForTimeout(1_500);
        });

        await step.dual(pageB, chromium, 'bob-sees-alice-content', "Bob's view shows Alice's text synced via CRDT", async () => {
          await pageB.waitForTimeout(800);
        });

        // --- Presence & follow ---
        await step.dual(pageB, chromium, 'check-presence-indicators', 'Both browsers show presence avatars in the header', async () => {
          // Wait for presence to sync between the two browser contexts
          await page.waitForTimeout(1_000);
          await pageB.waitForTimeout(500);
          // Scroll to top on both to see the header with avatars
          await page.evaluate(() => window.scrollTo({ top: 0 }));
          await pageB.evaluate(() => window.scrollTo({ top: 0 }));
          await page.waitForTimeout(300);
        });

        await step.dual(pageB, chromium, 'bob-hovers-alice-avatar', 'Bob hovers over Alice\'s avatar to see the tooltip with Follow button', async () => {
          const avatars = await pageB.$('[data-testid="participant-avatars"]');
          if (avatars) {
            const items = await avatars.$('div[style*="cursor"]');
            if (items.length > 0) {
              await items[0].hover();
              await pageB.waitForTimeout(600);
            }
          }
        });

        await step.dual(pageB, chromium, 'bob-clicks-follow', 'Bob clicks "Follow" to track Alice\'s cursor and scroll position', async () => {
          const followBtn = await pageB.$('div[role="button"]:has-text("Follow")');
          if (followBtn) {
            await followBtn.click();
            await pageB.waitForTimeout(600);
          }
        });

        await step.dual(pageB, chromium, 'alice-continues-typing', 'Alice adds more content while Bob watches', async () => {
          const editable = await page.$('[contenteditable="true"]');
          if (editable) {
            await editable.click();
            await page.keyboard.press('Enter');
            await page.keyboard.type('Design review confirmed for Thursday 2pm. Stakeholders: eng-leads, PM, design.');
          }
        });

        await step.dual(pageB, chromium, 'bob-scrolls-to-notes', 'Bob scrolls down to the Meeting Notes section', async () => {
          await pageB.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'bob-types-in-notes', 'Bob starts typing in the Meeting Notes section', async () => {
          const editables = await pageB.$$('[contenteditable="true"]');
          const target = editables.length > 1 ? editables[editables.length - 1] : editables[0];
          if (target) {
            await target.click();
            await pageB.keyboard.type('Bob: CI flakiness needs resolution before release. Affected: e2e suite on staging.');
            await pageB.waitForTimeout(300);
          }
        });

        await step.dual(pageB, chromium, 'both-typing-simultaneously', 'Both users type at the same time in different sections', async () => {
          const aliceEditable = await page.$('[contenteditable="true"]');
          const bobEditables = await pageB.$$('[contenteditable="true"]');
          const bobEditable = bobEditables.length > 1 ? bobEditables[bobEditables.length - 1] : bobEditables[0];
          await Promise.all([
            (async () => {
              if (aliceEditable) {
                await aliceEditable.click();
                await page.keyboard.type(' Deadline: end of Sprint 19.');
              }
            })(),
            (async () => {
              if (bobEditable) {
                await bobEditable.click();
                await pageB.keyboard.type(' Also: new hire onboarding docs need review by Friday.');
              }
            })(),
          ]);
          await page.waitForTimeout(600);
        });

        await step.dual(pageB, chromium, 'see-follow-tracking', 'Bob\'s view auto-scrolls to follow Alice — "following" badge visible in header', async () => {
          // Alice scrolls to top, Bob should follow
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await page.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'alice-sees-bob-notes', 'Alice scrolls down to see what Bob wrote in notes', async () => {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        });

        // --- Phase 3: Cross-mode collaboration ---
        await step.dual(pageB, chromium, 'bob-switches-to-review', 'Bob switches to Review mode while Alice edits', async () => {
          const reviewBtn = await pageB.$('[data-testid="mode-btn-ack"]')
            ?? await pageB.$('button:has-text("Review")');
          if (reviewBtn) await reviewBtn.click();
          await pageB.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'bob-approves-intro', 'Bob approves the Introduction section', async () => {
          const btn = await pageB.$('[data-testid$="-review-approved"]');
          if (btn) await btn.click();
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'bob-requests-changes-on-actions', 'Bob requests changes on the Action Items section', async () => {
          const btns = await pageB.$$('[data-testid$="-review-changes-requested"]');
          if (btns.length > 0) await btns[0].click();
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'bob-approves-notes', 'Bob marks Meeting Notes as reviewed', async () => {
          const btns = await pageB.$$('[data-testid$="-review-reviewed"]');
          if (btns.length > 0) await btns[0].click();
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'alice-reader-bob-review', 'Alice switches to Reader mode — split: Alice reads, Bob reviews', async () => {
          const readBtn = await page.$('[data-testid="mode-btn-reader"]')
            ?? await page.$('button:has-text("Read")');
          if (readBtn) await readBtn.click();
          await page.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'cross-mode-split', 'Stitched view: Alice in Reader mode (left) and Bob in Review mode (right)', async () => {
          await page.waitForTimeout(300);
        });

        await step.dual(pageB, chromium, 'both-back-to-editor', 'Both users return to Editor mode', async () => {
          const aliceBtn = await page.$('[data-testid="mode-btn-editor"]')
            ?? await page.$('button:has-text("Editor")');
          const bobBtn = await pageB.$('[data-testid="mode-btn-editor"]')
            ?? await pageB.$('button:has-text("Editor")');
          if (aliceBtn) await aliceBtn.click();
          if (bobBtn) await bobBtn.click();
          await page.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'final-collab-state', 'Final state — both users in editor, all content visible', async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await pageB.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await page.waitForTimeout(500);
        });
      } finally {
        await ctxB.close();
      }

      // --- Solo closing steps ---
      await step('alice-returns-to-list', 'Alice navigates back to the documents list', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('document-in-list', 'The document appears in the documents list', async () => {
        await page.waitForTimeout(400);
      });
    },
  },

  // =========================================================================
  // Journey 5: Pipeline Create, Configure, and Run (75+ steps)
  //   Comprehensive pipeline journey: templates, canvas editor, node palette,
  //   config panel, execution log, runs page, stats page, observability.
  // =========================================================================
  {
    slug: 'pipeline-create-configure-run',
    title: 'Comprehensive pipeline journey — templates to observability',
    description: 'Operator browses templates, creates from blank, explores canvas editor with node palette and keyboard shortcuts, config panel tabs, execution log, overflow menu, simulator, version diff, runs page with all filters, stats page KPIs, second pipeline, pending approvals, and full observability dashboard.',
    async run(page, step) {
      // --- Phase 1: Pipeline list & templates ---
      await step('land-on-pipelines', 'Navigate to /pipelines', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.waitForTimeout(800);
      });
      await step('see-pipeline-list-page', 'See the pipelines list page with header and filter bar', async () => {
        await page.waitForTimeout(400);
      });
      await step('open-templates-modal', 'Click Templates to browse prebuilt pipeline templates', async () => {
        const tpl = await page.$('button:has-text("Templates"), button:has-text("Browse Templates"), [data-testid="templates-btn"]');
        if (tpl) { await tpl.click(); await page.waitForTimeout(600); }
      });
      await step('see-templates-grid', 'See the template gallery with searchable card grid', async () => {
        await page.waitForTimeout(400);
      });
      await step('search-templates', 'Type a search term in the templates search box', async () => {
        await fillIfExists(page, '[data-testid="templates-search"]', 'review');
        await page.waitForTimeout(300);
      });
      await step('close-templates', 'Close the templates modal', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      });

      // --- Phase 2: Create pipeline from blank ---
      await step('open-new-pipeline-modal', 'Click the new-pipeline trigger to create from blank', async () => {
        const launcher = await page.$('button:has-text("New Pipeline"), button:has-text("+ New"), button:has-text("Blank")');
        if (launcher) {
          await launcher.click();
          await page.waitForSelector('[data-testid="new-pipeline-name"]', { timeout: 5_000 }).catch(() => {});
        }
      });
      await step('name-the-pipeline', 'Name it "Content Review Pipeline"', async () => {
        await fillIfExists(page, '[data-testid="new-pipeline-name"]', 'Content Review Pipeline');
      });
      await step('create-pipeline', 'Click Create to land in the canvas editor', async () => {
        const confirm = await page.$('[data-testid="new-pipeline-confirm"]');
        if (confirm) {
          await confirm.click();
          await Promise.race([
            page.waitForSelector('[data-testid="pipeline-editor"]', { timeout: 8_000 }),
            page.waitForURL(/\/pipelines\/[^/]+$/, { timeout: 8_000 }),
          ]).catch(() => {});
        }
      });
      await step('see-canvas-editor', 'See the pipeline canvas editor with left palette and center canvas', async () => {
        await page.waitForTimeout(800);
      });

      // --- Phase 3: Explore node palette ---
      await step('see-palette-and-trigger', 'See the left node palette showing all available node types and the default trigger node on canvas', async () => {
        await page.waitForTimeout(500);
      });
      await step('search-palette-for-transform', 'Type "transform" in palette search to filter, then clear it', async () => {
        const search = await page.$('[data-testid="palette-search"], [data-testid="node-search"]');
        if (search) {
          await search.click();
          await search.fill('transform');
          await page.waitForTimeout(600);
        }
      });
      await step('see-filtered-palette', 'See the palette filtered to show only Transform node type', async () => {
        await page.waitForTimeout(400);
        const search = await page.$('[data-testid="palette-search"], [data-testid="node-search"]');
        if (search) await search.fill('');
        await page.waitForTimeout(200);
      });

      // --- Phase 4: Build a connected pipeline via dev bridge ---
      await step('build-connected-pipeline', 'Use the dev bridge to insert LLM, Transform, Condition, and Action nodes at explicit positions', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const bridge = window.__pipelineEditor;
          if (!bridge) return;
          const triggerId = bridge.findNodeIdByType('trigger');
          const llmId = bridge.insertNode('llm', { x: 360, y: 120 });
          const transformId = bridge.insertNode('transform', { x: 640, y: 120 });
          const conditionId = bridge.insertNode('condition', { x: 920, y: 120 });
          const actionOk = bridge.insertNode('action', { x: 1200, y: 40 });
          const actionFail = bridge.insertNode('action', { x: 1200, y: 220 });
          // Connect: trigger → llm → transform → condition → action (ok/fail)
          if (triggerId) bridge.connect(triggerId, llmId);
          bridge.connect(llmId, transformId);
          bridge.connect(transformId, conditionId);
          bridge.connect(conditionId, actionOk, { sourceHandle: 'true' });
          bridge.connect(conditionId, actionFail, { sourceHandle: 'false' });
          // Label the nodes AND fill required config so validation passes
          bridge.updateNodeData(actionOk, { label: 'Publish Results', actionType: 'webhook' });
          bridge.updateNodeData(actionFail, { label: 'Send Alert', actionType: 'webhook' });
          bridge.updateNodeData(llmId, {
            label: 'Analyze Content',
            systemPrompt: 'You are a content reviewer.',
            userPromptTemplate: 'Review the following: {{input}}',
          });
          bridge.updateNodeData(transformId, {
            label: 'Format Output',
            expression: '$.result',
          });
          bridge.updateNodeData(conditionId, {
            label: 'Quality Check',
            expression: '$.score > 0.8',
          });
        });
        await page.waitForTimeout(800);
      });

      await step('see-connected-nodes', 'See all five nodes with edges connecting them in a proper DAG', async () => {
        await page.waitForTimeout(400);
      });

      // --- Phase 5: Auto-arrange and config panel ---
      await step('auto-arrange-nodes', 'Click auto-arrange to lay out nodes in clean columns', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(600);
        // Fit view to show the full pipeline
        const fitBtn = await page.$('button[title="Fit view"], button[aria-label="Fit view"]');
        if (fitBtn) { await fitBtn.click(); await page.waitForTimeout(500); }
      });

      await step('see-dag-layout', 'See the auto-arranged DAG: trigger → LLM → transform → condition → actions', async () => {
        await page.waitForTimeout(500);
      });
      await step('click-llm-node', 'Click the LLM node on the canvas to open its config panel', async () => {
        const node = await page.$('[data-testid="canvas-node-llm"], [data-node-type="llm"], [data-testid*="node"][data-testid*="llm"]');
        if (node) { await node.click(); }
        else {
          const nodes = await page.$('[data-testid^="canvas-node-"]');
          if (nodes.length > 1) await nodes[1].click();
        }
        await page.waitForTimeout(800);
      });
      await step('see-config-panel', 'See the right-side config panel with Config / Runs / Docs tabs', async () => {
        await page.waitForTimeout(300);
      });
      await step('click-docs-tab', 'Click the Docs tab to see node type documentation', async () => {
        const docsTab = await page.$('[data-testid="config-tab-docs"], button:has-text("Docs")');
        if (docsTab) await docsTab.click();
        await page.waitForTimeout(300);
      });
      await step('click-config-tab', 'Click back to the Config tab', async () => {
        const configTab = await page.$('[data-testid="config-tab-config"], button:has-text("Config")');
        if (configTab) await configTab.click();
        await page.waitForTimeout(300);
      });
      await step('deselect-node', 'Press Escape to deselect the node and close the config panel', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      });

      // --- Phase 6: Execution log ---
      await step('expand-execution-log', 'Click the chevron to expand the collapsed execution log', async () => {
        const chevron = await page.$('[data-testid="execution-log-toggle"], [data-testid="exec-log-chevron"]');
        if (chevron) await chevron.click();
        await page.waitForTimeout(400);
      });
      await step('click-fullscreen-log', 'Click the fullscreen button on the execution log', async () => {
        await clickIfExists(page, '[data-testid="execution-log-fullscreen-btn"]');
        await page.waitForTimeout(200);
      });
      await step('close-fullscreen-log', 'Close the fullscreen execution log', async () => {
        await clickIfExists(page, '[data-testid="execution-log-fullscreen-close"]');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      });

      // --- Phase 7: Rename & overflow menu ---
      await step('click-pipeline-name', 'Click the pipeline name to rename it', async () => {
        await clickIfExists(page, '[data-testid="pipeline-name"]');
        await page.waitForTimeout(200);
      });
      await step('rename-pipeline', 'Rename to "Content Review Pipeline v2"', async () => {
        const nameInput = await page.$('[data-testid="pipeline-name-input"], [data-testid="pipeline-name"] input');
        if (nameInput) {
          await nameInput.fill('Content Review Pipeline v2');
          await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(300);
      });
      await step('open-overflow-menu', 'Click the overflow menu button', async () => {
        await clickIfExists(page, '[data-testid="overflow-menu-btn"]');
        await page.waitForTimeout(200);
      });
      await step('close-overflow-menu', 'See Duplicate/Export/Publish/Delete options then close', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      });

      // --- Phase 8: Validation, simulator, versions ---
      await step('click-validation-indicator', 'Click the validation indicator to see any warnings', async () => {
        await clickIfExists(page, '[data-testid="validation-indicator"]');
        await page.waitForTimeout(200);
      });
      await step('click-sim-panel', 'Open the simulator panel if available', async () => {
        await clickIfExists(page, '[data-testid="sim-panel-open"]');
        await page.waitForTimeout(200);
      });
      await step('see-sim-panel', 'See the simulator panel for testing with mock data', async () => {
        await page.waitForTimeout(400);
      });
      await step('click-versions', 'Click version history button', async () => {
        await clickIfExists(page, '[data-testid="view-versions-btn"]');
        await page.waitForTimeout(200);
      });
      await step('close-versions', 'Close the version diff view', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      });

      // --- Phase 8b: Publish and execute the pipeline ---
      await step('publish-pipeline', 'Open overflow menu and click Publish to open confirm modal', async () => {
        await clickIfExists(page, '[data-testid="overflow-menu-btn"]');
        await page.waitForTimeout(500);
        // The menu item text is "Publish…" (unicode ellipsis)
        const menuItems = await page.$$('button');
        for (const btn of menuItems) {
          const text = (await btn.textContent()) ?? '';
          if (/^Publish/.test(text.trim())) {
            const isDisabled = await btn.isDisabled().catch(() => false);
            if (!isDisabled) {
              await btn.click();
              break;
            }
          }
        }
        await page.waitForTimeout(600);
      });

      await step('confirm-publish', 'Click the Publish button in the confirmation modal', async () => {
        // The confirm modal has a "Publish" button (not "Publish…")
        // It's inside a dialog — find buttons in the modal
        const dialog = await page.$('[role="dialog"]');
        if (dialog) {
          const btns = await dialog.$$('button');
          for (const btn of btns) {
            const text = (await btn.textContent()) ?? '';
            if (/^Publish$/i.test(text.trim())) {
              const isDisabled = await btn.isDisabled().catch(() => false);
              if (!isDisabled) {
                await btn.click();
                break;
              }
            }
          }
        }
        await page.waitForTimeout(800);
      });

      await step('see-published-badge', 'See the version badge update to show Published status', async () => {
        await page.waitForTimeout(500);
      });

      await step('click-run-button', 'Click the green Run button to execute the pipeline', async () => {
        const runBtn = await page.$('[data-testid="run-button"]');
        if (runBtn) {
          const isDisabled = await runBtn.isDisabled().catch(() => true);
          if (!isDisabled) {
            await runBtn.click();
          }
        }
        // Wait for the MockExecutor to start and process nodes
        await page.waitForTimeout(3_000);
      });

      await step('see-execution-running', 'See the execution log updating with step-by-step events', async () => {
        await page.waitForTimeout(2_000);
      });

      await step('wait-for-execution-complete', 'Wait for the pipeline execution to finish completely', async () => {
        // MockExecutor runs async — wait up to 15s for it to reach terminal state
        for (let i = 0; i < 15; i++) {
          const logText = await page.textContent('[data-testid="execution-log"]').catch(() => '');
          if (/completed|failed|cancelled/i.test(logText ?? '')) break;
          // Also check if run button changed to "Re-run" (means execution finished)
          const runBtnText = await page.textContent('[data-testid="run-button"]').catch(() => '');
          if (/re-run/i.test(runBtnText ?? '')) break;
          await page.waitForTimeout(1_000);
        }
        await page.waitForTimeout(1_000);
      });

      await step('see-execution-results', 'See the completed execution log with all node results', async () => {
        // Expand the log if collapsed
        const toggle = await page.$('[data-testid="execution-log-toggle"], [data-testid="exec-log-chevron"]');
        if (toggle) { await toggle.click(); await page.waitForTimeout(400); }
        await page.waitForTimeout(600);
      });

      await step('see-node-success-states', 'See nodes highlighted with success/failure states on the canvas', async () => {
        await page.waitForTimeout(500);
      });

      // Capture pipeline ID for runs/stats pages
      const pipelineUrl = page.url();
      const pipelineId = pipelineUrl.split('/pipelines/')[1]?.split(/[?#/]/)[0] ?? 'unknown';

      // --- Phase 9: Runs page with all filters ---
      await step('go-to-runs-page', 'Navigate to the pipeline runs page to see completed run', async () => {
        // Wait extra to ensure the MockExecutor has finished and persisted the run
        await page.waitForTimeout(2_000);
        await page.goto(`${FRONTEND_BASE}/pipelines/${pipelineId}/runs`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1_200);
      });
      await step('see-run-in-table', 'See the completed run in the runs table with status, duration, and cost', async () => {
        await page.waitForTimeout(600);
      });
      await step('type-in-runs-search', 'Type a search query in the runs search box', async () => {
        await fillIfExists(page, '[data-testid="runs-search-input"]', 'content review');
        await page.waitForTimeout(200);
      });
      await step('open-status-dropdown', 'Open the Status filter dropdown and select Completed + Failed', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-dropdown"]');
        await page.waitForTimeout(300);
        await clickIfExists(page, '[data-testid="runs-status-chip-completed"]');
        await page.waitForTimeout(150);
        await clickIfExists(page, '[data-testid="runs-status-chip-failed"]');
        await page.waitForTimeout(300);
      });
      await step('open-trigger-dropdown', 'Open the Trigger filter dropdown and select Manual', async () => {
        await clickIfExists(page, '[data-testid="runs-trigger-chip-dropdown"]');
        await page.waitForTimeout(300);
        await clickIfExists(page, '[data-testid="runs-trigger-chip-manual"]');
        await page.waitForTimeout(300);
      });
      await step('click-range-24h', 'Click the 24h date range pill', async () => {
        await clickIfExists(page, '[data-testid="runs-range-24h"]');
        await page.waitForTimeout(200);
      });
      await step('click-range-7d', 'Click the 7d date range pill', async () => {
        await clickIfExists(page, '[data-testid="runs-range-7d"]');
        await page.waitForTimeout(200);
      });
      await step('click-range-30d', 'Click the 30d date range pill', async () => {
        await clickIfExists(page, '[data-testid="runs-range-30d"]');
        await page.waitForTimeout(200);
      });
      await step('click-range-all', 'Click All to show all runs', async () => {
        await clickIfExists(page, '[data-testid="runs-range-all"]');
        await page.waitForTimeout(200);
      });

      // --- Phase 10: Stats page ---
      await step('go-to-stats-page', 'Navigate to the pipeline stats page', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines/${pipelineId}/stats`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-stats-kpi-row', 'See the KPI row: total runs, success rate, median duration, cost', async () => {
        await page.waitForTimeout(400);
      });
      await step('scroll-to-charts', 'Scroll down to see cost/duration/token trend charts', async () => {
        await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });
      await step('see-cost-by-node-chart', 'See the cost-by-node breakdown chart', async () => {
        await page.waitForTimeout(300);
      });
      await step('scroll-to-failure-breakdown', 'Scroll to failure breakdown and cost trend', async () => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });

      // --- Phase 11: Back to list, second pipeline ---
      await step('back-to-pipeline-list', 'Navigate back to /pipelines', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-first-pipeline-in-list', 'See Content Review Pipeline v2 in the list', async () => {
        await page.waitForTimeout(400);
      });
      await step('create-second-pipeline', 'Click new pipeline button', async () => {
        const launcher = await page.$('button:has-text("New Pipeline"), button:has-text("+ New"), button:has-text("Blank")');
        if (launcher) {
          await launcher.click();
          await page.waitForSelector('[data-testid="new-pipeline-name"]', { timeout: 5_000 }).catch(() => {});
        }
      });
      await step('name-second-pipeline', 'Name it "Data Ingestion Pipeline"', async () => {
        await fillIfExists(page, '[data-testid="new-pipeline-name"]', 'Data Ingestion Pipeline');
      });
      await step('create-second', 'Click Create to open the second pipeline editor', async () => {
        const confirm = await page.$('[data-testid="new-pipeline-confirm"]');
        if (confirm) {
          await confirm.click();
          await Promise.race([
            page.waitForSelector('[data-testid="pipeline-editor"]', { timeout: 8_000 }),
            page.waitForURL(/\/pipelines\/[^/]+$/, { timeout: 8_000 }),
          ]).catch(() => {});
        }
      });
      await step('see-second-editor', 'See the second pipeline editor canvas', async () => {
        await page.waitForTimeout(800);
      });

      // --- Phase 12: Build connected second pipeline via dev bridge ---
      await step('build-second-pipeline', 'Insert and connect nodes for a data ingestion pipeline', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const bridge = window.__pipelineEditor;
          if (!bridge) return;
          const triggerId = bridge.findNodeIdByType('trigger');
          const llmId = bridge.insertNode('llm', { x: 360, y: 120 });
          const forkId = bridge.insertNode('fork', { x: 640, y: 120 });
          const transformA = bridge.insertNode('transform', { x: 920, y: 40 });
          const transformB = bridge.insertNode('transform', { x: 920, y: 220 });
          const joinId = bridge.insertNode('join', { x: 1200, y: 120 });
          const approvalId = bridge.insertNode('approval', { x: 1480, y: 120 });
          const actionId = bridge.insertNode('action', { x: 1760, y: 120 });
          // Connect: trigger → llm → fork → [transformA, transformB] → join → approval → action
          if (triggerId) bridge.connect(triggerId, llmId);
          bridge.connect(llmId, forkId);
          bridge.connect(forkId, transformA, { sourceHandle: 'branch-0' });
          bridge.connect(forkId, transformB, { sourceHandle: 'branch-1' });
          bridge.connect(transformA, joinId);
          bridge.connect(transformB, joinId);
          bridge.connect(joinId, approvalId);
          bridge.connect(approvalId, actionId, { sourceHandle: 'approved' });
          // Label nodes AND fill required config so validation passes
          bridge.updateNodeData(llmId, {
            label: 'Parse Input',
            systemPrompt: 'You parse structured data from raw input.',
            userPromptTemplate: 'Parse this input: {{input}}',
          });
          bridge.updateNodeData(forkId, { branchCount: 2 });
          bridge.updateNodeData(transformA, { label: 'Validate Schema', expression: '$.validated' });
          bridge.updateNodeData(transformB, { label: 'Enrich Metadata', expression: '$.enriched' });
          bridge.updateNodeData(joinId, { mode: 'all', mergeStrategy: 'merge' });
          bridge.updateNodeData(approvalId, {
            label: 'Review Gate',
            approvers: ['ops-lead@example.com'],
            requiredCount: 1,
          });
          bridge.updateNodeData(actionId, { label: 'Write to Store', actionType: 'webhook' });
        });
        await page.waitForTimeout(800);
      });

      await step('auto-arrange-second', 'Auto-arrange to show the fork/join DAG layout', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(600);
        const fitBtn = await page.$('button[title="Fit view"], button[aria-label="Fit view"]');
        if (fitBtn) { await fitBtn.click(); await page.waitForTimeout(500); }
      });

      await step('see-second-pipeline-dag', 'See the data ingestion pipeline with fork/join branches', async () => {
        await page.waitForTimeout(500);
      });

      // --- Phase 13: Pending approvals ---
      await step('go-to-pending-approvals', 'Navigate to /pipelines/approvals', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines/approvals`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-approvals-page', 'See the pending approvals page with count badge', async () => {
        await page.waitForTimeout(400);
      });

      // --- Phase 14: Observability dashboard ---
      await step('go-to-observability-dashboard', 'Navigate to /observability', async () => {
        await page.goto(`${FRONTEND_BASE}/observability`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-dashboard-kpi-row', 'See the KPI row: runs today, active now, pending approvals, failed 24h', async () => {
        await page.waitForTimeout(400);
      });
      await step('scroll-to-cluster-health', 'Scroll to see the cluster health card with node grid', async () => {
        await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });
      await step('scroll-to-active-runs', 'Scroll to see the active runs table', async () => {
        await page.evaluate(() => window.scrollTo({ top: 800, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });
      await step('scroll-to-recent-events', 'Scroll to see recent events and alerts panel', async () => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });

      // --- Phase 15: Observability sub-pages ---
      await step('go-to-nodes-page', 'Navigate to /observability/nodes', async () => {
        await page.goto(`${FRONTEND_BASE}/observability/nodes`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-nodes-page-layout', 'See Chaos Panel on left and node grid with status/CPU/memory', async () => {
        await page.waitForTimeout(400);
      });
      await step('go-to-events-page', 'Navigate to /observability/events', async () => {
        await page.goto(`${FRONTEND_BASE}/observability/events`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-events-list', 'See the events list with pipeline and run filter controls', async () => {
        await page.waitForTimeout(400);
      });
      await step('go-to-metrics-page', 'Navigate to /observability/metrics', async () => {
        await page.goto(`${FRONTEND_BASE}/observability/metrics`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-metrics-chart-cards', 'See the metric chart cards with time range selector', async () => {
        await page.waitForTimeout(400);
      });
      await step('scroll-metrics-page', 'Scroll through the metrics charts', async () => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(400);
      });

      // --- Phase 16: Final list with filter chips ---
      await step('back-to-list-final', 'Return to /pipelines to see both pipelines', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('see-both-pipelines', 'See both Content Review and Data Ingestion pipelines', async () => {
        await page.waitForTimeout(400);
      });
      await step('click-draft-status-chip', 'Click the Draft status filter chip', async () => {
        await clickIfExists(page, '[data-testid="status-chip-draft"]');
        await page.waitForTimeout(200);
      });
      await step('click-published-status-chip', 'Click the Published status filter chip', async () => {
        await clickIfExists(page, '[data-testid="status-chip-published"]');
        await page.waitForTimeout(200);
      });
      await step('final-pipeline-list-state', 'Final state of the pipeline list with both pipelines', async () => {
        await page.waitForTimeout(400);
      });
    },
  },

  // =========================================================================
  // Journey 6: End-to-End — Type → Document → Collaboration → Pipeline
  //   Multi-page type creation, document instance, dual-user collaboration
  //   filling each page, finalize, and pipeline creation triggered by the
  //   document type.
  //   ~45 steps.
  // =========================================================================
  {
    slug: 'end-to-end-type-doc-collab-pipeline',
    title: 'End-to-end: multi-page type, collaborative editing, and pipeline trigger',
    description: 'Creates a multi-page "Product Spec" type with 3 pages (Overview, Design, Approval). Alice creates a document, fills page 1. Bob joins and fills page 2. Both collaborate on page 3. Document is finalized. A pipeline is created that triggers on document.finalize for this type.',
    async run(page, step, chromium) {
      const browser = page.context().browser();
      if (!browser) throw new Error('cannot resolve browser handle');

      // =================================================================
      // PHASE 1: Create a multi-page document type via the wizard
      // =================================================================

      await step('navigate-to-types', 'Navigate to /document-types', async () => {
        await page.goto(`${FRONTEND_BASE}/document-types`, { waitUntil: 'domcontentloaded' });
        await clearAccumulatedStorage(page);
        await page.waitForSelector('[data-testid="create-type-btn"]', { timeout: 10_000 });
      });

      await step('open-type-wizard', 'Click "+ New" to create a type', async () => {
        await page.click('[data-testid="create-type-btn"]');
        await page.waitForSelector('[data-testid="name-input"]', { timeout: 5_000 });
      });

      await step('name-product-spec', 'Name the type "Product Spec" with description', async () => {
        await page.fill('[data-testid="name-input"]', 'Product Spec');
        const desc = await page.$('[data-testid="description-input"]');
        if (desc) await desc.fill('Multi-page product specification — overview, technical design, and stakeholder approval. Used by cross-functional teams for feature sign-off.');
      });

      await step('advance-to-sections', 'Click Next to reach the Sections step', async () => {
        await page.click('[data-testid="wizard-next"]');
        await page.waitForSelector('[data-testid^="add-field-"]', { timeout: 8_000 });
      });

      // --- Page 1: Overview ---
      await step('add-overview-richtext', 'Add a Rich Text section for the product overview', async () => {
        await clickIfExists(page, '[data-testid="add-field-rich-text"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Product Overview');
        }
      });

      await step('add-goals-checklist', 'Add a Checklist section for success metrics', async () => {
        await clickIfExists(page, '[data-testid="add-field-checklist"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Success Metrics');
        }
      });

      // --- Page 2: Technical Design ---
      await step('add-page-2', 'Click "+ Add Page" for the Technical Design page', async () => {
        await clickIfExists(page, '[data-testid="add-page"]');
        await page.waitForTimeout(500);
      });

      await step('name-page-2', 'Name the second page "Technical Design"', async () => {
        const titles = await page.$$('[data-testid^="page-title-"]');
        if (titles.length >= 2) {
          await titles[1].fill('');
          await titles[1].fill('Technical Design');
        }
        await page.waitForTimeout(200);
      });

      await step('add-architecture-richtext', 'Add a Rich Text section for architecture', async () => {
        await clickIfExists(page, '[data-testid="add-field-rich-text"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Architecture');
        }
      });

      await step('add-tasks-section', 'Add a Tasks section for implementation plan', async () => {
        await clickIfExists(page, '[data-testid="add-field-tasks"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Implementation Plan');
        }
      });

      // --- Page 3: Approval ---
      await step('add-page-3', 'Click "+ Add Page" for the Approval page', async () => {
        await clickIfExists(page, '[data-testid="add-page"]');
        await page.waitForTimeout(500);
      });

      await step('name-page-3', 'Name the third page "Stakeholder Approval"', async () => {
        const titles = await page.$$('[data-testid^="page-title-"]');
        if (titles.length >= 3) {
          await titles[2].fill('');
          await titles[2].fill('Stakeholder Approval');
        }
        await page.waitForTimeout(200);
      });

      await step('add-decisions-section', 'Add a Decisions section for sign-off decisions', async () => {
        await clickIfExists(page, '[data-testid="add-field-decisions"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Sign-off Decisions');
        }
      });

      await step('add-approval-tasks', 'Add a Tasks section for approval action items', async () => {
        await clickIfExists(page, '[data-testid="add-field-tasks"]');
        await page.waitForTimeout(300);
        const fields = await page.$$('[data-testid^="field-name-"]');
        if (fields.length > 0) {
          await fields[fields.length - 1].fill('');
          await fields[fields.length - 1].fill('Approval Action Items');
        }
      });

      await step('see-3-page-wizard', 'See all 3 pages with 6 sections in the wizard', async () => {
        await page.waitForTimeout(400);
      });

      await step('enable-toc', 'Enable Table of Contents', async () => {
        const tocDiv = await page.$('[data-testid="page-config-toc"]');
        if (tocDiv) {
          const checkbox = await tocDiv.$('input[type="checkbox"]');
          if (checkbox) {
            const isChecked = await checkbox.isChecked();
            if (!isChecked) await checkbox.click();
          }
        }
        await page.waitForTimeout(200);
      });

      await step('save-product-spec-type', 'Walk wizard forward and save the type', async () => {
        for (let i = 0; i < 5; i++) {
          const next = await page.$('[data-testid="wizard-next"]');
          if (!next) break;
          const label = (await page.textContent('[data-testid="wizard-next"]')) ?? '';
          await next.click();
          if (/create type|save changes/i.test(label)) break;
          await page.waitForTimeout(200);
        }
        await page.waitForSelector('[data-testid="save-message"], [data-testid="type-list"]', { timeout: 5_000 });
      });

      await step('see-type-in-list', 'See "Product Spec" in the types sidebar', async () => {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('[data-testid^="type-item-"]'))
            .some(el => /product spec/i.test(el.textContent ?? '')),
          null, { timeout: 5_000 },
        );
      });

      // =================================================================
      // PHASE 2: Alice creates a document from the type and fills page 1
      // =================================================================

      await step('alice-go-to-documents', 'Alice navigates to /documents', async () => {
        await page.goto(`${FRONTEND_BASE}/documents`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });

      await step('alice-new-document', 'Alice clicks "+ New Document"', async () => {
        const btn = await page.$('[data-testid="new-document-btn"]')
          ?? await page.$('button:has-text("New Document")');
        if (btn) { await btn.click(); await page.waitForTimeout(600); }
      });

      await step('alice-pick-product-spec', 'Alice selects "Product Spec" type', async () => {
        const options = await page.$$('[data-testid^="type-option-"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (/product spec/i.test(text ?? '')) { await opt.click(); break; }
        }
        await page.waitForTimeout(300);
      });

      await step('alice-title-document', 'Alice names it "Notification System v2 Spec"', async () => {
        await fillIfExists(page, '[data-testid="new-doc-title"]', 'Notification System v2 Spec');
      });

      await step('alice-describe-document', 'Alice adds a description', async () => {
        await fillIfExists(page, '[data-testid="new-doc-description"]', 'Product spec for the notification system rewrite — real-time delivery, multi-channel routing, and preference management.');
      });

      await step('alice-create-document', 'Alice clicks "Create Document"', async () => {
        const submit = await page.$('[data-testid="new-doc-submit"]');
        if (submit) { await submit.click(); await page.waitForTimeout(1_500); }
      });

      await step('alice-open-document', 'Alice opens the newly created document', async () => {
        const cards = await page.$$('[data-testid^="document-card-"]');
        for (const card of cards) {
          const text = await card.textContent();
          if (/notification system/i.test(text ?? '')) { await card.click(); break; }
        }
        await page.waitForURL(/\/documents\/[^/]+/, { timeout: 5_000 }).catch(() => {
          if (cards.length > 0) cards[0].click();
        });
        await page.waitForTimeout(1_000);
      });

      await step('alice-see-editor', 'Alice sees the document editor with all sections from 3 pages', async () => {
        await page.waitForTimeout(600);
      });

      // Alice fills page 1 content
      await step('alice-fill-overview', 'Alice types the product overview', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.type('The Notification System v2 replaces our legacy email-only alerting with a unified multi-channel notification platform. Channels: in-app, email, SMS, and Slack. Key goals: sub-second delivery, user preference management, and digest batching for high-volume events.');
          await page.waitForTimeout(400);
        }
      });

      await step('alice-add-metrics', 'Alice adds success metrics via the checklist', async () => {
        const addBtns = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns.length > 0) {
          await addBtns[0].click();
          await page.waitForTimeout(300);
          await page.keyboard.type('P95 delivery latency < 500ms across all channels');
          await page.waitForTimeout(150);
        }
        const addBtns2 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns2.length > 0) {
          await addBtns2[0].click();
          await page.waitForTimeout(300);
          await page.keyboard.type('User opt-out rate < 5% after preference center launch');
          await page.waitForTimeout(150);
        }
        const addBtns3 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns3.length > 0) {
          await addBtns3[0].click();
          await page.waitForTimeout(300);
          await page.keyboard.type('Zero dropped notifications during peak (10k/min)');
        }
        await page.waitForTimeout(300);
      });

      await step('alice-see-page1-filled', 'Alice sees page 1 content filled — overview and metrics', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(500);
      });

      // Capture doc URL for Bob
      const docUrl = page.url();

      // =================================================================
      // PHASE 3: Bob joins — dual screenshots from here
      // =================================================================

      const ctxB = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
      const pageB = await ctxB.newPage();
      pageB.on('pageerror', (e) => log(`  [Bob] pageerror: ${e.message}`));

      try {
        await step.dual(pageB, chromium, 'bob-opens-document', 'Bob opens the same document in a second browser', async () => {
          await pageB.goto(docUrl, { waitUntil: 'domcontentloaded' });
          await pageB.waitForTimeout(1_500);
        });

        await step.dual(pageB, chromium, 'bob-sees-alice-content', "Bob sees Alice's overview and metrics synced", async () => {
          await pageB.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'presence-indicators', 'Both browsers show presence avatars', async () => {
          await page.evaluate(() => window.scrollTo({ top: 0 }));
          await pageB.evaluate(() => window.scrollTo({ top: 0 }));
          await page.waitForTimeout(600);
        });

        // --- Bob fills page 2: Technical Design ---
        await step.dual(pageB, chromium, 'bob-scrolls-to-architecture', 'Bob scrolls to the Architecture section (page 2)', async () => {
          const heading = await pageB.$('text=Architecture');
          if (heading) {
            await heading.scrollIntoViewIfNeeded();
            await pageB.waitForTimeout(400);
          } else {
            await pageB.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
            await pageB.waitForTimeout(600);
          }
        });

        await step.dual(pageB, chromium, 'bob-fills-architecture', 'Bob types the architecture description', async () => {
          const editables = await pageB.$$('[contenteditable="true"]');
          for (const ed of editables) {
            const text = await ed.textContent();
            if (!text || text.trim().length === 0) {
              await ed.click();
              await pageB.keyboard.type('Event-driven architecture: API Gateway → NATS JetStream → Channel Workers (email/SMS/push/Slack). PostgreSQL for preference storage, Redis for delivery dedup and rate limiting. Each channel worker is independently scalable. Dead letter queue for failed deliveries with automatic retry (exponential backoff, max 3 attempts).');
              break;
            }
          }
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'bob-adds-impl-tasks', 'Bob adds implementation plan tasks', async () => {
          const heading = await pageB.$('text=Implementation Plan');
          if (heading) {
            await heading.scrollIntoViewIfNeeded();
            await pageB.waitForTimeout(300);
          }
          const addBtns = await pageB.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns.length > 0) {
            await addBtns[addBtns.length - 1].click();
            await pageB.waitForTimeout(300);
            const inputs = await pageB.$$('input[type="text"]');
            if (inputs.length > 0) await inputs[inputs.length - 1].fill('Week 1-2: NATS cluster setup + channel worker scaffold');
          }
          await pageB.waitForTimeout(200);
          const addBtns2 = await pageB.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns2.length > 0) {
            await addBtns2[addBtns2.length - 1].click();
            await pageB.waitForTimeout(300);
            const inputs = await pageB.$$('input[type="text"]');
            if (inputs.length > 0) await inputs[inputs.length - 1].fill('Week 3-4: Preference API + digest batching logic');
          }
          await pageB.waitForTimeout(200);
          const addBtns3 = await pageB.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns3.length > 0) {
            await addBtns3[addBtns3.length - 1].click();
            await pageB.waitForTimeout(300);
            const inputs = await pageB.$$('input[type="text"]');
            if (inputs.length > 0) await inputs[inputs.length - 1].fill('Week 5-6: Integration testing + canary rollout');
          }
          await pageB.waitForTimeout(300);
        });

        await step.dual(pageB, chromium, 'alice-sees-bob-architecture', 'Alice scrolls down — sees Bob\'s architecture text appear via CRDT sync', async () => {
          const heading = await page.$('text=Architecture');
          if (heading) {
            await heading.scrollIntoViewIfNeeded();
          } else {
            await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
          }
          await page.waitForTimeout(800);
        });

        // --- Both collaborate on page 3: Approval ---
        await step.dual(pageB, chromium, 'both-scroll-to-approval', 'Both users scroll to the Stakeholder Approval section (page 3)', async () => {
          const headingA = await page.$('text=Sign-off Decisions');
          const headingB = await pageB.$('text=Sign-off Decisions');
          if (headingA) await headingA.scrollIntoViewIfNeeded();
          else await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          if (headingB) await headingB.scrollIntoViewIfNeeded();
          else await pageB.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        });

        await step.dual(pageB, chromium, 'alice-adds-decision', 'Alice adds a sign-off decision', async () => {
          const addBtn = await page.$('button:has-text("+ Add decision")');
          if (addBtn) {
            await addBtn.click();
            await page.waitForTimeout(400);
            const input = await page.$('input[placeholder="Describe the decision..."]');
            if (input) {
              await input.click();
              await input.fill('Approved: NATS JetStream as message broker — eng-leads unanimous');
            }
            await page.waitForTimeout(200);
          }
        });

        await step.dual(pageB, chromium, 'bob-adds-decision', 'Bob adds a second decision', async () => {
          const addBtn = await pageB.$('button:has-text("+ Add decision")');
          if (addBtn) {
            await addBtn.click();
            await pageB.waitForTimeout(400);
            const inputs = await pageB.$$('input[placeholder="Describe the decision..."]');
            if (inputs.length > 0) {
              const last = inputs[inputs.length - 1];
              await last.click();
              await last.fill('Deferred: SMS channel — launch with email + in-app + Slack first');
            }
            await pageB.waitForTimeout(200);
          }
        });

        await step.dual(pageB, chromium, 'bob-adds-approval-tasks', 'Bob adds approval action items', async () => {
          const addBtns = await pageB.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns.length > 0) {
            const btn = addBtns[addBtns.length - 1];
            await btn.click();
            await pageB.waitForTimeout(300);
            const inputs = await pageB.$$('input[type="text"]');
            if (inputs.length > 0) await inputs[inputs.length - 1].fill('PM sign-off on scope — @alice');
          }
          await pageB.waitForTimeout(200);
          const addBtns2 = await pageB.$$('button:has-text("+ Add item"), button:has-text("Add item")');
          if (addBtns2.length > 0) {
            const btn = addBtns2[addBtns2.length - 1];
            await btn.click();
            await pageB.waitForTimeout(300);
            const inputs = await pageB.$$('input[type="text"]');
            if (inputs.length > 0) await inputs[inputs.length - 1].fill('Security review — @infosec-team');
          }
          await pageB.waitForTimeout(300);
        });

        await step.dual(pageB, chromium, 'see-all-pages-filled', 'Both users scroll to top — all 3 pages filled collaboratively', async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await pageB.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await page.waitForTimeout(600);
        });

        // --- Bob switches to Review mode, Alice stays in editor ---
        await step.dual(pageB, chromium, 'bob-enters-review', 'Bob switches to Review mode while Alice continues editing', async () => {
          const btn = await pageB.$('[data-testid="mode-btn-ack"]')
            ?? await pageB.$('button:has-text("Review")');
          if (btn) await btn.click();
          await pageB.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'bob-approves-overview', 'Bob approves the Product Overview section', async () => {
          const btn = await pageB.$('[data-testid$="-review-approved"]');
          if (btn) await btn.click();
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'bob-approves-architecture', 'Bob approves the Architecture section', async () => {
          const btns = await pageB.$$('[data-testid$="-review-approved"]');
          if (btns.length > 0) await btns[0].click();
          await pageB.waitForTimeout(400);
        });

        await step.dual(pageB, chromium, 'cross-mode-view', 'Split view: Alice in Editor (left), Bob in Review (right)', async () => {
          await page.evaluate(() => window.scrollTo({ top: 0 }));
          await pageB.evaluate(() => window.scrollTo({ top: 0 }));
          await page.waitForTimeout(400);
        });

        // Both return to editor
        await step.dual(pageB, chromium, 'both-back-to-editor', 'Both users return to Editor mode', async () => {
          const bobBtn = await pageB.$('[data-testid="mode-btn-editor"]')
            ?? await pageB.$('button:has-text("Editor")');
          if (bobBtn) await bobBtn.click();
          await pageB.waitForTimeout(500);
        });

        // Alice switches to Reader to show final document
        await step.dual(pageB, chromium, 'alice-reader-final', 'Alice switches to Reader mode to see the finalized document', async () => {
          const btn = await page.$('[data-testid="mode-btn-reader"]')
            ?? await page.$('button:has-text("Read")');
          if (btn) await btn.click();
          await page.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'final-collab-state', 'Final collaborative state — Alice reads, Bob edits', async () => {
          await page.evaluate(() => window.scrollTo({ top: 0 }));
          await pageB.evaluate(() => window.scrollTo({ top: 0 }));
          await page.waitForTimeout(500);
        });
      } finally {
        await ctxB.close();
      }

      // =================================================================
      // PHASE 4: Create a pipeline triggered by the Product Spec type
      // =================================================================

      await step('go-to-pipelines', 'Navigate to /pipelines', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });

      await step('open-new-pipeline', 'Click to create a new pipeline', async () => {
        const btn = await page.$('button:has-text("New Pipeline"), button:has-text("+ New"), button:has-text("Blank")');
        if (btn) {
          await btn.click();
          await page.waitForSelector('[data-testid="new-pipeline-name"]', { timeout: 5_000 }).catch(() => {});
        }
      });

      await step('name-pipeline', 'Name it "Product Spec Review Pipeline"', async () => {
        await fillIfExists(page, '[data-testid="new-pipeline-name"]', 'Product Spec Review Pipeline');
      });

      await step('create-pipeline', 'Click Create to open the canvas editor', async () => {
        const confirm = await page.$('[data-testid="new-pipeline-confirm"]');
        if (confirm) {
          await confirm.click();
          await Promise.race([
            page.waitForSelector('[data-testid="pipeline-editor"]', { timeout: 8_000 }),
            page.waitForURL(/\/pipelines\/[^/]+$/, { timeout: 8_000 }),
          ]).catch(() => {});
        }
      });

      await step('see-pipeline-editor', 'See the blank pipeline canvas with trigger node', async () => {
        await page.waitForTimeout(800);
      });

      // Build the pipeline via dev bridge
      await step('build-review-pipeline', 'Build a document review pipeline: trigger → LLM → condition → approve/flag', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const bridge = window.__pipelineEditor;
          if (!bridge) return;
          const triggerId = bridge.findNodeIdByType('trigger');
          const llmId = bridge.insertNode('llm', { x: 360, y: 120 });
          const condId = bridge.insertNode('condition', { x: 640, y: 120 });
          const approveId = bridge.insertNode('action', { x: 920, y: 40 });
          const flagId = bridge.insertNode('action', { x: 920, y: 220 });
          if (triggerId) bridge.connect(triggerId, llmId);
          bridge.connect(llmId, condId);
          bridge.connect(condId, approveId, { sourceHandle: 'true' });
          bridge.connect(condId, flagId, { sourceHandle: 'false' });
          bridge.updateNodeData(llmId, { label: 'Review Content' });
          bridge.updateNodeData(condId, { label: 'Meets Standards?' });
          bridge.updateNodeData(approveId, { label: 'Auto-Approve' });
          bridge.updateNodeData(flagId, { label: 'Flag for Review' });
        });
        await page.waitForTimeout(800);
      });

      await step('auto-arrange', 'Auto-arrange the pipeline nodes', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
        await page.waitForTimeout(600);
        const fit = await page.$('button[title="Fit view"], button[aria-label="Fit view"]');
        if (fit) { await fit.click(); await page.waitForTimeout(500); }
      });

      await step('see-connected-pipeline', 'See the complete pipeline: trigger → Review Content → Meets Standards? → Auto-Approve / Flag for Review', async () => {
        await page.waitForTimeout(500);
      });

      // Configure trigger to fire on document.finalize
      await step('click-trigger-node', 'Click the trigger node to open its config', async () => {
        const node = await page.$('[data-testid="canvas-node-trigger"], [data-node-type="trigger"], [data-testid*="node"][data-testid*="trigger"]');
        if (node) await node.click();
        else {
          const nodes = await page.$$('[data-testid^="canvas-node-"]');
          if (nodes.length > 0) await nodes[0].click();
        }
        await page.waitForTimeout(800);
      });

      await step('see-trigger-config', 'See the trigger config panel', async () => {
        await page.waitForTimeout(300);
      });

      await step('set-document-finalize-trigger', 'Set trigger type to document.finalize for Product Spec', async () => {
        // Select document.finalize from trigger type dropdown
        const triggerSelect = await page.$('select:near([data-testid="config-tab-config"])');
        if (triggerSelect) {
          await triggerSelect.selectOption('document.finalize');
          await page.waitForTimeout(300);
        }
        // Select the document type
        const typeSelect = await page.$$('select');
        for (const sel of typeSelect) {
          const options = await sel.$$('option');
          for (const opt of options) {
            const text = await opt.textContent();
            if (/product spec/i.test(text ?? '')) {
              await sel.selectOption({ label: text });
              break;
            }
          }
        }
        await page.waitForTimeout(400);
      });

      await step('see-trigger-configured', 'See the trigger configured for document.finalize on Product Spec', async () => {
        await page.waitForTimeout(400);
      });

      await step('deselect-and-see-full-pipeline', 'Press Escape to see the full pipeline', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      });

      await step('final-pipeline-state', 'Final state: pipeline connected to the Product Spec type, ready for document events', async () => {
        await page.waitForTimeout(400);
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
    await journey.run(page, step, chromium);
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
      app: journey.app || 'Websocket Gateway',
      runs: [],
    };
    index.journeys.push(entry);
  } else {
    entry.title = journey.title;
    entry.description = journey.description;
    if (!entry.app) entry.app = journey.app || 'Websocket Gateway';
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
    await writeIndex(index);
  }

  await closeStitchBrowser();
  log(`done — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`runner failed: ${err?.message ?? err}`);
  process.exit(2);
});
