#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/snapshot-journeys.mjs';
let content = readFileSync(path, 'utf8');
let changes = 0;

function replace(old, nw, label) {
  if (!content.includes(old)) {
    console.error(`MISS: "${label}" — old string not found`);
    return;
  }
  content = content.replace(old, nw);
  changes++;
  console.log(`OK: ${label}`);
}

// Insert multi-page document steps at the end of Journey 2 (after "back-to-editor" step)

replace(
  `      await step('back-to-editor', 'Switch back to editor mode', async () => {
        const editorBtn = await page.$('[data-testid="mode-btn-editor"]')
          ?? await page.$('button:has-text("Editor")');
        if (editorBtn) await editorBtn.click();
        await page.waitForTimeout(500);
      });
    },
  },`,

  `      await step('back-to-editor', 'Switch back to editor mode', async () => {
        const editorBtn = await page.$('[data-testid="mode-btn-editor"]')
          ?? await page.$('button:has-text("Editor")');
        if (editorBtn) await editorBtn.click();
        await page.waitForTimeout(500);
      });

      // =========================================================
      // Phase B: Multi-page document type — create, fill, render
      // =========================================================

      await step('go-to-doc-types-for-multipage', 'Navigate to /document-types to create a multi-page type', async () => {
        await page.goto(\`\${FRONTEND_BASE}/document-types\`, { waitUntil: 'domcontentloaded' });
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
        // Rename the section
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
        const tocCheckbox = await page.$('[data-testid="page-config-toc"]');
        if (tocCheckbox) {
          const isChecked = await tocCheckbox.isChecked();
          if (!isChecked) await tocCheckbox.click();
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
        await page.goto(\`\${FRONTEND_BASE}/documents\`, { waitUntil: 'domcontentloaded' });
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
        // Find the card for our new doc
        const cards = await page.$$('[data-testid^="document-card-"]');
        for (const card of cards) {
          const text = await card.textContent();
          if (/platform modernization/i.test(text ?? '')) { await card.click(); break; }
        }
        // Fallback: click first card
        if (cards.length > 0) {
          await page.waitForURL(/\\/documents\\/[^/]+/, { timeout: 5_000 }).catch(async () => {
            await cards[0].click();
            await page.waitForURL(/\\/documents\\/[^/]+/, { timeout: 5_000 }).catch(() => {});
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
        // Find an empty editable (architecture section) — skip the first which has overview text
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
          const inputs = await page.$$('[contenteditable="true"]');
          const lastInput = inputs[inputs.length - 1];
          if (lastInput) {
            await lastInput.click();
            await page.keyboard.type('Adopt NATS JetStream over Kafka — lower operational overhead, native Go client, sufficient throughput for our scale (< 50k msg/s).');
          }
          await page.waitForTimeout(200);
        }
      });

      await step('add-signoff-task', 'Add sign-off tasks', async () => {
        const addBtns = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        // Find the last "Add item" button (for the sign-off tasks section)
        if (addBtns.length > 0) {
          const btn = addBtns[addBtns.length - 1];
          await btn.click();
          await page.waitForTimeout(200);
          await page.keyboard.type('Engineering lead sign-off — @alice');
          await page.waitForTimeout(150);
        }
        const addBtns2 = await page.$$('button:has-text("+ Add item"), button:has-text("Add item")');
        if (addBtns2.length > 0) {
          const btn = addBtns2[addBtns2.length - 1];
          await btn.click();
          await page.waitForTimeout(200);
          await page.keyboard.type('Product owner approval — @bob');
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
  },`,

  'J2: add multi-page document type creation and rendering'
);


writeFileSync(path, content, 'utf8');
console.log(`\nDone — ${changes} replacements applied. Lines: ${content.split('\\n').length}`);
