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

      // --- Fill in content ---
      await step('type-in-body-section', 'Type content into the rich-text body section', async () => {
        const editable = await page.$('[contenteditable="true"]');
        if (editable) {
          await editable.click();
          await page.keyboard.type('This sprint we shipped the new onboarding flow and fixed 12 bugs. Team morale is high — the design review went smoothly and stakeholders approved the Q3 roadmap.');
          await page.waitForTimeout(400);
        }
      });
      await step('scroll-through-sections', 'Scroll down to see all sections populated from the type', async () => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight / 2, behavior: 'smooth' }));
        await page.waitForTimeout(600);
      });
      await step('scroll-to-bottom', 'Scroll to bottom to see the full document', async () => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(600);
      });
      await step('scroll-back-to-top', 'Scroll back to the top to capture the complete view', async () => {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(400);
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
      await step('see-node-palette', 'See the left node palette with available node types', async () => {
        await page.waitForTimeout(300);
      });
      await step('see-trigger-node-on-canvas', 'See the default trigger node on the canvas', async () => {
        await page.waitForTimeout(300);
      });
      await step('search-palette', 'Type in the palette search to filter node types', async () => {
        const search = await page.$('[data-testid="palette-search"], [data-testid="node-search"]');
        if (search) { await search.click(); await search.fill('transform'); }
        await page.waitForTimeout(300);
      });
      await step('clear-palette-search', 'Clear the palette search to see all node types again', async () => {
        const search = await page.$('[data-testid="palette-search"], [data-testid="node-search"]');
        if (search) await search.fill('');
        await page.waitForTimeout(200);
      });

      // --- Phase 4: Add nodes via keyboard shortcuts ---
      await step('add-llm-node-via-shortcut', 'Press keyboard shortcut 2 to add an LLM node', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('2');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-transform-node', 'Press 3 to add a Transform node', async () => {
        await page.keyboard.press('3');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-condition-node', 'Press 4 to add a Condition node', async () => {
        await page.keyboard.press('4');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-action-node', 'Press 7 to add an Action node', async () => {
        await page.keyboard.press('7');
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });

      // --- Phase 5: Auto-arrange and config panel ---
      await step('auto-arrange-nodes', 'Click auto-arrange to organize the nodes on the canvas', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
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

      // Capture pipeline ID for runs/stats pages
      const pipelineUrl = page.url();
      const pipelineId = pipelineUrl.split('/pipelines/')[1]?.split(/[?#/]/)[0] ?? 'unknown';

      // --- Phase 9: Runs page with all filters ---
      await step('go-to-runs-page', 'Navigate to the pipeline runs page', async () => {
        await page.goto(`${FRONTEND_BASE}/pipelines/${pipelineId}/runs`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      });
      await step('type-in-runs-search', 'See the runs page and type a search query', async () => {
        await fillIfExists(page, '[data-testid="runs-search-input"]', 'content review');
        await page.waitForTimeout(200);
      });
      await step('click-status-chip-completed', 'Click the completed status filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-completed"]');
        await page.waitForTimeout(200);
      });
      await step('click-status-chip-failed', 'Click the failed status filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-status-chip-failed"]');
        await page.waitForTimeout(200);
      });
      await step('click-trigger-chip-manual', 'Click the manual trigger type filter chip', async () => {
        await clickIfExists(page, '[data-testid="runs-trigger-chip-manual"]');
        await page.waitForTimeout(200);
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

      // --- Phase 12: Add 6 node types to second pipeline ---
      await step('add-llm-to-second', 'Add an LLM node via shortcut 2', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('2');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-transform-to-second', 'Add a Transform node via shortcut 3', async () => {
        await page.keyboard.press('3');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-fork-to-second', 'Add a Fork node via shortcut 5', async () => {
        await page.keyboard.press('5');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-join-to-second', 'Add a Join node via shortcut 6', async () => {
        await page.keyboard.press('6');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('add-approval-to-second', 'Add an Approval node via shortcut 8', async () => {
        await page.keyboard.press('8');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
      await step('auto-arrange-second', 'Auto-arrange the second pipeline nodes', async () => {
        await clickIfExists(page, '[data-testid="auto-arrange-btn"]');
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
      runs: [],
    };
    index.journeys.push(entry);
  } else {
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
