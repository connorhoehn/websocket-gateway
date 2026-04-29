# Document UI audit — live browser survey

Driven via Playwright MCP against `http://localhost:5174` (Vite dev server, social-api on :3001, WS gateway not running). Captured 2026-04-29.

## Summary

| Surface | Existing testids | Status |
|---|---|---|
| **A. Document creation** (`/documents` + NewDocumentModal) | 2 | ⚠️ Sparse — list page is uninstrumented; modal only has type-picker |
| **B. Doc-type wizard** (`/document-types`) | 31 across 3 steps | ✅ Solid — wizard end-to-end testable today |
| **C. Configurable display modes** (wizard step 3) | 6 per field × 3 modes | ✅ Solid for existing per-field hide/renderer; **drag-nest doesn't exist** |
| **D. Section reviews** (`ReviewMode.tsx`) | 0 | ❌ Entirely uninstrumented |
| **E. Data Types** (`/field-types`) | 5 (1 duplicate) | ⚠️ Wireframe — minimal surface, has a strict-mode-violation duplicate |

End-to-end I confirmed: open Document Types tab → "+ New" → wizard step 1 (name/icon) → step 2 (add Rich Text section, see field-uuid testids) → step 3 (visibility/renderer per mode) → "Create Type" → list shows the new type with edit/delete affordances + a `save-message` flash. **The wizard happy path is testable today with zero UI changes.**

---

## A. Document creation

**Files:**
- `frontend/src/components/AppLayout.tsx` — owns the "+ New Document" button (line ~748)
- `frontend/src/components/doc-editor/NewDocumentModal.tsx` — the modal

**Existing testids:**
- `modal-backdrop` (modal wrapper)
- `type-option-{typeId}` (per type card in modal — uses the doc type's UUID)

**Missing testids (need to add before writing this spec):**
- `+ New Document` button on the Documents page → suggest `new-document-btn`
- Title input in modal → `new-doc-title`
- Description textarea in modal → `new-doc-description`
- "Create Document" submit button → `new-doc-submit`
- "Cancel" button → `new-doc-cancel`
- The "No documents yet" empty state → `documents-empty`

**Async hazards:**
- Document creation goes through **WebSocket `doc:create`** — the WS gateway must be running for the create to succeed. Today the page shows "Disconnected" without it. Spec needs to either (a) start gateway in test, (b) mock the WS layer with a fixture, or (c) accept that the spec only verifies the modal/UI side and not the actual creation roundtrip.
- Y.js editor mounts asynchronously after create — needs an "editor ready" signal.

**Backend deps:** WebSocket gateway (port 8080) + social-api (already on 3001).

---

## B. Doc-type wizard

**Files:** under `frontend/src/components/document-types/` (locations not deeply verified)

**Existing testids — solid coverage:**
- **List/idle:** `create-type-btn`, `type-list`, `right-panel`, `idle-panel`, `idle-create-btn`
- **Step 1 (Basic Info):** `name-input`, `description-input`, `icon-{emoji}` (×27 emoji buttons), `wizard-next`
- **Step 2 (Sections):** `fields-list`, `add-field-tasks` / `add-field-rich-text` / `add-field-decisions` / `add-field-checklist`. Per added section: `field-up-{uuid}`, `field-down-{uuid}`, `field-name-{uuid}`, `field-type-{uuid}`, `field-required-{uuid}`, `field-collapsed-{uuid}`, `field-remove-{uuid}`
- **Step 3 (View Modes):** `visibility-{uuid}-{editor|ack|reader}`, `renderer-{uuid}-{editor|ack|reader}`. The `wizard-next` button text changes to "Create Type" on the final step.
- **After create:** `type-item-{uuid}`, `edit-type-{uuid}`, `delete-type-{uuid}`, `save-message` (flash notice)

**Missing testids:**
- `Cancel` button (none — appears on every step)
- `← Back` button (none — appears on steps 2/3)
- Step indicator (no addressable testid — could expose as `wizard-step-{1|2|3}` if a spec wants to assert progress)

**Async hazards:** None significant. localStorage-only persistence, immediate state updates.

**Backend deps:** None.

---

## C. Configurable display modes

This is the existing form rendered in **wizard step 3**. The user's broader vision (Drupal-style drag-nest with field groups, multi-page wizard) is **not built**:

- ✅ Per-field visibility per mode (`visibility-{uuid}-{mode}`)
- ✅ Per-field renderer per mode (`renderer-{uuid}-{mode}`)
- ✅ 3 modes: `editor`, `ack` (review), `reader`
- ❌ **No drag-and-drop reorder** — section reorder is up/down arrow buttons only (`field-up-*`, `field-down-*`)
- ❌ **No grouping / nesting** — sections are flat
- ❌ **No multi-page wizard** — type creation is the 3-step wizard; the "wizard pages" the user envisioned for runtime doc editing don't exist

The existing display-modes spec can test the visibility/renderer toggle behavior. Drag-nest tests would be testing functionality that doesn't yet exist.

---

## D. Section reviews

**Files:**
- `frontend/src/components/doc-editor/ReviewMode.tsx`
- `frontend/src/components/doc-editor/ReviewableItem.tsx`
- `frontend/src/components/doc-editor/ReviewProgress.tsx`

**Existing testids: ZERO across all three files.** Verified via `grep -n "data-testid" frontend/src/components/doc-editor/Review*.tsx` returning no hits.

**Missing testids (full set needed before writing this spec):**
- The review-mode toggle / entry point on a document
- Per-section approve / request-changes buttons → `section-{id}-approve`, `section-{id}-request-changes`
- Reviewer chip → `section-{id}-reviewer`
- Status indicator → `section-{id}-status`
- The aggregate `ReviewProgress` bar
- Comment textbox if there is one

**Async hazards:** Backend persists via POST endpoint in social-api per earlier survey — needs social-api running with auth bypassed (already configured in `dev:all`).

**Live audit not possible without:** a way to open a document in review mode. Document creation requires WS gateway. Path of least resistance: seed a doc via `localStorage` or a fixture loader in test mode, then route to its review view. Need to investigate whether a `__docDemo.seed()` helper exists or should be added (analog of the existing `__pipelineDemo.seed()` pattern).

---

## E. Data Types (`/field-types`)

**Existing testids:** `new-data-type-button` (×2 — header + empty-state CTA), `name-input`, `description-input`, `primitive-type-select`, `next-button`.

**Critical issue:** **`new-data-type-button` is duplicated** — same testid on both buttons. Triggers a strict-mode violation in Playwright (confirmed during audit when `page.locator('[data-testid="new-data-type-button"]').click()` failed). Either differentiate (`new-data-type-btn-header` / `new-data-type-btn-empty`) or scope tests with `.first()` / `.last()`.

**Inconsistency:** doc-types wizard uses `wizard-next`; data-types wizard uses `next-button`. Pick a canonical name.

---

## Cross-cutting findings

- **No `__docDemo.seed()` style helper** — the gateway has `__pipelineDemo.seed()` but no analog for documents/types. Adding one would unblock spec writing for surfaces that need pre-seeded fixtures (especially D + the deeper paths of A).
- **WS gateway dependency for actual document creation** — spec strategy decision: full E2E vs UI-only. Tests that just exercise the modal can bypass WS; tests that verify the doc lands in the editor need it.
- **Vite runs on `:5174`** locally (not 5173 — port collision somewhere).
- **`dev:all` only starts Vite + social-api**; the WS gateway is a separate process.

---

## Gating gaps to fix BEFORE Phase 1 spec-writing

Ranked by ROI:

1. **Add 6 testids to `NewDocumentModal` + the "+ New Document" button** (~10 lines across 2 files). Unblocks Surface A spec.
2. **Add 5-7 testids to `ReviewMode` / `ReviewableItem` / `ReviewProgress`** (~15-20 lines across 3 files). Unblocks Surface D spec.
3. **Resolve `new-data-type-button` duplicate** (1 file, ~2 lines). Removes a strict-mode-violation hazard.
4. **Add a `__docDemo.seed()` helper** OR confirm that surface-D specs can stand up the WS gateway (a half-day decision).

Items 1-3 are mechanical and additive — could be done in a single PR before any spec work, or each spec agent could add the testids in their own worktree as part of their stream.

---

## Phase 1 spec plan (test what already exists)

| Spec file | Coverage | Prereqs | Estimated tests |
|---|---|---|---|
| `frontend/e2e/document-types.spec.ts` | Doc-type wizard end-to-end (create → edit → delete) | None (localStorage only) | 6-8 |
| `frontend/e2e/documents-create.spec.ts` | "+ New Document" → modal → type pick → fill → submit (UI side; roundtrip optional) | Add testids #1; decide WS strategy | 3-4 |
| `frontend/e2e/documents-display-modes.spec.ts` | Wizard step 3 visibility/renderer toggle behavior | None | 2-3 |
| `frontend/e2e/documents-section-reviews.spec.ts` | Review mode → per-section actions → reviewer state | Add testids #2; need fixture path (#4) | 3-4 |

**Total: ~15 tests across 4 spec files.** Roughly 1-2 days of agent work in parallel worktrees once testid gaps are closed.

The current state of `frontend/e2e/`:
- `frontend/e2e/observability.spec.ts` ✓ exists
- `frontend/e2e/pipelines.spec.ts` ✓ exists
- `frontend/e2e/sidebar-panels.spec.ts` ✓ exists
- No existing `documents.spec.ts` or `document-types.spec.ts` to merge with — the four new files are clean adds.

---

## Recommendation

1. **Wave 0 (mechanical, ~30 min):** Add the missing testids in items 1-3 above. One commit, no behavior change.
2. **Wave 1 (parallel, 4 spec agents):** Launch the four spec files concurrently in worktrees, each with a tight brief and the testid map from this audit.
3. **Wave 2 (decision):** After Phase 1 lands and we see real test results, triage the gap features (drag-nest, field validation, attestation, LLM migration, conversation-to-doc) — most of those are full builds, not test work.

The drag-nest / field-groups / multi-page wizard ask is unbuilt today; tests for that would be testing aspirational functionality, not existing code. The previous comprehensive plan I delivered (F1-F3 + #3-#7) covers building it and is still valid as a reference once you decide what to commit to.
